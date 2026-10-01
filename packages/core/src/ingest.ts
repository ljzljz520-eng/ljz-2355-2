import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { resolveRef, checkoutWorktree, removeWorktree, showFile } from './git.js';
import { staticExtractPackage } from './extract/static-extract.js';
import { runtimeReflectPackage } from './extract/runtime-reflect.js';
import { mergePackage } from './extract/merge.js';
import { discoverExamples, runExamples } from './examples/run-examples.js';
import { diffReleases, applyMigrationNotes, type RenamesFile } from './diff.js';
import { runReverify, validateDeprecations } from './reverify.js';
import { VersionRepository } from './db/repository.js';
import {
  uploadArtifacts,
  localFsBackend,
  type UploadBackend,
} from './artifacts.js';
import type {
  ArtifactManifestEntry,
  BreakingChange,
  DeprecationInfo,
  EvidenceManifest,
  MigrationNote,
  ReleaseContract,
} from './types.js';

export interface IngestOptions {
  repoDir: string;
  ref: string;
  packageName: string;
  version: string;
  dbPath: string;
  /** Sub-path inside the worktree holding the component sources. */
  sourceSubdir?: string;
  timeoutMs?: number;
  backend?: UploadBackend;
  /** Re-extract even when (package, version, commit) already stored. */
  force?: boolean;
}

export interface IngestReport {
  release: ReleaseContract;
  versionId: number;
  gaps: string[];
  deprecationErrors: string[];
  migrationGatePassed: boolean;
  artifactGatePassed: boolean;
  examplesPassed: number;
  examplesFailed: number;
  status: ReleaseContract['status'];
  commit: string;
}

/**
 * Full ingestion pipeline for one pinned source commit.
 *
 * Every artifact of the version — contract, examples, rendered output — is
 * produced by a single build (buildId = content hash of the extracted
 * sources), guaranteeing the props table / events / slots shown in docs and
 * the interactive examples cannot drift apart.
 */
export async function ingestRelease(opts: IngestOptions): Promise<IngestReport> {
  const repo = new VersionRepository(opts.dbPath);
  const { commit, treeHash } = await resolveRef(opts.repoDir, opts.ref);

  const sameVersion = repo.getRelease(opts.packageName, opts.version);
  if (sameVersion && sameVersion.commit !== commit) {
    repo.close();
    throw new Error(
      `${opts.packageName}@${opts.version} already pinned to ${sameVersion.commit}; ${opts.ref} resolves to ${commit}`,
    );
  }
  // Predecessor = most recently ingested different version of this package.
  const predecessorRow = repo
    .listReleases(opts.packageName)
    .filter((r) => r.version !== opts.version)
    .sort((a, b) => b.id - a.id)[0];
  const prior = predecessorRow
    ? repo.getRelease(opts.packageName, predecessorRow.version)
    : null;

  const worktree = await fs.mkdtemp(path.join(os.tmpdir(), 'compodoc-wt-'));
  try {
    await checkoutWorktree(opts.repoDir, commit, worktree);
    const root = path.join(worktree, opts.sourceSubdir ?? '');

    // ---- contract: static + runtime + manual evidence, one build ----
    const staticResult = staticExtractPackage(
      root,
      path.join(root, 'src', 'index.ts'),
    );
    const runtime = await runtimeReflectPackage(
      root,
      path.join(root, 'src', 'index.ts'),
    );
    const evidence = await readJson<EvidenceManifest>(
      path.join(root, 'evidence', `${opts.version}.json`),
    );
    const merged = mergePackage(staticResult, runtime, evidence ?? undefined);
    const buildId = createHash('sha256')
      .update(treeHash)
      .update(JSON.stringify(merged.components.map((m) => m.contract)))
      .digest('hex')
      .slice(0, 16);

    // ---- interactive examples from the SAME snapshot ----
    const examplesDir = path.join(root, 'examples');
    const files = await discoverExamples(examplesDir);
    const examples = await runExamples(examplesDir, files, {
      timeoutMs: opts.timeoutMs,
    });

    // ---- deprecations declared by sources, validated vs known versions ----
    const deprecations: ReleaseContract['deprecations'] = [];
    for (const ex of staticResult) {
      for (const d of ex.deprecations) {
        deprecations.push({
          component: ex.component.name,
          path: d.path,
          info: d.info,
        });
      }
    }
    const known = repo.listReleases(opts.packageName).map((r) => r.version);
    const deprecationErrors = validateDeprecations(
      deprecations,
      known,
      opts.version,
    );

    // ---- breaking changes vs predecessor + migration notes/reverify ----
    let breakingChanges: BreakingChange[] = [];
    let migrationGatePassed = true;
    if (prior) {
      const renames = (await readJson<RenamesFile>(
        path.join(worktree, 'migrations', 'renames.json'),
      )) ?? { renames: {} };
      const raw = diffReleases(
        prior.components,
        merged.components.map((m) => m.contract),
        renames,
      );
      const migrationMap = await readJson<Record<string, MigrationNote>>(
        path.join(worktree, 'migrations', `${opts.version}.json`),
      );
      const withNotes = applyMigrationNotes(raw, migrationMap ?? {});
      breakingChanges = runReverify(withNotes.changes, examples);
      migrationGatePassed =
        withNotes.missing.length === 0 &&
        breakingChanges.every(
          (c) => c.migration && c.reverifyPassed === true,
        );
      if (!migrationGatePassed) {
        for (const key of withNotes.missing) {
          const ch = breakingChanges.find((c) => c.key === key);
          if (ch) ch.reverifyError = 'missing migration note';
        }
      }
    }

    const release: ReleaseContract = {
      packageName: opts.packageName,
      version: opts.version,
      commit,
      treeHash,
      branch: opts.ref,
      components: merged.components.map((m) => m.contract),
      examples,
      breakingChanges,
      deprecations,
      status: 'blocked',
      gates: {
        migrations: migrationGatePassed,
        artifacts: false,
        gaps: merged.gaps,
      },
    };

    const versionId = repo.saveRelease(release, buildId);

    // ---- required artifacts (partial upload survives retries) ----
    const manifest = await readJson<{ artifacts: ArtifactManifestEntry[] }>(
      path.join(root, 'artifacts.json'),
    );
    let artifactGatePassed = true;
    if (manifest) {
      const backend =
        opts.backend ??
        localFsBackend(path.join(path.dirname(opts.dbPath), 'published'));
      const up = await uploadArtifacts(
        repo,
        versionId,
        root,
        manifest.artifacts,
        backend,
      );
      artifactGatePassed = up.requiredSatisfied;
    }

    // ---- predecessor link ----
    if (prior) {
      repo.linkReleases(prior.id, versionId, 'predecessor-of');
      repo.linkReleases(versionId, prior.id, 'successor-of');
    }

    const status: ReleaseContract['status'] =
      migrationGatePassed && artifactGatePassed && deprecationErrors.length === 0
        ? 'complete'
        : 'partial';
    release.status = status;
    release.gates.artifacts = artifactGatePassed;
    repo.saveRelease(release, buildId);

    return {
      release,
      versionId,
      gaps: merged.gaps,
      deprecationErrors,
      migrationGatePassed,
      artifactGatePassed,
      examplesPassed: examples.filter((e) => e.status === 'passed').length,
      examplesFailed: examples.filter((e) => e.status === 'failed').length,
      status,
      commit,
    };
  } finally {
    await removeWorktree(opts.repoDir, worktree);
    await fs.rm(worktree, { recursive: true, force: true }).catch(() => undefined);
    repo.close();
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export type { DeprecationInfo };
