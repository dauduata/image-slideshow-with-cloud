const dataFile = new URLSearchParams(window.location.search).get('data') || 'image-links.js';
const gallery = document.querySelector('#gallery');
const galleryWrapper = gallery.querySelector('.swiper-wrapper');
const status = document.querySelector('#status');
const meta = document.querySelector('#meta');
const goToButton = document.querySelector('#go-to-button');
const goToDialog = document.querySelector('#go-to-dialog');
const goToForm = document.querySelector('#go-to-form');
const imageIndexInput = document.querySelector('#image-index');
const goToCancel = document.querySelector('#go-to-cancel');
const personFilter = document.querySelector('#person-filter');

function imageUrl(item, width = 2400) {
  let sourceUrl;
  if (item.thumbnailLink) {
    sourceUrl = item.thumbnailLink.replace(/=s\d+$/, `=w${width}`);
    return sourceUrl;
  }
  if (item.thumbnailUrl) {
    sourceUrl = item.thumbnailUrl.replace(/([?&])width=\d+/, `$1width=${width}`).replace(/([?&])height=\d+/, `$1height=${width}`);
  } else if (item.id && item.url?.includes('drive.google.com')) {
    sourceUrl = `https://lh3.googleusercontent.com/d/${encodeURIComponent(item.id)}=w${width}`;
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderSlide(item, index, total) {
  const name = escapeHtml(item.name || 'Untitled image');
  const alt = escapeHtml(item.name || `Image ${index + 1}`);
  const count = `${String(index + 1).padStart(4, '0')} / ${String(total).padStart(4, '0')}`;
  return `<article class="swiper-slide gallery-cell">
    <div class="swiper-zoom-container">
      <img src="${escapeHtml(imageUrl(item))}" data-full-src="${escapeHtml(imageUrl(item))}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer">
    </div>
    <div class="caption"><span>${name}</span><span>${count}</span></div>
  </article>`;
}

function loadFullResolutionImage(swiper) {
  const activeSlide = gallery.querySelector('.swiper-slide-active');
  const image = activeSlide?.querySelector('img[data-full-src]');
  if (image && image.src !== image.dataset.fullSrc) {
    image.src = image.dataset.fullSrc;
  }
}

const driveConfig = window.GOOGLE_DRIVE_CONFIG || {};
const source = driveConfig.apiKey && driveConfig.folderId
  ? loadGoogleDriveImages(driveConfig)
  : Promise.resolve(typeof seriesData === 'undefined' ? [] : seriesData);

function displayPerson(personId) {
  return window.personAliases?.[personId] || personId;
}

function populatePersonFilter(items) {
  const personIds = [...new Set(items.flatMap((item) => Array.isArray(item.persons) ? item.persons : []))].sort();
  personIds.forEach((personId) => personFilter.add(new Option(displayPerson(personId), personId)));
}

source
  .then((items) => {
    if (!Array.isArray(items) || items.length === 0) throw new Error('The JSON file contains no images');
    const allImages = items.filter((item) => item && imageUrl(item));
    populatePersonFilter(allImages);
    let images = allImages;
    const storageKey = `image-gallery-index:${dataFile}`;
    const savedIndex = Number.parseInt(localStorage.getItem(storageKey), 10);
    const initialSlide = Number.isInteger(savedIndex)
      ? Math.min(Math.max(savedIndex, 0), images.length - 1)
      : 0;
    const saveCurrentIndex = (swiperInstance) => {
      localStorage.setItem(storageKey, String(swiperInstance.activeIndex));
    };
    const swiper = new Swiper(gallery, {
      virtual: {
        slides: images,
        addSlidesBefore: 3,
        addSlidesAfter: 3,
        renderSlide: (item, index) => renderSlide(item, index, images.length)
      },
      loop: false,
      initialSlide,
      grabCursor: true,
      zoom: { maxRatio: 3, minRatio: 1 },
      pagination: { el: '.swiper-pagination', type: 'fraction' },
      navigation: { nextEl: '.swiper-button-next', prevEl: '.swiper-button-prev' },
      touchEventsTarget: 'container',
      threshold: 15,
      on: {
        init(swiperInstance) {
          loadFullResolutionImage(swiperInstance);
          saveCurrentIndex(swiperInstance);
        },
        slideChange(swiperInstance) {
          loadFullResolutionImage(swiperInstance);
          saveCurrentIndex(swiperInstance);
        },
        touchEnd(swiperInstance) {
          if (swiperInstance.isEnd && swiperInstance.swipeDirection === 'next') swiperInstance.slideTo(0);
          if (swiperInstance.isBeginning && swiperInstance.swipeDirection === 'prev') swiperInstance.slideTo(images.length - 1);
        }
      }
    });
    personFilter.addEventListener('change', () => {
      images = personFilter.value
        ? allImages.filter((item) => item.persons?.includes(personFilter.value))
        : allImages;
      swiper.virtual.slides = images;
      swiper.virtual.update(true);
      swiper.slideTo(0, 0);
      imageIndexInput.max = String(images.length);
      meta.textContent = `${images.length} images · ${dataFile}`;
    });
    imageIndexInput.max = String(images.length);
    goToButton.disabled = false;
    goToButton.addEventListener('click', () => {
      imageIndexInput.value = String(swiper.activeIndex + 1);
      goToDialog.showModal();
      imageIndexInput.select();
    });
    goToForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const requestedIndex = Number.parseInt(imageIndexInput.value, 10);
      if (!Number.isInteger(requestedIndex) || requestedIndex < 1 || requestedIndex > images.length) {
        imageIndexInput.setCustomValidity(`Enter an index from 1 to ${images.length}.`);
        imageIndexInput.reportValidity();
        return;
      }
      imageIndexInput.setCustomValidity('');
      goToDialog.close();
      swiper.slideTo(requestedIndex - 1);
    });
    goToCancel.addEventListener('click', () => goToDialog.close());
    gallery.querySelector('.swiper-button-next').addEventListener('click', () => {
      if (swiper.isEnd) swiper.slideTo(0);
    });
    gallery.querySelector('.swiper-button-prev').addEventListener('click', () => {
      if (swiper.isBeginning) swiper.slideTo(images.length - 1);
    });
    meta.textContent = `${images.length} images · ${dataFile}`;
    status.textContent = 'Ready';
  })
  .catch((error) => showError(error.message));
