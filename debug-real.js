const fs = require("fs");
const path = require("path");
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

// ========== ANALYZE PIPELINE WITH REAL IMAGE ==========
async function analyzePipeline() {
  console.log("\n" + "=".repeat(80));
  console.log("YuNet DETECTION PIPELINE ANALYSIS");
  console.log("=".repeat(80));

  // Fetch real image from URL
  console.log("\n📥 Fetching test image...");
  let buffer;
  try {
    // Using a URL that has faces
    const testUrl = "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Camponotus_flavomarginatus_ant.jpg/1200px-Camponotus_flavomarginatus_ant.jpg";
    buffer = await fetchBuffer(testUrl);
    console.log(`✓ Fetched ${buffer.length} bytes`);
  } catch (error) {
    console.log("⚠️  Could not fetch from URL, using white image instead");
    // Fallback: create white test image
    buffer = await sharp({
      create: { width: 800, height: 800, channels: 3, background: [255, 255, 255] }
    }).jpeg().toBuffer();
  }

  // Prepare image
  const source = sharp(buffer).rotate();
  const metadata = await source.metadata();
  console.log(`📊 Original image: ${metadata.width}x${metadata.height}, ${metadata.format}`);

  const scale = Math.min(1, 1600 / Math.max(metadata.width || 1, metadata.height || 1));
  const width = Math.max(1, Math.round((metadata.width || 1) * scale));
  const height = Math.max(1, Math.round((metadata.height || 1) * scale));
  
  console.log(`📐 Scaled to: ${width}x${height}`);

  const resized = await source
    .resize(width, height)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // ========== BƯỚC 4: KIỂM TRA LETTERBOX ==========
  console.log("\n" + "=".repeat(80));
  console.log("BƯỚC 4: KIỂM TRA LETTERBOX TRANSFORM");
  console.log("=".repeat(80));

  const detectorSize = 640;
  const detectorScale = Math.min(detectorSize / width, detectorSize / height);
  const detectorWidth = Math.round(width * detectorScale);
  const detectorHeight = Math.round(height * detectorScale);
  const detectorOffsetX = Math.round((detectorSize - detectorWidth) / 2);
  const detectorOffsetY = Math.round((detectorSize - detectorHeight) / 2);

  console.log(`📊 Letterbox parameters:`);
  console.log(`   detectorScale = min(${detectorSize}/${width}, ${detectorSize}/${height}) = ${detectorScale.toFixed(4)}`);
  console.log(`   detectorWidth = round(${width} * ${detectorScale.toFixed(4)}) = ${detectorWidth}`);
  console.log(`   detectorHeight = round(${height} * ${detectorScale.toFixed(4)}) = ${detectorHeight}`);
  console.log(`   detectorOffsetX = round((${detectorSize} - ${detectorWidth}) / 2) = ${detectorOffsetX}`);
  console.log(`   detectorOffsetY = round((${detectorSize} - ${detectorHeight}) / 2) = ${detectorOffsetY}`);

  // Create detector image
  const detectorImage = await sharp(resized.data, { raw: resized.info })
    .resize(detectorSize, detectorSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0 },
    })
    .raw()
    .toBuffer();

  console.log(`✓ Detector image: ${detectorSize}x${detectorSize}`);

  // Load and run detector
  console.log("\n📥 Loading YuNet detector...");
  const detector = await ort.InferenceSession.create(
    path.join(ROOT, "models", "face_detection_yunet_2023mar.onnx")
  );

  const detectorResult = await detector.run({
    [detector.inputNames[0]]: tensorFromRgb(detectorImage, detectorSize, detectorSize, false, true)
  });

  // ========== BƯỚC 1: ANALYZE RAW OUTPUT ==========
  console.log("\n" + "=".repeat(80));
  console.log("BƯỚC 1: RAW YUNET OUTPUT");
  console.log("=".repeat(80));

  console.log("\n📋 Output shapes:");
  for (const stride of [8, 16, 32]) {
    console.log(`   cls_${stride}: ${detectorResult[`cls_${stride}`].dims.join("x")}`);
    console.log(`   obj_${stride}: ${detectorResult[`obj_${stride}`].dims.join("x")}`);
    console.log(`   bbox_${stride}: ${detectorResult[`bbox_${stride}`].dims.join("x")}`);
    console.log(`   kps_${stride}: ${detectorResult[`kps_${stride}`].dims.join("x")}`);
  }

  // ========== BƯỚC 2: DECODE DETECTIONS ==========
  console.log("\n" + "=".repeat(80));
  console.log("BƯỚC 2-3: DECODE DETECTIONS & RAW TO 640x640");
  console.log("=".repeat(80));

  const detections = [];
  const minConfidence = 0.6; // Lower for analysis
  
  for (const stride of [8, 16, 32]) {
    const count = (detectorSize / stride) ** 2;
    const scores = detectorResult[`cls_${stride}`].data;
    const objects = detectorResult[`obj_${stride}`].data;
    const boxes = detectorResult[`bbox_${stride}`].data;
    const keypoints = detectorResult[`kps_${stride}`].data;

    console.log(`\n📊 Stride ${stride}: grid=${Math.sqrt(count)}x${Math.sqrt(count)}`);

    let strideDetections = 0;

    for (let index = 0; index < count; index += 1) {
      const confidence = scores[index] * objects[index];
      
      if (confidence < minConfidence) continue;

      const column = index % (detectorSize / stride);
      const row = Math.floor(index / (detectorSize / stride));
      const offset = index * 4;

      const rawLeft = boxes[offset];
      const rawTop = boxes[offset + 1];
      const rawRight = boxes[offset + 2];
      const rawBottom = boxes[offset + 3];

      const decodedLeft = (column - rawLeft) * stride;
      const decodedTop = (row - rawTop) * stride;
      const decodedRight = (column + rawRight) * stride;
      const decodedBottom = (row + rawBottom) * stride;

      const landmarks = [];
      for (let point = 0; point < 5; point += 1) {
        landmarks.push({
          x: (column + keypoints[index * 10 + point * 2]) * stride,
          y: (row + keypoints[index * 10 + point * 2 + 1]) * stride,
        });
      }

      detections.push({
        stride,
        confidence,
        decodedLeft,
        decodedTop,
        decodedRight,
        decodedBottom,
        landmarks,
        rawLeft,
        rawTop,
        rawRight,
        rawBottom,
      });

      strideDetections++;
    }

    console.log(`   ✓ Found ${strideDetections} candidates above threshold`);
  }

  // Sort by confidence
  detections.sort((a, b) => b.confidence - a.confidence);

  // Print top detections
  console.log(`\n📊 Top ${Math.min(5, detections.length)} detections (sorted by confidence):`);
  
  for (let i = 0; i < Math.min(5, detections.length); i++) {
    const det = detections[i];
    console.log(`\n   ✓ Detection ${i + 1}:`);
    console.log(`      Score: ${det.confidence.toFixed(3)}, Stride: ${det.stride}`);
    console.log(`      Raw bbox values: L=${det.rawLeft.toFixed(3)}, T=${det.rawTop.toFixed(3)}, R=${det.rawRight.toFixed(3)}, B=${det.rawBottom.toFixed(3)}`);
    console.log(`      Decoded (640x640): L=${det.decodedLeft.toFixed(1)}, T=${det.decodedTop.toFixed(1)}, R=${det.decodedRight.toFixed(1)}, B=${det.decodedBottom.toFixed(1)}`);
    console.log(`      Size: ${(det.decodedRight - det.decodedLeft).toFixed(0)}x${(det.decodedBottom - det.decodedTop).toFixed(0)}`);

    // ========== BƯỚC 6: CHECK BOX vs LANDMARK ==========
    console.log(`      Landmarks in 640x640:`);
    let allInside = true;
    det.landmarks.forEach((lm, idx) => {
      const inside = lm.x >= det.decodedLeft && lm.x <= det.decodedRight && 
                     lm.y >= det.decodedTop && lm.y <= det.decodedBottom;
      if (!inside) allInside = false;
      
      const status = inside ? "✓" : "✗";
      console.log(`        ${status} P${idx}: (${lm.x.toFixed(1)}, ${lm.y.toFixed(1)}) ${inside ? "INSIDE" : "OUTSIDE"}`);
    });

    // ========== BƯỚC 5: TRANSFORM TO SOURCE COORDINATES ==========
    console.log(`      Transform to source (${width}x${height}):`);
    
    const toSourceX = (v) => (v - detectorOffsetX) / detectorScale;
    const toSourceY = (v) => (v - detectorOffsetY) / detectorScale;

    const sourceLeft = Math.max(0, Math.round(toSourceX(det.decodedLeft)));
    const sourceTop = Math.max(0, Math.round(toSourceY(det.decodedTop)));
    const sourceRight = Math.min(width, Math.round(toSourceX(det.decodedRight)));
    const sourceBottom = Math.min(height, Math.round(toSourceY(det.decodedBottom)));

    console.log(`        Box: L=${sourceLeft}, T=${sourceTop}, R=${sourceRight}, B=${sourceBottom}`);
    console.log(`        Size: ${sourceRight - sourceLeft}x${sourceBottom - sourceTop}`);

    console.log(`      Landmarks in source coordinates:`);
    det.landmarks.forEach((lm, idx) => {
      const sourceLmX = (lm.x - detectorOffsetX) / detectorScale;
      const sourceLmY = (lm.y - detectorOffsetY) / detectorScale;
      
      const inside = sourceLmX >= sourceLeft && sourceLmX <= sourceRight &&
                     sourceLmY >= sourceTop && sourceLmY <= sourceBottom;
      
      const status = inside ? "✓" : "✗";
      console.log(`        ${status} P${idx}: (${sourceLmX.toFixed(1)}, ${sourceLmY.toFixed(1)}) ${inside ? "INSIDE" : "OUTSIDE"}`);
    });
  }

  console.log(`\n✅ PIPELINE ANALYSIS COMPLETE (Total: ${detections.length} detections)`);
}

async function main() {
  await loadModels();
  await analyzePipeline();
}

main().catch((error) => {
  console.error("Fatal:", error.message);
  process.exitCode = 1;
});
