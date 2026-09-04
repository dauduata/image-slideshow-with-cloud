const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const sharp = require("sharp");
let ort;

const ROOT = __dirname;
const defaults = {
  input: path.join(ROOT, "image-xuatgiabedao-links.js"),
  output: path.join(ROOT, "image-links-labeled.js"),
  report: path.join(ROOT, "face-clusters-report.html"),
  detector: path.join(ROOT, "models", "face_detection_yunet_2023mar.onnx"),
  recognizer: path.join(ROOT, "models", "face_recognition_sface_2021dec.onnx"),
  concurrency: 3,
  threshold: 0.45,
  timeout: 30000,
  minConfidence: 0.75,
  nmsThreshold: 0.5,
  minFaceSize: 20,
  maxFaceAspectRatio: 2.5,
  maxDimension: 1600,
};

function parseArgs() {
  const options = { ...defaults };
  const values = process.argv.slice(2);
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    if (argument === "--help") {
      console.log(
        "node face-label-poc.js [--input file] [--output file] [--report file] [--concurrency 2] [--threshold 0.45]",
      );
      process.exit(0);
    }
    if (!argument.startsWith("--") || values[index + 1] === undefined)
      throw new Error(`Invalid argument: ${argument}`);
    const key = argument.slice(2);
    const value = values[++index];
    options[key] =
      [
        "concurrency",
        "timeout",
        "maxDimension",
        "limit",
        "nmsThreshold",
        "minFaceSize",
        "maxFaceAspectRatio",
      ].includes(key) || ["threshold", "minConfidence"].includes(key)
        ? Number(value)
        : value;
  }
  if (
    options.concurrency < 1 ||
    options.threshold <= 0 ||
    options.threshold >= 1
  )
    throw new Error("Invalid concurrency or threshold");
  return options;
}

function loadSeriesData(fileName) {
  const source = fs.readFileSync(fileName, "utf8");
  const sandbox = {};
  vm.runInNewContext(`${source}\nthis.__seriesData = seriesData;`, sandbox, {
    filename: fileName,
  });
  if (!Array.isArray(sandbox.__seriesData))
    throw new Error("Input does not define an array named seriesData");
  return sandbox.__seriesData;
}

async function fetchBuffer(url, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function processingUrl(record) {
  if (!record.thumbnailUrl) throw new Error("thumbnailUrl is missing");
  return record.thumbnailUrl
    .replace(/([?&])width=\d+/, (_, separator) => `${separator}width=2400`)
    .replace(/([?&])height=\d+/, (_, separator) => `${separator}height=2400`);
}

async function fetchRecordImage(record, timeout) {
  try {
    return { buffer: await fetchBuffer(record.url, timeout), source: "url" };
  } catch (error) {
    if (!error.message.includes("HTTP 403")) throw error;
    return {
      buffer: await fetchBuffer(processingUrl(record), timeout),
      source: "thumbnailUrl@2400 (fallback after HTTP 403)",
    };
  }
}

function tensorFromRgb(
  rgb,
  width,
  height,
  normalize = false,
  subtractMean = false,
) {
  const data = new Float32Array(3 * width * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const blueOrder = 2 - channel;
        const value = rgb[source + blueOrder];
        const mean = [104, 117, 123][channel];
        data[channel * width * height + y * width + x] = subtractMean
          ? value - mean
          : normalize
            ? (value / 255) * 2 - 1
            : value / 255;
      }
    }
  return new ort.Tensor("float32", data, [1, 3, height, width]);
}

