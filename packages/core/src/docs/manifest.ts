import fs from 'node:fs/promises';
import path from 'node:path';
import { VersionRepository } from '../db/repository.js';
import type {
  ComponentContract,
  ExampleResult,
  ReleaseContract,
} from '../types.js';
import { compareSemver } from '../reverify.js';

export interface DocsExampleEntry {
  slug: string;
  component: string;
  title: string;
  status: ExampleResult['status'];
  failureKind?: string;
  /** Only present for passed examples — production never embeds failures. */
  html?: string;
}

export interface DocsComponent {
  name: string;
  description?: string;
  props: ComponentContract['props'];
  events: ComponentContract['events'];
  slots: ComponentContract['slots'];
  examples: DocsExampleEntry[];
}

export interface DocsVersionManifest {
  packageName: string;
  version: string;
  commit: string;
  treeHash: string;
  buildCommit: string;
  status: ReleaseContract['status'];
  components: DocsComponent[];
  breakingChanges: ReleaseContract['breakingChanges'];
  deprecations: ReleaseContract['deprecations'];
}

export interface DocsSiteManifest {
  packageName: string;
  defaultVersion: string;
  versions: {
    version: string;
    status: ReleaseContract['status'];
    commit: string;
  }[];
}

export interface BuildOptions {
  draft?: boolean;
  /** Only releases whose status is in this set are eligible. */
  includeStatuses?: ReleaseContract['status'][];
}

/**
 * Build docs manifests from SQL. Production builds only read releases that
 * passed every gate; failed examples are dropped entirely (never stitched
 * into a real page). Draft builds retain them with failure placeholders.
 */
export function buildDocsData(
  dbPath: string,
  packageName: string,
  opts: BuildOptions = {},
): { site: DocsSiteManifest; perVersion: DocsVersionManifest[] } {
  const repo = new VersionRepository(dbPath);
  try {
    const eligible = new Set(
      opts.includeStatuses ?? ['complete'],
    );
    const releases = repo
      .listReleases(packageName)
      .filter((r) => eligible.has(r.status as ReleaseContract['status']))
      .map((r) => repo.getRelease(packageName, r.version)!)
      .filter(Boolean)
      .sort((a, b) => compareSemver(b.version, a.version));

    const perVersion = releases.map((r) => toVersionManifest(r, !!opts.draft));
    const site: DocsSiteManifest = {
      packageName,
      defaultVersion: perVersion[0]?.version ?? '',
      versions: perVersion.map((v) => ({
        version: v.version,
        status: v.status,
        commit: v.commit,
      })),
    };
    return { site, perVersion };
  } finally {
    repo.close();
  }
}

function toVersionManifest(
  release: ReleaseContract & { id?: number },
  draft: boolean,
): DocsVersionManifest {
  return {
    packageName: release.packageName,
    version: release.version,
    commit: release.commit,
    treeHash: release.treeHash,
    buildCommit: release.commit,
    status: release.status,
    components: release.components.map((c) => ({
      name: c.name,
      description: c.description,
      props: c.props,
      events: c.events,
      slots: c.slots,
      examples: release.examples
        .filter((e) => e.component === c.name)
        .flatMap((e) => {
          // Production: failed examples are omitted, never embedded.
          if (e.status !== 'passed' && !draft) return [];
          const entry: DocsExampleEntry = {
            slug: e.slug,
            component: e.component,
            title: e.title,
            status: e.status,
          };
          if (e.status === 'passed') entry.html = e.renderedHtml;
          else entry.failureKind = e.failure?.kind;
          return [entry];
        }),
    })),
    breakingChanges: release.breakingChanges,
    deprecations: release.deprecations,
  };
}

/**
 * Persist manifests under docsDir/.generated/<version>/. The VitePress build
 * reads these files — it never touches the component source, so a branch
 * update cannot change an already-published docs version.
 */
export async function writeDocsData(
  docsDir: string,
  data: { site: DocsSiteManifest; perVersion: DocsVersionManifest[] },
): Promise<string> {
  const outDir = path.join(docsDir, '.generated');
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, 'versions.json'),
    JSON.stringify(data.site, null, 2),
  );
  for (const v of data.perVersion) {
    const dir = path.join(outDir, v.version);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify(v, null, 2),
    );
  }
  return outDir;
}
