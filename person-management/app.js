// ============ CLOUD PROVIDER DETECTION ============
const CloudProvider = {
    GOOGLE_DRIVE: 'google-drive',
    ONE_DRIVE: 'onedrive',
    UNKNOWN: 'unknown'
};

function detectCloudProvider(url) {
    if (!url || typeof url !== 'string') return CloudProvider.UNKNOWN;
    
    const urlLower = url.toLowerCase();
    
    if (urlLower.includes('drive.google.com') || urlLower.includes('folder')) {
        return CloudProvider.GOOGLE_DRIVE;
    }
    
    if (urlLower.includes('onedrive.live.com') || urlLower.includes('1drv.ms') || urlLower.includes('sharepoint')) {
        return CloudProvider.ONE_DRIVE;
    }
    
    return CloudProvider.UNKNOWN;
}

// ============ DOM ELEMENTS ============
const pageGenerate = document.querySelector('#page-generate');
const pageGallery = document.querySelector('#page-gallery');
const cloudUrlInput = document.querySelector('#cloud-url');
const openUrlBtn = document.querySelector('#open-url-btn');
const generateBtn = document.querySelector('#generate-btn');
const clearLogBtn = document.querySelector('#clear-log-btn');
const jobLog = document.querySelector('#job-log');
const goToGalleryBtn = document.querySelector('#go-to-gallery-btn');
const backToGenerateBtn = document.querySelector('#back-to-generate-btn');
const galleryContainer = document.querySelector('#gallery-container');
let galleryStatus = document.querySelector('#gallery-status');
const labelingPanel = document.querySelector('#labeling-panel');
const collapseLabelingBtn = document.querySelector('#collapse-labeling-btn');
const expandLabelingBtn = document.querySelector('#expand-labeling-btn');
const sourceUrlBtn = document.querySelector('#source-url-btn');
const labelingBtn = document.querySelector('#labeling-btn');
const clearLabelLogBtn = document.querySelector('#clear-label-log-btn');
const labelLog = document.querySelector('#label-log');
const personFilter = document.querySelector('#person-filter');
const aliasInput = document.querySelector('#alias-input');
const updateAliasBtn = document.querySelector('#update-alias-btn');

// ============ STATE MANAGEMENT ============
let isProcessing = false;
let pollingTimer = null;
let currentJobId = null;
let pollInFlight = false;
let sourceUrl = '';
let persons = [];
let gallerySwiper = null;
let cloudDataAvailable = false;

// ============ LOGGING ============
function addLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    jobLog.value = `[${timestamp}] ${message}\n${jobLog.value}`;
    jobLog.scrollTop = 0;
}

function clearLog() {
    jobLog.value = '';
}

function addLabelLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    labelLog.value = `[${timestamp}] ${message}\n${labelLog.value}`;
    labelLog.scrollTop = 0;
}

function stopJobPolling() {
    if (pollingTimer) clearInterval(pollingTimer);
    pollingTimer = null;
    currentJobId = null;
}

async function pollJobStatus(jobId) {
    if (!jobId || pollInFlight) return;
    pollInFlight = true;
    try {
        const response = await fetch(`/api/job-status/${encodeURIComponent(jobId)}`);
        const job = await response.json();
        if (!response.ok) throw new Error(job.error || 'Could not check job status');

        addLog(`Job status: ${job.status}${job.progress ? ` (${job.progress}%)` : ''}`);
        if (job.status === 'completed') {
            addLog('Image extraction completed successfully');
            if (job.result?.output) addLog(`Output: ${job.result.output}`);
            stopJobPolling();
            isProcessing = false;
            generateBtn.disabled = false;
            await checkGalleryData();
        } else if (job.status === 'failed') {
            addLog(`ERROR: ${job.error || 'Image extraction failed'}`);
            stopJobPolling();
            isProcessing = false;
            generateBtn.disabled = false;
        }
    } catch (error) {
        addLog(`ERROR: ${error.message}`);
        stopJobPolling();
        isProcessing = false;
        generateBtn.disabled = false;
    } finally {
        pollInFlight = false;
    }
}

function startJobPolling(jobId) {
    stopJobPolling();
    currentJobId = jobId;
    pollJobStatus(jobId);
    pollingTimer = setInterval(() => pollJobStatus(currentJobId), 3000);
}

// ============ PAGE NAVIGATION ============
function showPage(page) {
    pageGenerate.style.display = 'none';
    pageGallery.style.display = 'none';
    
    if (page === 'generate') {
        pageGenerate.style.display = 'block';
    } else if (page === 'gallery') {
        pageGallery.style.display = 'block';
    }
}

// ============ CLOUD URL INPUT HANDLING ============
openUrlBtn.addEventListener('click', () => {
    const url = cloudUrlInput.value.trim();
    if (!url) {
        addLog('ERROR: Please enter a URL');
        return;
    }
    
    window.open(url, '_blank', 'noopener,noreferrer');
});