function decodeDetections(result, inputSize, minConfidence, nmsThreshold) {
  const detections = [];
  for (const stride of [8, 16, 32]) {
    const count = (inputSize / stride) ** 2;
    // 🔴 [A] LẤY RAW OUTPUT CỦA YUNET
    const scores = result[`cls_${stride}`].data;
    const objects = result[`obj_${stride}`].data;
    const boxes = result[`bbox_${stride}`].data;
    const keypoints = result[`kps_${stride}`].data;

    for (let index = 0; index < count; index += 1) {
      // 🔴 [B] TÍNH SCORE
      const clsScore = Math.max(0, Math.min(1, scores[index]));
      const objScore = Math.max(0, Math.min(1, objects[index]));
      const confidence = Math.sqrt(clsScore * objScore);
      // const confidence = scores[index] * objects[index];
      if (confidence < minConfidence) continue;
      const column = index % (inputSize / stride);
      const row = Math.floor(index / (inputSize / stride));
      const offset = index * 4;

      // 🔴 [C] DECODE 5 LANDMARKS
      const landmarks = [];
      for (let point = 0; point < 5; point += 1)
        landmarks.push({
          x: (column + keypoints[index * 10 + point * 2]) * stride,
          y: (row + keypoints[index * 10 + point * 2 + 1]) * stride,
        });

      // 🔴🔴 [D] DECODE BOUNDING BOX
      //update
      const cx = (column + boxes[offset]) * stride;
      const cy = (row + boxes[offset + 1]) * stride;
      const w = Math.exp(boxes[offset + 2]) * stride;
      const h = Math.exp(boxes[offset + 3]) * stride;

      const left = cx - w / 2;
      const top = cy - h / 2;
      const right = cx + w / 2;
      const bottom = cy + h / 2;

      detections.push({
        confidence,
        left,
        top,
        right,
        bottom,
        landmarks,
      });
    }
  }
  detections.sort((first, second) => second.confidence - first.confidence);
  const kept = [];
  while (detections.length) {
    const candidate = detections.shift();
    kept.push(candidate);

    // 🔴 [E] NMS
    for (let index = detections.length - 1; index >= 0; index -= 1) {
      // 🔴 [F] TÍNH IoU
      const iou = intersectionOverUnion(candidate, detections[index]);
      if (iou > nmsThreshold) {
        // 🔴 [G] LOẠI BỎ CÁC BOX TRÙNG NHAU
        detections.splice(index, 1);
      }
    }
  }
  return kept;
}

const ALIGNMENT_TEMPLATE = [
  { x: 38.2946, y: 51.6963 },
  { x: 73.5318, y: 51.5014 },
  { x: 56.0252, y: 71.7366 },
  { x: 41.5493, y: 92.3655 },
  { x: 70.7299, y: 92.2041 },
];

function similarityTransform(sourcePoints) {
  const orderedSource = [
    sourcePoints[1],
    sourcePoints[0],
    sourcePoints[2],
    sourcePoints[4],
    sourcePoints[3],
  ];
  const sourceMean = orderedSource.reduce(
    (mean, point) => ({ x: mean.x + point.x / 5, y: mean.y + point.y / 5 }),
    { x: 0, y: 0 },
  );
  const targetMean = ALIGNMENT_TEMPLATE.reduce(
    (mean, point) => ({ x: mean.x + point.x / 5, y: mean.y + point.y / 5 }),
    { x: 0, y: 0 },
  );
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
  return {
    cosine,
    sine,
    translateX: targetMean.x - cosine * sourceMean.x + sine * sourceMean.y,
    translateY: targetMean.y - sine * sourceMean.x - cosine * sourceMean.y,
  };
}

function sampleAligned(source, width, height, transform) {
  const output = Buffer.alloc(112 * 112 * 3);
  const determinant =
    transform.cosine * transform.cosine + transform.sine * transform.sine;
  for (let targetY = 0; targetY < 112; targetY += 1)
    for (let targetX = 0; targetX < 112; targetX += 1) {
      const shiftedX = targetX - transform.translateX;
      const shiftedY = targetY - transform.translateY;
      const sourceX =
        (transform.cosine * shiftedX + transform.sine * shiftedY) / determinant;
      const sourceY =
        (-transform.sine * shiftedX + transform.cosine * shiftedY) /
        determinant;
      const x = Math.max(0, Math.min(width - 1, sourceX));
      const y = Math.max(0, Math.min(height - 1, sourceY));
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      const xWeight = x - x0;
      const yWeight = y - y0;
      for (let channel = 0; channel < 3; channel += 1) {
        const value =
          (1 - yWeight) *
          ((1 - xWeight) * source[(y0 * width + x0) * 3 + channel] +
            xWeight * source[(y0 * width + x1) * 3 + channel]) +
          yWeight *
          ((1 - xWeight) * source[(y1 * width + x0) * 3 + channel] +
            xWeight * source[(y1 * width + x1) * 3 + channel]);
        output[(targetY * 112 + targetX) * 3 + channel] = Math.round(value);
      }
    }
  return output;
}

// 🔴 [G] IoU CỦA NMS
function intersectionOverUnion(first, second) {
  const width = Math.max(
    0,
    Math.min(first.right, second.right) - Math.max(first.left, second.left),
  );
  const height = Math.max(
    0,
    Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top),
  );
  const overlap = width * height;
  const area =
    (first.right - first.left) * (first.bottom - first.top) +
    (second.right - second.left) * (second.bottom - second.top) -
    overlap;
  return area > 0 ? overlap / area : 0;
}

