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

function getImageUrl(record) {
    if (record.id && record.url?.includes('drive.google.com')) {
        return `https://lh3.googleusercontent.com/d/${encodeURIComponent(record.id)}=w2400`;
    }
    if (record.thumbnailLink) {
        return record.thumbnailLink.replace(/=s\d+$/, '=w2400');
    }
    return record.thumbnailUrl || record.url || '';
}

function loadImage(url) {
    if (!imageCache.has(url)) {
        const promise = new Promise((resolve, reject) => {
            const image = new Image();
            image.referrerPolicy = 'no-referrer';
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error(`Unable to load ${url}`));
            image.src = url;
        });
        imageCache.set(url, promise);
    }

    return imageCache.get(url);
}

function drawFaceAnnotations(canvas, image, record, people) {
    const processingSize = getFaceImageSize(record, people[0]);
    const scaleX = image.naturalWidth / processingSize.width;
    const scaleY = image.naturalHeight / processingSize.height;
    const context = canvas.getContext('2d');

    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    context.lineWidth = Math.max(3, Math.round(image.naturalWidth / 600));
    context.font = `${Math.max(18, Math.round(image.naturalWidth / 90))}px system-ui`;
    context.textBaseline = 'top';

    people.forEach(({ person }) => {
        const box = person.box;
        const left = box.left * scaleX;
        const top = box.top * scaleY;
        const width = box.width * scaleX;
        const height = box.height * scaleY;
        const label = `${person.id} ${Number(person.confidence).toFixed(2)}`;

        context.strokeStyle = '#ff3b30';
        context.fillStyle = 'rgba(255, 59, 48, 0.18)';
        context.strokeRect(left, top, width, height);
        context.fillRect(left, top, width, height);

        context.fillStyle = '#ff3b30';
        context.fillText(label, left, Math.max(0, top - context.measureText(label).actualBoundingBoxAscent - 6));

        context.fillStyle = '#00a8ff';
        person.landmarks.forEach((point) => {
            context.beginPath();
            context.arc(point.x * scaleX, point.y * scaleY, context.lineWidth * 1.5, 0, Math.PI * 2);
            context.fill();
        });
    });
}

function createOriginalImage(record, people) {
    const wrapper = document.createElement('div');
    const image = document.createElement('img');
    const overlay = document.createElement('canvas');
    const name = document.createElement('p');
    const url = getImageUrl(record);

    wrapper.className = 'original-image-wrapper';
    image.className = 'original';
    image.src = url;
    image.alt = record.name || '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    overlay.className = 'original-overlay';
    overlay.setAttribute('aria-label', `Face annotations for ${record.name || 'image'}`);
    name.className = 'image-name';
    name.textContent = record.name || '';
    wrapper.append(image, overlay, name);

    loadImage(url)
        .then((loadedImage) => drawFaceAnnotations(overlay, loadedImage, record, people))
        .catch(() => overlay.setAttribute('aria-label', 'Face annotations unavailable'));

    return wrapper;
}

function getFaceImageSize(record, person) {
    return record.faceImageSize || {
        width: person.imageWidth,
        height: person.imageHeight,
    };
}

function renderFaceCrop(canvas, record, person) {
    const url = getImageUrl(record);
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
        if (!records.has(record.name)) records.set(record.name, []);
        records.get(record.name).push({ record, person });
        grid.appendChild(createFaceCard(record, person));
    });

    section.appendChild(heading);
    records.forEach((items) => section.appendChild(createOriginalImage(items[0].record, items)));
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
