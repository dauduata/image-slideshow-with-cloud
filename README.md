# Image gallery and face labeling

Node.js 18 or newer is required. The project contains two workflows:

- extract public image links from Google Drive or OneDrive;
- detect and group faces locally with YuNet and SFace.

## Install

```powershell
npm install
npx playwright install chromium
npm run download-face-models
```

The face models are stored in `models/` and inference runs locally on the CPU. Images are not uploaded by the face-labeling pipeline.

## Extract image links

### Google Drive

The folder and image files must be shared as **Anyone with the link**. Enable the Google Drive API, create a restricted API key, and set it only in the local PowerShell session:

```powershell
$env:GOOGLE_DRIVE_API_KEY = 'YOUR_API_KEY'
node extract-drive-images.js "https://drive.google.com/drive/folders/FOLDER_ID" image-links.js
```

The default output is `image-links.js`. It contains `const seriesData = [...]` with filenames, file IDs, and direct image URLs.

### OneDrive

The folder must be public:

```powershell
npm run extract:onedrive -- "https://1drv.ms/f/..." image-onedrive-links.js
```

The extractor uses Chromium to read rendered image items, removes duplicate IDs, and writes `seriesData`.

## Static gallery

The frontend is in `FE/public/` and loads a `seriesData` JavaScript file. To change the dataset, update the data script referenced by `FE/public/index.html`.

The site can be deployed as static files. Firebase deployment configuration and scripts are in `FE/`. For Google Drive API mode, configure the public API key and folder ID in the frontend configuration. Never place a service-account key or OAuth secret in frontend files.

## Face labeling

The CLI reads `image-onedrive-links.js`, downloads each original image URL, and falls back to its `thumbnailUrl` at 2400 pixels only after HTTP 403. It then:

1. resizes images up to 1600 pixels on the longest side;
2. letterboxes them to YuNet's 640x640 input;
3. detects faces and decodes five landmarks;
4. aligns each face to 112x112 and creates an SFace embedding;
5. groups embeddings with cosine-distance DBSCAN.

Run the complete pipeline:

```powershell
npm run face-label -- --concurrency 2 --threshold 0.45
```

Default outputs:

- `image-onedrive-links-labeled.js`: original records plus `persons` labels;
- `face-clusters-report.html`: grouped face crops, confidence, boxes, and landmarks.

Useful options:

```powershell
node face-label-poc.js --input image-onedrive-links.js --output image-onedrive-links-labeled.js --report face-clusters-report.html --concurrency 3 --threshold 0.45 --timeout 30000 --maxDimension 1600 --limit 200
```

Current detector defaults are `minConfidence=0.75`, `nmsThreshold=0.5`, `minFaceSize=20`, and `maxFaceAspectRatio=2.5`. Use `--name FILE.JPG --debug 1` to process one exact image and print decoded detector coordinates.

The report should be reviewed visually because accuracy depends on face size, pose, blur, lighting, and image quality. Isolated embeddings remain unassigned noise because clustering requires at least two neighboring faces.