// ============ GENERATE BUTTON HANDLING ============
generateBtn.addEventListener('click', async () => {
    const url = cloudUrlInput.value.trim();

    // Nếu cloudDataAvailable là true, thì hiển thị confirm dialog để hỏi người dùng có muốn tiếp tục hay không
    if (cloudDataAvailable) {
        if (!confirm('Gallery data is already available. Do you want to extract images again?')) {
            return;
        }
    }

    if (!url) {
        addLog('ERROR: Please enter a cloud folder URL');
        return;
    }
    
    if (isProcessing) {
        addLog('ERROR: Already processing. Please wait...');
        return;
    }
    
    // Detect cloud provider
    const provider = detectCloudProvider(url);
    if (provider === CloudProvider.UNKNOWN) {
        addLog('ERROR: URL must be a Google Drive or OneDrive shared folder URL');
        return;
    }
    
    clearLog();
    addLog(`Cloud provider detected: ${provider === CloudProvider.GOOGLE_DRIVE ? 'Google Drive' : 'OneDrive'}`);
    addLog('Starting image extraction...');
    
    // Disable button during processing
    isProcessing = true;
    generateBtn.disabled = true;
    stopJobPolling();
    
    try {
        // Determine API endpoint based on cloud provider
        const apiEndpoint = provider === CloudProvider.GOOGLE_DRIVE
            ? '/api/extract/google-drive'
            : '/api/extract/onedrive';
        
        addLog(`Calling API: ${apiEndpoint}`);
        
        const response = await fetch(apiEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ folderUrl: url })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            addLog(`ERROR: ${data.error || 'Failed to extract images'}`);
            isProcessing = false;
            generateBtn.disabled = false;
            return;
        }

        if (!data.jobId) throw new Error('Extraction API did not return a job ID');
        addLog(`Job ID: ${data.jobId}`);
        addLog('Job status: processing');
        startJobPolling(data.jobId);
    } catch (error) {
        addLog(`ERROR: ${error.message}`);
        stopJobPolling();
        isProcessing = false;
        generateBtn.disabled = false;
    }
});

// ============ GALLERY DATA CHECKING ============
async function checkGalleryData() {
    try {
        const response = await fetch('/api/image-data');
        const data = await response.json();
        cloudDataAvailable = response.ok && data.available;

        if (response.ok && data.available) {
            //fill the cloud-url with shareFolder if available
            if (data.shareFolder) cloudUrlInput.value = data.shareFolder;
            goToGalleryBtn.disabled = false;
            addLog(`Gallery data is ready (${data.count} images found)`);
            //mở page gallery nếu có dữ liệu
            showPage('gallery');
            await loadGallery();
        } else {
            cloudUrlInput.value = '';
            goToGalleryBtn.disabled = true;
            addLog('Gallery data: image-data.json has no images');
        }
    } catch (error) {
        goToGalleryBtn.disabled = true;
        addLog(`Could not check gallery data: ${error.message}`);
    }
}

// ============ GALLERY NAVIGATION ============
goToGalleryBtn.addEventListener('click', async () => {
    sourceUrl = cloudUrlInput.value.trim();
    showPage('gallery');
    await loadGallery();
});

backToGenerateBtn.addEventListener('click', () => {
    showPage('generate');
});

// ============ GALLERY LOADING ============
async function loadGallery() {
    try {
        galleryStatus.textContent = 'Loading gallery...';
        const response = await fetch('/api/persons');
        const data = await response.json();
        
        if (!response.ok) {
            galleryStatus.textContent = `Error: ${data.error || 'Failed to load gallery'}`;
            return;
        }
        
        persons = data.persons || [];
        if (persons.length === 0) {
            galleryStatus.textContent = 'No images available. Generate images first.';
            return;
        }
        personFilter.replaceChildren(new Option('All', 'all'), new Option('No Person', 'no-person'));
        persons.forEach((person) => personFilter.add(new Option(person.alias || person.id, person.id)));
        await loadFilteredImages();
    } catch (error) {
        galleryStatus.textContent = `Error: ${error.message}`;
    }
}

