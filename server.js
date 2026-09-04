const http = require('node:http');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { URL } = require('node:url');
const googleDrive = require('./extract/google-drive/service');
const oneDrive = require('./extract/onedrive/service');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const ALIASES_FILE = path.join(ROOT, 'data', 'person-aliases.json');
const GENERATED_FILE = path.join(ROOT, 'FE', 'public', 'seriesData.js');
const REPORT_DIRECTORY = path.join(ROOT, 'report');
const REPORT_FILE = path.join(REPORT_DIRECTORY, 'face-clusters-report.html');
const LABELING_OUTPUT_FILE = path.join(ROOT, 'image-links-labeled.js');
const LABELED_FILE = LABELING_OUTPUT_FILE;
const IMAGE_DATA_FILE = path.join(ROOT, 'data', 'image-data.json');

const jobManager = {
    jobs: new Map(),
    createJob(initialValues = {}) {
        const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        this.jobs.set(jobId, {
            jobId,
            status: 'processing',
            progress: 0,
            totalImages: 0,
            processedImages: 0,
            remainingImages: 0,
            failedImages: 0,
            result: null,
            error: null,
            logs: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            ...initialValues
        });
        this.cleanupOldJobs();
        return jobId;
    },
    getJob(jobId) { return this.jobs.get(jobId); },
    updateJob(jobId, updates) {
        const job = this.jobs.get(jobId);
        if (job) Object.assign(job, updates, { updatedAt: Date.now() });
    },
    appendJobLog(jobId, message) {
        const job = this.jobs.get(jobId);
        if (job) job.logs.push(message);
        this.updateJob(jobId, {});
    },
    completeJob(jobId, result) {
        const job = this.getJob(jobId);
        this.updateJob(jobId, {
            status: 'completed',
            progress: 100,
            processedImages: job?.totalImages ?? job?.processedImages ?? 0,
            remainingImages: 0,
            result
        });
    },
    failJob(jobId, error) {
        this.updateJob(jobId, { status: 'failed', error: error.message || String(error) });
    },
    cleanupOldJobs() {
        const maxAge = 24 * 60 * 60 * 1000;
        for (const [jobId, job] of this.jobs) {
            if (Date.now() - job.createdAt > maxAge) this.jobs.delete(jobId);
        }
    }
};

function json(response, status, value) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
}

async function readJson(fileName, fallback) {
    try { return JSON.parse(await fs.readFile(fileName, 'utf8')); }
    catch (error) {
        if (error.code === 'ENOENT') return fallback;
        throw new Error(`Cannot read ${path.relative(ROOT, fileName)}: ${error.message}`);
    }
}

function loadSeries(fileName) {
    if (!fsSync.existsSync(fileName)) return [];
    const source = fsSync.readFileSync(fileName, 'utf8');
    const sandbox = {};
    vm.runInNewContext(`${source}\nthis.__seriesData = seriesData;`, sandbox, { filename: fileName });
    if (!Array.isArray(sandbox.__seriesData)) throw new Error('Data file does not define seriesData');
    return sandbox.__seriesData;
}

function imageUrl(item, width = 2400) {
    if (!item) return '';
    if (item.thumbnailLink) return item.thumbnailLink.replace(/=s\d+$/, `=w${width}`);
    if (item.thumbnailUrl) {
        return item.thumbnailUrl
            .replace(/([?&])width=\d+/, `$1width=${width}`)
            .replace(/([?&])height=\d+/, `$1height=${width}`);
    }
    if (item.id && item.url?.includes('drive.google.com')) {
        return `https://lh3.googleusercontent.com/d/${encodeURIComponent(item.id)}=w${width}`;
    }
    return item.url || '';
}

async function saveImageData(folderUrl, outputFile) {
    const series = loadSeries(path.join(ROOT, outputFile));
    const imageData = await readJson(IMAGE_DATA_FILE, {});
    imageData.shareFolder = folderUrl;
    imageData.data = series;
    await fs.mkdir(path.dirname(IMAGE_DATA_FILE), { recursive: true });
    await fs.writeFile(IMAGE_DATA_FILE, `${JSON.stringify(imageData, null, 2)}\n`, 'utf8');
    return series.length;
}

