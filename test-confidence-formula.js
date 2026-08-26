/**
 * Check if confidence formula needs sigmoid or other adjustment
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

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
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

async function testConfidenceFormula() {
  await loadModels();

  console.log("\n" + "=".repeat(80));
  console.log("CONFIDENCE FORMULA INVESTIGATION");
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

  const tensor = tensorFromRgb(detectorImage, 640, 640, false, true);
  
  const result = await detector.run({
    [detector.inputNames[0]]: tensor,
  });

  const scores = result[`cls_8`].data;
  const objects = result[`obj_8`].data;

  console.log("\nTesting different confidence formulas:\n");

  // Test different formulas
  const formulas = [
    { name: "cls * obj (current)", fn: (cls, obj) => cls * obj },
    { name: "sigmoid(cls) * sigmoid(obj)", fn: (cls, obj) => sigmoid(cls) * sigmoid(obj) },
    { name: "sigmoid(cls * obj)", fn: (cls, obj) => sigmoid(cls * obj) },
    { name: "sigmoid(cls + obj)", fn: (cls, obj) => sigmoid(cls + obj) },
    { name: "cls only", fn: (cls, obj) => cls },
    { name: "obj only", fn: (cls, obj) => obj },
    { name: "max(cls, obj)", fn: (cls, obj) => Math.max(cls, obj) },
    { name: "(cls + obj) / 2", fn: (cls, obj) => (cls + obj) / 2 },
  ];

  for (const formula of formulas) {
    let maxConf = 0;
    const detections = [];

    for (let i = 0; i < Math.min(100, scores.length); i++) {
      const conf = formula.fn(scores[i], objects[i]);
      detections.push(conf);
      if (conf > maxConf) maxConf = conf;
    }

    detections.sort((a, b) => b - a);

    const thresholds = [0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9];
    const counts = {};
    for (const thresh of thresholds) {
      let count = 0;
      for (let i = 0; i < scores.length; i++) {
        if (formula.fn(scores[i], objects[i]) >= thresh) count++;
      }
      counts[thresh] = count;
    }

    console.log(`✓ ${formula.name}`);
    console.log(`  Max: ${maxConf.toFixed(4)}`);
    console.log(`  Top 5: [${detections.slice(0, 5).map(x => x.toFixed(4)).join(", ")}]`);
    console.log(`  Detections >= 0.75: ${counts[0.75]}`);
    console.log();
  }

  console.log("=".repeat(80));
}

testConfidenceFormula().catch(error => {
  console.error("Fatal:", error.message);
  process.exitCode = 1;
});
