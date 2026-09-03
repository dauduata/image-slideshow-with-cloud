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
const galleryStatus = document.querySelector('#gallery-status');

// ============ STATE MANAGEMENT ============
let isProcessing = false;
let pollingTimer = null;
let currentJobId = null;
let pollInFlight = false;

// ============ LOGGING ============
function addLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    jobLog.value = `[${timestamp}] ${message}\n${jobLog.value}`;
    jobLog.scrollTop = 0;
}

function clearLog() {
    jobLog.value = '';
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
        const response = await fetch('/api/persons');
        const data = await response.json();
        
        if (response.ok && data.persons && data.persons.length > 0) {
            goToGalleryBtn.disabled = false;
            addLog(`✓ Gallery data is ready (${data.persons.length} people found)`);
        } else {
            goToGalleryBtn.disabled = true;
            addLog('Gallery data: No labeled people found');
        }
    } catch (error) {
        goToGalleryBtn.disabled = true;
        addLog(`Could not check gallery data: ${error.message}`);
    }
}

// ============ GALLERY NAVIGATION ============
goToGalleryBtn.addEventListener('click', async () => {
    showPage('gallery');
    await loadGallery();
});

backToGenerateBtn.addEventListener('click', () => {
    showPage('generate');
});

// ============ GALLERY LOADING ============
async function loadGallery() {
    galleryStatus.textContent = 'Loading gallery...';
    galleryContainer.innerHTML = '<p id="gallery-status">Loading gallery...</p>';
    
    try {
        const response = await fetch('/api/persons');
        const data = await response.json();
        
        if (!response.ok) {
            galleryStatus.textContent = `Error: ${data.error || 'Failed to load gallery'}`;
            return;
        }
        
        if (!data.persons || data.persons.length === 0) {
            galleryStatus.textContent = 'No images available. Generate images first.';
            return;
        }
        
        renderGallery(data.persons);
        galleryStatus.textContent = `Loaded ${data.persons.length} people`;
    } catch (error) {
        galleryStatus.textContent = `Error: ${error.message}`;
    }
}

function renderGallery(persons) {
    galleryContainer.innerHTML = `
        <div class="gallery-grid">
            ${persons.map(person => `
                <article class="gallery-item">
                    <img src="${escapeHtml(person.representative || '')}" alt="${escapeHtml(person.id)}" loading="lazy" onerror="this.style.display='none'">
                    <div class="gallery-item-info">
                        <p class="gallery-item-id">${escapeHtml(person.id)}</p>
                        <p class="gallery-item-count">${person.faceCount} face${person.faceCount === 1 ? '' : 's'}</p>
                        <p class="gallery-item-alias">${escapeHtml(person.alias || '(no alias)')}</p>
                    </div>
                </article>
            `).join('')}
        </div>
    `;
}

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
