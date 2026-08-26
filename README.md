# Image gallery and link extractors

Requires Node.js 18 or newer.

The shared Drive folder must be accessible as **Anyone with the link**. The script uses the Google Drive API to list all public image files and writes a JavaScript data file.

## Extract images with Google Drive API

Enable **Google Drive API** in Google Cloud Console and create an API key. Set it in PowerShell before running the extractor:

```powershell
$env:GOOGLE_DRIVE_API_KEY = 'YOUR_API_KEY'
node extract-drive-images.js "https://drive.google.com/drive/folders/1F2Mwlk5WHa1Hg2yaxNjk9Cc9aQhttKCh?usp=sharing" image-links.js
```

The API key is used only by the local extractor. Restrict it to the Google Drive API and keep the folder and image files public. The extractor requests images in pages of up to 1,000 files and follows `nextPageToken` until every image has been collected.

## Usage

```powershell

`node extract-drive-images.js "https://drive.google.com/drive/folders/1VYWUy-aFfBkw6zvUfl0xo_3cDrM-Fp5Q?usp=sharing" sna-xmas-2019.js``

The output file defaults to `image-links.js` when the second argument is omitted. The output contains `const seriesData = [...]`; each record contains the original filename, Drive file ID, and direct image URL.

## Gallery

The page is split into `index.html`, `styles.css`, and `app.js`. It loads `image-links.js` by default. To use another JavaScript data file, change the data script filename in `index.html` and keep the `seriesData` variable name.

This is a static site. Upload `index.html`, `styles.css`, `app.js`, the JavaScript data file, and `google-config.js` to GitHub Pages, Netlify, or another static hosting provider. The browser loads `seriesData` and assigns each URL directly to an `<img>` element. No backend or image proxy is included.

## Google Drive without a server

You can open `index.html` directly with `file://` by using Google Drive API mode. In [google-config.js](google-config.js), set:

```js
window.GOOGLE_DRIVE_CONFIG = {
	apiKey: 'YOUR_API_KEY',
	folderId: 'YOUR_FOLDER_ID'
};
```

In Google Cloud Console, enable **Google Drive API** and restrict the API key to that API and approved website origins. The folder and image files must be shared publicly. The key is visible in frontend code, so never put a service-account key or OAuth secret here.

After saving the config, the page calls the Drive API directly, handles pagination, and uses each file's `thumbnailLink`. Leave both config values empty to use JavaScript data mode. Because the data is loaded with a normal `<script>` tag, it can also work from `file://`.

## OneDrive

Install dependencies and the Chromium browser once:

```powershell
npm install
npx playwright install chromium
```

Then extract images from a public OneDrive folder:

```powershell
npm run extract:onedrive -- "https://1drv.ms/f/..." image-onedrive-links.js
```

The OneDrive folder must be shared publicly. The script opens the folder in Chromium, reads the rendered image items, removes duplicate IDs, and writes a JavaScript file containing `const seriesData = [...]`.


npm run extract:onedrive -- "https://1drv.ms/f/c/c3eea47a85d86883/IgBwpaRUKr9sSaaDG9XR5vOMAW1X1NWWhLffyd4WWVfj2Jg" image-onedrive-links.js

## Local face-label POC

This is a separate CLI pipeline. It does not use Playwright or scan OneDrive: it reads the existing `image-onedrive-links.js` and tries each record's original `url` first. Only an HTTP 403 response triggers fallback to `thumbnailUrl` at 2400x2400, matching the working gallery path.

### Stack

- `onnxruntime-node`: local CPU inference on Windows and macOS, without TensorFlow.js or CUDA.
- YuNet (`face_detection_yunet_2023mar.onnx`): lightweight face detector. This downloaded model uses a 640x640 inference tensor; the CLI keeps source detail up to `--maxDimension 1600` and letterboxes it before detection.
- SFace (`face_recognition_sface_2021dec.onnx`): 112x112 face crops to normalized embeddings.
- A small in-process DBSCAN implementation using cosine distance. `--threshold 0.45` is the default distance threshold; noise faces are not assigned to a person.

ONNX Runtime has native prebuilt binaries for common Windows/macOS Node environments and uses CPU by default. `sharp` uses native image codecs and releases each image buffer after processing. The two ONNX files are downloaded separately from OpenCV Zoo by the command below. Check the model repositories' licenses before distributing the models; this POC does not upload images anywhere.

### Install and run

Node.js 18+ is required. These commands work in PowerShell, macOS Terminal, and Linux shells:

```powershell
npm install
npm run download-face-models
npm run face-label -- --concurrency 2 --threshold 0.45
```

The default outputs are `image-onedrive-links-labeled.js` and `face-clusters-report.html`. The input file is never overwritten. Every original field is preserved and each record receives `persons: []` or one or more `person-001` style labels. Failed downloads/timeouts are reported and do not stop the remaining images.

Useful options:

```powershell
node face-label-poc.js --input image-onedrive-links.js --output image-onedrive-links-labeled.js --report face-clusters-report.html --concurrency 3 --threshold 0.45 --timeout 30000 --maxDimension 1600 --limit 200
```

The detector defaults are `--minConfidence 0.75`, `--nmsThreshold 0.5`, `--minFaceSize 80`, and `--maxFaceAspectRatio 1.8`. The last two reject very thin or tiny false-positive boxes; tune them for a different camera distance. Use `--name _DSC0556.JPG --debug 1` to test one exact record and print detector boxes.

Open `face-clusters-report.html` locally to visually inspect groups. It now shows the actual 112x112 face crops, confidence, source filename, and box coordinates rather than only repeating the full image thumbnail. The final console summary includes OS, CPU, RAM, Node version, model, image/face/group counts, processing time, average time per image, clustering time, and failed-image count for Windows/macOS comparison.

The default detector/embedding models are deliberately small CPU-oriented POC models. Accuracy depends strongly on face size, pose, blur, lighting, and the threshold; validate groups visually and tune `--threshold` on the 100-200 image sample before scaling to 3,000 images. DBSCAN currently uses a minimum of two neighboring faces, so isolated faces remain noise rather than being forced into a group.

When fallback is used, the progress line says `thumbnailUrl@2400 (fallback after HTTP 403)`. The original URL remains preferred because it is the best source for recognition when available. The transformed response is much larger than the default 144x96 preview and is suitable for this POC; validate accuracy visually in the generated report.