function averageLandmarkDistance(first, second) {
  return (
    first.landmarks.reduce(
      (sum, point, index) =>
        sum +
        Math.hypot(
          point.x - second.landmarks[index].x,
          point.y - second.landmarks[index].y,
        ),
      0,
    ) / first.landmarks.length
  );
}

async function detectAndEmbed(buffer, detector, recognizer, options) {
  const source = sharp(buffer).rotate();
  const metadata = await source.metadata();
  const scale = Math.min(
    1,
    options.maxDimension / Math.max(metadata.width || 1, metadata.height || 1),
  );
  const width = Math.max(1, Math.round((metadata.width || 1) * scale));
  const height = Math.max(1, Math.round((metadata.height || 1) * scale));
  const resized = await source
    .resize(width, height)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const detectorSize = 640;
  const detectorScale = Math.min(detectorSize / width, detectorSize / height);
  const detectorWidth = Math.round(width * detectorScale);
  const detectorHeight = Math.round(height * detectorScale);
  const detectorOffsetX = Math.round((detectorSize - detectorWidth) / 2);
  const detectorOffsetY = Math.round((detectorSize - detectorHeight) / 2);
  const detectorImage = await sharp(resized.data, { raw: resized.info })
    .resize(detectorSize, detectorSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0 },
    })
    .raw()
    .toBuffer();
  const detectorResult = await detector.run({
    [detector.inputNames[0]]: tensorFromRgb(
      detectorImage,
      detectorSize,
      detectorSize,
      false,
      true,
    ),
  });
  const faces = [];
  for (const detection of decodeDetections(
    detectorResult,
    detectorSize,
    options.minConfidence,
    options.nmsThreshold,
  )) {
    // 🔴 [H] CHUYỂN BOX TỪ HỆ TỌA ĐỘ 640
    //     VỀ HỆ TỌA ĐỘ ẢNH ĐÃ RESIZE
    const toSourceX = (value) =>
      Math.round((value - detectorOffsetX) / detectorScale);
    const toSourceY = (value) =>
      Math.round((value - detectorOffsetY) / detectorScale);
    const left = Math.max(0, toSourceX(detection.left));
    const top = Math.max(0, toSourceY(detection.top));
    const right = Math.min(width, toSourceX(detection.right));
    const bottom = Math.min(height, toSourceY(detection.bottom));

    // 🔴 [I] DEBUG LANDMARKS — CÓ CÔNG THỨC KHÁC
    if (options.debug)
      console.log(
        `DEBUG candidate score=${detection.confidence.toFixed(3)} box=${left},${top},${right - left}x${bottom - top} landmarks=${detection.landmarks
          .map((point) => `${((point.x * width) / detectorSize).toFixed(0)},${((point.y * height) / detectorSize).toFixed(0)}`).join("|")}`,
      );
    if (options.debug)
      console.log(
        `DEBUG box score=${detection.confidence.toFixed(3)} x=${left},y=${top},w=${right - left},h=${bottom - top}`,
      );
    if (right <= left || bottom <= top) continue;
    const boxWidth = right - left;
    const boxHeight = bottom - top;
    const aspectRatio = Math.max(boxWidth / boxHeight, boxHeight / boxWidth);
    if (
      Math.min(boxWidth, boxHeight) < options.minFaceSize ||
      aspectRatio > options.maxFaceAspectRatio
    )
      continue;

    // 🔴 [J] LANDMARKS THỰC TẾ DÙNG CHO ALIGNMENT
    const landmarks = detection.landmarks.map((point) => ({
      x: (point.x - detectorOffsetX) / detectorScale,
      y: (point.y - detectorOffsetY) / detectorScale,
    }));
    const cropBefore = await sharp(resized.data, { raw: resized.info })
      .extract({ left, top, width: boxWidth, height: boxHeight })
      .resize(112, 112)
      .raw()
      .toBuffer();
    const aligned = sampleAligned(
      resized.data,
      width,
      height,
      similarityTransform(landmarks),
    );
    const previewBefore = await sharp(cropBefore, {
      raw: { width: 112, height: 112, channels: 3 },
    })
      .jpeg()
      .toBuffer();
    const previewAligned = await sharp(aligned, {
      raw: { width: 112, height: 112, channels: 3 },
    })
      .jpeg()
      .toBuffer();
    const result = await recognizer.run({
      [recognizer.inputNames[0]]: tensorFromRgb(aligned, 112, 112, true),
    });
    const values = Array.from(result[recognizer.outputNames[0]].data);
    const length = Math.hypot(...values) || 1;
    
    console.log(
      `[EMBEDDING] output=${recognizer.outputNames[0]} dim=${values.length}`,
    );
    
    const normalized = values.map((value) => value / length);

    console.log(
      `[EMBEDDING] normalizedNorm=${Math.hypot(...normalized).toFixed(6)}`,
    );

    if (options.debug)
      console.log(
        `DEBUG landmarks=${landmarks.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" | ")} cropBefore=${boxWidth}x${boxHeight} aligned=112x112`,
      );
    faces.push({
      embedding: normalized,
      preview: `data:image/jpeg;base64,${previewAligned.toString("base64")}`,
      previewBefore: `data:image/jpeg;base64,${previewBefore.toString("base64")}`,
      landmarks,
      box: { left, top, width: boxWidth, height: boxHeight },
      confidence: detection.confidence,
    });
  }
  const overlays = faces
    .map(
      (face) =>
        `<rect x="${face.box.left}" y="${face.box.top}" width="${face.box.width}" height="${face.box.height}"/><g>${face.landmarks.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="8"/>`).join("")}</g>`,
    )
    .join("");
  const annotated = await sharp(resized.data, { raw: resized.info })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${width}" height="${height}"><style>rect,circle{fill:none;stroke:#00ff55;stroke-width:6}circle{fill:#ff3355}</style>${overlays}</svg>`,
        ),
      },
    ])
    .jpeg()
    .toBuffer();
  faces.forEach((face) => {
    face.annotated = `data:image/jpeg;base64,${annotated.toString("base64")}`;
  });
  return faces;
}