function runLabeling(jobId) {
    const input = path.join(ROOT, 'image-links.js');
    const totalImages = loadSeries(input).length;
    jobManager.updateJob(jobId, {
        totalImages,
        remainingImages: totalImages
    });
    return new Promise((resolve, reject) => {
        const child = require('node:child_process').spawn(process.execPath, [
            path.join(ROOT, 'face-label-poc.js'),
            '--input', input,
            '--output', LABELING_OUTPUT_FILE,
            '--report', REPORT_FILE
        ], { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        let errorOutput = '';
        let pendingLine = '';
        const processedIndexes = new Set();
        let failedImages = 0;
        const processOutputLine = (line) => {
            if (line.trim() === 'SKIPPED') {
                failedImages += 1;
                jobManager.updateJob(jobId, { failedImages });
                return;
            }
            const match = line.match(/^\[(\d+)\/(\d+)\]/);
            if (!match || processedIndexes.has(match[1])) return;
            processedIndexes.add(match[1]);
            const processedImages = processedIndexes.size;
            jobManager.updateJob(jobId, {
                processedImages,
                remainingImages: Math.max(0, totalImages - processedImages),
                progress: totalImages
                    ? Math.floor((processedImages / totalImages) * 100)
                    : 100
            });
        };
        child.stdout.on('data', (chunk) => {
            output += chunk;
            pendingLine += chunk.toString();
            const lines = pendingLine.split(/\r?\n/);
            pendingLine = lines.pop();
            for (const line of lines) processOutputLine(line);
        });
        child.stderr.on('data', (chunk) => { errorOutput += chunk; });
        child.on('error', reject);
        child.on('close', (code) => {
            if (pendingLine) processOutputLine(pendingLine);
            if (code === 0) resolve({ output: output.trim(), file: LABELING_OUTPUT_FILE });
            else reject(new Error((errorOutput || output || `Labeling exited with code ${code}`).trim()));
        });
    });
}

function runWebsiteDeployment(jobId) {
    return new Promise((resolve, reject) => {
        const serviceAccountFile = path.join(ROOT, 'FE', 'firebase-danglephd.iptp.test.json');
        let projectName = process.env.PUBLIC_WEBSITE_PROJECT || 'baoloc-summer-2026';
        if (!projectName && fsSync.existsSync(serviceAccountFile)) {
            projectName = JSON.parse(fsSync.readFileSync(serviceAccountFile, 'utf8')).project_id;
        }
        if (!projectName) return reject(new Error('Public website Firebase project is not configured'));

        const child = require('node:child_process').spawn(process.execPath, [
            path.join(ROOT, 'FE', 'deploy-website.js'),
            projectName
        ], { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
        const output = (chunk) => {
            for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
                jobManager.appendJobLog(jobId, line);
            }
        };
        child.stdout.on('data', output);
        child.stderr.on('data', output);
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve({
                    project: projectName,
                    url: `https://${projectName.toLowerCase()}.web.app/`
                });
            } else {
                reject(new Error(`Website deployment exited with code ${code}`));
            }
        });
    });
}

async function startWebsiteDeployment(jobId) {
    jobManager.appendJobLog(jobId, 'Running FE/deploy-website.js...');
    return runWebsiteDeployment(jobId);
}

async function ensureAliases(personIds) {
    const aliases = await readJson(ALIASES_FILE, {});
    let changed = false;
    for (const personId of personIds) {
        if (!aliases[personId] || typeof aliases[personId] !== 'object') {
            aliases[personId] = { alias: '' };
            changed = true;
        } else if (typeof aliases[personId].alias !== 'string') {
            aliases[personId].alias = '';
            changed = true;
        }
    }
    if (changed) await fs.writeFile(ALIASES_FILE, `${JSON.stringify(aliases, null, 2)}\n`);
    return aliases;
}

function personIdsFromSeries(series) {
    return [...new Set(series.flatMap((record) => Array.isArray(record.persons) ? record.persons : []))].sort();
}

function clusterDetails() {
    if (!fsSync.existsSync(REPORT_FILE)) return new Map();
    const html = fsSync.readFileSync(REPORT_FILE, 'utf8');
    const details = new Map();
    const sectionPattern = /<section><h2>([^<]+) <small>(\d+) face\(s\)<\/small><\/h2>(?:<img class="original" src="([^"]+)")?/g;
    for (const match of html.matchAll(sectionPattern)) {
        details.set(match[1], { faceCount: Number(match[2]), representative: match[3] || '' });
    }
    return details;
}

