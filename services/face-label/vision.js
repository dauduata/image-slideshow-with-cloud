const sharp = require("sharp");
const crypto = require("node:crypto");

const ALIGNMENT_TEMPLATE = [
  { x: 38.2946, y: 51.6963 },
  { x: 73.5318, y: 51.5014 },
  { x: 56.0252, y: 71.7366 },
  { x: 41.5493, y: 92.3655 },
  { x: 70.7299, y: 92.2041 },
];
const CURRENT_LANDMARK_ORDER = [1, 0, 2, 4, 3];
const ALTERNATIVE_LANDMARK_ORDER = [0, 1, 2, 3, 4];

function tensorFromRgb(ort, rgb, width, height, normalize = false, subtractMean = false) {
  const data = new Float32Array(3 * width * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const value = rgb[source + 2 - channel];
        const mean = [104, 117, 123][channel];
        data[channel * width * height + y * width + x] = subtractMean ? value - mean : normalize ? (value / 255) * 2 - 1 : value;
      }
    }
  return new ort.Tensor("float32", data, [1, 3, height, width]);
}

function tensorStats(tensor) {
  const values = Array.from(tensor.data);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}

function intersectionOverUnion(first, second) {
  const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
  const overlap = width * height;
  const area = (first.right - first.left) * (first.bottom - first.top) + (second.right - second.left) * (second.bottom - second.top) - overlap;
  return area > 0 ? overlap / area : 0;
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
      const clsScore = Math.max(0, Math.min(1, scores[index]));
      const objScore = Math.max(0, Math.min(1, objects[index]));
      const confidence = Math.sqrt(clsScore * objScore);
      if (confidence < minConfidence) continue;
      const column = index % (inputSize / stride);
      const row = Math.floor(index / (inputSize / stride));
      const offset = index * 4;
      const landmarks = [];
      for (let point = 0; point < 5; point += 1)
        landmarks.push({ x: (column + keypoints[index * 10 + point * 2]) * stride, y: (row + keypoints[index * 10 + point * 2 + 1]) * stride });
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

function similarityTransformForOrder(sourcePoints, order) {
  const orderedSource = order.map((index) => sourcePoints[index]);
  const sourceMean = orderedSource.reduce((mean, point) => ({ x: mean.x + point.x / 5, y: mean.y + point.y / 5 }), { x: 0, y: 0 });
  const targetMean = ALIGNMENT_TEMPLATE.reduce((mean, point) => ({ x: mean.x + point.x / 5, y: mean.y + point.y / 5 }), { x: 0, y: 0 });
  let scaleCosine = 0;
  let scaleSine = 0;
  let denominator = 0;
  orderedSource.forEach((point, index) => {
    const x = point.x - sourceMean.x;
    const y = point.y - sourceMean.y;
    const u = ALIGNMENT_TEMPLATE[index].x - targetMean.x;
    const v = ALIGNMENT_TEMPLATE[index].y - targetMean.y;
    scaleCosine += x * u + y * v;
    scaleSine += x * v - y * u;
    denominator += x * x + y * y;
  });
  const cosine = scaleCosine / denominator;
  const sine = scaleSine / denominator;
  return { cosine, sine, translateX: targetMean.x - cosine * sourceMean.x + sine * sourceMean.y, translateY: targetMean.y - sine * sourceMean.x - cosine * sourceMean.y };
}

function transformPoint(point, transform) {
  return { x: transform.cosine * point.x - transform.sine * point.y + transform.translateX, y: transform.sine * point.x + transform.cosine * point.y + transform.translateY };
}

function alignmentErrors(sourcePoints, order, transform) {
  return order.map((sourceIndex, targetIndex) => {
    const transformed = transformPoint(sourcePoints[sourceIndex], transform);
    const target = ALIGNMENT_TEMPLATE[targetIndex];
    return Math.hypot(transformed.x - target.x, transformed.y - target.y);
  });
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
      for (let channel = 0; channel < 3; channel += 1) {
        const value = (1 - yWeight) * ((1 - xWeight) * source[(y0 * width + x0) * 3 + channel] + xWeight * source[(y0 * width + x1) * 3 + channel]) + yWeight * ((1 - xWeight) * source[(y1 * width + x0) * 3 + channel] + xWeight * source[(y1 * width + x1) * 3 + channel]);
        output[(targetY * 112 + targetX) * 3 + channel] = Math.round(value);
      }
    }
  return output;
}