function cosineDistance(first, second) {
  if (first.length !== second.length) {
    throw new Error(
      `Embedding dimension mismatch: ${first.length} vs ${second.length}`,
    );
  }

  const similarity = first.reduce(
    (sum, value, index) =>
      sum + value * second[index],
    0,
  );

  return 1 - similarity;
}

function cluster(embeddings, imageIds, threshold) {
  const distanceMatrix = Array.from(
    { length: embeddings.length },
    () => Array(embeddings.length).fill(0),
  );

  // Tính cosine distance giữa mọi cặp embedding.
  for (let first = 0; first < embeddings.length; first += 1)
    for (let second = first + 1; second < embeddings.length; second += 1) {
      const distance = cosineDistance(embeddings[first], embeddings[second]);
      distanceMatrix[first][second] = distance;
      distanceMatrix[second][first] = distance;
    }

  let minDistance = Infinity;
  let maxDistance = -Infinity;
  let distanceSum = 0;
  let distanceCount = 0;
  for (let first = 0; first < embeddings.length; first += 1)
    for (let second = first + 1; second < embeddings.length; second += 1) {
      const distance = distanceMatrix[first][second];
      minDistance = Math.min(minDistance, distance);
      maxDistance = Math.max(maxDistance, distance);
      distanceSum += distance;
      distanceCount += 1;
    }
  console.log(
    `[CLUSTER] START faces=${embeddings.length} threshold=${threshold} ` +
    `pairs=${distanceCount} ` +
    `min=${(distanceCount ? minDistance : 0).toFixed(4)} ` +
    `avg=${(distanceCount ? distanceSum / distanceCount : 0).toFixed(4)} ` +
    `max=${(distanceCount ? maxDistance : 0).toFixed(4)}`,
  );

  // Mỗi embedding ban đầu là một cluster.
  let clusters = embeddings.map((_, index) => [index]);
  let mergeCount = 0;
  let sameImageRejected = 0;
  while (true) {
    let bestPair = null;
    let bestDistance = Infinity;

    // Chọn cặp có complete-linkage distance nhỏ nhất.
    for (let first = 0; first < clusters.length; first += 1)
      for (let second = first + 1; second < clusters.length; second += 1) {
        const imagesInFirstCluster = new Set(
          clusters[first].map((index) => imageIds[index]),
        );
        const hasSameImage = clusters[second].some((index) =>
          imagesInFirstCluster.has(imageIds[index]),
        );
        if (hasSameImage) {
          sameImageRejected += 1;
          continue;
        }

        let completeDistance = 0;
        for (const firstIndex of clusters[first])
          for (const secondIndex of clusters[second])
            completeDistance = Math.max(
              completeDistance,
              distanceMatrix[firstIndex][secondIndex],
            );
        if (
          completeDistance < bestDistance ||
          (completeDistance === bestDistance &&
            (bestPair === null || first < bestPair[0] ||
              (first === bestPair[0] && second < bestPair[1])))
        ) {
          bestDistance = completeDistance;
          bestPair = [first, second];
        }
      }
    if (bestPair === null) {
      console.log(
        `[CLUSTER] STOP no-valid-pair clusters=${clusters.length}`,
      );
      break;
    }
    const [first, second] = bestPair;
    if (bestDistance > threshold) {
      console.log(
        `[CLUSTER] STOP threshold distance=${bestDistance.toFixed(4)} ` +
        `threshold=${threshold} A=[${clusters[first].join(",")}] ` +
        `B=[${clusters[second].join(",")}]`,
      );
      break;
    }

    const pairDistances = [];
    for (const firstIndex of clusters[first])
      for (const secondIndex of clusters[second])
        pairDistances.push({
          firstIndex,
          secondIndex,
          distance: distanceMatrix[firstIndex][secondIndex],
        });
    pairDistances.sort((left, right) => right.distance - left.distance);
    console.log(
      `[CLUSTER] MERGE #${mergeCount + 1} ` +
      `complete=${bestDistance.toFixed(4)} threshold=${threshold} ` +
      `A=[${clusters[first].join(",")}] B=[${clusters[second].join(",")}]`,
    );
    for (const pair of pairDistances)
      console.log(
        `  face ${pair.firstIndex} (image=${imageIds[pair.firstIndex]}) ` +
        `<-> face ${pair.secondIndex} (image=${imageIds[pair.secondIndex]}) ` +
        `distance=${pair.distance.toFixed(4)}`,
      );
    clusters[first] = [...clusters[first], ...clusters[second]];
    clusters.splice(second, 1);
    mergeCount += 1;
  }

  const labels = Array(embeddings.length).fill(-1);
  clusters
    .sort((first, second) => first[0] - second[0])
    .forEach((members, label) => {
      members.forEach((index) => {
        labels[index] = label;
      });
    });
  console.log(
    `[CLUSTER] DONE groups=${clusters.length} merges=${mergeCount} ` +
    `sameImageRejected=${sameImageRejected}`,
  );
  return labels;
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
      character
      ],
  );
}

