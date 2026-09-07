const imageCache = new Map();

function buildGroups() {
    const groups = new Map();

    seriesData.forEach((record) => {
        record.persons.forEach((person) => {
            if (!groups.has(person.id)) {
                groups.set(person.id, []);
            }

            groups.get(person.id).push({ record, person });
        });
    });

    return groups;
}

function loadImage(url) {
    if (!imageCache.has(url)) {
        const promise = new Promise((resolve, reject) => {
            const image = new Image();
            image.crossOrigin = 'anonymous';
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error(`Unable to load ${url}`));
            image.src = url;
        });
        imageCache.set(url, promise);
    }

    return imageCache.get(url);
}

function createOriginalImage(record) {
    const wrapper = document.createElement('div');
    const image = document.createElement('img');
    const name = document.createElement('p');
    const url = record.url || record.thumbnailUrl || '';

    image.className = 'original';
    image.src = url;
    image.alt = record.name || '';
    image.loading = 'lazy';
    name.className = 'image-name';
    name.textContent = record.name || '';
    wrapper.append(image, name);

    return wrapper;
}

function getFaceImageSize(record, person) {
    return record.faceImageSize || {
        width: person.imageWidth,
        height: person.imageHeight,
    };
}

function renderFaceCrop(canvas, record, person) {
    const url = record.url || record.thumbnailUrl || '';
    const processingSize = getFaceImageSize(record, person);

    if (!url || !processingSize.width || !processingSize.height) {
        return;
    }

    loadImage(url)
        .then((image) => {
            const scaleX = image.naturalWidth / processingSize.width;
            const scaleY = image.naturalHeight / processingSize.height;
            const box = person.box;
            const sourceX = box.left * scaleX;
            const sourceY = box.top * scaleY;
            const sourceWidth = box.width * scaleX;
            const sourceHeight = box.height * scaleY;
            const padding = Math.max(sourceWidth, sourceHeight) * 0.3;
            const cropSize = Math.max(sourceWidth, sourceHeight) + padding * 2;
            const centerX = sourceX + sourceWidth / 2;
            const centerY = sourceY + sourceHeight / 2;
            const cropX = Math.max(
                0,
                Math.min(image.naturalWidth - cropSize, centerX - cropSize / 2),
            );
            const cropY = Math.max(
                0,
                Math.min(image.naturalHeight - cropSize, centerY - cropSize / 2),
            );
            const boundedSize = Math.min(
                cropSize,
                image.naturalWidth - cropX,
                image.naturalHeight - cropY,
            );

            canvas.width = 232;
            canvas.height = 232;
            canvas.getContext('2d').drawImage(
                image,
                cropX,
                cropY,
                boundedSize,
                boundedSize,
                0,
                0,
                canvas.width,
                canvas.height,
            );
        })
        .catch(() => {
            canvas.setAttribute('aria-label', 'Face crop unavailable');
        });
}

function createFaceCard(record, person) {
    const article = document.createElement('article');
    const canvas = document.createElement('canvas');
    const caption = document.createElement('figcaption');
    const box = person.box;
    const landmarks = person.landmarks
        .map((point) => `${point.x.toFixed(0)},${point.y.toFixed(0)}`)
        .join(' | ');

    canvas.className = 'face-crop';
    canvas.width = 232;
    canvas.height = 232;
    caption.textContent = [
        `score ${Number(person.confidence).toFixed(3)}`,
        `box ${box.left},${box.top},${box.width}x${box.height}`,
        `landmarks ${landmarks}`,
    ].join('\n');
    article.append(canvas, caption);
    renderFaceCrop(canvas, record, person);

    return article;
}

function createCluster(id, items) {
    const section = document.createElement('section');
    const heading = document.createElement('h2');
    const count = document.createElement('small');
    const grid = document.createElement('div');
    const records = new Map();

    heading.textContent = id;
    count.textContent = ` ${items.length} face(s)`;
    heading.appendChild(count);
    grid.className = 'grid';

    items.forEach(({ record, person }) => {
        if (!records.has(record.name)) {
            records.set(record.name, record);
        }
        grid.appendChild(createFaceCard(record, person));
    });

    section.appendChild(heading);
    records.forEach((record) => section.appendChild(createOriginalImage(record)));
    section.appendChild(grid);
    return section;
}

function renderReport() {
    const clusters = document.getElementById('clusters');
    const status = document.getElementById('report-status');
    const groups = buildGroups();

    groups.forEach((items, id) => {
        clusters.appendChild(createCluster(id, items));
    });

    status.textContent = groups.size
        ? `${groups.size} cluster(s)`
        : 'No cluster data available.';
}

renderReport();
