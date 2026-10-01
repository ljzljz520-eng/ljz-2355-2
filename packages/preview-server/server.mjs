// Restricted interactive-example preview server.
//
// Threat model:
//  - User-supplied example code is untrusted. It runs ONLY in the browser,
//    inside a sandboxed iframe served from a distinct origin. The server
//    never executes example code (that happens in worker threads at build).
//  - The main docs site and any login/session context live on a different
//    origin. Because responses forbid framing from that origin, omit
//    credentials and the iframe uses sandbox="allow-scripts" (no
//    allow-same-origin), example code cannot read cookies/storage of the
//    main site nor reach back into its DOM.
//  - A bad request or a missing/failed example yields a self-contained error
//    page; it can never take down the docs site (separate process/origin).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_ORIGIN = 'https://preview.example.invalid';
const PORT = Number(process.env.PREVIEW_PORT ?? 8899);
// Allowed framing origin must be supplied; it never shares the preview host.
const DOCS_ORIGIN = process.env.DOCS_ORIGIN ?? 'https://docs.example.invalid';

/**
 * Security headers applied to EVERY response. These are asserted in tests as
 * the isolation contract between untrusted examples and the main site.
 */
export function securityHeaders(requestOrigin) {
  return {
    // No parent other than the docs origin may frame us.
    'Content-Security-Policy': [
      "default-src 'none'",
      "script-src 'unsafe-inline'", // single self-contained bootstrap
      "style-src 'unsafe-inline'",
      "img-src data: blob:",
      "font-src data:",
      "connect-src 'none'",
      "frame-ancestors " + DOCS_ORIGIN,
      'base-uri \'none\'',
      'form-action \'none\'',
      'sandbox allow-scripts',
    ].join('; '),
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

/** Only served artifacts: examples that passed in a complete release. */
function loadPassedExample(generatedDir, version, component, slug) {
  const manifestPath = path.join(generatedDir, version, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.status !== 'complete') return null;
  for (const c of manifest.components) {
    if (c.name !== component) continue;
    const ex = c.examples.find(
      (e) => e.slug === slug && e.status === 'passed' && typeof e.html === 'string',
    );
    if (!ex) return null;
    return { example: ex, commit: manifest.commit };
  }
  return null;
}

function renderPage({ example, commit, version, component, slug }) {
  const html = example.html;
  const data = JSON.stringify({
    v: version,
    c: component,
    s: slug,
    commit: commit.slice(0, 8),
  }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body>
<div id="root"></div>
<script>
// Minimal bootstrap: inject build-verified, statically rendered HTML.
// Interactive wiring is intentionally omitted for untrusted content; the
// example cannot load external resources (see CSP).
const META = ${data};
document.getElementById('root').textContent = 'preview ' + META.s + ' @' + META.v;
const host = document.createElement('div');
host.className = 'rendered';
host.innerHTML = ${JSON.stringify(html)};
document.getElementById('root').appendChild(host);
<\/script>
</body>
</html>`;
}

function errorPage(status, message) {
  return {
    status,
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"></head>
<body><p role="alert">${escapeHtml(message)}</p></body></html>`,
  };
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch],
  );
}

export function createServer({ generatedDir, origin = DEFAULT_ORIGIN, docsOrigin } = {}) {
  const dir =
    generatedDir ?? path.resolve(here, '..', '..', 'docs', '.generated');
  return http.createServer((req, res) => {
    const headers = securityHeaders(req.headers.origin);
    const send = (status, body, type = 'text/html; charset=utf-8') => {
      res.writeHead(status, { ...headers, 'Content-Type': type });
      res.end(body);
    };

    try {
      // Reject encoded path separators / NUL on the raw request target.
      if (/%(?:2f|5c|00|2e)/i.test(req.url ?? '')) {
        const e = errorPage(400, 'Invalid preview identifier.');
        return send(e.status, e.body);
      }
      const url = new URL(req.url, origin);
      // Match against the path so encoded separators cannot smuggle path
      // traversal past the single-segment identifier check.
      const m = url.pathname.match(
        /^\/run\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/,
      );
      if (!m) {
        const looksLikeRun = /^\/run\//.test(url.pathname);
        const e = errorPage(
          looksLikeRun ? 400 : 404,
          looksLikeRun
            ? 'Invalid preview identifier.'
            : 'Unknown preview path.',
        );
        return send(e.status, e.body);
      }
      const [, version, component, slug] = m;
      const found = loadPassedExample(dir, version, component, slug);
      if (!found) {
        // A missing or not-passed example is a self-contained failure.
        const e = errorPage(
          404,
          'Example not available (missing or did not pass build verification).',
        );
        return send(e.status, e.body);
      }
      const body = renderPage({
        example: found.example,
        commit: found.commit,
        version,
        component,
        slug,
      });
      return send(200, body);
    } catch (err) {
      const e = errorPage(500, 'Preview rendering failed.');
      return send(e.status, e.body);
    }
  });
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const server = createServer({});
  server.listen(PORT, () => {
    console.log(`preview server listening on :${PORT} (docs origin ${DOCS_ORIGIN})`);
  });
}
