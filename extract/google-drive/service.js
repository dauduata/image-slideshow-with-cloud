import { runScript } from './utils.js';

function run(folderUrl, outputFile) {
    return runScript('extract-drive-images.js', [folderUrl, outputFile]);
}


module.exports = { run };
