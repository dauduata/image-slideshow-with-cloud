const fs = require('node:fs/promises');
const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config();


const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3/files';
const PAGE_SIZE = 1000;

function printUsage() {
  console.log('Usage: node extract-drive-images.js <drive-folder-url> [output-file.js]');
  console.log('Example: node extract-drive-images.js "https://drive.google.com/drive/folders/FOLDER_ID" image-links.js');
}

function getJavaScriptOutputPath(outputFile) {
  return outputFile.replace(/\.json$/i, '.js');
}

function getFolderId(folderUrl) {
  const match = folderUrl.match(/\/folders\/([^/?]+)/i);
  if (!match) {
    throw new Error('Invalid Drive folder URL. Expected /drive/folders/FOLDER_ID.');
  }

  return match[1];
}

async function listImages(folderId, apiKey) {
  const images = [];
  let pageToken;

  do {
    const params = new URLSearchParams({
      key: apiKey,
      q: `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`,
      pageSize: String(PAGE_SIZE),
      fields: 'nextPageToken,files(id,name,mimeType,thumbnailLink)'
    });

    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    let response;
    try {
      response = await fetch(`${DRIVE_API_URL}?${params}`);
    } catch (error) {
      throw new Error(`Cannot access the Google Drive API: ${error.message}`);
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Google Drive API returned HTTP ${response.status}: ${data.error?.message || 'Unknown error'}`);
    }

    images.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return images;
}

async function main() {
  const folderUrl = process.argv[2];
  const outputFile = process.argv[3] || 'image-links.js';

  if (!folderUrl) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const apiKey = process.env.GOOGLE_DRIVE_API_KEY;
  if (!apiKey) {
    throw new Error('Missing GOOGLE_DRIVE_API_KEY environment variable. Create a Google API key with Google Drive API enabled.');
  }

  const folderId = getFolderId(folderUrl);
  const files = await listImages(folderId, apiKey);
  const seenIds = new Set();
  const images = [];

  for (const { id, name, thumbnailLink } of files) {
    if (seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    images.push({
      name,
      id,
      url: `https://drive.google.com/uc?export=view&id=${id}`,
      ...(thumbnailLink ? { thumbnailLink } : {})
    });
  }

  if (images.length === 0) {
    throw new Error('No public images found. Check the sharing permission and folder URL.');
  }

  const outputPath = path.resolve(getJavaScriptOutputPath(outputFile));
  const output = `const seriesData = ${JSON.stringify(images, null, 2)};\n`;
  await fs.writeFile(outputPath, output, 'utf8');
  console.log(`Extracted ${images.length} image link(s) to ${outputPath}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
