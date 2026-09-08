const imageCache = new Map();

const landmarkStyles = [
    { name: 'Left eye', color: '#2563eb' },
    { name: 'Right eye', color: '#16a34a' },
    { name: 'Nose', color: '#f4ebdd' },
    { name: 'Left mouth corner', color: '#dc2626' },
    { name: 'Right mouth corner', color: '#9333ea' },
];

function createLandmarkLegend() {
    const legend = document.createElement('div');
    legend.className = 'landmark-legend';
    legend.setAttribute('aria-label', 'Landmark color legend');

    landmarkStyles.forEach(({ name, color }) => {
        const item = document.createElement('span');
        const swatch = document.createElement('span');
        swatch.className = 'landmark-swatch';
        swatch.style.backgroundColor = color;
        swatch.setAttribute('aria-hidden', 'true');
        item.append(swatch, document.createTextNode(name));
        legend.append(item);
    });

    return legend;
}

function buildGroups() {
    const groups = new Map();
    let globalFaceIndex = 0;

    seriesData.forEach((record) => {
        record.persons.forEach((person, imageFaceIndex) => {
            const face = {
                record,
                person,
                globalFaceIndex,
                imageFaceIndex,
            };
            globalFaceIndex += 1;
            if (!groups.has(person.id)) {
                groups.set(person.id, []);
            }

            groups.get(person.id).push(face);
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

    people.forEach(({ person, globalFaceIndex }) => {
        const box = person.box;
        const left = box.left * scaleX;
        const top = box.top * scaleY;
        const width = box.width * scaleX;
        const height = box.height * scaleY;
        const label = `face #${globalFaceIndex} ${person.id} ${Number(person.confidence).toFixed(2)}`;

        context.strokeStyle = '#ff3b30';
        context.fillStyle = 'rgba(255, 59, 48, 0.18)';
        context.strokeRect(left, top, width, height);
        context.fillRect(left, top, width, height);

        const labelMetrics = context.measureText(label);
        const labelPadding = Math.max(4, Math.round(context.lineWidth));
        const labelWidth = labelMetrics.width + labelPadding * 2;
        const labelHeight = Math.max(24, Math.round(context.font.match(/\d+/)?.[0] || 18) + labelPadding * 2);
        const labelX = left;
        const labelY = Math.max(0, top - labelHeight - labelPadding);

        context.fillStyle = '#ffffff';
        context.fillRect(labelX, labelY, labelWidth, labelHeight);
        context.fillStyle = '#ff3b30';
        context.fillText(label, labelX + labelPadding, labelY + labelPadding);

        person.landmarks.forEach((point, landmarkIndex) => {
            const landmarkStyle = landmarkStyles[landmarkIndex] || {
                color: '#64748b',
            };
            context.fillStyle = landmarkStyle.color;
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

function createFaceCard(record, face) {
    const article = document.createElement('article');
    const canvas = document.createElement('canvas');
    const caption = document.createElement('figcaption');
    const person = face.person;
    const box = person.box;
    const landmarks = person.landmarks
        .map((point) => `${point.x.toFixed(0)},${point.y.toFixed(0)}`)
        .join(' | ');

    canvas.className = 'face-crop';
    canvas.width = 232;
    canvas.height = 232;
    caption.textContent = [
        `face #${face.globalFaceIndex} | image face #${face.imageFaceIndex}`,
        `cluster ${person.id}`,
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

    items.forEach(({ record, person, globalFaceIndex, imageFaceIndex }) => {
        if (!records.has(record.name)) records.set(record.name, []);
        records.get(record.name).push({ record, person, globalFaceIndex, imageFaceIndex });
        grid.appendChild(createFaceCard(record, { record, person, globalFaceIndex, imageFaceIndex }));
    });

    section.appendChild(heading);
    section.appendChild(grid);
    records.forEach((items) => section.appendChild(createOriginalImage(items[0].record, items)));
    return section;
}

function setupPersonFilter(groups, render) {
    const select = document.getElementById('person-filter');
    const trigger = document.getElementById('person-filter-trigger');
    const label = document.getElementById('person-filter-label');
    const menu = document.getElementById('person-filter-menu');
    const ids = [...groups.keys()];

    ids.forEach((id) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = id;
        option.selected = ids.indexOf(id) === 0;
        select.append(option);
    });

    const sync = () => {
        const selected = [...select.options].filter((option) => option.selected);
        label.textContent = selected.length === 0
            ? 'No person selected'
            : selected[0].textContent;
        menu.replaceChildren();

        if (!select.options.length) {
            const empty = document.createElement('div');
            empty.className = 'person-filter-empty';
            empty.textContent = 'No people available';
            menu.append(empty);
            return;
        }

        [...select.options].forEach((option) => {
            const item = document.createElement('label');
            const checkbox = document.createElement('input');
            const text = document.createElement('span');

            item.className = 'person-filter-option';
            checkbox.type = 'radio';
            checkbox.name = 'person-filter-option';
            checkbox.checked = option.selected;
            checkbox.setAttribute('aria-label', option.textContent);
            checkbox.addEventListener('change', () => {
                [...select.options].forEach((itemOption) => {
                    itemOption.selected = itemOption === option;
                });
                option.selected = checkbox.checked;
                render();
                sync();
            });
            text.textContent = option.textContent;
            item.append(checkbox, text);
            menu.append(item);
        });
    };

    const setOpen = (isOpen) => {
        trigger.setAttribute('aria-expanded', String(isOpen));
        menu.hidden = !isOpen;
    };

    trigger.addEventListener('click', () => {
        sync();
        setOpen(menu.hidden);
    });
    document.addEventListener('click', (event) => {
        if (!event.target.closest('.person-filter-control')) setOpen(false);
    });

    return {
        getSelected: () => new Set(
            [...select.options]
                .filter((option) => option.selected)
                .map((option) => option.value),
        ),
        sync,
    };
}

function renderReport() {
    const clusters = document.getElementById('clusters');
    const status = document.getElementById('report-status');
    const groups = buildGroups();
    let personFilter;

    // document.getElementById('report').insertBefore(
    //     createLandmarkLegend(),
    //     clusters,
    // );

    const render = () => {
        const selected = personFilter ? personFilter.getSelected() : new Set();
        const visibleGroups = [...groups.entries()]
            .filter(([id]) => selected.size === 0 || selected.has(id));

        clusters.replaceChildren();
        visibleGroups.forEach(([id, items]) => {
            clusters.appendChild(createCluster(id, items));
        });
        status.textContent = visibleGroups.length
            ? `${visibleGroups.length} of ${groups.size} cluster(s)`
            : 'No matching people.';
    };

    personFilter = setupPersonFilter(groups, render);
    personFilter.sync();
    render();
}

renderReport();
