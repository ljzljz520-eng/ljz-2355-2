// Runs inside a worker_thread. Imports the example module through the
// registered load hook and posts rendered HTML back. A crash here terminates
// only this worker; the orchestrator records 'crash' and continues.
import { parentPort } from 'node:worker_threads';

process.on('uncaughtException', (err) => {
  parentPort.postMessage({
    ok: false,
    error: { message: `uncaught: ${err?.message ?? err}` },
  });
});
process.on('unhandledRejection', (err) => {
  parentPort.postMessage({
    ok: false,
    error: { message: `unhandled rejection: ${err?.message ?? err}` },
  });
});

parentPort.once('message', async ({ url }) => {
  try {
    const mod = await import(url);
    const example = mod.default;
    if (!example || typeof example.render !== 'function') {
      throw new Error('example must default-export { render }');
    }
    const html = await example.render();
    if (typeof html !== 'string') {
      throw new Error('render() must return an HTML string');
    }
    parentPort.postMessage({ ok: true, html });
  } catch (err) {
    parentPort.postMessage({
      ok: false,
      error: { message: err?.message ?? String(err), stack: err?.stack },
    });
  }
});
