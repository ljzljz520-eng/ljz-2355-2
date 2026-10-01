export * from './types.js';
export { staticExtractPackage } from './extract/static-extract.js';
export { runtimeReflectPackage } from './extract/runtime-reflect.js';
export { mergePackage, mergeComponent } from './extract/merge.js';
export { expandType } from './extract/type-expand.js';
export { runExamples, discoverExamples, DEFAULT_TIMEOUT_MS } from './examples/run-examples.js';
export { runA11yChecks } from './examples/a11y.js';
export { diffReleases, applyMigrationNotes } from './diff.js';
export type { RenamesFile } from './diff.js';
export { runReverify, validateDeprecations, compareSemver, filterActiveDeprecations } from './reverify.js';
export { VersionRepository } from './db/repository.js';
export {
  uploadArtifacts,
  retryPending,
  localFsBackend,
  failingBackend,
} from './artifacts.js';
export type { UploadBackend, UploadResult } from './artifacts.js';
export {
  buildDocsData,
  writeDocsData,
} from './docs/manifest.js';
export type { DocsSiteManifest, DocsVersionManifest } from './docs/manifest.js';
export {
  parseRoute,
  switchVersion,
  switchVersionWithIndex,
} from './docs/version-routing.js';
export { resolveRef, checkoutWorktree, removeWorktree } from './git.js';
export { scaffoldVersionedPages } from './docs/scaffold.js';
