const dataFile = new URLSearchParams(window.location.search).get('data') || 'image-links.js';
const gallery = document.querySelector('#gallery');
const status = document.querySelector('#status');
const meta = document.querySelector('#meta');

function imageUrl(item) {
  let sourceUrl;
  if (item.thumbnailLink) {
    sourceUrl = item.thumbnailLink.replace(/=s\d+$/, '=w2400');
    return sourceUrl;
  }
  if (item.thumbnailUrl) {
    sourceUrl = item.thumbnailUrl.replace(/([?&])width=\d+/, '$1width=2400').replace(/([?&])height=\d+/, '$1height=2400');
  } else if (item.id && item.url?.includes('drive.google.com')) {
    sourceUrl = `https://lh3.googleusercontent.com/d/${encodeURIComponent(item.id)}=w2400`;
  } else {
    sourceUrl = item.url;
  }
  return sourceUrl;
}

async function loadGoogleDriveImages({ apiKey, folderId }) {
  const files = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`,
      fields: 'nextPageToken,files(id,name,mimeType,thumbnailLink)',
      pageSize: '1000',
      orderBy: 'name',
      key: apiKey
    });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`);
    if (!response.ok) throw new Error(`Google Drive API error: HTTP ${response.status}`);
    const data = await response.json();
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return files;
}

function showError(message) {
  status.textContent = message;
  status.style.color = '#ff9b8f';
}

function addImage(item, index, total) {
  const cell = document.createElement('article');
  const image = document.createElement('img');
  const caption = document.createElement('div');
  const name = document.createElement('span');
  const count = document.createElement('span');

  cell.className = 'gallery-cell';
  image.src = imageUrl(item);
  image.alt = item.name || `Image ${index + 1}`;
  image.loading = index === 0 ? 'eager' : 'lazy';
  image.referrerPolicy = 'no-referrer';
  image.onerror = () => image.classList.add('image-error');
  caption.className = 'caption';
  name.textContent = item.name || 'Untitled image';
  count.textContent = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
  caption.append(name, count);
  cell.append(image, caption);
  gallery.appendChild(cell);
}

const driveConfig = window.GOOGLE_DRIVE_CONFIG || {};
const source = driveConfig.apiKey && driveConfig.folderId
  ? loadGoogleDriveImages(driveConfig)
  : Promise.resolve(typeof seriesData === 'undefined' ? [] : seriesData);

source
  .then((items) => {
    if (!Array.isArray(items) || items.length === 0) throw new Error('The JSON file contains no images');
    const images = items.filter((item) => item && imageUrl(item));
    images.forEach((item, index) => addImage(item, index, images.length));
    new Flickity(gallery, { cellAlign: 'center', contain: true, wrapAround: true, lazyLoad: 2, pageDots: true });
    meta.textContent = `${images.length} images · ${dataFile}`;
    status.textContent = 'Ready';
  })
  .catch((error) => showError(error.message));
