var MetaUtil = require('../');

var tags = process.argv[2];

//Live Mode! Updates every second
var meta = MetaUtil({'tags':tags}).pipe(process.stdout);

