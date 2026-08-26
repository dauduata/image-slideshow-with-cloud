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

// ========== BƯỚC 1: KIỂM TRA RAW YUNET OUTPUT ==========
async function analyzeRawYuNet() {
  console.log("\n" + "=".repeat(80));
  console.log("BƯỚC 1: KIỂM TRA RAW YUNET OUTPUT");
  console.log("=".repeat(80));

  // Tạo ảnh test đơn giản
  const testImageSize = 100; // 100x100 white face-like test
  const testImageData = Buffer.alloc(testImageSize * testImageSize * 3, 255);
  
  // Tạo ảnh 640x640 từ test image (padded)
  const detectorSize = 640;
  const testImage = await sharp({
    create: {
      width: testImageSize,
      height: testImageSize,
      channels: 3,
      background: [255, 255, 255]
    }
  })
    .resize(detectorSize, detectorSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0 }
    })
    .raw()
    .toBuffer();

  // Load detector
  const detector = await ort.InferenceSession.create(
    path.join(ROOT, "models", "face_detection_yunet_2023mar.onnx")
  );

  console.log("\n📊 YuNet Model Info:");
  console.log("Input name:", detector.inputNames[0]);
  console.log("Output names:", detector.outputNames);

  // Run detector
  const result = await detector.run({
    [detector.inputNames[0]]: tensorFromRgb(testImage, detectorSize, detectorSize, false, true)
  });

  // Analyze outputs
  for (const stride of [8, 16, 32]) {
    const clsKey = `cls_${stride}`;
    const objKey = `obj_${stride}`;
    const bboxKey = `bbox_${stride}`;
    const kpsKey = `kps_${stride}`;

    if (result[clsKey]) {
      const count = (detectorSize / stride) ** 2;
      console.log(`\n📋 Stride ${stride}:`);
      console.log(`   Shape cls_${stride}: ${result[clsKey].dims.join("x")}, values: ${count}`);
      console.log(`   Shape obj_${stride}: ${result[objKey].dims.join("x")}, values: ${count}`);
      console.log(`   Shape bbox_${stride}: ${result[bboxKey].dims.join("x")}, values: ${count * 4}`);
      console.log(`   Shape kps_${stride}: ${result[kpsKey].dims.join("x")}, values: ${count * 10}`);
      
      // Sample first few values
      const clsData = Array.from(result[clsKey].data).slice(0, 5);
      const objData = Array.from(result[objKey].data).slice(0, 5);
      const bboxData = Array.from(result[bboxKey].data).slice(0, 20);
      const kpsData = Array.from(result[kpsKey].data).slice(0, 50);
      
      console.log(`   First cls values: ${clsData.map(v => v.toFixed(4)).join(", ")}`);
      console.log(`   First obj values: ${objData.map(v => v.toFixed(4)).join(", ")}`);
      console.log(`   First bbox values: ${bboxData.map(v => v.toFixed(4)).join(", ")}`);
      console.log(`   First kps values: ${kpsData.slice(0, 10).map(v => v.toFixed(4)).join(", ")}`);
    }
  }

  console.log("\n✅ RAW YUNET OUTPUT RECORDED");
  return result;
}