async function getPersons() {
    const series = loadSeries(LABELED_FILE);
    const aliases = await ensureAliases(personIdsFromSeries(series));
    const details = clusterDetails();
    return personIdsFromSeries(series).map((id) => ({
        id,
        alias: aliases[id]?.alias || '',
        faceCount: details.get(id)?.faceCount || series.filter((record) => record.persons?.includes(id)).length,
        representative: details.get(id)?.representative || imageUrl(series.find((record) => record.persons?.includes(id))),
        images: series.filter((record) => record.persons?.includes(id)).map((record) => ({
            name: record.name,
            url: record.url,
            thumbnailUrl: imageUrl(record)
        }))
    }));
}

function getImages(selectedPersons) {
    const series = loadSeries(LABELED_FILE);
    const filtered = !selectedPersons.length || selectedPersons.includes('all')
        ? series
        : series.filter((record) => {
        const persons = Array.isArray(record.persons) ? record.persons : [];
        return selectedPersons.some((person) => person === 'no-person'
            ? persons.length === 0
            : persons.includes(person));
        });
    return filtered.map((record) => ({ ...record, thumbnailUrl: imageUrl(record) }));
}

async function generateFeData() {
    const series = loadSeries(LABELED_FILE);
    if (!series.length) throw new Error('Labeled source data is missing or empty');
    const aliases = await ensureAliases(personIdsFromSeries(series));
    const output = `const personAliases = ${JSON.stringify(Object.fromEntries(Object.entries(aliases).map(([id, value]) => [id, value.alias || ''])), null, 2)};\n\nconst seriesData = ${JSON.stringify(series, null, 2)};\n`;
    await fs.mkdir(path.dirname(GENERATED_FILE), { recursive: true });
    await fs.writeFile(GENERATED_FILE, output, 'utf8');
    return { file: '/FE/public/seriesData.js', persons: personIdsFromSeries(series).length, images: series.length };
}

async function body(request) {
    let data = '';
    for await (const chunk of request) data += chunk;
    try { return JSON.parse(data || '{}'); }
    catch { throw new Error('Request body must be valid JSON'); }
}

const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
async function serveFile(response, fileName) {
    try {
        const data = await fs.readFile(fileName);
        response.writeHead(200, { 'Content-Type': contentTypes[path.extname(fileName)] || 'application/octet-stream' });
        response.end(data);
    } catch (error) {
        json(response, error.code === 'ENOENT' ? 404 : 500, { error: error.message });
    }
}

function safeStaticFile(baseDirectory, relativePath) {
    const base = path.resolve(baseDirectory);
    const fileName = path.resolve(base, relativePath);
    if (fileName !== base && !fileName.startsWith(`${base}${path.sep}`)) throw new Error('Invalid static file path');
    return fileName;
}

function startExtractionJob(response, extractor, input, provider) {
    const jobId = jobManager.createJob();
    json(response, 202, { jobId, status: 'processing', message: 'Image extraction job started' });
    extractor(input.folderUrl, input.outputFile).then(async (output) => {
        const imageCount = await saveImageData(input.folderUrl, input.outputFile);
        jobManager.completeJob(jobId, { output, imageCount, dataFile: 'data/image-data.json' });
    }).catch((error) => {
        jobManager.failJob(jobId, error);
    });
}

async function resetImageDataFile() {
    await fs.writeFile(IMAGE_DATA_FILE, JSON.stringify({ shareFolder: "", data: [] }, null, 2));
    await fs.writeFile(ALIASES_FILE, JSON.stringify({}), null, 2);
}

function startLabelingJob(response) {
    const totalImages = loadSeries(path.join(ROOT, 'image-links.js')).length;
    // reset person-aliases.json before starting labeling job
    fs.writeFile(ALIASES_FILE, JSON.stringify({}, null, 2)).catch((error) => {
        console.error(`Failed to reset ${ALIASES_FILE}: ${error.message}`);
    });
    const jobId = jobManager.createJob({ totalImages, remainingImages: totalImages });
    json(response, 202, { jobId, status: 'processing', message: 'Labeling job started' });
    runLabeling(jobId).then((result) => {
        jobManager.completeJob(jobId, result);
    }).catch((error) => {
        jobManager.failJob(jobId, error);
    });
}

