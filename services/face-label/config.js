const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..", "..");

const defaults = {
  input: path.join(ROOT, "image-links.js"),
  output: path.join(ROOT, "image-links-labeled.js"),
  clusterOutput: path.join(ROOT, "report", "image-links-clusters.js"),
  report: path.join(ROOT, "face-clusters-report", "index.html"),
  detector: path.join(ROOT, "models", "face_detection_yunet_2023mar.onnx"),
  recognizer: path.join(ROOT, "models", "face_recognition_sface_2021dec.onnx"),
  concurrency: 1,
  threshold: 0.45,
  timeout: 120000,
  minConfidence: 0.75,
  nmsThreshold: 0.5,
  minFaceSize: 20,
  maxFaceAspectRatio: 2.5,
  maxDimension: 1600,
};

function parseArgs(argv = process.argv.slice(2)) {
  const options = { ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      console.log("node face-label-poc.js [--input file] [--output file] [--cluster-output file] [--report file] [--name file] [--names a,b] [--concurrency 2] [--threshold 0.45]");
      process.exit(0);
    }
    if (!argument.startsWith("--") || argv[index + 1] === undefined)
      throw new Error(`Invalid argument: ${argument}`);
    const key = argument.slice(2);
    const value = argv[++index];
    if (key === "name") {
      options.names = [...(options.names || []), value];
      continue;
    }
    if (key === "names") {
      options.names = [...(options.names || []), ...String(value).split(",").map((name) => name.trim()).filter(Boolean)];
      continue;
    }
    options[key] = ["concurrency", "timeout", "maxDimension", "limit", "nmsThreshold", "minFaceSize", "maxFaceAspectRatio", "threshold", "minConfidence"].includes(key)
      ? Number(value)
      : value;
  }
  if (options.concurrency < 1 || options.threshold <= 0 || options.threshold >= 1)
    throw new Error("Invalid concurrency or threshold");
  return options;
}

function loadSeriesData(fileName) {
  const source = fs.readFileSync(fileName, "utf8");
  const sandbox = {};
  vm.runInNewContext(`${source}\nthis.__seriesData = seriesData;`, sandbox, { filename: fileName });
  if (!Array.isArray(sandbox.__seriesData)) throw new Error("Input does not define an array named seriesData");
  return sandbox.__seriesData;
}

module.exports = { ROOT, defaults, parseArgs, loadSeriesData };