function writeReport(series, faces, labels, names, fileName) {
  const groups = new Map();
  faces.forEach((face, index) => {
    const label = labels[index];
    const key = label >= 0 ? label : "noise";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(series[face.imageIndex]);
  });
  const imagePreviews = new Map();
  faces.forEach((face) => imagePreviews.set(face.imageIndex, face.annotated));
  const sections = [...groups.entries()]
    .map(([label]) => {
      const groupFaces = faces
        .map((face, index) => ({ face, index }))
        .filter(({ index }) =>
          label === "noise" ? labels[index] < 0 : labels[index] === label,
        );
      const title = label === "noise" ? "noise / unassigned" : names.get(label);
      return `<section><h2>${title} <small>${groupFaces.length} face(s)</small></h2>${[...new Set(groupFaces.map(({ face }) => face.imageIndex))].map((imageIndex) => `<img class="original" src="${imagePreviews.get(imageIndex)}"><p>${escapeHtml(series[imageIndex].name)}</p>`).join("")}<div class="grid">${groupFaces.map(({ face }) => `<figure><img src="${face.previewBefore}"><img src="${face.preview}"><figcaption>before / aligned 112x112<br>score ${face.confidence.toFixed(3)}<br>${face.box.left},${face.box.top},${face.box.width}x${face.box.height}<br>${face.landmarks.map((point) => `${point.x.toFixed(0)},${point.y.toFixed(0)}`).join(" | ")}</figcaption></figure>`).join("")}</div></section>`;
    })
    .join("\n");
  fs.writeFileSync(
    fileName,
    `<!doctype html><meta charset="utf-8"><title>Face clusters</title><style>body{font:16px system-ui;margin:24px;background:#f5f3ef;color:#242424}section{border-top:2px solid #242424;padding:12px 0 28px}.original{display:block;max-width:min(100%,900px);height:auto;margin:12px 0}.grid{display:flex;flex-wrap:wrap;gap:12px}figure{width:232px;margin:0}figure img{display:inline-block;width:112px;height:112px;object-fit:cover;background:#ddd;margin-right:4px}figcaption{font-size:11px;margin-top:4px;line-height:1.35}small{font-size:13px;font-weight:normal}</style>${sections}`,
  );
}

