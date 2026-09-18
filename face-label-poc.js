const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ROOT, parseArgs, loadSeriesData } = require("./services/face-label/config");
const { fetchRecordImage } = require("./services/face-label/fetcher");
const { detectAndEmbed } = require("./services/face-label/vision");
const { cluster, cosineDistance } = require("./services/face-label/clustering");
const { buildReportFaces, writeReport } = require("./services/face-label/report");

async function loadModels(options) {
  if (!fs.existsSync(options.detector) || !fs.existsSync(options.recognizer))
    throw new Error("Models missing. Run: npm run download-face-models");
  let ort;
  try {
    ort = require("onnxruntime-node");
  } catch (error) {
    throw new Error(`ONNX Runtime could not load its native binary. Original error: ${error.message}`);
  }
  const [detector, recognizer] = await Promise.all([
    ort.InferenceSession.create(options.detector),
    ort.InferenceSession.create(options.recognizer),
  ]);
  return { detector, recognizer, ort };
}

function selectSeries(allSeries, options) {
  const selected = options.names?.length ? allSeries.filter((record) => options.names.includes(record.name)) : allSeries;
  if (options.names?.length) {
    const foundNames = new Set(selected.map((record) => record.name));
    const missingNames = options.names.filter((name) => !foundNames.has(name));
    if (missingNames.length) throw new Error(`Image name(s) not found: ${missingNames.join(", ")}`);
  }
  return options.limit > 0 ? selected.slice(0, options.limit) : selected;
}

async function processImages(series, models, options) {
  const imageFaces = Array.from({ length: series.length }, () => null);
  const failed = [];
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= series.length) return;
      try {
        const image = await fetchRecordImage(series[index], options.timeout);
        imageFaces[index] = await detectAndEmbed(image.buffer, models.detector, models.recognizer, models.ort, options);
        console.log(`[${index + 1}/${series.length}] ${series[index].name} faces: ${imageFaces[index].faces.length} source: ${image.source}`);
      } catch (error) {
        failed.push(index);
        const details = error instanceof Error ? error : new Error(String(error));
        console.log(`[${index + 1}/${series.length}] ${series[index].name}\nURL: ${series[index].url || "<missing>"}\nthumbnailUrl: ${series[index].thumbnailUrl || "<missing>"}\nERROR: ${details.name}: ${details.message}\nSTACK:\n${details.stack || "<no stack>"}\nSKIPPED`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, series.length) }, worker));
  if (failed.length === series.length && series.length > 0)
    throw new Error(`All ${failed.length} selected image(s) failed; see SKIPPED diagnostics above`);
  return { imageFaces, failed };
}

function flattenFaces(imageFaces) {
  const faces = [];
  imageFaces.forEach((result, imageIndex) => {
    if (!result) return;
    result.faces.forEach((face) => faces.push({ imageIndex, imageWidth: result.width, imageHeight: result.height, ...face }));
  });
  return faces;
}

function writeDataOutputs(series, imageFaces, faces, labels, names, options) {
  const reportFaces = buildReportFaces(faces);
  const output = series.map((record, imageIndex) => ({
    ...record,
    faces: reportFaces.filter((face) => face.imageIndex === imageIndex),
    persons: [...new Set(faces.map((face, faceIndex) => face.imageIndex === imageIndex && labels[faceIndex] >= 0 ? names.get(labels[faceIndex]) : null).filter(Boolean))],
  }));
  const clusterOutput = series.map((record, imageIndex) => ({
    ...record,
    faceImageSize: imageFaces[imageIndex]?.faces.length ? { width: imageFaces[imageIndex].width, height: imageFaces[imageIndex].height } : undefined,
    faces: reportFaces.filter((face) => face.imageIndex === imageIndex),
    persons: faces.map((face, faceIndex) => face.imageIndex === imageIndex && labels[faceIndex] >= 0 ? { id: names.get(labels[faceIndex]), confidence: face.confidence, box: face.box, landmarks: face.landmarks } : null).filter(Boolean),
  }));
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.mkdirSync(path.dirname(options.clusterOutput), { recursive: true });
  fs.writeFileSync(options.output, `const seriesData = ${JSON.stringify(output, null, 2)};\n`);
  fs.writeFileSync(options.clusterOutput, `const seriesData = ${JSON.stringify(clusterOutput, null, 2)};\n`);
  return reportFaces;
}

async function main() {
  const options = parseArgs();
  const started = Date.now();
  const series = selectSeries(loadSeriesData(options.input), options);
  const models = await loadModels(options);
  const { imageFaces, failed } = await processImages(series, models, options);
  const faces = flattenFaces(imageFaces);
  const clusteringStarted = Date.now();
  const labels = cluster(faces.map((face) => face.embedding), faces.map((face) => face.imageIndex), options.threshold, options.clusterPair);
  const names = new Map();
  labels.forEach((label) => { if (label >= 0 && !names.has(label)) names.set(label, `person-${String(names.size + 1).padStart(3, "0")}`); });
  const clusteringTime = Date.now() - clusteringStarted;
  const reportFaces = writeDataOutputs(series, imageFaces, faces, labels, names, options);
  if (options.report) {
    writeReport(series, faces, labels, names, path.resolve(ROOT, options.report));
    console.log(`Face cluster report written: ${path.resolve(ROOT, options.report)}`);
  }
  const elapsed = Date.now() - started;
  console.log(`\n===== BENCHMARK =====\n  Platform: ${process.platform} ${os.release()}\n  CPU: ${os.cpus()[0].model}\n  Node.js: ${process.version}\n  Images: ${series.length}\n  Images with faces: ${imageFaces.filter((result) => result?.faces.length > 0).length}\n  Faces: ${faces.length}\n  Groups: ${names.size}\n  Detection + embedding: ${((elapsed - clusteringTime) / 1000).toFixed(1)} sec\n  Clustering: ${(clusteringTime / 1000).toFixed(1)} sec\n  Total: ${(elapsed / 1000).toFixed(1)} sec\n  Failed images: ${failed.length}\n  Output: ${options.output}\n  Cluster output: ${options.clusterOutput}\n  Report: ${options.report ? path.resolve(ROOT, options.report) : "not requested"}\n  =====================`);
  return reportFaces;
}

main().catch((error) => {
  console.error(`Fatal: ${error.message}`);
  process.exitCode = 1;
});
