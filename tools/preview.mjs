// Produces a SELF-CONTAINED preview HTML for one example, sourced from an exact
// commit. The main site embeds it in <iframe sandbox> from a DIFFERENT origin,
// so user code never touches the main site's cookies, localStorage or DOM.
//
// Failures (throw/timeout) are contained inside the iframe and surfaced via
// postMessage; a broken example can never take down the page around it.
import { show } from './git.mjs';
import { renderToHtml } from './render.mjs';
import { checkA11y } from './a11y.mjs';

export function previewHtml(commit, exampleFile, example) {
  const demoSrc = show(commit, exampleFile)
    .replaceAll("'../../runtime/h.js'", "'./runtime.js'");
  const runtimeSrc = show(commit, 'library/runtime/h.js');
  const timeoutMs = example.meta?.timeoutMs ?? 3000;
  const title = example.meta?.title || example.example;
  // Initial static html is the SAME gate-tested html (same build).
  const initial = example.html || '';
  const violations = example.violations || [];
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:14px/1.5 system-ui;margin:12px;color:#1f2937}.err{color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;padding:8px;border-radius:6px;white-space:pre-wrap}.ok{color:#166534;font-size:12px}</style>
</head><body>
<div id="stage">${initial}</div>
<p class="ok" id="status"></p>
<script type="module">
const RUNTIME = ${JSON.stringify(runtimeSrc)};
const DEMO = ${JSON.stringify(demoSrc)};
const TIMEOUT_MS = ${timeoutMs};
const GATE_VIOLATIONS = ${JSON.stringify(violations)};
const blobs = (name, text) => URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
const rtUrl = blobs('runtime.js', RUNTIME);
const demoUrl = blobs('demo.js', DEMO.replaceAll('./runtime.js', rtUrl));
function fail(msg) {
  document.getElementById('status').className = 'err';
  document.getElementById('status').textContent = '示例运行失败（已隔离，不影响站点）：' + msg;
  parent.postMessage({ type: 'example-error', message: msg }, '*');
}
window.addEventListener('error', (e) => fail(e.message));
const watchdog = setTimeout(() => fail('示例超时 ' + TIMEOUT_MS + 'ms'), TIMEOUT_MS + 500);
try {
  const h = await import(demoUrl);
  const stage = document.getElementById('stage');
  const events = [];
  const realClick = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const api = {
    emit: (n, p) => { events.push({ name: n, payload: p ?? null }); parent.postMessage({ type: 'example-event', name: n, payload: p ?? null }, '*'); },
    wait: (ms) => new Promise(r => setTimeout(r, ms)),
    assert(c, m) { if (!c) throw new Error('assertion failed: ' + m); },
    fire: { click: realClick },
  };
  const toHtml = ${renderToHtml.toString().split('\n').slice(1).join('\n')};
  const vnode = h.render(api);
  stage.innerHTML = toHtml(vnode);
  if (h.play) await h.play(stage, api);
  clearTimeout(watchdog);
  document.getElementById('status').textContent = GATE_VIOLATIONS.length
    ? '门控未通过：' + GATE_VIOLATIONS.map(v => v.code).join(',') + '（该示例不会出现在正式页面）'
    : '示例运行正常 · 事件 ' + JSON.stringify(events);
  parent.postMessage({ type: 'example-ok', events }, '*');
} catch (e) { clearTimeout(watchdog); fail(String(e && e.message || e)); }
<\/script></body></html>`;
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
export { checkA11y };
