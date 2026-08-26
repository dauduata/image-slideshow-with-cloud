/**
 * YuNet Detection Pipeline Investigation
 * Evidence-first diagnostic - NO assumptions, ONLY data
 * 
 * Steps:
 * 1. Verify preprocessing/letterbox transform
 * 2. Capture RAW YuNet output
 * 3. Verify decode formula against reference
 * 4. Dump ALL detections before any filtering
 * 5. Test confidence threshold impact
 * 6. Test minFaceSize filtering
 * 7. Test NMS filtering with detailed logs
 * 8. Verify inverse transform
 * 9. Visualize pipeline stages
 * 10. Identify root cause
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const sharp = require("sharp");
let ort;

const ROOT = __dirname;

async function loadModels() {
  try {
    ort = await import("onnxruntime-node");
  } catch (error) {
    console.error("Failed to load ONNX Runtime:", error.message);
    process.exit(1);
  }
}

function tensorFromRgb(rgb, width, height, normalize = false, subtractMean = false) {
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

async function fetchBuffer(url, timeout = 30000) {
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

function loadSeriesData(fileName) {
  const source = fs.readFileSync(fileName, "utf8");
  const sandbox = {};
  vm.runInNewContext(`${source}\nthis.__seriesData = seriesData;`, sandbox);
  return sandbox.__seriesData;
}

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

// ============================================================
// STEP 1: VERIFY PREPROCESSING & LETTERBOX
// ============================================================
async function step1_verifyPreprocessing(buffer) {
  console.log("\n" + "=".repeat(80));
  console.log("STEP 1: VERIFY PREPROCESSING & LETTERBOX");
  console.log("=".repeat(80));

  const source = sharp(buffer).rotate();
  const metadata = await source.metadata();

  console.log("\nSOURCE IMAGE");
  console.log(`width: ${metadata.width}`);
  console.log(`height: ${metadata.height}`);

  const scale = Math.min(1, 1600 / Math.max(metadata.width, metadata.height));
  const width = Math.max(1, Math.round(metadata.width * scale));
  const height = Math.max(1, Math.round(metadata.height * scale));

  console.log("\nAFTER SCALING");
  console.log(`resize scale: ${scale.toFixed(4)}`);
  console.log(`resized width: ${width}`);
  console.log(`resized height: ${height}`);

  const detectorSize = 640;
  const detectorScale = Math.min(detectorSize / width, detectorSize / height);
  const detectorWidth = Math.round(width * detectorScale);
  const detectorHeight = Math.round(height * detectorScale);
  const detectorOffsetX = Math.round((detectorSize - detectorWidth) / 2);
  const detectorOffsetY = Math.round((detectorSize - detectorHeight) / 2);

  console.log("\nLETTERBOX TO 640x640");
  console.log(`detectorScale: ${detectorScale.toFixed(4)}`);
  console.log(`detectorWidth: ${detectorWidth}`);
  console.log(`detectorHeight: ${detectorHeight}`);
  console.log(`detectorOffsetX: ${detectorOffsetX}`);
  console.log(`detectorOffsetY: ${detectorOffsetY}`);
  console.log(`padding left: ${detectorOffsetX}`);
  console.log(`padding top: ${detectorOffsetY}`);
  console.log(`padding right: ${detectorSize - detectorOffsetX - detectorWidth}`);
  console.log(`padding bottom: ${detectorSize - detectorOffsetY - detectorHeight}`);

  // Test transform: source → detector → source
  console.log("\nTRANSFORM TEST (source → detector → source)");
  const testPoints = [
    [0, 0, "top-left"],
    [width - 1, 0, "top-right"],
    [width - 1, height - 1, "bottom-right"],
    [0, height - 1, "bottom-left"],
    [Math.floor(width / 2), Math.floor(height / 2), "center"],
  ];

  for (const [srcX, srcY, label] of testPoints) {
    // source → detector
    const detX = srcX * detectorScale + detectorOffsetX;
    const detY = srcY * detectorScale + detectorOffsetY;

    // detector → source
    const backX = (detX - detectorOffsetX) / detectorScale;
    const backY = (detY - detectorOffsetY) / detectorScale;

    console.log(
      `  ${label.padEnd(12)}: [${srcX}, ${srcY}] → [${detX.toFixed(1)}, ${detY.toFixed(1)}] → [${backX.toFixed(1)}, ${backY.toFixed(1)}]`,
    );
  }

  return {
    sourceMetadata: { width: metadata.width, height: metadata.height },
    scaledSize: { width, height },
    detectorParams: { detectorScale, detectorWidth, detectorHeight, detectorOffsetX, detectorOffsetY, detectorSize },
  };
}

// ============================================================
// STEP 2-3: DUMP RAW YUNET OUTPUT & DECODE DETECTIONS
// ============================================================
async function step23_rawYuNetAndDecode(buffer, scaledSize, detectorParams, detector) {
  console.log("\n" + "=".repeat(80));
  console.log("STEP 2-3: RAW YUNET OUTPUT & DECODE ALL DETECTIONS");
  console.log("=".repeat(80));

  const { width, height } = scaledSize;
  const resized = await sharp(buffer)
    .rotate()
    .resize(width, height)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const detectorImage = await sharp(resized.data, { raw: resized.info })
    .resize(640, 640, { fit: "contain", background: { r: 0, g: 0, b: 0 } })
    .raw()
    .toBuffer();

  const detectorResult = await detector.run({
    [detector.inputNames[0]]: tensorFromRgb(detectorImage, 640, 640, false, true),
  });

  console.log("\nRAW YUNET OUTPUT SHAPES");
  for (const stride of [8, 16, 32]) {
    console.log(`  stride ${stride}:`);
    console.log(`    cls_${stride}: ${detectorResult[`cls_${stride}`].dims.join("x")}`);
    console.log(`    obj_${stride}: ${detectorResult[`obj_${stride}`].dims.join("x")}`);
    console.log(`    bbox_${stride}: ${detectorResult[`bbox_${stride}`].dims.join("x")}`);
    console.log(`    kps_${stride}: ${detectorResult[`kps_${stride}`].dims.join("x")}`);
  }

  // DECODE ALL DETECTIONS (NO FILTERING YET)
  const rawDetections = [];
  for (const stride of [8, 16, 32]) {
    const count = (640 / stride) ** 2;
    const scores = detectorResult[`cls_${stride}`].data;
    const objects = detectorResult[`obj_${stride}`].data;
    const boxes = detectorResult[`bbox_${stride}`].data;
    const keypoints = detectorResult[`kps_${stride}`].data;

    for (let index = 0; index < count; index += 1) {
      const confidence = scores[index] * objects[index];
      if (confidence < 0.01) continue; // Only very low threshold to get ALL detections

      const column = index % (640 / stride);
      const row = Math.floor(index / (640 / stride));
      const offset = index * 4;

      const landmarks = [];
      for (let point = 0; point < 5; point += 1) {
        landmarks.push({
          x: (column + keypoints[index * 10 + point * 2]) * stride,
          y: (row + keypoints[index * 10 + point * 2 + 1]) * stride,
        });
      }

      rawDetections.push({
        stride,
        index,
        row,
        column,
        confidence,
        rawCls: scores[index],
        rawObj: objects[index],
        rawBbox: [boxes[offset], boxes[offset + 1], boxes[offset + 2], boxes[offset + 3]],
        left: (column - boxes[offset]) * stride,
        top: (row - boxes[offset + 1]) * stride,
        right: (column + boxes[offset + 2]) * stride,
        bottom: (row + boxes[offset + 3]) * stride,
        landmarks,
      });
    }
  }

  console.log(`\nTOTAL RAW DETECTIONS (confidence >= 0.01): ${rawDetections.length}`);

  // Show top 10 by confidence
  rawDetections.sort((a, b) => b.confidence - a.confidence);
  console.log(`\nTOP 10 RAW DETECTIONS:`);
  for (let i = 0; i < Math.min(10, rawDetections.length); i++) {
    const d = rawDetections[i];
    console.log(`  [${i + 1}] confidence=${d.confidence.toFixed(4)} (cls=${d.rawCls.toFixed(4)} obj=${d.rawObj.toFixed(4)}) box=[${d.left.toFixed(1)}, ${d.top.toFixed(1)}, ${d.right.toFixed(1)}, ${d.bottom.toFixed(1)}] size=${((d.right - d.left) * (d.bottom - d.top)).toFixed(0)}px²`);
  }

  return { rawDetections, detectorResult, resized };
}

// ============================================================
// STEP 4-5: TEST CONFIDENCE THRESHOLDS
// ============================================================
function step45_testConfidenceThresholds(rawDetections) {
  console.log("\n" + "=".repeat(80));
  console.log("STEP 4-5: CONFIDENCE THRESHOLD IMPACT");
  console.log("=".repeat(80));

  const thresholds = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9];

  console.log(`\nconfidence threshold → detection count:`);
  for (const threshold of thresholds) {
    const count = rawDetections.filter(d => d.confidence >= threshold).length;
    console.log(`  >= ${threshold.toFixed(2)}: ${count}`);
  }
}

// ============================================================
// STEP 6-7: TEST FILTERING STAGES
// ============================================================
function step67_testFiltering(rawDetections, scaledSize, detectorParams) {
  console.log("\n" + "=".repeat(80));
  console.log("STEP 6-7: MINCONFIDENCE & MINFACE SIZE FILTERING");
  console.log("=".repeat(80));

  const { width, height } = scaledSize;
  const minConfidence = 0.75;
  const minFaceSize = 20;

  console.log(`\nminConfidence: ${minConfidence}`);
  console.log(`minFaceSize: ${minFaceSize}`);

  const afterConfidence = rawDetections.filter(d => d.confidence >= minConfidence);
  console.log(`After confidence filtering: ${afterConfidence.length} detections`);

  const afterMinFaceSize = afterConfidence.filter(d => {
    // First transform to source coordinates
    const { detectorScale, detectorOffsetX, detectorOffsetY } = detectorParams;
    const sourceLeft = (d.left - detectorOffsetX) / detectorScale;
    const sourceTop = (d.top - detectorOffsetY) / detectorScale;
    const sourceRight = (d.right - detectorOffsetX) / detectorScale;
    const sourceBottom = (d.bottom - detectorOffsetY) / detectorScale;

    const boxWidth = sourceRight - sourceLeft;
    const boxHeight = sourceBottom - sourceTop;
    const minDim = Math.min(boxWidth, boxHeight);
    
    return minDim >= minFaceSize;
  });

  console.log(`After minFaceSize filtering: ${afterMinFaceSize.length} detections`);

  // Show detections rejected by minFaceSize
  const rejectedBySize = afterConfidence.filter(d => {
    const { detectorScale, detectorOffsetX, detectorOffsetY } = detectorParams;
    const sourceLeft = (d.left - detectorOffsetX) / detectorScale;
    const sourceTop = (d.top - detectorOffsetY) / detectorScale;
    const sourceRight = (d.right - detectorOffsetX) / detectorScale;
    const sourceBottom = (d.bottom - detectorOffsetY) / detectorScale;

    const boxWidth = sourceRight - sourceLeft;
    const boxHeight = sourceBottom - sourceTop;
    const minDim = Math.min(boxWidth, boxHeight);
    
    return minDim < minFaceSize;
  });

  if (rejectedBySize.length > 0) {
    console.log(`\nDetections REJECTED by minFaceSize (${minFaceSize}):`);
    for (let i = 0; i < Math.min(5, rejectedBySize.length); i++) {
      const d = rejectedBySize[i];
      const { detectorScale, detectorOffsetX, detectorOffsetY } = detectorParams;
      const sourceLeft = (d.left - detectorOffsetX) / detectorScale;
      const sourceTop = (d.top - detectorOffsetY) / detectorScale;
      const sourceRight = (d.right - detectorOffsetX) / detectorScale;
      const sourceBottom = (d.bottom - detectorOffsetY) / detectorScale;
      const boxWidth = sourceRight - sourceLeft;
      const boxHeight = sourceBottom - sourceTop;
      const minDim = Math.min(boxWidth, boxHeight);
      console.log(`  [${i + 1}] conf=${d.confidence.toFixed(3)} size=${boxWidth.toFixed(0)}x${boxHeight.toFixed(0)} (min=${minDim.toFixed(0)} < ${minFaceSize})`);
    }
  }

  return { afterConfidence, afterMinFaceSize };
}

// ============================================================
// STEP 8: TEST NMS
// ============================================================
function step8_testNMS(detections, nmsThreshold) {
  console.log("\n" + "=".repeat(80));
  console.log(`STEP 8: NMS FILTERING (threshold=${nmsThreshold})`);
  console.log("=".repeat(80));

  const kept = [];
  const suppressed = [];
  const detectionsCopy = [...detections].sort((a, b) => b.confidence - a.confidence);

  while (detectionsCopy.length) {
    const candidate = detectionsCopy.shift();
    kept.push(candidate);

    for (let index = detectionsCopy.length - 1; index >= 0; index -= 1) {
      const iou = intersectionOverUnion(candidate, detectionsCopy[index]);
      if (iou > nmsThreshold) {
        suppressed.push({
          kept: candidate,
          suppressed: detectionsCopy[index],
          iou,
        });
        detectionsCopy.splice(index, 1);
      }
    }
  }

  console.log(`After NMS: ${kept.length} detections kept, ${suppressed.length} suppressed`);

  if (suppressed.length > 0 && suppressed.length <= 10) {
    console.log(`\nNMS DECISIONS:`);
    for (let i = 0; i < suppressed.length; i++) {
      const s = suppressed[i];
      console.log(`  [${i + 1}] conf=${s.kept.confidence.toFixed(3)} KEPT over conf=${s.suppressed.confidence.toFixed(3)} (IoU=${s.iou.toFixed(3)} > ${nmsThreshold})`);
    }
  }

  return kept;
}

// ============================================================
// STEP 9-10: INVERSE TRANSFORM & FINAL REPORT
// ============================================================
async function step910_inverseTransformAndReport(detections, scaledSize, detectorParams, resized) {
  console.log("\n" + "=".repeat(80));
  console.log("STEP 9-10: INVERSE LETTERBOX TRANSFORM & FINAL DETECTIONS");
  console.log("=".repeat(80));

  const { width, height } = scaledSize;
  const { detectorScale, detectorOffsetX, detectorOffsetY } = detectorParams;

  console.log(`\nTransform from 640x640 → ${width}x${height}:`);

  const finalDetections = [];
  for (const detection of detections) {
    const sourceLeft = Math.max(0, Math.round((detection.left - detectorOffsetX) / detectorScale));
    const sourceTop = Math.max(0, Math.round((detection.top - detectorOffsetY) / detectorScale));
    const sourceRight = Math.min(width, Math.round((detection.right - detectorOffsetX) / detectorScale));
    const sourceBottom = Math.min(height, Math.round((detection.bottom - detectorOffsetY) / detectorScale));

    if (sourceRight <= sourceLeft || sourceBottom <= sourceTop) continue;

    const landmarks = detection.landmarks.map(point => ({
      x: (point.x - detectorOffsetX) / detectorScale,
      y: (point.y - detectorOffsetY) / detectorScale,
    }));

    finalDetections.push({
      confidence: detection.confidence,
      box: { left: sourceLeft, top: sourceTop, right: sourceRight, bottom: sourceBottom },
      landmarks,
      width: sourceRight - sourceLeft,
      height: sourceBottom - sourceTop,
    });
  }

  console.log(`Final detections in source coordinates: ${finalDetections.length}`);

  console.log(`\nFINAL DETECTIONS:`);
  for (let i = 0; i < finalDetections.length; i++) {
    const d = finalDetections[i];
    console.log(`  [${i + 1}] conf=${d.confidence.toFixed(3)} box=[${d.box.left}, ${d.box.top}, ${d.box.right}, ${d.box.bottom}] size=${d.width}x${d.height}`);
    
    // Check landmarks
    let allInside = true;
    for (const lm of d.landmarks) {
      if (lm.x < d.box.left || lm.x > d.box.right || lm.y < d.box.top || lm.y > d.box.bottom) {
        allInside = false;
        break;
      }
    }
    console.log(`      landmarks: ${allInside ? "ALL INSIDE BOX ✓" : "SOME OUTSIDE BOX ✗"}`);
  }

  return finalDetections;
}

// ============================================================
// MAIN INVESTIGATION
// ============================================================
async function main() {
  await loadModels();

  // Get a test image
  console.log("\n📥 Loading test image...");
  const seriesData = loadSeriesData(path.join(ROOT, "image-xuatgiabedao-links.js"));
  let buffer;

  try {
    const firstRecord = seriesData[0];
    buffer = await fetchBuffer(firstRecord.url);
    console.log(`✓ Loaded: ${firstRecord.name}`);
  } catch (error) {
    console.error("✗ Could not load image:", error.message);
    process.exit(1);
  }

  // Step 1: Verify preprocessing
  const step1 = await step1_verifyPreprocessing(buffer);

  // Load detector
  const detector = await ort.InferenceSession.create(path.join(ROOT, "models", "face_detection_yunet_2023mar.onnx"));

  // Step 2-3: Raw YuNet output & decode
  const step23 = await step23_rawYuNetAndDecode(buffer, step1.scaledSize, step1.detectorParams, detector);

  // Step 4-5: Confidence thresholds
  step45_testConfidenceThresholds(step23.rawDetections);

  // Step 6-7: Filtering
  const step67 = step67_testFiltering(step23.rawDetections, step1.scaledSize, step1.detectorParams);

  // Step 8: NMS with different thresholds
  console.log("\nTesting NMS with different thresholds:");
  const nmsResults = {};
  for (const threshold of [0.3, 0.4, 0.5, 0.6]) {
    const afterNMS = step8_testNMS(step67.afterMinFaceSize, threshold);
    nmsResults[threshold] = afterNMS;
  }

  // Step 9-10: Final with standard NMS
  const final = await step910_inverseTransformAndReport(nmsResults[0.5], step1.scaledSize, step1.detectorParams, step23.resized);

  // SUMMARY
  console.log("\n" + "=".repeat(80));
  console.log("PIPELINE SUMMARY");
  console.log("=".repeat(80));
  console.log(`RAW DECODED:           ${step23.rawDetections.length}`);
  console.log(`AFTER CONFIDENCE(0.75): ${step67.afterConfidence.length}`);
  console.log(`AFTER MINFACE SIZE:    ${step67.afterMinFaceSize.length}`);
  console.log(`AFTER NMS(0.5):        ${nmsResults[0.5].length}`);
  console.log(`FINAL (in source):     ${final.length}`);
  console.log("=".repeat(80) + "\n");
}

main().catch(error => {
  console.error("Fatal:", error.message);
  process.exitCode = 1;
});
