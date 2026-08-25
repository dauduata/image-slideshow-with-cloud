const fs = require('fs');
const path = require('path');

const models = {
  'face_detection_yunet_2023mar.onnx': 'https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx',
  'face_recognition_sface_2021dec.onnx': 'https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx'
};

async function download(fileName, url) {
  const target = path.join(__dirname, 'models', fileName);
  if (fs.existsSync(target)) return console.log(`Exists: ${target}`);
  console.log(`Downloading ${fileName}...`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  console.log(`Saved: ${target}`);
}

(async () => {
  for (const [fileName, url] of Object.entries(models)) await download(fileName, url);
})().catch((error) => {
  console.error(`Model download failed: ${error.message}`);
  process.exitCode = 1;
});