const server = http.createServer(async (request, response) => {
    try {
        const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
        if (url.pathname === '/api/image-data' && request.method === 'GET') {
            const imageData = await readJson(IMAGE_DATA_FILE, {});
            const images = Array.isArray(imageData.data) ? imageData.data : [];
            // trả về thông tin url link và số lượng ảnh trong thư mục
            return json(response, 200,
                {
                    available: images.length > 0,
                    count: images.length,
                    shareFolder: imageData.shareFolder || null
                });
        }
        if (url.pathname === '/api/persons' && request.method === 'GET') return json(response, 200, { persons: await getPersons() });
        if (url.pathname === '/api/images' && request.method === 'GET') return json(response, 200, { images: getImages(url.searchParams.getAll('person')) });
        if (url.pathname === '/api/person-aliases' && request.method === 'GET') return json(response, 200, await readJson(ALIASES_FILE, {}));
        if (url.pathname === '/api/person-aliases' && request.method === 'POST') {
            const submitted = await body(request);
            if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) throw new Error('Aliases must be a JSON object');
            const current = await readJson(ALIASES_FILE, {});
            for (const [id, value] of Object.entries(submitted)) {
                if (!/^person-\d+$/.test(id) || typeof value !== 'string') throw new Error('Invalid person alias data');
                current[id] = { alias: value.trim() };
            }
            await fs.writeFile(ALIASES_FILE, `${JSON.stringify(current, null, 2)}\n`);
            return json(response, 200, { ok: true, aliases: current });
        }
        if (url.pathname.startsWith('/api/job-status/') && request.method === 'GET') {
            const job = jobManager.getJob(url.pathname.slice('/api/job-status/'.length));
            if (!job) return json(response, 404, { error: 'Job not found' });
            return json(response, 200, job);
        }
        if (url.pathname === '/api/labeling' && request.method === 'POST') {
            return startLabelingJob(response);
        }
        if (url.pathname === '/api/deploy-website' && request.method === 'POST') {
            const jobId = jobManager.createJob();
            json(response, 202, { jobId, status: 'processing', message: 'Public website deployment started' });
            startWebsiteDeployment(jobId).then((result) => {
                jobManager.completeJob(jobId, result);
            }).catch((error) => {
                jobManager.failJob(jobId, error);
            });
            return;
        }
        if (url.pathname === '/api/generate-fe-data' && request.method === 'POST') return json(response, 200, await generateFeData());
        if (url.pathname === '/api/extract/google-drive' && request.method === 'POST') {
            const input = await body(request);
            if (typeof input.folderUrl !== 'string' || !input.folderUrl) throw new Error('folderUrl is required');
            input.outputFile = 'image-links.js';
            await resetImageDataFile();
            return startExtractionJob(response, googleDrive.run, input, 'google-drive');
        }
        if (url.pathname === '/api/extract/onedrive' && request.method === 'POST') {
            const input = await body(request);
            if (typeof input.folderUrl !== 'string' || !input.folderUrl) throw new Error('folderUrl is required');
            input.outputFile = input.outputFile || 'image-links.js';
            await resetImageDataFile();
            return startExtractionJob(response, oneDrive.run, input, 'onedrive');
        }
        if (url.pathname === '/' || url.pathname === '/index.html') return serveFile(response, path.join(ROOT, 'person-management', 'index.html'));
        if (url.pathname === '/person-management' || url.pathname === '/person-management/') return serveFile(response, path.join(ROOT, 'person-management', 'index.html'));
        if (url.pathname.startsWith('/person-management/')) return serveFile(response, safeStaticFile(path.join(ROOT, 'person-management'), url.pathname.slice('/person-management/'.length)));
        if (url.pathname === '/report/' || url.pathname === '/report') return serveFile(response, safeStaticFile(REPORT_DIRECTORY, 'face-clusters-report.html'));
        if (url.pathname.startsWith('/report/')) return serveFile(response, safeStaticFile(REPORT_DIRECTORY, url.pathname.slice('/report/'.length)));
        if (url.pathname === '/face-clusters-report/' || url.pathname === '/face-clusters-report') return serveFile(response, safeStaticFile(path.join(ROOT, 'face-clusters-report'), 'index.html'));
        if (url.pathname.startsWith('/face-clusters-report/')) return serveFile(response, safeStaticFile(path.join(ROOT, 'face-clusters-report'), url.pathname.slice('/face-clusters-report/'.length)));
        if (url.pathname === '/FE/seriesData.js') return serveFile(response, GENERATED_FILE);
        if (url.pathname.startsWith('/FE/')) return serveFile(response, safeStaticFile(path.join(ROOT, 'FE', 'public'), url.pathname.slice(4) || 'index.html'));
        return json(response, 404, { error: 'Not found' });
    } catch (error) { json(response, 400, { error: error.message }); }
});

server.listen(PORT, () => console.log(`Image application listening at http://localhost:${PORT}`));

module.exports = { server, generateFeData, getPersons };
