import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/**
 * Resolve a ref (branch / tag / sha) to an immutable commit + tree hash.
 * Docs builds never consume branch tips directly — they pin the resolved
 * commit so a later branch push cannot make an old doc version silently load
 * newer component code.
 */
export async function resolveRef(
  repoDir: string,
  ref: string,
): Promise<{ commit: string; treeHash: string }> {
  const { stdout } = await execFileP(
    'git',
    ['rev-parse', '--verify', `${ref}^{commit}`],
    { cwd: repoDir },
  );
  const commit = stdout.trim();
  const tree = await execFileP('git', ['rev-parse', `${commit}^{tree}`], {
    cwd: repoDir,
  });
  return { commit, treeHash: tree.stdout.trim() };
}

export async function checkoutWorktree(
  repoDir: string,
  commit: string,
  worktreeDir: string,
): Promise<void> {
  // Detached HEAD at the exact commit; the worktree is read-only by contract.
  await execFileP(
    'git',
    ['worktree', 'add', '--detach', '--force', worktreeDir, commit],
    { cwd: repoDir },
  );
}

export async function pruneWorktrees(repoDir: string): Promise<void> {
  await execFileP('git', ['worktree', 'prune'], { cwd: repoDir }).catch(
    () => undefined,
  );
}

export async function removeWorktree(
  repoDir: string,
  worktreeDir: string,
): Promise<void> {
  await execFileP('git', ['worktree', 'remove', '--force', worktreeDir], {
    cwd: repoDir,
  }).catch(() => undefined);
}

/** Read a file blob at a given commit without a worktree (for migration files). */
export async function showFile(
  repoDir: string,
  commit: string,
  relPath: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileP(
      'git',
      ['show', `${commit}:${relPath}`],
      { cwd: repoDir, maxBuffer: 32 * 1024 * 1024 },
    );
    return stdout;
  } catch {
    return null;
  }
}
