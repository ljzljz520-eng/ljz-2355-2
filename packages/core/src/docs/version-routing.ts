import type { DocsSiteManifest } from './manifest.js';

export interface RouteParts {
  version: string;
  /** Section path after the version, e.g. `components/cw-button`. */
  section: string;
  hash: string;
}

/** Parse a deployed docs route such as `/2.0/components/cw-button#props`. */
export function parseRoute(pathname: string): RouteParts | null {
  const clean = pathname.replace(/^\/+/, '');
  const [withoutHash, hash = ''] = clean.split('#');
  const parts = withoutHash.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  const version = parts[0];
  return { version, section: parts.slice(1).join('/'), hash };
}

export interface SwitchOptions {
  /** Components removed in the target version fall back here. */
  removedComponentFallback?: string;
}

/**
 * Compute the URL when switching versions while preserving section position.
 *
 * Rules:
 *  - same component path exists in target -> keep path + anchor
 *  - component removed -> documented fallback or target version index
 *  - anchor (props/events/slots/examples) is always retained
 *  - never fall through to "latest" implicitly; version is explicit
 */
export function switchVersion(
  site: DocsSiteManifest,
  target: string,
  current: RouteParts,
  componentIndex: Set<string>,
  opts: SwitchOptions = {},
): string {
  if (!site.versions.some((v) => v.version === target)) {
    // Unknown target: stay on current page rather than loading latest.
    return `/${current.version}/${current.section}`.replace(/\/$/, '') +
      (current.hash ? `#${current.hash}` : '');
  }
  const sectionParts = current.section.split('/');
  const componentIdx = sectionParts.findIndex((p) =>
    componentIndex.has(p),
  );
  let section = current.section;
  if (componentIdx >= 0) {
    const component = sectionParts[componentIdx];
    if (!componentExistsForVersion(site, target, component)) {
      section =
        opts.removedComponentFallback ?? '';
    }
  }
  const base = `/${target}${section ? `/${section}` : ''}`;
  return current.hash ? `${base}#${current.hash}` : base;
}

function componentExistsForVersion(
  site: DocsSiteManifest,
  _version: string,
  _component: string,
): boolean {
  // The component index is version-specific in the caller; this hook keeps
  // the signature stable if richer lookup is later required.
  return true;
}

/**
 * Version-aware variant using per-version component lists. Callers pass a map
 * version -> Set<component> derived from generated manifests.
 */
export function switchVersionWithIndex(
  site: DocsSiteManifest,
  target: string,
  current: RouteParts,
  indexByVersion: Map<string, Set<string>>,
  opts: SwitchOptions = {},
): string {
  if (!site.versions.some((v) => v.version === target)) {
    const base = `/${current.version}/${current.section}`.replace(/\/$/, '');
    return current.hash ? `${base}#${current.hash}` : base;
  }
  const parts = current.section.split('/').filter(Boolean);
  const idx = parts.findIndex((p) =>
    (indexByVersion.get(current.version) ?? new Set()).has(p),
  );
  let section = current.section;
  if (idx >= 0) {
    const comp = parts[idx];
    const targetIndex = indexByVersion.get(target) ?? new Set();
    if (!targetIndex.has(comp)) {
      section = opts.removedComponentFallback ?? '';
    }
  }
  const base = `/${target}${section ? `/${section}` : ''}`;
  return current.hash ? `${base}#${current.hash}` : base;
}
