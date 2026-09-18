const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

async function fetchBuffer(url, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    console.log("[FETCH START]", url);
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    console.log("[FETCH RESPONSE]", {
      status: response.status,
      url: response.url,
      contentType: response.headers.get("content-type"),
      contentLength: response.headers.get("content-length"),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    console.error("[FETCH ERROR]", { name: error.name, message: error.message, code: error.cause?.code, hostname: error.cause?.hostname });
    try {
      const { stdout } = await execFileAsync("curl", ["--fail", "--silent", "--show-error", "--location", "--max-time", String(Math.ceil(timeout / 1000)), url], { encoding: "buffer", maxBuffer: 100 * 1024 * 1024 });
      console.log("[FETCH FALLBACK] curl succeeded", url);
      return stdout;
    } catch (fallbackError) {
      throw new Error(`Fetch failed and curl fallback failed: ${error.message}; curl: ${fallbackError.message}`, { cause: error });
    }
  } finally {
    clearTimeout(timer);
  }
}

function processingUrl(record) {
  if (!record.thumbnailUrl) throw new Error("thumbnailUrl is missing");
  return record.thumbnailUrl.replace(/([?&])width=\d+/, (_, separator) => `${separator}width=2400`).replace(/([?&])height=\d+/, (_, separator) => `${separator}height=2400`);
}

async function fetchRecordImage(record, timeout) {
  try {
    return { buffer: await fetchBuffer(record.url, timeout), source: "url" };
  } catch (error) {
    if (!error.message.includes("HTTP 403")) throw error;
    return { buffer: await fetchBuffer(processingUrl(record), timeout), source: "thumbnailUrl@2400 (fallback after HTTP 403)" };
  }
}

module.exports = { fetchRecordImage };
