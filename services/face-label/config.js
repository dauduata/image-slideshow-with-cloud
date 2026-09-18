const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const dotenv = require("dotenv");

dotenv.config();

const ROOT = path.join(__dirname, "..", "..");
const envPath = (name, fallback) => path.resolve(ROOT, process.env[name] || fallback);
const envNumber = (name, fallback) => Number(process.env[name] || fallback);

const defaults = {
  input: envPath("FACE_LABEL_INPUT", "image-links.js"),
  output: envPath("FACE_LABEL_OUTPUT", "image-links-labeled.js"),
  clusterOutput: envPath("FACE_LABEL_CLUSTER_OUTPUT", path.join("report", "image-links-clusters.js")),
  report: envPath("FACE_LABEL_REPORT", path.join("face-clusters-report", "index.html")),
  detector: envPath("FACE_LABEL_DETECTOR", path.join("models", "face_detection_yunet_2023mar.onnx")),
  recognizer: envPath("FACE_LABEL_RECOGNIZER", path.join("models", "face_recognition_sface_2021dec.onnx")),
  concurrency: envNumber("FACE_LABEL_CONCURRENCY", 1),
  threshold: envNumber("FACE_LABEL_THRESHOLD", 0.45),
  timeout: envNumber("FACE_LABEL_TIMEOUT", 120000),
  minConfidence: envNumber("FACE_LABEL_MIN_CONFIDENCE", 0.75),
  nmsThreshold: envNumber("FACE_LABEL_NMS_THRESHOLD", 0.5),
  minFaceSize: envNumber("FACE_LABEL_MIN_FACE_SIZE", 20),
  maxFaceAspectRatio: envNumber("FACE_LABEL_MAX_FACE_ASPECT_RATIO", 2.5),
  maxDimension: envNumber("FACE_LABEL_MAX_DIMENSION", 1600),
};

function parseArgs(argv = process.argv.slice(2)) {
  const options = { ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      console.log("node services/face-label/runner.js [--input file] [--output file] [--cluster-output file] [--report file] [--name file] [--names a,b] [--concurrency 2] [--threshold 0.45]");
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
