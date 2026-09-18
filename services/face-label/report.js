const fs = require("node:fs");
const path = require("node:path");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function buildReportFaces(faceList) {
  const imageFaceIndexes = new Map();
  return faceList.map((face, faceIndex) => {
    const imageFaceIndex = imageFaceIndexes.get(face.imageIndex) || 0;
    imageFaceIndexes.set(face.imageIndex, imageFaceIndex + 1);
    return { faceIndex, imageFaceIndex, imageIndex: face.imageIndex, imageWidth: face.imageWidth, imageHeight: face.imageHeight, box: face.box, landmarks: face.landmarks, confidence: face.confidence };
  });
}

function writeReport(series, faces, labels, names, fileName) {
  fs.mkdirSync(path.dirname(fileName), { recursive: true });
  const groups = new Map();
  faces.forEach((face, index) => {
    const key = labels[index] >= 0 ? labels[index] : "noise";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ face, index });
  });
  const sections = [...groups.entries()].map(([label, groupFaces]) => {
    const title = label === "noise" ? "noise / unassigned" : names.get(label);
    const imageIndexes = [...new Set(groupFaces.map(({ face }) => face.imageIndex))];
    return `<section><h2>${escapeHtml(title)} <small>${groupFaces.length} face(s)</small></h2>${imageIndexes.map((imageIndex) => { const imageFace = groupFaces.find(({ face }) => face.imageIndex === imageIndex); return `<img class="original" src="${imageFace.face.annotated}" loading="lazy"><p>${escapeHtml(series[imageIndex].name)}</p>`; }).join("")}<div class="grid">${groupFaces.map(({ face }) => `<figure><img src="${face.previewBefore}"><img src="${face.preview}"><figcaption>before / aligned 112x112<br>score ${face.confidence.toFixed(3)}<br>${face.box.left},${face.box.top},${face.box.width}x${face.box.height}<br>${face.landmarks.map((point) => `${point.x.toFixed(0)},${point.y.toFixed(0)}`).join(" | ")}</figcaption></figure>`).join("")}</div></section>`;
  }).join("\n");
  fs.writeFileSync(fileName, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Face clusters</title><style>body{font:16px system-ui;margin:24px;background:#f5f3ef;color:#242424}section{border-top:2px solid #242424;padding:12px 0 28px}.original{display:block;max-width:min(100%,900px);height:auto;margin:12px 0}.grid{display:flex;flex-wrap:wrap;gap:12px}figure{width:232px;margin:0}figure img{display:inline-block;width:112px;height:112px;object-fit:cover;background:#ddd;margin-right:4px}figcaption{font-size:11px;margin-top:4px;line-height:1.35}small{font-size:13px;font-weight:normal}</style>${sections || "<p>No cluster data available.</p>"}`);
}

module.exports = { buildReportFaces, writeReport };
