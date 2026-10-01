// Read files at an EXACT commit so a branch update can never leak latest source
// into an older documentation build.
import { execFileSync } from 'node:child_process';

export function show(commit, path, repo = process.env.UI_REPO || process.cwd()) {
  return execFileSync('git', ['show', `${commit}:${path}`], { cwd: repo, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore','pipe','ignore'] });
}
export function ls(commit, path, repo = process.env.UI_REPO || process.cwd()) {
  const out = execFileSync('git', ['ls-tree', '-r', '--name-only', commit, path], { cwd: repo, encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}
export function tryShow(commit, path, repo) {
  try { return show(commit, path, repo); } catch { return null; }
}
