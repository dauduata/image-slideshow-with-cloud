const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const sharp = require("sharp");
const crypto = require("crypto");
let ort;

const ROOT = __dirname;
const defaults = {
  input: path.join(ROOT, "image-links.js"),
  output: path.join(ROOT, "image-links-labeled.js"),
  clusterOutput: path.join(ROOT, "report", "image-links-clusters.js"),
  report: path.join(ROOT, "report", "face-clusters-report.html"),
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
        "node face-label-poc.js [--input file] [--output file] [--cluster-output file] [--report file] [--concurrency 2] [--threshold 0.45]",
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
  // if (/\.html\.html$/i.test(options.report))
  //   throw new Error("Invalid report path: use face-clusters-report.html, not .html.html");
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
            : value;
      }
    }
  return new ort.Tensor("float32", data, [1, 3, height, width]);
}

function tensorStats(tensor) {
  const values = Array.from(tensor.data);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean,
  };
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

const CURRENT_LANDMARK_ORDER = [1, 0, 2, 4, 3];
const ALTERNATIVE_LANDMARK_ORDER = [0, 1, 2, 3, 4];

function similarityTransformForOrder(sourcePoints, order) {
  const orderedSource = order.map((index) => sourcePoints[index]);
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

function similarityTransform(sourcePoints) {
  return similarityTransformForOrder(sourcePoints, CURRENT_LANDMARK_ORDER);
}

function transformPoint(point, transform) {
  return {
    x: transform.cosine * point.x - transform.sine * point.y + transform.translateX,
    y: transform.sine * point.x + transform.cosine * point.y + transform.translateY,
  };
}

function alignmentErrors(sourcePoints, order, transform) {
  return order.map((sourceIndex, targetIndex) => {
    const transformed = transformPoint(sourcePoints[sourceIndex], transform);
    const target = ALIGNMENT_TEMPLATE[targetIndex];
    return Math.hypot(transformed.x - target.x, transformed.y - target.y);
  });
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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
  const resized = await sharp(buffer)
    .rotate()
    .resize({
      width: options.maxDimension,
      height: options.maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = resized.info.width;
  const height = resized.info.height;
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

    // 🔴 [I] DEBUG LANDMARKS
    //     YuNet trả landmark trong hệ tọa độ 640x640.
    //     Phải undo offset + scale giống hệt [J].
    const landmarks = detection.landmarks.map((point) => ({
        x: (point.x - detectorOffsetX) / detectorScale,
        y: (point.y - detectorOffsetY) / detectorScale,
    }));
    if (options.debug) {
      console.log(
        `DEBUG candidate score=${detection.confidence.toFixed(3)} ` +
        `box=${left},${top},${right - left}x${bottom - top} ` +
        `landmarks=${landmarks
          .map(
            (point) =>
              `${point.x.toFixed(1)},${point.y.toFixed(1)}`,
          )
          .join("|")}`,
      );
    }
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
    const transformA = similarityTransformForOrder(
      landmarks,
      CURRENT_LANDMARK_ORDER,
    );
    const transformB = similarityTransformForOrder(
      landmarks,
      ALTERNATIVE_LANDMARK_ORDER,
    );
    const alignedA = sampleAligned(resized.data, width, height, transformA);
    const alignedB = sampleAligned(resized.data, width, height, transformB);
    const sfaceTensor = tensorFromRgb(alignedB, 112, 112, false, false);
    if (options.debug) {
      console.log(
        `[SFACE INPUT] mode=BGR_RAW_0_255 shape=${sfaceTensor.dims.join("x")} ` +
        `min=${tensorStats(sfaceTensor).min.toFixed(3)} ` +
        `max=${tensorStats(sfaceTensor).max.toFixed(3)} ` +
        `mean=${tensorStats(sfaceTensor).mean.toFixed(3)}`,
      );
    }
    const result = await recognizer.run({
      [recognizer.inputNames[0]]: sfaceTensor,
    });
    const resultB = await recognizer.run({
      [recognizer.inputNames[0]]: tensorFromRgb(alignedA, 112, 112, false, false),
    });
    const values = Array.from(result[recognizer.outputNames[0]].data);
    const valuesB = Array.from(resultB[recognizer.outputNames[0]].data);
    const length = Math.hypot(...values) || 1;
    const lengthB = Math.hypot(...valuesB) || 1;

    console.log(
      `[EMBEDDING] output=${recognizer.outputNames[0]} dim=${values.length}`,
    );

    const normalized = values.map((value) => value / length);
    const normalizedB = valuesB.map((value) => value / lengthB);

    console.log(
      `[EMBEDDING] normalizedNorm=${Math.hypot(...normalized).toFixed(6)}`,
    );
    if (options.debug)
      console.log(`[SFACE EMBEDDING] normBefore=${length.toFixed(6)} normAfter=${Math.hypot(...normalized).toFixed(6)}`);
    if (options.debug) {
      const errorsA = alignmentErrors(landmarks, CURRENT_LANDMARK_ORDER, transformA);
      const errorsB = alignmentErrors(landmarks, ALTERNATIVE_LANDMARK_ORDER, transformB);
      const formatPoints = (points) =>
        points.map((point) => `(${point.x.toFixed(2)},${point.y.toFixed(2)})`).join(" ");
      console.log(
        `[ALIGNMENT-AB] face=${faces.length} ` +
        `A-order=${CURRENT_LANDMARK_ORDER.join(",")} ` +
        `B-order=${ALTERNATIVE_LANDMARK_ORDER.join(",")}`,
      );
      console.log(
        `[ALIGNMENT-AB] source=${formatPoints(landmarks)} ` +
        `template=${formatPoints(ALIGNMENT_TEMPLATE)}`,
      );
      console.log(
        `[ALIGNMENT-AB] A-transform=${JSON.stringify(transformA)} ` +
        `B-transform=${JSON.stringify(transformB)} ` +
        `A-errors=${errorsA.map((value) => value.toFixed(4)).join(",")} ` +
        `B-errors=${errorsB.map((value) => value.toFixed(4)).join(",")}`,
      );
      console.log(
        `[FORENSIC HASH] face=${faces.length} ` +
        `alignedA=${sha256(alignedA)} alignedB=${sha256(alignedB)} ` +
        `tensorA=${sha256(tensorFromRgb(alignedA, 112, 112, false, false).data)} tensorB=${sha256(sfaceTensor.data)} ` +
        `rawA=${sha256(Float32Array.from(valuesB))} rawB=${sha256(Float32Array.from(values))} ` +
        `normalizedA=${sha256(Float32Array.from(normalizedB))} normalizedB=${sha256(Float32Array.from(normalized))}`,
      );
      console.log(
        `[FORENSIC EMBEDDING] face=${faces.length} ` +
        `B-norm-before=${length.toFixed(6)} B-norm-after=${Math.hypot(...normalized).toFixed(6)} ` +
        `A-norm-before=${lengthB.toFixed(6)} A-norm-after=${Math.hypot(...normalizedB).toFixed(6)}`,
      );
    }

    if (options.debug)
      console.log(
        `DEBUG landmarks=${landmarks.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" | ")} cropBefore=${boxWidth}x${boxHeight} aligned=B 112x112`,
      );
    const errorsA = alignmentErrors(landmarks, CURRENT_LANDMARK_ORDER, transformA);
    const errorsB = alignmentErrors(landmarks, ALTERNATIVE_LANDMARK_ORDER, transformB);
    faces.push({
      embedding: normalized,
      alternativeEmbedding: normalizedB,
      alignmentErrorsA: errorsA,
      alignmentErrorsB: errorsB,
      landmarks,
      box: {
        left,
        top,
        width: boxWidth,
        height: boxHeight
      },

      // Needed by the report to map the box
      // from the resized image back to the original image.
      imageWidth: width,
      imageHeight: height,

      confidence: detection.confidence,
    });
  }
  return {
    width,
    height,
    faces,
  };
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

function cluster(embeddings, imageIds, threshold, debugPair = null) {
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
  const tracedPair = debugPair
    ? String(debugPair).split(",").map(Number)
    : null;
  if (tracedPair && embeddings[tracedPair[0]] && embeddings[tracedPair[1]]) {
    const [first, second] = tracedPair;
    const neighbors = [];
    for (let index = 0; index < embeddings.length; index += 1) {
      if (index !== first && distanceMatrix[first][index] <= threshold)
        neighbors.push(`${index}:${distanceMatrix[first][index].toFixed(6)}`);
    }
    console.log(
      `[CLUSTER TRACE] pair=${first},${second} ` +
      `direct=${distanceMatrix[first][second].toFixed(6)} ` +
      `neighborsOfFirst=[${neighbors.join(",")}] corePoint=not-used`,
    );
  }

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
          if (
            tracedPair &&
            (clusters[first].includes(tracedPair[0]) ||
              clusters[second].includes(tracedPair[0])) &&
            (clusters[first].includes(tracedPair[1]) ||
              clusters[second].includes(tracedPair[1]))
          ) {
            console.log(
              `[CLUSTER TRACE] reject-traced-pair ` +
              `clusters=${first},${second} reason=same-image ` +
              `membersA=[${clusters[first].join(",")}] ` +
              `membersB=[${clusters[second].join(",")}]`,
            );
          }
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
    if (tracedPair) {
      const tracedClusters = clusters
        .map((members, index) => ({ index, members }))
        .filter(({ members }) =>
          members.includes(tracedPair[0]) || members.includes(tracedPair[1]),
        )
        .map(({ index, members }) => `${index}=[${members.join(",")}]`)
        .join(" ");
      console.log(
        `[CLUSTER TRACE] candidate=${first},${second} ` +
        `complete=${bestDistance.toFixed(6)} traced=${tracedClusters}`,
      );
    }
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

function writeReport(fileName) {
  fs.mkdirSync(path.dirname(fileName), { recursive: true });
  fs.writeFileSync(
    fileName,
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Face clusters</title><style>body{font:16px system-ui;margin:24px;background:#f5f3ef;color:#242424}section{border-top:2px solid #242424;padding:12px 0 28px}.original{display:block;max-width:min(100%,900px);height:auto;margin:12px 0}.grid{display:flex;flex-wrap:wrap;gap:12px}article{width:232px}article img{max-width:100%;height:auto}figcaption{font-size:11px;margin-top:4px;line-height:1.35}small{font-size:13px;font-weight:normal}</style><main id="report">Loading...</main><script src="image-links-clusters.js"></script><script>const escapeHtml=value=>String(value).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));const groups=new Map();seriesData.forEach(record=>record.persons.forEach(person=>{if(!groups.has(person.id))groups.set(person.id,[]);groups.get(person.id).push({record,person})}));document.querySelector('#report').innerHTML=[...groups].map(([id,items])=>'<section><h2>'+escapeHtml(id)+' <small>'+items.length+' face(s)</small></h2>'+[...new Set(items.map(({record})=>record.name))].map(name=>{const item=items.find(({record})=>record.name===name);return '<img class="original" src="'+escapeHtml(item.record.url||item.record.thumbnailUrl||'')+'" loading="lazy"><p>'+escapeHtml(name)+'</p>'}).join('')+'<div class="grid">'+items.map(({person})=>'<article><figcaption>score '+Number(person.confidence).toFixed(3)+'<br>box '+person.box.left+','+person.box.top+','+person.box.width+'x'+person.box.height+'<br>landmarks '+person.landmarks.map(point=>point.x.toFixed(0)+','+point.y.toFixed(0)).join(' | ')+'</figcaption></article>').join('')+'</div></section>').join('')||'<p>No cluster data available.</p>';</script>`,
  );
}

function buildReportFaces(faceList) {
  const imageFaceIndexes = new Map();

  const reportFaces = faceList.map((face, faceIndex) => {
    const imageFaceIndex = imageFaceIndexes.get(face.imageIndex) || 0;
    imageFaceIndexes.set(face.imageIndex, imageFaceIndex + 1);
    return {
      faceIndex,
      imageFaceIndex,
      imageIndex: face.imageIndex,
      imageWidth: face.imageWidth,
      imageHeight: face.imageHeight,
      box: face.box,
      landmarks: face.landmarks,
      confidence: face.confidence,
    };
  });
  return reportFaces;
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
  const imageFaces = Array.from({ length: series.length }, () => null);
  const failed = [];
  let next = 0;
  const started = Date.now();
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= series.length) return;
      try {
        const image = await fetchRecordImage(series[index], options.timeout);
        const result = await detectAndEmbed(
          image.buffer,
          detector,
          recognizer,
          options,
        );
        imageFaces[index] = result;
        console.log(
          `[${index + 1}/${series.length}] ${series[index].name} faces: ${imageFaces[index].faces.length} source: ${image.source}`,
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

  imageFaces.forEach((result, imageIndex) => {
    if (!result) return;
    result.faces.forEach((face) => {
      faces.push({
        imageIndex,
        imageWidth: result.width,
        imageHeight: result.height,
        ...face,
      });
    });
  });

  if (options.debug) {
    const suspiciousPairs = [
      [6, 10],
      [5, 6],
      [5, 10],
      [0, 2],
      [0, 10],
      [0, 6],
    ];
    console.log("[ALIGNMENT DISTANCE SUMMARY] production=B, alternative=A");
    suspiciousPairs.forEach(([first, second]) => {
      if (!faces[first] || !faces[second]) {
        console.log(`[ALIGNMENT DISTANCE] pair=${first},${second} unavailable`);
        return;
      }
      const firstFace = faces[first];
      const secondFace = faces[second];
      const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
      const max = (values) => Math.max(...values);
      console.log(
        `[ALIGNMENT DISTANCE] pair=${first},${second} ` +
        `production(B-B)=${cosineDistance(firstFace.embedding, secondFace.embedding).toFixed(6)} ` +
        `alternative(A-A)=${cosineDistance(firstFace.alternativeEmbedding, secondFace.alternativeEmbedding).toFixed(6)} ` +
        `B-A=${cosineDistance(firstFace.embedding, secondFace.alternativeEmbedding).toFixed(6)} ` +
        `A-B=${cosineDistance(firstFace.alternativeEmbedding, secondFace.embedding).toFixed(6)} ` +
        `A-error=${mean(firstFace.alignmentErrorsA).toFixed(4)}/${max(firstFace.alignmentErrorsA).toFixed(4)},` +
        `${mean(secondFace.alignmentErrorsA).toFixed(4)}/${max(secondFace.alignmentErrorsA).toFixed(4)} ` +
        `B-error=${mean(firstFace.alignmentErrorsB).toFixed(4)}/${max(firstFace.alignmentErrorsB).toFixed(4)},` +
        `${mean(secondFace.alignmentErrorsB).toFixed(4)}/${max(secondFace.alignmentErrorsB).toFixed(4)}`,
      );
    });
  }


  const reportFaces = buildReportFaces(faces);

  const facesOnlyOutput = series.map((record, imageIndex) => ({
    ...record,
    faces: reportFaces.filter((face) => face.imageIndex === imageIndex),
  }));
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(
    options.output,
    `const seriesData = ${JSON.stringify(facesOnlyOutput, null, 2)};\n`,
  );
  console.log(`Faces-only output written: ${options.output}`);

  // xong phần detect + embedding, giờ clustering
  if (options.debug)
    for (let first = 0; first < faces.length; first += 1)
      for (let second = first + 1; second < faces.length; second += 1)
        console.log(
          `DEBUG distance image-${faces[first].imageIndex}/face-${first} ` +
          `<-> image-${faces[second].imageIndex}/face-${second}: ` +
          `${cosineDistance(faces[first].embedding, faces[second].embedding).toFixed(6)}`,
        );
  if (options.clusterPair) {
    const [first, second] = String(options.clusterPair).split(",").map(Number);
    if (faces[first] && faces[second])
      console.log(
        `[SUSPECT CASE] image ${faces[first].imageIndex} / face ${first} <-> ` +
        `image ${faces[second].imageIndex} / face ${second} ` +
        `B-B=${cosineDistance(faces[first].embedding, faces[second].embedding).toFixed(6)} ` +
        `B-A=${cosineDistance(faces[first].embedding, faces[second].alternativeEmbedding).toFixed(6)} ` +
        `A-B=${cosineDistance(faces[first].alternativeEmbedding, faces[second].embedding).toFixed(6)} ` +
        `A-A=${cosineDistance(faces[first].alternativeEmbedding, faces[second].alternativeEmbedding).toFixed(6)} ` +
        `threshold=${options.threshold}`,
      );
    else
      console.log(`[SUSPECT CASE] requested pair ${options.clusterPair} unavailable; faces=${faces.length}`);
  }
  console.log("\nClustering...");
  const clusteringStarted = Date.now();
  const labels = cluster(
    faces.map((face) => face.embedding),
    faces.map((face) => face.imageIndex),
    options.threshold,
    options.clusterPair,
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
  if (options.clusterPair) {
    const [first, second] = String(options.clusterPair).split(",").map(Number);
    if (faces[first] && faces[second])
      console.log(
        `[SUSPECT CLUSTER] face ${first}=${labels[first] >= 0 ? names.get(labels[first]) : "noise"} ` +
        `face ${second}=${labels[second] >= 0 ? names.get(labels[second]) : "noise"} ` +
        `merged=${labels[first] >= 0 && labels[first] === labels[second]}`,
      );
  }

  const output = series.map((record, imageIndex) => ({
    ...record,
    faces: reportFaces.filter((face) => face.imageIndex === imageIndex),
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

  const clusterOutput = series.map((record, imageIndex) => ({
    ...record,
    faceImageSize: imageFaces[imageIndex] && imageFaces[imageIndex].faces.length
      ? {
        width: imageFaces[imageIndex].width,
        height: imageFaces[imageIndex].height,
      }
      : undefined,
    faces: reportFaces.filter((face) => face.imageIndex === imageIndex),
    persons: faces
      .map((face, faceIndex) =>
        face.imageIndex === imageIndex && labels[faceIndex] >= 0
          ? {
            id: names.get(labels[faceIndex]),
            confidence: face.confidence,
            box: face.box,
            landmarks: face.landmarks,

          }
          : null,
      )
      .filter(Boolean),
  }));

  // Make sure output directory exists.
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.mkdirSync(path.dirname(options.clusterOutput), { recursive: true });

  // DATA files only.
  // These are generated on every run.
  fs.writeFileSync(
    options.output,
    `const seriesData = ${JSON.stringify(output, null, 2)};\n`,
  );
  fs.writeFileSync(
    options.clusterOutput,
    `const seriesData = ${JSON.stringify(clusterOutput, null, 2)};\n`,
  );

  // Report HTML/JS are fixed files.
  // main() does NOT generate them.
  // writeReport(options.report);

  const elapsed = Date.now() - started;
  const withFaces = imageFaces.filter(
    (result) => result && result.faces.length > 0,
  ).length;

  console.log(
    `\n===== BENCHMARK =====
  Platform: ${process.platform} ${os.release()}
  CPU: ${os.cpus()[0].model}
  RAM: ${Math.round(os.totalmem() / 1024 ** 3)} GB
  Node.js: ${process.version}
  Model: YuNet + SFace (ONNX Runtime CPU)
  Images: ${series.length}
  Images with faces: ${withFaces}
  Faces: ${faces.length}
  Groups: ${names.size}
  Detection + embedding: ${((elapsed - clusteringTime) / 1000).toFixed(1)} sec
  Clustering: ${(clusteringTime / 1000).toFixed(1)} sec
  Total: ${(elapsed / 1000).toFixed(1)} sec
  Average: ${Math.round(elapsed / Math.max(1, series.length))} ms/image
  Failed images: ${failed.length}
  Output: ${options.output}
  Cluster output: ${options.clusterOutput}
  Report: ${options.report}
  =====================`,
  );
}

main().catch((error) => {
  console.error(`Fatal: ${error.message}`);
  process.exitCode = 1;
});
