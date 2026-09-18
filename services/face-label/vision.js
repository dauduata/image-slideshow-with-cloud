const sharp = require("sharp");
const crypto = require("node:crypto");

const ALIGNMENT_TEMPLATE = [
  { x: 38.2946, y: 51.6963 }, { x: 73.5318, y: 51.5014 },
  { x: 56.0252, y: 71.7366 }, { x: 41.5493, y: 92.3655 },
  { x: 70.7299, y: 92.2041 },
];
const LANDMARK_ORDER = [1, 0, 2, 4, 3];

function tensorFromRgb(ort, rgb, width, height, subtractMean = false) {
  const data = new Float32Array(3 * width * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      for (let channel = 0; channel < 3; channel += 1) {
        const source = (y * width + x) * 3;
        const value = rgb[source + 2 - channel];
        data[channel * width * height + y * width + x] = subtractMean ? value - [104, 117, 123][channel] : value;
      }
  return new ort.Tensor("float32", data, [1, 3, height, width]);
}

function decodeDetections(result, inputSize, minConfidence, nmsThreshold) {
  const detections = [];
  for (const stride of [8, 16, 32]) {
    const count = (inputSize / stride) ** 2;
    const scores = result[`cls_${stride}`].data;
    const objects = result[`obj_${stride}`].data;
    const boxes = result[`bbox_${stride}`].data;
    const keypoints = result[`kps_${stride}`].data;
    for (let index = 0; index < count; index += 1) {
      const confidence = Math.sqrt(Math.max(0, Math.min(1, scores[index])) * Math.max(0, Math.min(1, objects[index])));
      if (confidence < minConfidence) continue;
      const column = index % (inputSize / stride);
      const row = Math.floor(index / (inputSize / stride));
      const offset = index * 4;
      const landmarks = Array.from({ length: 5 }, (_, point) => ({
        x: (column + keypoints[index * 10 + point * 2]) * stride,
        y: (row + keypoints[index * 10 + point * 2 + 1]) * stride,
      }));
      const cx = (column + boxes[offset]) * stride;
      const cy = (row + boxes[offset + 1]) * stride;
      const width = Math.exp(boxes[offset + 2]) * stride;
      const height = Math.exp(boxes[offset + 3]) * stride;
      detections.push({ confidence, left: cx - width / 2, top: cy - height / 2, right: cx + width / 2, bottom: cy + height / 2, landmarks });
    }
  }
  detections.sort((first, second) => second.confidence - first.confidence);
  const kept = [];
  while (detections.length) {
    const candidate = detections.shift();
    kept.push(candidate);
    for (let index = detections.length - 1; index >= 0; index -= 1)
      if (intersectionOverUnion(candidate, detections[index]) > nmsThreshold) detections.splice(index, 1);
  }
  return kept;
}

function intersectionOverUnion(first, second) {
  const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
  const overlap = width * height;
  const area = (first.right - first.left) * (first.bottom - first.top) + (second.right - second.left) * (second.bottom - second.top) - overlap;
  return area > 0 ? overlap / area : 0;
}

function similarityTransform(sourcePoints) {
  const ordered = LANDMARK_ORDER.map((index) => sourcePoints[index]);
  const sourceMean = ordered.reduce((mean, point) => ({ x: mean.x + point.x / 5, y: mean.y + point.y / 5 }), { x: 0, y: 0 });
  const targetMean = ALIGNMENT_TEMPLATE.reduce((mean, point) => ({ x: mean.x + point.x / 5, y: mean.y + point.y / 5 }), { x: 0, y: 0 });
  let cosineNumerator = 0;
  let sineNumerator = 0;
  let denominator = 0;
  ordered.forEach((point, index) => {
    const x = point.x - sourceMean.x;
    const y = point.y - sourceMean.y;
    const u = ALIGNMENT_TEMPLATE[index].x - targetMean.x;
    const v = ALIGNMENT_TEMPLATE[index].y - targetMean.y;
    cosineNumerator += x * u + y * v;
    sineNumerator += x * v - y * u;
    denominator += x * x + y * y;
  });
  const cosine = cosineNumerator / denominator;
  const sine = sineNumerator / denominator;
  return { cosine, sine, translateX: targetMean.x - cosine * sourceMean.x + sine * sourceMean.y, translateY: targetMean.y - sine * sourceMean.x - cosine * sourceMean.y };
}

function sampleAligned(source, width, height, transform) {
  const output = Buffer.alloc(112 * 112 * 3);
  const determinant = transform.cosine ** 2 + transform.sine ** 2;
  for (let targetY = 0; targetY < 112; targetY += 1)
    for (let targetX = 0; targetX < 112; targetX += 1) {
      const shiftedX = targetX - transform.translateX;
      const shiftedY = targetY - transform.translateY;
      const sourceX = (transform.cosine * shiftedX + transform.sine * shiftedY) / determinant;
      const sourceY = (-transform.sine * shiftedX + transform.cosine * shiftedY) / determinant;
      const x = Math.max(0, Math.min(width - 1, sourceX));
      const y = Math.max(0, Math.min(height - 1, sourceY));
      const x0 = Math.floor(x); const y0 = Math.floor(y);
      const x1 = Math.min(width - 1, x0 + 1); const y1 = Math.min(height - 1, y0 + 1);
      const xWeight = x - x0; const yWeight = y - y0;
      for (let channel = 0; channel < 3; channel += 1)
        output[(targetY * 112 + targetX) * 3 + channel] = Math.round((1 - yWeight) * ((1 - xWeight) * source[(y0 * width + x0) * 3 + channel] + xWeight * source[(y0 * width + x1) * 3 + channel]) + yWeight * ((1 - xWeight) * source[(y1 * width + x0) * 3 + channel] + xWeight * source[(y1 * width + x1) * 3 + channel]));
    }
  return output;
}

async function detectAndEmbed(buffer, detector, recognizer, ort, options) {
  const resized = await sharp(buffer).rotate().resize({ width: options.maxDimension, height: options.maxDimension, fit: "inside", withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = resized.info.width; const height = resized.info.height;
  const detectorSize = 640;
  const detectorScale = Math.min(detectorSize / width, detectorSize / height);
  const detectorWidth = Math.round(width * detectorScale); const detectorHeight = Math.round(height * detectorScale);
  const detectorOffsetX = Math.round((detectorSize - detectorWidth) / 2); const detectorOffsetY = Math.round((detectorSize - detectorHeight) / 2);
  const detectorImage = await sharp(resized.data, { raw: resized.info }).resize(detectorSize, detectorSize, { fit: "contain", background: { r: 0, g: 0, b: 0 } }).raw().toBuffer();
  const detectorResult = await detector.run({ [detector.inputNames[0]]: tensorFromRgb(ort, detectorImage, detectorSize, detectorSize, true) });
  const faces = [];
  for (const detection of decodeDetections(detectorResult, detectorSize, options.minConfidence, options.nmsThreshold)) {
    const toSourceX = (value) => Math.round((value - detectorOffsetX) / detectorScale);
    const toSourceY = (value) => Math.round((value - detectorOffsetY) / detectorScale);
    const left = Math.max(0, toSourceX(detection.left)); const top = Math.max(0, toSourceY(detection.top));
    const right = Math.min(width, toSourceX(detection.right)); const bottom = Math.min(height, toSourceY(detection.bottom));
    if (right <= left || bottom <= top) continue;
    const boxWidth = right - left; const boxHeight = bottom - top;
    if (Math.min(boxWidth, boxHeight) < options.minFaceSize || Math.max(boxWidth / boxHeight, boxHeight / boxWidth) > options.maxFaceAspectRatio) continue;
    const landmarks = detection.landmarks.map((point) => ({ x: (point.x - detectorOffsetX) / detectorScale, y: (point.y - detectorOffsetY) / detectorScale }));
    const aligned = sampleAligned(resized.data, width, height, similarityTransform(landmarks));
    const cropBefore = await sharp(resized.data, { raw: resized.info }).extract({ left, top, width: boxWidth, height: boxHeight }).resize(112, 112).raw().toBuffer();
    const [previewBefore, previewAligned] = await Promise.all([
      sharp(cropBefore, { raw: { width: 112, height: 112, channels: 3 } }).jpeg().toBuffer(),
      sharp(aligned, { raw: { width: 112, height: 112, channels: 3 } }).jpeg().toBuffer(),
    ]);
    const result = await recognizer.run({ [recognizer.inputNames[0]]: tensorFromRgb(ort, aligned, 112, 112) });
    const values = Array.from(result[recognizer.outputNames[0]].data);
    const norm = Math.hypot(...values) || 1;
    faces.push({ embedding: values.map((value) => value / norm), preview: `data:image/jpeg;base64,${previewAligned.toString("base64")}`, previewBefore: `data:image/jpeg;base64,${previewBefore.toString("base64")}`, landmarks, box: { left, top, width: boxWidth, height: boxHeight }, imageWidth: width, imageHeight: height, confidence: detection.confidence });
  }
  const overlays = faces.map((face) => `<rect x="${face.box.left}" y="${face.box.top}" width="${face.box.width}" height="${face.box.height}"/><g>${face.landmarks.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="8"/>`).join("")}</g>`).join("");
  const annotated = await sharp(resized.data, { raw: resized.info }).composite([{ input: Buffer.from(`<svg width="${width}" height="${height}"><style>rect,circle{fill:none;stroke:#00ff55;stroke-width:6}circle{fill:#ff3355}</style>${overlays}</svg>`) }]).jpeg().toBuffer();
  faces.forEach((face) => { face.annotated = `data:image/jpeg;base64,${annotated.toString("base64")}`; });
  return { width, height, faces };
}

module.exports = { detectAndEmbed, tensorFromRgb, sha256: (value) => crypto.createHash("sha256").update(value).digest("hex") };