async function loadFilteredImages() {
    const selected = [...personFilter.selectedOptions].map((option) => option.value);
    const query = new URLSearchParams();
    if (!selected.length || selected.includes('all')) query.set('person', 'all');
    else selected.forEach((person) => query.append('person', person));
    galleryStatus.textContent = 'Loading images...';
    try {
        const response = await fetch(`/api/images?${query}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to load images');
        renderGallery(data.images || []);
        galleryStatus.textContent = `${data.images?.length || 0} images`;
    } catch (error) {
        galleryStatus.textContent = `Error: ${error.message}`;
    }
    updateAliasState();
}

function renderGallery(images) {
    if (gallerySwiper) {
        gallerySwiper.destroy(true, true);
        gallerySwiper = null;
    }
    galleryContainer.innerHTML = `
        <p id="gallery-status"></p>
        <div class="backend-gallery swiper">
            <div class="swiper-wrapper"></div>
            <button class="swiper-button-prev" type="button" aria-label="Previous image"></button>
            <button class="swiper-button-next" type="button" aria-label="Next image"></button>
        </div>
    `;
    galleryStatus = galleryContainer.querySelector('#gallery-status');
    if (!images.length) {
        galleryStatus.textContent = 'No images match the selected people.';
        return;
    }
    galleryStatus.textContent = '';
    gallerySwiper = new Swiper(galleryContainer.querySelector('.backend-gallery'), {
        virtual: {
            slides: images,
            addSlidesBefore: 2,
            addSlidesAfter: 2,
            renderSlide: (image, index) => renderGallerySlide(image, index, images.length)
        },
        loop: false,
        grabCursor: true,
        zoom: { maxRatio: 3, minRatio: 1 },
        navigation: {
            nextEl: galleryContainer.querySelector('.swiper-button-next'),
            prevEl: galleryContainer.querySelector('.swiper-button-prev')
        },
        on: {
            touchEnd(swiper) {
                if (swiper.isEnd && swiper.swipeDirection === 'next') swiper.slideTo(0);
                if (swiper.isBeginning && swiper.swipeDirection === 'prev') swiper.slideTo(images.length - 1);
            }
        }
    });
}

function renderGallerySlide(image, index, total) {
    const name = escapeHtml(image.name || `Image ${index + 1}`);
    const source = escapeHtml(image.thumbnailUrl || image.url || '');
    return `<article class="swiper-slide gallery-cell">
        <div class="swiper-zoom-container">
            <img src="${source}" alt="${name}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">
        </div>
        <div class="caption"><span>${name}</span><span>${String(index + 1).padStart(4, '0')} / ${String(total).padStart(4, '0')}</span></div>
    </article>`;
}

function updateAliasState() {
    const selected = [...personFilter.selectedOptions].map((option) => option.value);
    const eligible = selected.length === 1 && selected[0] !== 'all' && selected[0] !== 'no-person';
    const person = eligible ? persons.find((item) => item.id === selected[0]) : null;
    aliasInput.disabled = !eligible;
    updateAliasBtn.disabled = !eligible;
    aliasInput.value = person?.alias || '';
}

collapseLabelingBtn.addEventListener('click', () => labelingPanel.classList.add('collapsed'));
expandLabelingBtn.addEventListener('click', () => labelingPanel.classList.remove('collapsed'));
sourceUrlBtn.addEventListener('click', () => {
    cloudUrlInput.value = sourceUrl;
    showPage('generate');
});
personFilter.addEventListener('change', loadFilteredImages);
clearLabelLogBtn.addEventListener('click', () => { labelLog.value = ''; });

labelingBtn.addEventListener('click', async () => {
    // Nếu đã có persons thì show confirm dialog để hỏi người dùng có muốn tiếp tục hay không
    if (persons.length > 0) {
        if (!confirm('Labeling will overwrite existing labels. Do you want to continue?')) {
            return;
        }
    }

    if (isProcessing) return;
    isProcessing = true;
    labelingBtn.disabled = true;
    addLabelLog('Starting labeling...');
    try {
        const response = await fetch('/api/labeling', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not start labeling');
        addLabelLog(`Job ID: ${data.jobId}`);
        const poll = async () => {
            const statusResponse = await fetch(`/api/job-status/${encodeURIComponent(data.jobId)}`);
            const job = await statusResponse.json();
            if (!statusResponse.ok) throw new Error(job.error || 'Could not check labeling status');
            addLabelLog(`Job status: ${job.status} (${job.processedImages}/${job.totalImages} images, ${job.remainingImages} remaining${job.progress ? `, ${job.progress}%` : ''})`);
            if (job.status === 'completed') {
                addLabelLog('Labeling completed successfully');
                labelingBtn.disabled = false;
                isProcessing = false;
                await loadGallery();
                return;
            }
            if (job.status === 'failed') throw new Error(job.error || 'Labeling failed');
            setTimeout(poll, 3000);
        };
        poll();
    } catch (error) {
        addLabelLog(`ERROR: ${error.message}`);
        labelingBtn.disabled = false;
        isProcessing = false;
    }
});

updateAliasBtn.addEventListener('click', async () => {
    const selected = [...personFilter.selectedOptions].map((option) => option.value);
    if (selected.length !== 1 || selected[0] === 'all' || selected[0] === 'no-person') return;
    try {
        const response = await fetch('/api/person-aliases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [selected[0]]: aliasInput.value })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not update alias');
        const person = persons.find((item) => item.id === selected[0]);
        if (person) person.alias = aliasInput.value.trim();
        personFilter.querySelector(`option[value="${CSS.escape(selected[0])}"]`).textContent = person.alias || person.id;
        addLabelLog(`Alias updated for ${selected[0]}`);
    } catch (error) {
        addLabelLog(`ERROR: ${error.message}`);
    }
});

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============ CLEAR LOG ============
clearLogBtn.addEventListener('click', () => {
    clearLog();
});

// ============ INITIALIZATION ============
function init() {
    showPage('generate');
    checkGalleryData();
    
    addLog('Application started');
    addLog('Ready to extract images from cloud');
}

init();