async function detectAndEmbed(buffer, detector, recognizer, ort, options) {
  const resized = await sharp(buffer).rotate().resize({ width: options.maxDimension, height: options.maxDimension, fit: "inside", withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = resized.info.width;
  const height = resized.info.height;
  const detectorSize = 640;
  const detectorScale = Math.min(detectorSize / width, detectorSize / height);
  const detectorWidth = Math.round(width * detectorScale);
  const detectorHeight = Math.round(height * detectorScale);
  const detectorOffsetX = Math.round((detectorSize - detectorWidth) / 2);
  const detectorOffsetY = Math.round((detectorSize - detectorHeight) / 2);
  const detectorImage = await sharp(resized.data, { raw: resized.info }).resize(detectorSize, detectorSize, { fit: "contain", background: { r: 0, g: 0, b: 0 } }).raw().toBuffer();
  const detectorResult = await detector.run({ [detector.inputNames[0]]: tensorFromRgb(ort, detectorImage, detectorSize, detectorSize, false, true) });
  const faces = [];
  for (const detection of decodeDetections(detectorResult, detectorSize, options.minConfidence, options.nmsThreshold)) {
    const toSourceX = (value) => Math.round((value - detectorOffsetX) / detectorScale);
    const toSourceY = (value) => Math.round((value - detectorOffsetY) / detectorScale);
    const left = Math.max(0, toSourceX(detection.left));
    const top = Math.max(0, toSourceY(detection.top));
    const right = Math.min(width, toSourceX(detection.right));
    const bottom = Math.min(height, toSourceY(detection.bottom));
    const landmarks = detection.landmarks.map((point) => ({ x: (point.x - detectorOffsetX) / detectorScale, y: (point.y - detectorOffsetY) / detectorScale }));
    if (options.debug) console.log(`DEBUG candidate score=${detection.confidence.toFixed(3)} box=${left},${top},${right - left}x${bottom - top} landmarks=${landmarks.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join("|")}`);
    if (right <= left || bottom <= top) continue;
    const boxWidth = right - left;
    const boxHeight = bottom - top;
    const aspectRatio = Math.max(boxWidth / boxHeight, boxHeight / boxWidth);
    if (options.debug) console.log("[LANDMARK-RAW]", { imageWidth: width, imageHeight: height, box: { x: left, y: top, width: boxWidth, height: boxHeight }, landmarks });
    if (Math.min(boxWidth, boxHeight) < options.minFaceSize || aspectRatio > options.maxFaceAspectRatio) continue;
    const transformA = similarityTransformForOrder(landmarks, CURRENT_LANDMARK_ORDER);
    const transformB = similarityTransformForOrder(landmarks, ALTERNATIVE_LANDMARK_ORDER);
    const alignedA = sampleAligned(resized.data, width, height, transformA);
    const alignedB = sampleAligned(resized.data, width, height, transformB);
    const cropBefore = await sharp(resized.data, { raw: resized.info }).extract({ left, top, width: boxWidth, height: boxHeight }).resize(112, 112).raw().toBuffer();
    const [previewBefore, previewAligned] = await Promise.all([
      sharp(cropBefore, { raw: { width: 112, height: 112, channels: 3 } }).jpeg().toBuffer(),
      sharp(alignedB, { raw: { width: 112, height: 112, channels: 3 } }).jpeg().toBuffer(),
    ]);
    const sfaceTensor = tensorFromRgb(ort, alignedB, 112, 112);
    if (options.debug) {
      const stats = tensorStats(sfaceTensor);
      console.log(`[SFACE INPUT] mode=BGR_RAW_0_255 shape=${sfaceTensor.dims.join("x")} min=${stats.min.toFixed(3)} max=${stats.max.toFixed(3)} mean=${stats.mean.toFixed(3)}`);
    }
    const result = await recognizer.run({ [recognizer.inputNames[0]]: sfaceTensor });
    const resultA = await recognizer.run({ [recognizer.inputNames[0]]: tensorFromRgb(ort, alignedA, 112, 112) });
    const values = Array.from(result[recognizer.outputNames[0]].data);
    const valuesA = Array.from(resultA[recognizer.outputNames[0]].data);
    const length = Math.hypot(...values) || 1;
    const lengthA = Math.hypot(...valuesA) || 1;
    const normalized = values.map((value) => value / length);
    const normalizedA = valuesA.map((value) => value / lengthA);
    if (options.debug) {
      const errorsA = alignmentErrors(landmarks, CURRENT_LANDMARK_ORDER, transformA);
      const errorsB = alignmentErrors(landmarks, ALTERNATIVE_LANDMARK_ORDER, transformB);
      console.log(`[ALIGNMENT-AB] A-order=${CURRENT_LANDMARK_ORDER.join(",")} B-order=${ALTERNATIVE_LANDMARK_ORDER.join(",")} A-errors=${errorsA.map((value) => value.toFixed(4)).join(",")} B-errors=${errorsB.map((value) => value.toFixed(4)).join(",")}`);
      console.log(`[FORENSIC HASH] alignedA=${sha256(alignedA)} alignedB=${sha256(alignedB)} tensorA=${sha256(tensorFromRgb(ort, alignedA, 112, 112).data)} tensorB=${sha256(sfaceTensor.data)} rawA=${sha256(Float32Array.from(valuesA))} rawB=${sha256(Float32Array.from(values))}`);
    }
    const errorsA = alignmentErrors(landmarks, CURRENT_LANDMARK_ORDER, transformA);
    const errorsB = alignmentErrors(landmarks, ALTERNATIVE_LANDMARK_ORDER, transformB);
    faces.push({ embedding: normalized, alternativeEmbedding: normalizedA, preview: `data:image/jpeg;base64,${previewAligned.toString("base64")}`, previewBefore: `data:image/jpeg;base64,${previewBefore.toString("base64")}`, alignmentErrorsA: errorsA, alignmentErrorsB: errorsB, landmarks, box: { left, top, width: boxWidth, height: boxHeight }, imageWidth: width, imageHeight: height, confidence: detection.confidence });
  }
  const overlays = faces.map((face) => `<rect x="${face.box.left}" y="${face.box.top}" width="${face.box.width}" height="${face.box.height}"/><g>${face.landmarks.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="8"/>`).join("")}</g>`).join("");
  const annotated = await sharp(resized.data, { raw: resized.info }).composite([{ input: Buffer.from(`<svg width="${width}" height="${height}"><style>rect,circle{fill:none;stroke:#00ff55;stroke-width:6}circle{fill:#ff3355}</style>${overlays}</svg>`) }]).jpeg().toBuffer();
  faces.forEach((face) => { face.annotated = `data:image/jpeg;base64,${annotated.toString("base64")}`; });
  return { width, height, faces };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

module.exports = { detectAndEmbed, tensorFromRgb, sha256 };
