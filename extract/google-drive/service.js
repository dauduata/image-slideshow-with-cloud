const { runScript } = require('../utils.js');

const EXTRACT_IMG_SERVICE = 'services/google-drive/runner.js';
// const EXTRACT_IMG_SERVICE = 'extract-drive-images.js';

function run(folderUrl, outputFile) {
    return runScript(EXTRACT_IMG_SERVICE, [folderUrl, outputFile || 'image-links.js']);
}

module.exports = { run };
