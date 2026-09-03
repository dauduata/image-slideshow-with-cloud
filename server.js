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
const LABELED_FILE = path.join(ROOT, 'image-onedrive-links-labeled.js');
const GENERATED_FILE = path.join(ROOT, 'FE', 'seriesData.js');
const REPORT_FILE = path.join(ROOT, 'face-clusters-report.html');

const jobManager = {
    jobs: new Map(),
    createJob() {
        const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        this.jobs.set(jobId, {
            jobId,
            status: 'processing',
            progress: 0,
            result: null,
            error: null,
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
        this.cleanupOldJobs();
        return jobId;
    },
    getJob(jobId) { return this.jobs.get(jobId); },
    updateJob(jobId, updates) {
        const job = this.jobs.get(jobId);
        if (job) Object.assign(job, updates, { updatedAt: Date.now() });
    },
    completeJob(jobId, result) {
        this.updateJob(jobId, { status: 'completed', progress: 100, result });
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
        representative: details.get(id)?.representative || series.find((record) => record.persons?.includes(id))?.thumbnailUrl || series.find((record) => record.persons?.includes(id))?.url || '',
        images: series.filter((record) => record.persons?.includes(id)).map(({ name, url, thumbnailUrl }) => ({ name, url, thumbnailUrl: thumbnailUrl || url }))
    }));
}

async function generateFeData() {
    const series = loadSeries(LABELED_FILE);
    if (!series.length) throw new Error('Labeled source data is missing or empty');
    const aliases = await ensureAliases(personIdsFromSeries(series));
    const output = `const personAliases = ${JSON.stringify(Object.fromEntries(Object.entries(aliases).map(([id, value]) => [id, value.alias || ''])), null, 2)};\n\nconst seriesData = ${JSON.stringify(series, null, 2)};\n`;
    await fs.mkdir(path.dirname(GENERATED_FILE), { recursive: true });
    await fs.writeFile(GENERATED_FILE, output, 'utf8');
    return { file: '/FE/seriesData.js', persons: personIdsFromSeries(series).length, images: series.length };
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

function startExtractionJob(response, extractor, input) {
    const jobId = jobManager.createJob();
    json(response, 202, { jobId, status: 'processing', message: 'Image extraction job started' });
    extractor(input.folderUrl, input.outputFile).then((output) => {
        jobManager.completeJob(jobId, { output });
    }).catch((error) => {
        jobManager.failJob(jobId, error);
    });
}

const server = http.createServer(async (request, response) => {
    try {
        const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
        if (url.pathname === '/api/persons' && request.method === 'GET') return json(response, 200, { persons: await getPersons() });
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
        if (url.pathname === '/api/generate-fe-data' && request.method === 'POST') return json(response, 200, await generateFeData());
        if (url.pathname === '/api/extract/google-drive' && request.method === 'POST') {
            const input = await body(request);
            if (typeof input.folderUrl !== 'string' || !input.folderUrl) throw new Error('folderUrl is required');
            return startExtractionJob(response, googleDrive.run, input);
        }
        if (url.pathname === '/api/extract/onedrive' && request.method === 'POST') {
            const input = await body(request);
            if (typeof input.folderUrl !== 'string' || !input.folderUrl) throw new Error('folderUrl is required');
            return startExtractionJob(response, oneDrive.run, input);
        }
        if (url.pathname === '/' || url.pathname === '/index.html') return serveFile(response, path.join(ROOT, 'person-management', 'index.html'));
        if (url.pathname === '/person-management' || url.pathname === '/person-management/') return serveFile(response, path.join(ROOT, 'person-management', 'index.html'));
        if (url.pathname.startsWith('/person-management/')) return serveFile(response, safeStaticFile(path.join(ROOT, 'person-management'), url.pathname.slice('/person-management/'.length)));
        if (url.pathname === '/face-clusters-report/' || url.pathname === '/face-clusters-report') return serveFile(response, safeStaticFile(path.join(ROOT, 'face-clusters-report'), 'index.html'));
        if (url.pathname.startsWith('/face-clusters-report/')) return serveFile(response, safeStaticFile(path.join(ROOT, 'face-clusters-report'), url.pathname.slice('/face-clusters-report/'.length)));
        if (url.pathname === '/FE/seriesData.js') return serveFile(response, GENERATED_FILE);
        if (url.pathname.startsWith('/FE/')) return serveFile(response, safeStaticFile(path.join(ROOT, 'FE', 'public'), url.pathname.slice(4) || 'index.html'));
        return json(response, 404, { error: 'Not found' });
    } catch (error) { json(response, 400, { error: error.message }); }
});

server.listen(PORT, () => console.log(`Image application listening at http://localhost:${PORT}`));

module.exports = { server, generateFeData, getPersons };
