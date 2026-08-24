# Image gallery and link extractors

Requires Node.js 18 or newer.

The shared Drive folder must be accessible as **Anyone with the link**. The script uses the Google Drive API to list all public image files and writes a JavaScript data file.

## Extract images with Google Drive API

Enable **Google Drive API** in Google Cloud Console and create an API key. Set it in PowerShell before running the extractor:

```powershell
$env:GOOGLE_DRIVE_API_KEY = 'YOUR_API_KEY'
node extract-drive-images.js "https://drive.google.com/drive/folders/FOLDER_ID" image-links.js
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
