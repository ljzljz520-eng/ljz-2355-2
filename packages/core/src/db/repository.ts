import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  BreakingChange,
  ExampleResult,
  ReleaseContract,
} from '../types.js';

const schemaPath = fileURLToPath(import.meta.resolve('./schema.sql'));

export class VersionRepository {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('foreign_keys = ON');
    this.db.exec(fs.readFileSync(schemaPath, 'utf8'));
  }

  close(): void {
    this.db.close();
  }

  /** Idempotent upsert keyed by (package, version); commit must stay stable. */
  saveRelease(release: ReleaseContract, buildId: string): number {
    const existing = this.db
      .prepare(
        'SELECT id, "commit" AS "commit" FROM component_versions WHERE package_name=? AND version=?',
      )
      .get(release.packageName, release.version) as
      | { id: number; commit: string }
      | undefined;

    if (existing && existing.commit !== release.commit) {
      throw new Error(
        `Refusing to pin ${release.packageName}@${release.version}: already recorded at ${existing.commit}, refusing ${release.commit}. Bump the version instead.`,
      );
    }

    const save = this.db.transaction((): number => {
      let id: number;
      if (existing) {
        id = existing.id;
        this.db
          .prepare(
            `UPDATE component_versions SET tree_hash=?, branch=?, status=?, contract_json=? WHERE id=?`,
          )
          .run(
            release.treeHash,
            release.branch,
            release.status,
            JSON.stringify(release),
            id,
          );
        this.db.prepare('DELETE FROM test_runs WHERE version_id=?').run(id);
        this.db.prepare('DELETE FROM artifacts WHERE version_id=?').run(id);
        this.db.prepare('DELETE FROM breaking_changes WHERE version_id=?').run(id);
      } else {
        const res = this.db
          .prepare(
            `INSERT INTO component_versions
               (package_name, version, "commit", tree_hash, branch, status, contract_json)
             VALUES (?,?,?,?,?,?,?)`,
          )
          .run(
            release.packageName,
            release.version,
            release.commit,
            release.treeHash,
            release.branch,
            release.status,
            JSON.stringify(release),
          );
        id = Number(res.lastInsertRowid);
      }

      for (const name of new Set(release.components.map((c) => c.name))) {
        this.db
          .prepare('INSERT OR IGNORE INTO components(name) VALUES (?)')
          .run(name);
      }

      for (const ex of release.examples) this.insertTestRun(id, buildId, ex);
      for (const ch of release.breakingChanges) this.insertBreakingChange(id, ch);
      return id;
    });
    return save();
  }

  private insertTestRun(versionId: number, buildId: string, ex: ExampleResult): void {
    this.db
      .prepare(
        `INSERT INTO test_runs
           (version_id, build_id, slug, component, status, failure_kind,
            failure_msg, a11y_json, duration_ms, content_hash)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        versionId,
        buildId,
        ex.slug,
        ex.component,
        ex.status,
        ex.failure?.kind ?? null,
        ex.failure?.message ?? null,
        JSON.stringify(ex.a11yViolations ?? []),
        ex.durationMs,
        ex.contentHash,
      );
  }

  private insertBreakingChange(versionId: number, ch: BreakingChange): void {
    this.db
      .prepare(
        `INSERT INTO breaking_changes
           (version_id, change_key, kind, component, path,
            migration_json, reverify_passed, reverify_error)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        versionId,
        ch.key,
        ch.kind,
        ch.component,
        ch.path,
        ch.migration ? JSON.stringify(ch.migration) : null,
        ch.reverifyPassed === undefined ? null : ch.reverifyPassed ? 1 : 0,
        ch.reverifyError ?? null,
      );
  }

  recordArtifact(
    versionId: number,
    a: {
      name: string;
      type: string;
      path: string;
      required: boolean;
      uploaded: boolean;
      uploadError?: string;
      bytes?: number;
      contentHash?: string;
    },
  ): void {
    this.db
      .prepare(
        `INSERT INTO artifacts
           (version_id, name, type, path, required, uploaded, upload_error, bytes, content_hash)
         VALUES (@versionId, @name, @type, @path, @required, @uploaded, @uploadError, @bytes, @contentHash)
         ON CONFLICT(version_id, name) DO UPDATE SET
           uploaded=excluded.uploaded, upload_error=excluded.upload_error,
           bytes=excluded.bytes, content_hash=excluded.content_hash`,
      )
      .run({
        versionId,
        name: a.name,
        type: a.type,
        path: a.path,
        required: a.required ? 1 : 0,
        uploaded: a.uploaded ? 1 : 0,
        uploadError: a.uploadError ?? null,
        bytes: a.bytes ?? null,
        contentHash: a.contentHash ?? null,
      });
  }

  /** Artifacts not yet uploaded — drives resumable partial-upload retry. */
  pendingArtifacts(
    versionId: number,
  ): { id: number; name: string; path: string; required: boolean }[] {
    return this.db
      .prepare(
        `SELECT id, name, path, required FROM artifacts
         WHERE version_id=? AND uploaded=0`,
      )
      .all(versionId) as {
      id: number;
      name: string;
      path: string;
      required: boolean;
    }[];
  }

  markArtifactUploaded(id: number): void {
    this.db
      .prepare('UPDATE artifacts SET uploaded=1, upload_error=NULL WHERE id=?')
      .run(id);
  }

  markArtifactFailed(id: number, error: string): void {
    this.db
      .prepare('UPDATE artifacts SET uploaded=0, upload_error=? WHERE id=?')
      .run(error, id);
  }

  linkReleases(
    sourceVersionId: number,
    targetVersionId: number,
    relation: 'predecessor-of' | 'successor-of' | 'migrates-to',
  ): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO release_links
           (source_version_id, target_version_id, relation) VALUES (?,?,?)`,
      )
      .run(sourceVersionId, targetVersionId, relation);
  }

  getRelease(
    packageName: string,
    version: string,
  ): (ReleaseContract & { id: number }) | null {
    const row = this.db
      .prepare(
        'SELECT * FROM component_versions WHERE package_name=? AND version=?',
      )
      .get(packageName, version) as
      | { id: number; contract_json: string }
      | undefined;
    if (!row) return null;
    return { ...(JSON.parse(row.contract_json) as ReleaseContract), id: row.id };
  }

  listReleases(
    packageName: string,
  ): { id: number; version: string; commit: string; status: string }[] {
    return this.db
      .prepare(
        `SELECT id, version, "commit" AS "commit", status FROM component_versions
         WHERE package_name=? ORDER BY created_at`,
      )
      .all(packageName) as {
      id: number;
      version: string;
      commit: string;
      status: string;
    }[];
  }

  setStatus(versionId: number, status: ReleaseContract['status']): void {
    this.db
      .prepare('UPDATE component_versions SET status=? WHERE id=?')
      .run(status, versionId);
  }
}
