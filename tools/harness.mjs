// Runs ONE example (from an exact commit) under a hard timeout and records:
// render output, emitted events, play() assertions, a11y verdict.
// The same html+a11y result is embedded into the preview artifact -> the
// property table, event docs and the live demo all originate from one build.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { show } from './git.mjs';
import { renderToHtml, buildFakeDom } from './render.mjs';
import { checkA11y } from './a11y.mjs';

export async function runExample(commit, exampleFile, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ex-'));
  const result = { example: exampleFile.split('/').pop(), status: 'fail', html: '', events: [], violations: [], error: null, timedOut: false, durationMs: 0 };
  try {
    // Materialize the minimal import closure from THIS commit only.
    writeFileSync(join(dir, 'h.mjs'), show(commit, 'library/runtime/h.js'));
    const demoSrc = show(commit, exampleFile).replaceAll("'../../runtime/h.js'", "'./h.mjs'");
    const demoPath = join(dir, 'demo.mjs');
    writeFileSync(demoPath, demoSrc);
    const mod = await import(pathToFileURL(demoPath).href);
    const meta = mod.meta || { timeoutMs: 3000, a11y: true };
    result.meta = meta;
    const events = result.events;
    const api = {
      emit(name, payload) { events.push({ name, payload: serialize(payload) }); },
      wait: (ms) => new Promise((r) => setTimeout(r, ms)),
      assert(cond, msg) { if (!cond) throw new Error(`assertion failed: ${msg}`); },
      fire: null,
    };
    const started = Date.now();
    const vnode = mod.render(api);
    const dom = buildFakeDom(vnode);
    api.fire = dom.fire;
    result.html = renderToHtml(vnode);
    if (meta.a11y !== false) result.violations = checkA11y(result.html);
    const limit = opts.timeoutMs ?? meta.timeoutMs ?? 3000;
    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => { const e = new Error(`example timed out after ${limit}ms`); e.code = 'TIMEOUT'; rej(e); }, limit); });
    try {
      if (mod.play) await Promise.race([Promise.resolve(mod.play(dom.root, api)), timeout]);
    } catch (e) {
      if (e.code === 'TIMEOUT') result.timedOut = true;
      throw e;
    } finally { clearTimeout(timer); result.durationMs = Date.now() - started; }
    result.status = result.violations.length ? 'a11y-fail' : 'pass';
  } catch (e) {
    result.error = String(e && e.message || e);
    if (result.timedOut) result.status = 'timeout';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return result;
}
function serialize(v) {
  try { return JSON.parse(JSON.stringify(v ?? null)); } catch { return String(v); }
}
