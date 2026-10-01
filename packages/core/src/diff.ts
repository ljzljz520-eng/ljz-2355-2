import type {
  BreakingChange,
  ComponentContract,
  MigrationNote,
} from './types.js';

export interface RenamesFile {
  /** key: `${component}:${oldName} -> newName` */
  renames?: Record<string, string>;
}

/**
 * Diff two consecutive component builds and classify breaking changes.
 *
 * Heuristic rename detection: a removed prop + an added prop whose type text
 * is identical is treated as a probable rename. An explicit renames map from
 * migrations/vX.json overrides the heuristic (and is required when types also
 * change, e.g. boolean -> object during a rename).
 */
export function diffReleases(
  before: ComponentContract[],
  after: ComponentContract[],
  renames: RenamesFile = {},
): BreakingChange[] {
  const changes: BreakingChange[] = [];
  const beforeMap = new Map(before.map((c) => [c.name, c]));

  for (const next of after) {
    const prev = beforeMap.get(next.name);
    if (!prev) continue; // brand-new component is not breaking

    const renameMap = new Map<string, string>();
    for (const [key, to] of Object.entries(renames.renames ?? {})) {
      const [component, from] = key.split(':');
      if (component === next.name) renameMap.set(from, to);
    }

    const prevProps = new Map(prev.props.map((p) => [p.name, p]));
    const nextProps = new Map(next.props.map((p) => [p.name, p]));
    const consumedNext = new Set<string>();

    // Explicit renames first.
    for (const [from, to] of renameMap) {
      const p = prevProps.get(from);
      const n = nextProps.get(to);
      if (p && n) {
        consumedNext.add(to);
        changes.push({
          key: `prop-renamed:${next.name}:${from}->${to}`,
          kind: 'prop-renamed',
          component: next.name,
          path: from,
          from,
          to,
          message: `Prop "${from}" renamed to "${to}"`,
        });
      }
    }

    for (const p of prev.props) {
      if (nextProps.has(p.name)) {
        const n = nextProps.get(p.name)!;
        if (
          p.type &&
          n.type &&
          normalize(p.type.text) !== normalize(n.type.text)
        ) {
          changes.push({
            key: `prop-type-changed:${next.name}:${p.name}`,
            kind: 'prop-type-changed',
            component: next.name,
            path: p.name,
            from: p.type.text,
            to: n.type.text,
            message: `Prop "${p.name}" type changed: ${p.type.text} -> ${n.type.text}`,
          });
        }
        if (!p.required?.value && n.required?.value) {
          changes.push({
            key: `prop-required-changed:${next.name}:${p.name}`,
            kind: 'prop-required-changed',
            component: next.name,
            path: p.name,
            message: `Prop "${p.name}" is now required`,
          });
        }
        continue;
      }
      if ([...renameMap.keys()].includes(p.name)) continue;
      // Heuristic: removed prop with a type-identical added prop.
      const candidate = next.props.find(
        (n) =>
          !consumedNext.has(n.name) &&
          ![...renameMap.values()].includes(n.name) &&
          n.type?.text === p.type?.text,
      );
      if (candidate) {
        consumedNext.add(candidate.name);
        changes.push({
          key: `prop-renamed:${next.name}:${p.name}->${candidate.name}`,
          kind: 'prop-renamed',
          component: next.name,
          path: p.name,
          from: p.name,
          to: candidate.name,
          message: `Prop "${p.name}" likely renamed to "${candidate.name}" (same type)`,
        });
      } else {
        changes.push({
          key: `prop-removed:${next.name}:${p.name}`,
          kind: 'prop-removed',
          component: next.name,
          path: p.name,
          message: `Prop "${p.name}" was removed`,
        });
      }
    }

    for (const n of next.props) {
      if (consumedNext.has(n.name)) continue;
      if (prevProps.has(n.name)) continue;
      if ([...renameMap.values()].includes(n.name)) continue;
      if (n.required?.value) {
        changes.push({
          key: `prop-added-required:${next.name}:${n.name}`,
          kind: 'prop-added-required',
          component: next.name,
          path: n.name,
          message: `New required prop "${n.name}" added`,
        });
      }
    }

    // Events
    const prevEvents = new Map(prev.events.map((e) => [e.name, e]));
    const nextEvents = new Map(next.events.map((e) => [e.name, e]));
    const eventRenames = new Map<string, string>();
    for (const e of prev.events) {
      if (nextEvents.has(e.name)) {
        const n = nextEvents.get(e.name)!;
        if (
          e.payloadType?.text &&
          n.payloadType?.text &&
          normalize(e.payloadType.text) !== normalize(n.payloadType.text)
        ) {
          changes.push({
            key: `event-payload-changed:${next.name}:${e.name}`,
            kind: 'event-payload-changed',
            component: next.name,
            path: e.name,
            from: e.payloadType.text,
            to: n.payloadType.text,
            message: `Event "${e.name}" payload changed`,
          });
        }
        continue;
      }
      // event rename heuristic: prefer identical payload; otherwise fall back
      // to a high-similarity name match (handles simultaneous payload change,
      // e.g. loadingChange {loading} -> busyChange {busy}, shared "Change").
      const addedEvents = next.events.filter((x) => !prevEvents.has(x.name));
      const consumedEvent = new Set<string>();
      let candidate = addedEvents.find(
        (x) =>
          x.payloadType?.text === e.payloadType?.text ||
          (e.payloadType &&
            sharedCoreName(e.name, x.name) &&
            payloadStructurallyClose(e.payloadType?.text, x.payloadType?.text)),
      );
      if (candidate && consumedEvent.has(candidate.name)) candidate = undefined;
      if (candidate) {
        consumedEvent.add(candidate.name);
        eventRenames.set(e.name, candidate.name);
        changes.push({
          key: `event-renamed:${next.name}:${e.name}->${candidate.name}`,
          kind: 'event-renamed',
          component: next.name,
          path: e.name,
          from: e.name,
          to: candidate.name,
          message: `Event "${e.name}" renamed to "${candidate.name}"`,
        });
      } else {
        changes.push({
          key: `event-removed:${next.name}:${e.name}`,
          kind: 'event-removed',
          component: next.name,
          path: e.name,
          message: `Event "${e.name}" was removed`,
        });
      }
    }

    // Slots removed
    const nextSlots = new Set(next.slots.map((s) => s.name));
    for (const s of prev.slots) {
      if (!nextSlots.has(s.name)) {
        changes.push({
          key: `slot-removed:${next.name}:${s.name}`,
          kind: 'slot-removed',
          component: next.name,
          path: s.name,
          message: `Slot "${s.name}" was removed`,
        });
      }
    }
  }
  return changes;
}

