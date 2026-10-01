import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ingestRelease } from '../packages/core/dist/ingest.js';
import { validateDeprecations } from '../packages/core/dist/index.js';
import { createFixtureRepo } from './helpers/fixtures.mjs';
import { createServer, securityHeaders } from '../packages/preview-server/server.mjs';

test('breaking change without migration note blocks release gate', async () => {
  const f = await createFixtureRepo({ omitMigration: true });
  const dbPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'gates-')),
    'docs.db',
  );
  await ingestRelease({
    repoDir: f.repo,
    ref: 'v1.0.0',
    packageName: '@acme/ui',
    version: '1.0.0',
    dbPath,
    timeoutMs: 500,
  });
  const v2 = await ingestRelease({
    repoDir: f.repo,
    ref: 'v2.0.0',
    packageName: '@acme/ui',
    version: '2.0.0',
    dbPath,
    timeoutMs: 500,
  });
  assert.equal(v2.migrationGatePassed, false);
  assert.notEqual(v2.status, 'complete');
  assert.ok(v2.release.breakingChanges.length > 0);
  assert.ok(
    v2.release.breakingChanges.some((c) => c.migration === undefined),
  );
});

test('deprecation scope must reference real versions', () => {
  const dep = (since, removeIn) => ({
    component: 'c',
    path: 'p',
    info: { since, removeIn },
  });
  assert.ok(
    validateDeprecations(
      [dep('2.0.0', '3.0.0')],
      ['1.0.0', '2.0.0'],
      '2.0.0',
    ).length === 0,
  );
  const errors = validateDeprecations(
    [dep('9.9.9', '3.0.0')],
    ['1.0.0', '2.0.0'],
    '2.0.0',
  );
  assert.ok(errors.length > 0);
  const order = validateDeprecations(
    [dep('2.0.0', '1.0.0')],
    ['1.0.0', '2.0.0'],
    '2.0.0',
  );
  assert.ok(order.some((e) => /removeIn/.test(e)));
});

function start(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

test('preview server sends strict isolation headers on every response', async () => {
  const server = createServer({
    generatedDir: path.resolve('docs/.generated'),
  });
  const port = await start(server);
  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/run/2.0.0/cw-button/basic`,
    );
    assert.equal(res.status, 200);
    const h = res.headers;
    const csp = h.get('content-security-policy');
    assert.match(csp, /frame-ancestors https:\/\/docs\.example\.invalid/);
    assert.match(csp, /sandbox allow-scripts/);
    assert.match(csp, /connect-src 'none'/);
    assert.equal(h.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(h.get('x-content-type-options'), 'nosniff');
    assert.equal(h.get('referrer-policy'), 'no-referrer');
    // never cached (older version content cannot linger)
    assert.equal(h.get('cache-control'), 'no-store');
  } finally {
    server.close();
  }
});

test('preview server refuses non-passed / unknown examples with isolated error page', async () => {
  const server = createServer({
    generatedDir: path.resolve('docs/.generated'),
  });
  const port = await start(server);
  try {
    const bad = await fetch(
      `http://127.0.0.1:${port}/run/2.0.0/cw-button/a11y-fail`,
    );
    assert.equal(bad.status, 404);
    const csp = bad.headers.get('content-security-policy');
    assert.match(csp, /sandbox allow-scripts/);
    const missing = await fetch(
      `http://127.0.0.1:${port}/run/9.9.9/cw-button/basic`,
    );
    assert.equal(missing.status, 404);
  } finally {
    server.close();
  }
});

test('preview path traversal is rejected', async () => {
  const server = createServer({
    generatedDir: path.resolve('docs/.generated'),
  });
  const port = await start(server);
  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/run/2.0.0/..%2f..%2fetc/passwd/x`,
    );
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});