async function main() {
  const options = parseArgs();
  const allSeries = loadSeriesData(options.input);
  const selected = options.name
    ? allSeries.filter((record) => record.name === options.name)
    : allSeries;
  const series =
    options.limit > 0 ? selected.slice(0, options.limit) : selected;
  if (options.name && series.length !== 1)
    throw new Error(
      `Expected exactly one record named ${options.name}, found ${series.length}`,
    );
  if (!fs.existsSync(options.detector) || !fs.existsSync(options.recognizer))
    throw new Error("Models missing. Run: npm run download-face-models");
  try {
    ort = require("onnxruntime-node");
  } catch (error) {
    throw new Error(
      `ONNX Runtime could not load its native Windows binary. Install the Microsoft Visual C++ 2015-2022 x64 Redistributable and retry. Original error: ${error.message}`,
    );
  }
  const [detector, recognizer] = await Promise.all([
    ort.InferenceSession.create(options.detector),
    ort.InferenceSession.create(options.recognizer),
  ]);
  const imageFaces = Array.from({ length: series.length }, () => []);
  const failed = [];
  let next = 0;
  const started = Date.now();
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= series.length) return;
      try {
        const image = await fetchRecordImage(series[index], options.timeout);
        imageFaces[index] = await detectAndEmbed(
          image.buffer,
          detector,
          recognizer,
          options,
        );
        console.log(
          `[${index + 1}/${series.length}] ${series[index].name} faces: ${imageFaces[index].length} source: ${image.source}`,
        );
      } catch (error) {
        failed.push(index);
        console.log(
          `[${index + 1}/${series.length}] ${series[index].name}\nERROR: ${error.message}\nSKIPPED`,
        );
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(options.concurrency, series.length) },
      worker,
    ),
  );
  const faces = [];
  imageFaces.forEach((items, imageIndex) =>
    items.forEach((face) => faces.push({ imageIndex, ...face })),
  );
  if (options.debug)
    for (let first = 0; first < faces.length; first += 1)
      for (let second = first + 1; second < faces.length; second += 1)
        console.log(
          `DEBUG distance face-${first + 1}/face-${second + 1}: ${cosineDistance(faces[first].embedding, faces[second].embedding).toFixed(4)}`,
        );
  console.log("\nClustering...");
  const clusteringStarted = Date.now();
  const labels = cluster(
    faces.map((face) => face.embedding),
    faces.map((face) => face.imageIndex),
    options.threshold,
  );
  const clusteringTime = Date.now() - clusteringStarted;
  const names = new Map();
  labels.forEach((label) => {
    if (label >= 0 && !names.has(label))
      names.set(label, `person-${String(names.size + 1).padStart(3, "0")}`);
  });
  if (options.debug)
    labels.forEach((label, index) =>
      console.log(
        `DEBUG face-${index + 1} => ${label >= 0 ? names.get(label) : "noise"}`,
      ),
    );
  const output = series.map((record, imageIndex) => ({
    ...record,
    persons: [
      ...new Set(
        faces
          .map((face, faceIndex) =>
            face.imageIndex === imageIndex && labels[faceIndex] >= 0
              ? names.get(labels[faceIndex])
              : null,
          )
          .filter(Boolean),
      ),
    ],
  }));
  fs.writeFileSync(
    options.output,
    `const seriesData = ${JSON.stringify(output, null, 2)};\n`,
  );
  writeReport(output, faces, labels, names, options.report);
  const elapsed = Date.now() - started;
  const withFaces = imageFaces.filter((items) => items.length).length;
  console.log(
    `\n===== BENCHMARK =====\nPlatform: ${process.platform} ${os.release()}\nCPU: ${os.cpus()[0].model}\nRAM: ${Math.round(os.totalmem() / 1024 ** 3)} GB\nNode.js: ${process.version}\nModel: YuNet + SFace (ONNX Runtime CPU)\nImages: ${series.length}\nImages with faces: ${withFaces}\nFaces: ${faces.length}\nGroups: ${names.size}\nDetection + embedding: ${((elapsed - clusteringTime) / 1000).toFixed(1)} sec\nClustering: ${(clusteringTime / 1000).toFixed(1)} sec\nTotal: ${(elapsed / 1000).toFixed(1)} sec\nAverage: ${Math.round(elapsed / Math.max(1, series.length))} ms/image\nFailed images: ${failed.length}\nOutput: ${options.output}\nReport: ${options.report}\n=====================`,
  );
}

main().catch((error) => {
  console.error(`Fatal: ${error.message}`);
  process.exitCode = 1;
});
