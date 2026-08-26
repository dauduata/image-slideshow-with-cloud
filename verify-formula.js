/**
 * Verify the actual raw values and correct formula
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

async function verify() {
  await loadModels();

  console.log("\n" + "=".repeat(80));
  console.log("VERIFY CONFIDENCE FORMULA - RAW VALUES");
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

  console.log("\nAnalyzing stride 8 outputs:\n");

  const scores = result[`cls_8`].data;
  const objects = result[`obj_8`].data;
  const boxes = result[`bbox_8`].data;
  const keypoints = result[`kps_8`].data;

  // Find indices where confidence would be high
  const candidates = [];

  for (let index = 0; index < Math.min(6400, scores.length); index++) {
    const cls = scores[index];
    const obj = objects[index];
    const conf = cls * obj;
    const clsOnly = cls;
    
    candidates.push({
      index,
      cls,
      obj,
      confMultiply: conf,
      confClsOnly: clsOnly,
    });
  }

  // Sort by cls * obj
  candidates.sort((a, b) => b.confMultiply - a.confMultiply);

  console.log("Top 20 by cls * obj formula:\n");
  for (let i = 0; i < 20; i++) {
    const c = candidates[i];
    console.log(`[${i + 1}] cls=${c.cls.toFixed(4)}, obj=${c.obj.toFixed(4)}, cls*obj=${c.confMultiply.toFixed(4)} vs cls-only=${c.confClsOnly.toFixed(4)}`);
  }

  console.log("\n" + "=".repeat(80));
  console.log("FORMULA COMPARISON");
  console.log("=".repeat(80));

  // Count by formula
  const countMultiply = candidates.filter(c => c.confMultiply >= 0.75).length;
  const countClsOnly = candidates.filter(c => c.confClsOnly >= 0.75).length;

  console.log(`\nDetections >= 0.75:`);
  console.log(`  Using cls * obj:  ${countMultiply}`);
  console.log(`  Using cls only:   ${countClsOnly}`);

  console.log(`\nTop value:`);
  console.log(`  Using cls * obj:  ${candidates[0].confMultiply.toFixed(4)}`);
  console.log(`  Using cls only:   ${candidates[0].confClsOnly.toFixed(4)}`);

  // Show why obj is always low
  console.log(`\nAnalyzing obj values:\n`);
  const objValues = Array.from(objects).slice(0, 6400);
  objValues.sort((a, b) => b - a);
  console.log(`Top 10 obj values: [${objValues.slice(0, 10).map(x => x.toFixed(4)).join(", ")}]`);
  console.log(`Max obj: ${objValues[0].toFixed(4)}`);
  console.log(`Avg obj (top 1000): ${(objValues.slice(0, 1000).reduce((a, b) => a + b) / 1000).toFixed(4)}`);

  const objGt06 = objValues.filter(x => x >= 0.6).length;
  const objGt075 = objValues.filter(x => x >= 0.75).length;
  console.log(`Obj values >= 0.60: ${objGt06}`);
  console.log(`Obj values >= 0.75: ${objGt075}`);

  console.log("\n" + "=".repeat(80));
}

verify().catch(error => {
  console.error("Fatal:", error.message);
  process.exitCode = 1;
});
