import type {
  BreakingChange,
  DeprecationInfo,
  ExampleResult,
  ReleaseContract,
} from './types.js';

/**
 * Run the reverify cases attached to migration notes. A reverify case points
 * at an example from the SAME build and asserts that its rendered output
 * matches a literal or /regex/. This proves the documented migration path
 * actually works on the released artifacts.
 */
export function runReverify(
  changes: BreakingChange[],
  examples: ExampleResult[],
): BreakingChange[] {
  const bySlug = new Map(
    examples.map((e) => [`${e.component}/${e.slug}`, e]),
  );
  return changes.map((change) => {
    if (!change.migration) return change;
    const cases = change.migration.reverify ?? [];
    for (const c of cases) {
      const example = bySlug.get(c.example);
      if (!example) {
        return {
          ...change,
          reverifyPassed: false,
          reverifyError: `reverify example not found: ${c.example}`,
        };
      }
      if (example.status !== 'passed') {
        return {
          ...change,
          reverifyPassed: false,
          reverifyError: `reverify example ${c.example} did not pass (${example.failure?.kind})`,
        };
      }
      const html = example.renderedHtml ?? '';
      const matched = c.expect.startsWith('/') && c.expect.endsWith('/')
        ? new RegExp(c.expect.slice(1, -1)).test(html)
        : html.includes(c.expect);
      if (!matched) {
        return {
          ...change,
          reverifyPassed: false,
          reverifyError: `reverify case "${c.name}" expected ${c.expect}`,
        };
      }
    }
    return { ...change, reverifyPassed: true };
  });
}

/**
 * Validate deprecation declarations against the set of versions that actually
 * exist. Deprecation scope must be declared per real version — a since/removeIn
 * pointing at an unknown version, or removeIn <= since, is rejected.
 */
export function validateDeprecations(
  deprecations: ReleaseContract['deprecations'],
  knownVersions: string[],
  releaseVersion: string,
): string[] {
  const errors: string[] = [];
  const known = new Set([...knownVersions, releaseVersion]);
  for (const { component, path, info } of deprecations) {
    const where = `${component}:${path}`;
    if (!info.since || !known.has(info.since)) {
      errors.push(`${where}: deprecation since="${info.since}" is not a known version`);
    }
    if (!info.removeIn) {
      errors.push(`${where}: deprecation must declare removeIn`);
    } else if (compareSemver(info.removeIn, info.since) <= 0) {
      errors.push(`${where}: removeIn ${info.removeIn} must be after since ${info.since}`);
    }
    if (
      info.removeIn &&
      !known.has(info.removeIn) &&
      // A future removal version is allowed; it must at least parse as semver.
      !SEMVER_RE.test(info.removeIn)
    ) {
      errors.push(`${where}: removeIn "${info.removeIn}" is not a valid version`);
    }
  }
  return errors;
}

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function compareSemver(a: string, b: string): number {
  const pa = a.split('-')[0].split('.').map(Number);
  const pb = b.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export function filterActiveDeprecations(
  all: ReleaseContract['deprecations'],
  version: string,
): ReleaseContract['deprecations'] {
  // Only show deprecations that were actually in effect at this version.
  return all.filter(
    ({ info }) =>
      compareSemver(version, info.since) >= 0 &&
      compareSemver(version, info.removeIn) < 0,
  );
}

export type { DeprecationInfo };
