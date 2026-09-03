const { runScript } = require('../utils.js');

function run(folderUrl, outputFile) {
    return runScript('extract-drive-images.js', [folderUrl, outputFile || 'image-links.js']);
}

module.exports = { run };
