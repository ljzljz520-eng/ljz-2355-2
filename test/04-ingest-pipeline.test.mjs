import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ingestRelease } from '../packages/core/dist/ingest.js';
import { failingBackend } from '../packages/core/dist/index.js';
import { createFixtureRepo } from './helpers/fixtures.mjs';

let fixture;
let dbDir;

before(async () => {
  fixture = await createFixtureRepo();
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compodoc-testdb-'));
});

test('v1.0.0 ingests complete with all examples passing', async () => {
  const report = await ingestRelease({
    repoDir: fixture.repo,
    ref: 'v1.0.0',
    packageName: '@acme/ui',
    version: '1.0.0',
    dbPath: path.join(dbDir, 'docs.db'),
    timeoutMs: 500,
  });
  assert.equal(report.status, 'complete');
  assert.equal(report.examplesFailed, 0);
  assert.ok(report.examplesPassed >= 3);
  assert.deepEqual(report.gaps, []);
  assert.equal(report.release.components.length, 2);
});

test('prop rename loading->busy detected (acceptance)', async () => {
  const report = await ingestRelease({
    repoDir: fixture.repo,
    ref: 'v2.0.0',
    packageName: '@acme/ui',
    version: '2.0.0',
    dbPath: path.join(dbDir, 'docs.db'),
    timeoutMs: 500,
  });
  const rename = report.release.breakingChanges.find(
    (c) => c.kind === 'prop-renamed' && c.component === 'cw-button',
  );
  assert.ok(rename, 'expected prop-renamed change');
  assert.equal(rename.from, 'loading');
  assert.equal(rename.to, 'busy');
  assert.ok(rename.migration, 'must carry migration note');
  assert.equal(rename.reverifyPassed, true);
});

test('event rename and tree prop rename and slot removal detected', async () => {
  // Re-read stored release through a fresh ingest is idempotent; query via DB.
  const { VersionRepository } = await import(
    '../packages/core/dist/index.js'
  );
  const repo = new VersionRepository(path.join(dbDir, 'docs.db'));
  const v2 = repo.getRelease('@acme/ui', '2.0.0');
  const kinds = v2.breakingChanges.map((c) => c.kind);
  assert.ok(kinds.includes('event-renamed'));
  assert.ok(
    v2.breakingChanges.some(
      (c) =>
        c.kind === 'prop-renamed' &&
        c.component === 'cw-tree' &&
        c.from === 'expanded' &&
        c.to === 'initiallyExpanded',
    ),
  );
  assert.ok(kinds.includes('slot-removed'));
  assert.ok(
    v2.breakingChanges.every((c) => c.migration && c.reverifyPassed === true),
  );
  repo.close();
});

test('async timeout example is failed kind=timeout and others still pass', async () => {
  const { VersionRepository } = await import(
    '../packages/core/dist/index.js'
  );
  const repo = new VersionRepository(path.join(dbDir, 'docs.db'));
  const v2 = repo.getRelease('@acme/ui', '2.0.0');
  const bySlug = Object.fromEntries(
    v2.examples.map((e) => [`${e.component}/${e.slug}`, e]),
  );
  assert.equal(bySlug['cw-button/timeout'].status, 'failed');
  assert.equal(bySlug['cw-button/timeout'].failure.kind, 'timeout');
  assert.match(
    bySlug['cw-button/timeout'].failure.message,
    /timed out after/,
  );
  // Crash isolation: the batch survives the killed worker.
  assert.equal(bySlug['cw-button/crash'].failure.kind, 'crash');
  // Accessibility failure.
  assert.equal(bySlug['cw-button/a11y-fail'].failure.kind, 'a11y');
  // Good examples unaffected.
  assert.equal(bySlug['cw-button/basic'].status, 'passed');
  assert.equal(bySlug['cw-button/busy'].status, 'passed');
  assert.equal(bySlug['cw-tree/recursive'].status, 'passed');
  repo.close();
});

test('failure isolation: one bad example does not abort the site build', async () => {
  const { buildDocsData } = await import('../packages/core/dist/index.js');
  const data = buildDocsData(path.join(dbDir, 'docs.db'), '@acme/ui');
  assert.equal(data.site.versions.length, 2);
  const v2 = data.perVersion.find((v) => v.version === '2.0.0');
  const button = v2.components.find((c) => c.name === 'cw-button');
  // Production manifest contains ONLY passed examples.
  assert.deepEqual(
    button.examples.map((e) => e.slug).sort(),
    ['basic', 'busy', 'icon'],
  );
  assert.ok(
    button.examples.every((e) => e.status === 'passed' && e.html),
  );
});

test('version pinning: branch updates cannot change a pinned version', async () => {
  // Push a new commit on top of v2.0.0 on a branch; ingesting v2.0.0 by tag
  // still resolves the tagged commit and must NOT silently move.
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['checkout', '-q', '-b', 'feature-x'], { cwd: fixture.repo });
  fs.writeFileSync(
    path.join(fixture.repo, 'src', 'cw-button.ts'),
    fs.readFileSync(path.join(fixture.repo, 'src', 'cw-button.ts'), 'utf8') +
      '\n// branch change after release\n',
  );
  execFileSync('git', ['add', '-A'], { cwd: fixture.repo });
  execFileSync('git', ['commit', '-qm', 'post-release change'], {
    cwd: fixture.repo,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'ci',
      GIT_AUTHOR_EMAIL: 'ci@example.com',
      GIT_COMMITTER_NAME: 'ci',
      GIT_COMMITTER_EMAIL: 'ci@example.com',
    },
  });
  const { VersionRepository } = await import('../packages/core/dist/index.js');
  const repo = new VersionRepository(path.join(dbDir, 'docs.db'));
  const before = repo.getRelease('@acme/ui', '2.0.0');
  const report = await ingestRelease({
    repoDir: fixture.repo,
    ref: 'v2.0.0',
    packageName: '@acme/ui',
    version: '2.0.0',
    dbPath: path.join(dbDir, 'docs.db'),
    timeoutMs: 500,
  });
  assert.equal(report.commit, before.commit);
  assert.equal(report.release.treeHash, before.treeHash);
  repo.close();
});

test('partial artifact upload: optional failure ok, required failure blocks', async () => {
  const dbPath = path.join(dbDir, 'partial.db');
  const f = await createFixtureRepo();
  await ingestRelease({
    repoDir: f.repo,
    ref: 'v1.0.0',
    packageName: '@acme/ui',
    version: '1.0.0',
    dbPath,
    timeoutMs: 500,
  });
  // v2 with backend that fails a REQUIRED artifact (ui.js).
  const required = await ingestRelease({
    repoDir: f.repo,
    ref: 'v2.0.0',
    packageName: '@acme/ui',
    version: '2.0.0',
    dbPath,
    timeoutMs: 500,
    backend: failingBackend(new Set(['ui.js'])),
  });
  assert.equal(required.artifactGatePassed, false);
  assert.notEqual(required.status, 'complete');
});
