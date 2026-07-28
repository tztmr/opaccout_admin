import { parentPort, workerData } from "node:worker_threads";
import { parseImport } from "./import-parser";

if (parentPort) {
  try {
    const { buffer, fileName } = workerData;
    const result = parseImport(buffer, fileName);
    parentPort.postMessage({ success: true, result });
  } catch (error) {
    parentPort.postMessage({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
