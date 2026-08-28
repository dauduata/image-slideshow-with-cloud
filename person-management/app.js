const peopleElement = document.querySelector('#people');
const statusElement = document.querySelector('#status');
let people = [];

function setStatus(message, isError = false) { statusElement.textContent = message; statusElement.dataset.error = isError ? 'true' : 'false'; }
function imageSource(person) { return person.representative || ''; }
function render() {
    peopleElement.innerHTML = people.length ? people.map((person) => `<article class="person"><img src="${imageSource(person)}" alt="${person.id}" loading="lazy"><div><p class="person-id">${person.id}</p><p class="count">${person.faceCount} face${person.faceCount === 1 ? '' : 's'}</p><label for="alias-${person.id}">Alias</label><input id="alias-${person.id}" data-person-id="${person.id}" value="${person.alias.replaceAll('"', '&quot;')}" maxlength="120"></div></article>`).join('') : '<p>No labeled people found.</p>';
}
async function load() {
    setStatus('Loading people...');
    try { const response = await fetch('/api/persons'); const data = await response.json(); if (!response.ok) throw new Error(data.error); people = data.persons; render(); setStatus(`${people.length} people loaded`); }
    catch (error) { setStatus(error.message, true); }
}
document.querySelector('#refresh').addEventListener('click', load);
document.querySelector('#save').addEventListener('click', async () => {
    const aliases = Object.fromEntries([...document.querySelectorAll('[data-person-id]')].map((input) => [input.dataset.personId, input.value]));
    try { const response = await fetch('/api/person-aliases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(aliases) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setStatus('Aliases saved'); await load(); }
    catch (error) { setStatus(error.message, true); }
});
document.querySelector('#generate').addEventListener('click', async () => {
    try { const response = await fetch('/api/generate-fe-data', { method: 'POST' }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setStatus(`${data.file} generated`); }
    catch (error) { setStatus(error.message, true); }
});
load();
