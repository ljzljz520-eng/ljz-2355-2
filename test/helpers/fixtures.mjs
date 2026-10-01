// Build a temporary git repository with two tagged releases from the tracked
// snapshots (test/fixtures/v1, test/fixtures/v2). The pipeline always ingests
// pinned tags, never branch tips.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function gitEnv() {
  const env = { ...process.env };
  for (const k of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
  ]) {
    delete env[k];
  }
  env.GIT_AUTHOR_NAME = 'ci';
  env.GIT_AUTHOR_EMAIL = 'ci@example.com';
  env.GIT_COMMITTER_NAME = 'ci';
  env.GIT_COMMITTER_EMAIL = 'ci@example.com';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_CONFIG_SYSTEM = '/dev/null';
  return env;
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    env: gitEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

export async function createFixtureRepo(opts = {}) {
  const snapshots = path.resolve('test/fixtures');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'compodoc-fixture-'));
  run('git', ['init', '-q'], { cwd: repo });

  copyDir(path.join(snapshots, 'v1'), repo);
  run('git', ['add', '-A'], { cwd: repo });
  run('git', ['commit', '-qm', 'v1'], { cwd: repo });
  run('git', ['tag', 'v1.0.0'], { cwd: repo });

  // Replace the tracked tree with the v2 snapshot.
  for (const entry of fs.readdirSync(repo)) {
    if (entry === '.git') continue;
    fs.rmSync(path.join(repo, entry), { recursive: true, force: true });
  }
  copyDir(path.join(snapshots, 'v2'), repo);
  if (opts.omitMigration) {
    fs.rmSync(path.join(repo, 'migrations'), { recursive: true, force: true });
  }
  run('git', ['add', '-A'], { cwd: repo });
  run('git', ['commit', '-qm', 'v2'], { cwd: repo });
  run('git', ['tag', 'v2.0.0'], { cwd: repo });

  return { repo };
}
