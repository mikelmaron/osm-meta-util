var MetaUtil = require('../');

var argv = require('minimist')(process.argv.slice(2));
var db = argv['db'];
var tags_collection = argv['tags_collection'];
var tags = argv['_'][0];

//Live Mode! Updates every second
var meta = MetaUtil({'tags':tags, 'db':db, 'tags_collection':tags_collection}).pipe(process.stdout);

