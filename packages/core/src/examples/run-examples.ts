import { Worker } from 'node:worker_threads';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { runA11yChecks } from './a11y.js';
import {
  transpileComponentTree,
  rewriteExampleImports,
} from './example-loader.js';
import type { ExampleResult } from '../types.js';

const workerFile = fileURLToPath(import.meta.resolve('./worker-runner.mjs'));
const registerFile = fileURLToPath(
  import.meta.resolve('./worker-register.mjs'),
);

export const DEFAULT_TIMEOUT_MS = 2000;

export interface RunOptions {
  timeoutMs?: number;
  /** Component source root containing src/ (defaults to examplesDir/..). */
  componentRoot?: string;
}

export interface ExampleFile {
  slug: string;
  component: string;
  title: string;
  file: string;
}

/**
 * Run every example in its own worker thread with an ESM load hook that
 * redirects component imports to a per-run transpiled runtime directory.
 *
 * Isolation guarantees — one failing example never aborts the batch:
 *  - thrown error / rejected promise -> failed (kind error)
 *  - no response before timeout       -> failed (kind timeout), worker killed
 *  - worker death                     -> failed (kind crash)
 *  - a11y violations                  -> failed (kind a11y)
 */
export async function runExamples(
  examplesDir: string,
  files: ExampleFile[],
  opts: RunOptions = {},
): Promise<ExampleResult[]> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const componentRoot = opts.componentRoot ?? path.join(examplesDir, '..');
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'compodoc-examples-'));
  const runtimeRoot = path.join(work, 'components');
  // Output preserves the basename of the source root so an example import of
  // `<root>/src/index.js` maps unchanged into the transpiled runtime.
  const runtimeDir = path.join(runtimeRoot, path.basename(componentRoot));
  await transpileComponentTree(
    path.join(componentRoot, 'src'),
    path.join(runtimeDir, 'src'),
  );

  const results: ExampleResult[] = [];
  try {
    for (const f of files) {
      const abs = path.join(examplesDir, f.file);
      const started = Date.now();
      const content = await fs.readFile(abs, 'utf8');
      const contentHash = createHash('sha256')
        .update(content)
        .digest('hex');
      const rewritten = rewriteExampleImports(
        content,
        abs,
        componentRoot,
        runtimeDir,
      );

      try {
        const html = await runOne(abs, rewritten, timeoutMs, work);
        const violations = runA11yChecks(html);
        results.push({
          ...f,
          contentHash,
          status: violations.length ? 'failed' : 'passed',
          failure: violations.length
            ? {
                kind: 'a11y',
                message: `${violations.length} a11y violation(s)`,
              }
            : undefined,
          durationMs: Date.now() - started,
          renderedHtml: html,
          a11yViolations: violations,
        });
      } catch (err) {
        results.push({
          ...f,
          contentHash,
          status: 'failed',
          failure: {
            kind: err instanceof ExampleError ? err.kind : 'error',
            message: err instanceof Error ? err.message : String(err),
          },
          durationMs: Date.now() - started,
        });
      }
    }
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
  return results;
}

class ExampleError extends Error {
  constructor(
    public kind: 'timeout' | 'crash' | 'error',
    message: string,
  ) {
    super(message);
  }
}

function runOne(
  exampleFile: string,
  rewrittenSource: string,
  timeoutMs: number,
  workDir: string,
): Promise<string> {
  const hookConfig = path.join(
    workDir,
    `hook-${process.pid}-${Math.random().toString(36).slice(2)}.json`,
  );
  fssync.writeFileSync(
    hookConfig,
    JSON.stringify({
      url: pathToFileURL(exampleFile).href,
      source: rewrittenSource,
    }),
  );

  return new Promise<string>((resolve, reject) => {
    const worker = new Worker(workerFile, {
      execArgv: ['--import', registerFile],
      env: { ...process.env, COMPODOC_HOOKS: hookConfig },
    });
    let settled = false;
    const fail = (
      kind: 'timeout' | 'crash' | 'error',
      message: string,
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ExampleError(kind, message));
    };
    const timer = setTimeout(() => {
      fail('timeout', `example timed out after ${timeoutMs}ms`);
      worker.terminate();
    }, timeoutMs);

    worker.on(
      'message',
      (msg: {
        ok: boolean;
        html?: string;
        error?: { message?: string };
      }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        if (msg.ok) resolve(msg.html!);
        else fail('error', msg.error?.message ?? 'example failed');
      },
    );
    worker.on('error', (err) =>
      fail('crash', `worker crashed: ${err.message}`),
    );
    worker.on('exit', (code) => {
      if (!settled && code !== 0)
        fail('crash', `worker exited unexpectedly with code ${code}`);
    });

    worker.postMessage({ url: pathToFileURL(exampleFile).href });
  }).finally(() => {
    try {
      fssync.unlinkSync(hookConfig);
    } catch {
      /* ignore */
    }
  });
}

/** Discover examples/<component>/*.mjs modules. */
export async function discoverExamples(
  examplesDir: string,
): Promise<ExampleFile[]> {
  const out: ExampleFile[] = [];
  let entries: string[];
  try {
    entries = await fs.readdir(examplesDir);
  } catch {
    return [];
  }
  for (const component of entries) {
    const compDir = path.join(examplesDir, component);
    const stat = await fs.stat(compDir).catch(() => undefined);
    if (!stat?.isDirectory()) continue;
    for (const name of await fs.readdir(compDir)) {
      if (!name.endsWith('.mjs')) continue;
      const file = path.join(compDir, name);
      const code = await fs.readFile(file, 'utf8');
      const title =
        /^\/\/\s*@title\s+(.+)$/m.exec(code)?.[1]?.trim() ?? name;
      out.push({
        slug: name.replace(/\.mjs$/, ''),
        component,
        title,
        file: path.relative(examplesDir, file),
      });
    }
  }
  return out;
}
