import { parentPort, workerData } from "node:worker_threads";
import { parseImport } from "./import-parser";

if (parentPort) {
  try {
    const { buffer, fileName, accountKind } = workerData;
    // workerData passes Buffer as Uint8Array, we need to convert it back to Buffer
    const realBuffer = Buffer.from(buffer);
    const result = parseImport(realBuffer, fileName, accountKind);
    parentPort.postMessage({ success: true, result });
  } catch (error) {
    parentPort.postMessage({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