// ========== BƯỚC 2: KIỂM TRA DECODE DETECTIONS ==========
async function analyzeDecodeFormulas(result) {
  console.log("\n" + "=".repeat(80));
  console.log("BƯỚC 2: KIỂM TRA DECODE FORMULAS");
  console.log("=".repeat(80));

  const inputSize = 640;
  const minConfidence = 0.75;

  let candidateCount = 0;

  for (const stride of [8, 16, 32]) {
    const count = (inputSize / stride) ** 2;
    const scores = result[`cls_${stride}`].data;
    const objects = result[`obj_${stride}`].data;
    const boxes = result[`bbox_${stride}`].data;
    const keypoints = result[`kps_${stride}`].data;

    console.log(`\n📊 Stride ${stride}:`);

    for (let index = 0; index < Math.min(count, 100); index += 1) {
      // Công thức: confidence = cls * obj
      const confidence = scores[index] * objects[index];
      
      if (confidence < minConfidence) continue;

      const column = index % (inputSize / stride);
      const row = Math.floor(index / (inputSize / stride));
      const offset = index * 4;

      candidateCount++;

      if (candidateCount <= 3) { // Chỉ in 3 candidate đầu
        console.log(`\n   ✓ Candidate ${candidateCount}:`);
        console.log(`      index=${index}, row=${row}, column=${column}`);
        console.log(`      raw cls[${index}]=${scores[index].toFixed(4)}`);
        console.log(`      raw obj[${index}]=${objects[index].toFixed(4)}`);
        console.log(`      confidence = ${scores[index].toFixed(4)} * ${objects[index].toFixed(4)} = ${confidence.toFixed(4)}`);
        
        // BBOX DECODE
        const rawLeft = boxes[offset];
        const rawTop = boxes[offset + 1];
        const rawRight = boxes[offset + 2];
        const rawBottom = boxes[offset + 3];
        
        const decodedLeft = (column - rawLeft) * stride;
        const decodedTop = (row - rawTop) * stride;
        const decodedRight = (column + rawRight) * stride;
        const decodedBottom = (row + rawBottom) * stride;
        
        console.log(`      raw bbox: [${rawLeft.toFixed(2)}, ${rawTop.toFixed(2)}, ${rawRight.toFixed(2)}, ${rawBottom.toFixed(2)}]`);
        console.log(`      decoded bbox (640x640): left=${decodedLeft.toFixed(1)}, top=${decodedTop.toFixed(1)}, right=${decodedRight.toFixed(1)}, bottom=${decodedBottom.toFixed(1)}`);
        console.log(`      decoded size: ${(decodedRight - decodedLeft).toFixed(1)} x ${(decodedBottom - decodedTop).toFixed(1)}`);
        
        // LANDMARKS DECODE
        console.log(`      raw kps[${index*10}..${index*10+9}]: [${Array.from(keypoints).slice(index*10, index*10+10).map(v => v.toFixed(2)).join(", ")}]`);
        
        const landmarks = [];
        for (let point = 0; point < 5; point += 1) {
          const kpX = keypoints[index * 10 + point * 2];
          const kpY = keypoints[index * 10 + point * 2 + 1];
          const decodedX = (column + kpX) * stride;
          const decodedY = (row + kpY) * stride;
          landmarks.push({ x: decodedX, y: decodedY });
          
          console.log(`      landmark ${point}: raw=[${kpX.toFixed(2)}, ${kpY.toFixed(2)}] → decoded=[${decodedX.toFixed(1)}, ${decodedY.toFixed(1)}]`);
        }
        
        // CHECK IF LANDMARKS INSIDE BOX
        console.log(`      ✓ Landmarks inside box check:`);
        landmarks.forEach((lm, idx) => {
          const inside = lm.x >= decodedLeft && lm.x <= decodedRight && lm.y >= decodedTop && lm.y <= decodedBottom;
          const distLeft = lm.x < decodedLeft ? decodedLeft - lm.x : 0;
          const distRight = lm.x > decodedRight ? lm.x - decodedRight : 0;
          const distTop = lm.y < decodedTop ? decodedTop - lm.y : 0;
          const distBottom = lm.y > decodedBottom ? lm.y - decodedBottom : 0;
          
          if (inside) {
            console.log(`        P${idx}: INSIDE box`);
          } else {
            const distOutside = Math.max(distLeft, distRight, distTop, distBottom);
            console.log(`        P${idx}: OUTSIDE box by ${distOutside.toFixed(1)} pixels`);
          }
        });
      }
    }

    if (candidateCount > 3) break;
  }

  console.log(`\n✅ Total candidates analyzed: ${candidateCount}`);
}

async function main() {
  await loadModels();
  const result = await analyzeRawYuNet();
  await analyzeDecodeFormulas(result);

  console.log("\n" + "=".repeat(80));
  console.log("✅ PIPELINE ANALYSIS COMPLETE");
  console.log("=".repeat(80));
}

main().catch((error) => {
  console.error("Fatal:", error.message);
  process.exitCode = 1;
});
