const filter = document.querySelector('#person-filter');
const clusters = document.querySelector('#clusters');
const status = document.querySelector('#status');
let people = [];
function label(person) { return person.alias || person.id; }
function render() {
    const selected = filter.value;
    const visible = selected ? people.filter((person) => person.id === selected) : people;
    clusters.innerHTML = visible.map((person) => `<article class="cluster"><div class="cluster-head"><div><p class="person-id">${person.id}</p><h2>${label(person)}</h2></div><strong>${person.faceCount} <small>faces</small></strong></div><img class="representative" src="${person.representative}" alt="Representative face for ${person.id}" loading="lazy"><div class="related"><p>Related images</p>${person.images.map((image) => `<a href="${image.url}" target="_blank" rel="noreferrer"><img src="${image.thumbnailUrl}" alt="${image.name}" loading="lazy"><span>${image.name}</span></a>`).join('')}</div></article>`).join('') || '<p>No cluster data available.</p>';
    status.textContent = `${visible.length} person${visible.length === 1 ? '' : 's'}`;
}
fetch('/api/persons').then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); people = data.persons; people.forEach((person) => filter.add(new Option(label(person), person.id))); render(); }).catch((error) => { status.textContent = error.message; });
filter.addEventListener('change', render);
