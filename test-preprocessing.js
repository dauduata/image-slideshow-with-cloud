/**
 * Test different preprocessing options to identify confidence issue
 */

const path = require("path");
const vm = require("vm");
const sharp = require("sharp");
const fs = require("fs");
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

function loadSeriesData(fileName) {
  const source = fs.readFileSync(fileName, "utf8");
  const sandbox = {};
  vm.runInNewContext(`${source}\nthis.__seriesData = seriesData;`, sandbox);
  return sandbox.__seriesData;
}

async function fetchBuffer(url, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
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

async function testPreprocessing() {
  await loadModels();

  console.log("\n" + "=".repeat(80));
  console.log("PREPROCESSING INVESTIGATION");
  console.log("=".repeat(80));

  // Load image
  const seriesData = loadSeriesData(path.join(ROOT, "image-xuatgiabedao-links.js"));
  const buffer = await fetchBuffer(seriesData[0].url);

  // Prepare image
  const source = sharp(buffer).rotate();
  const metadata = await source.metadata();
  const scale = Math.min(1, 1600 / Math.max(metadata.width, metadata.height));
  const width = Math.max(1, Math.round(metadata.width * scale));
  const height = Math.max(1, Math.round(metadata.height * scale));

  const resized = await source
    .resize(width, height)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const detectorImage = await sharp(resized.data, { raw: resized.info })
    .resize(640, 640, { fit: "contain", background: { r: 0, g: 0, b: 0 } })
    .raw()
    .toBuffer();

  // Load detector
  const detector = await ort.InferenceSession.create(
    path.join(ROOT, "models", "face_detection_yunet_2023mar.onnx")
  );

  console.log("\nTesting different preprocessing options:\n");

  const configs = [
    { normalize: false, subtractMean: false, name: "RAW [0-255] + NO MEAN" },
    { normalize: false, subtractMean: true, name: "RAW [0-255] + SUBTRACT MEAN [104,117,123]" },
    { normalize: true, subtractMean: false, name: "NORMALIZED [-1,1] + NO MEAN" },
    { normalize: true, subtractMean: true, name: "NORMALIZED [-1,1] + SUBTRACT MEAN" },
  ];

  for (const config of configs) {
    const tensor = tensorFromRgb(detectorImage, 640, 640, config.normalize, config.subtractMean);
    
    // Sample first value to show preprocessing effect
    const firstPixel = tensor.data.slice(0, 3); // First pixel RGB channels
    
    const result = await detector.run({
      [detector.inputNames[0]]: tensor,
    });

    // Analyze top confidence
    let maxConfidence = 0;
    const scores = result[`cls_8`].data;
    const objects = result[`obj_8`].data;

    for (let i = 0; i < Math.min(6400, scores.length); i++) {
      const conf = scores[i] * objects[i];
      if (conf > maxConfidence) maxConfidence = conf;
    }

    console.log(`✓ ${config.name}`);
    console.log(`  First pixel sample: [${firstPixel[0].toFixed(2)}, ${firstPixel[1].toFixed(2)}, ${firstPixel[2].toFixed(2)}]`);
    console.log(`  Max confidence: ${maxConfidence.toFixed(4)}`);
    
    // Count detections at different thresholds
    const counts = {};
    for (const thresh of [0.3, 0.4, 0.5, 0.75]) {
      let count = 0;
      for (let i = 0; i < scores.length; i++) {
        if (scores[i] * objects[i] >= thresh) count++;
      }
      counts[thresh] = count;
    }
    console.log(`  Detections >= 0.75: ${counts[0.75]}, >= 0.50: ${counts[0.5]}, >= 0.40: ${counts[0.4]}`);
    console.log();
  }

  console.log("=".repeat(80));
}

testPreprocessing().catch(error => {
  console.error("Fatal:", error.message);
  process.exitCode = 1;
});
