import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { VersionRepository } from './db/repository.js';
import type { ArtifactManifestEntry } from './types.js';

export interface UploadResult {
  uploaded: ArtifactManifestEntry[];
  failed: { entry: ArtifactManifestEntry; error: string }[];
  /** True only when every REQUIRED artifact is uploaded. */
  requiredSatisfied: boolean;
}

/**
 * Pluggable upload backend. The default copies into a local `published/`
 * directory; production injects an S3/CDN backend with the same interface.
 */
export interface UploadBackend {
  put(name: string, sourcePath: string): Promise<void>;
}

export function localFsBackend(destinationDir: string): UploadBackend {
  return {
    async put(name, sourcePath) {
      const dest = path.join(destinationDir, name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await fs.promises.copyFile(sourcePath, dest);
    },
  };
}

/** In-memory backend whose `failNames` fail on demand (partial upload tests). */
export function failingBackend(
  failNames: Set<string>,
  recordTo?: string[],
): UploadBackend {
  return {
    async put(name) {
      recordTo?.push(name);
      if (failNames.has(name)) {
        throw new Error(`simulated upload failure for ${name}`);
      }
    },
  };
}

/**
 * Upload all artifacts, recording progress per artifact in SQL.
 * Partial upload is the norm: successful artifacts stay uploaded and a retry
 * (same version/build) only re-sends the pending rows. A missing REQUIRED
 * artifact fails the release gate; optional artifacts never block.
 */
export async function uploadArtifacts(
  repo: VersionRepository,
  versionId: number,
  baseDir: string,
  entries: ArtifactManifestEntry[],
  backend: UploadBackend,
): Promise<UploadResult> {
  const uploaded: ArtifactManifestEntry[] = [];
  const failed: UploadResult['failed'] = [];

  for (const entry of entries) {
    const sourcePath = path.join(baseDir, entry.path);
    let bytes = 0;
    let contentHash = '';
    try {
      const stat = await fs.promises.stat(sourcePath);
      bytes = stat.size;
      contentHash = createHash('sha256')
        .update(fs.readFileSync(sourcePath))
        .digest('hex');
      repo.recordArtifact(versionId, {
        name: entry.name,
        type: entry.type,
        path: entry.path,
        required: entry.required,
        uploaded: false,
        bytes,
        contentHash,
      });
    } catch (err) {
      const error = `missing artifact: ${(err as Error).message}`;
      repo.recordArtifact(versionId, {
        name: entry.name,
        type: entry.type,
        path: entry.path,
        required: entry.required,
        uploaded: false,
        uploadError: error,
      });
      failed.push({ entry, error });
      continue;
    }

    try {
      await backend.put(entry.name, sourcePath);
      repo.recordArtifact(versionId, {
        name: entry.name,
        type: entry.type,
        path: entry.path,
        required: entry.required,
        uploaded: true,
        bytes,
        contentHash,
      });
      uploaded.push(entry);
    } catch (err) {
      const error = (err as Error).message;
      repo.recordArtifact(versionId, {
        name: entry.name,
        type: entry.type,
        path: entry.path,
        required: entry.required,
        uploaded: false,
        uploadError: error,
        bytes,
        contentHash,
      });
      failed.push({ entry, error });
    }
  }

  const requiredFailed = failed.filter((f) => f.entry.required);
  return {
    uploaded,
    failed,
    requiredSatisfied: requiredFailed.length === 0,
  };
}

/** Retry only the rows still marked pending (resumable partial upload). */
export async function retryPending(
  repo: VersionRepository,
  versionId: number,
  backend: UploadBackend,
): Promise<{ retried: number; stillFailing: number }> {
  const pending = repo.pendingArtifacts(versionId);
  let stillFailing = 0;
  for (const row of pending) {
    try {
      await backend.put(row.name, row.path);
      repo.markArtifactUploaded(row.id);
    } catch (err) {
      repo.markArtifactFailed(row.id, (err as Error).message);
      if (row.required) stillFailing++;
    }
  }
  return { retried: pending.length, stillFailing };
}
