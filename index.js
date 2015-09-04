var zlib = require('zlib');
var request = require('request');
var fs = require('fs');
var expat = require('node-expat');
var Readable = require('stream').Readable;
var util = require('util');
var MongoClient = require('mongodb').MongoClient;


util.inherits(MetaUtil, Readable)

function MetaUtil(opts) {
    if (!(this instanceof MetaUtil)) return new MetaUtil(opts);
    
    opts = opts || {}
    Readable.call(this, opts)
    
    var that = this;
    this.liveMode = (!opts.start && !opts.end && !opts.delay)
    this.state = Number(opts.start) || 0;
    this.end = Number(opts.end) || 1;
    this.diff = this.end - this.state;
    this.delay = (opts.delay || 60000)
    this.initialized = true;
    this.dbname = opts.db;
    this.tags_collection = opts.tags_collection;
    this.tags = (opts.tags ? opts.tags.split(" ") : []);

    this.baseURL = opts.baseURL || 'http://planet.osm.org/replication/changesets'
    this._changesetAttrs = {}
    this.started = false;
    //start

    MongoClient.connect('mongodb://localhost:27017/' + this.dbname, function(err, database) {
      if(err) throw err;
      that.db = database;
    });
}

MetaUtil.prototype._read = function() {
    var that = this;
    if (!this.started) {
        if (this.liveMode) {
            request.get('http://planet.osm.org/replication/changesets/state.yaml', 
            function(err, response, body) {
                that.state = Number(body.substr(body.length - 8))
                that.end = Infinity //don't stop
                that.delay = 60000 //every minute
                that.run()
                that.started = true;
            }
        )
        } else {
            this.run() 
            this.started = true  
        }
    }
}

MetaUtil.prototype.run = function() {
    var that = this;
    var numProcessed = 0;
    var parserEnd = function(name, attrs) {
        if (name === 'changeset') {
            that.push(new Buffer(JSON.stringify(that._changesetAttrs) + '\n'), 'ascii');

            if (! that._changesetAttrs['comment']) { return; }
            var intersection = []; var j = 0;
            var tags = that._changesetAttrs['comment'].split(/[\s,]+/);
            for (var i=0; i < tags.length; ++i) {
              var t = tags[i];
              if (tags[i] != undefined) { t = t.replace('\%23','#'); } 
              if (that.tags.indexOf(t.toLowerCase()) != -1)
                intersection[j++] = t;
            }
            if (j > 0) {
              that._changesetAttrs['comment'] = that._changesetAttrs['comment'].toLowerCase();
              that._changesetAttrs['created_at'] = new Date(that._changesetAttrs['created_at']);
              that._changesetAttrs['created_at'] = new Date(that._changesetAttrs['closed_at']);
              that.db.collection('changesets').update( { "id": that._changesetAttrs.id },
                that._changesetAttrs,
                { upsert: true,  writeConcern: 0  }, 
                function(err,result){});
            }
        }
        if (name === 'osm') {
            that.diff -= 1;
            if (!that.liveMode && that.diff < 0) {
                that.push(null)
            }
        }
    }

    var parserStart = function(name, attrs) {
        if (name === 'changeset') { 
            if (attrs) {
                that._changesetAttrs = attrs;
            }
        }
        if (name === 'tag' && that._changesetAttrs && that._changesetAttrs['open'] === 'false') { 
            that._changesetAttrs[attrs['k']] = attrs['v'];
        }
    }

    var interval = setInterval(function()  {

        if (that.tags_collection != "") {
          that.db.collection(that.tags_collection).find({"status":1}).toArray(function(err, results){ 
            that.tags = results.map(function(result){
              return result.tag;
            });
          });
        }

        //Add padding
        var stateStr = that.state.toString().split('').reverse()
        var diff = 9 - stateStr.length
        for (var i=0; i < diff; i++) { stateStr.push('0') }
        stateStr = stateStr.join('');

        //Create URL
        var url = '';
        for (var i=0; i<(stateStr.length/3); i++) {
            url += stateStr[i*3] + stateStr[i*3 + 1] + stateStr[i*3 + 2] + '/'
        }
    
        //XML Parser
        var xmlParser = new expat.Parser('UTF-8');
        xmlParser.on('startElement', parserStart)
        xmlParser.on('endElement', parserEnd)

        request.get(that.baseURL + url.split('').reverse().join('') + '.osm.gz')
            .pipe(zlib.createUnzip())
            .pipe(xmlParser)

        that.state += 1;
        if (that.state > that.end) {
            clearInterval(interval);
        }
    }, that.delay);    
}

module.exports = MetaUtil
