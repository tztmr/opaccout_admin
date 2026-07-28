const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');

if (isMainThread) {
  const worker = new Worker(__filename, { workerData: { buffer: Buffer.from("hello") } });
  worker.on('message', console.log);
  worker.on('error', console.error);
} else {
  try {
    const buf = workerData.buffer;
    const isBuffer = Buffer.isBuffer(buf);
    const hasToStringUtf8 = typeof buf.toString === 'function' && buf.toString('utf8') === 'hello';
    parentPort.postMessage({ isBuffer, hasToStringUtf8 });
  } catch (e) {
    parentPort.postMessage({ error: e.message });
  }
}