function normalize(t: string): string {
  return t.replace(/\s+/g, '').trim();
}

/** Split camelCase / kebab into lower-case tokens. */
function tokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** True when two identifiers share a meaningful token stem (e.g. *Change). */
function sharedCoreName(a: string, b: string): boolean {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  for (const t of ta) if (t.length >= 3 && tb.has(t)) return true;
  return false;
}

/** Very rough structural proximity for payload text (same object field count). */
function payloadStructurallyClose(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const fields = (s: string): Set<string> =>
    new Set((s.match(/[A-Za-z_][\w]*(?=\s*[?:])/g) ?? []));
  const fa = fields(a);
  const fb = fields(b);
  if (fa.size === 0 || fb.size === 0) return false;
  let common = 0;
  for (const f of fa) if (fb.has(f)) common++;
  // Renamed one-field payloads ({loading} -> {busy}) have no shared field but
  // identical arity; accept same arity when the event names share a stem.
  return common > 0 || (fa.size === fb.size && fa.size <= 2);
}

export function applyMigrationNotes(
  changes: BreakingChange[],
  migrations: Record<string, MigrationNote>,
): { changes: BreakingChange[]; missing: string[] } {
  const missing: string[] = [];
  const out = changes.map((c) => {
    const note = migrations[c.key] ?? migrations[`${c.kind}:${c.component}:${c.path}`];
    if (!note) {
      missing.push(c.key);
      return c;
    }
    return { ...c, migration: note };
  });
  return { changes: out, missing };
}
