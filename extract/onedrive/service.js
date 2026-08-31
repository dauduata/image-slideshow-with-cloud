import { runScript } from './utils.js';

function run(folderUrl, outputFile) {
    return runScript('extract-onedrive-images.js', [folderUrl, outputFile]);
}

module.exports = { run };
