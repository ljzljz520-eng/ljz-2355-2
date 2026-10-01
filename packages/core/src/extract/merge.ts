import type {
  ComponentContract,
  EvidenceManifest,
  PropDoc,
  SlotDoc,
  TypeShape,
} from '../types.js';
import type { StaticExtraction } from './static-extract.js';
import type { RuntimeComponent } from './runtime-reflect.js';

type ComponentEvidence =
  | NonNullable<EvidenceManifest['components']>[string]
  | undefined;

export interface MergeOutcome {
  contract: ComponentContract;
  /** Fields that no automated source could provide. Must be covered manually. */
  gaps: string[];
  /** Slot names seen in code but not described in evidence. */
  undescribedSlots: string[];
}

export interface MergeReport {
  components: MergeOutcome[];
  gaps: string[];
}

/**
 * Merge the three evidence sources for one component.
 *
 * Provenance rules:
 *  - structural type information: static only (runtime types are coarse).
 *  - default values: runtime wins when static analysis could not evaluate
 *    the expression (factories, non-literal defaults).
 *  - descriptions / slots: manual evidence is authoritative; static JSDoc
 *    fills in automatically.
 *  - static/runtime disagreement on required/default is recorded as a gap
 *    for human adjudication rather than silently taking one side.
 */
export function mergeComponent(
  extraction: StaticExtraction,
  runtime: RuntimeComponent | undefined,
  evidence: ComponentEvidence,
): MergeOutcome {
  const c = extraction.component;
  const gaps: string[] = [];
  const rtProps = new Map(runtime?.props.map((p) => [p.name, p]));

  const props = c.props.map((p) => {
    const out: PropDoc = { ...p };
    const evProp = evidence?.props?.[p.name];
    if (evProp?.description) {
      out.description = { value: evProp.description, source: 'manual' };
    } else if (!out.description) {
      gaps.push(`${c.name}:props.${p.name}.description`);
    }

    const rt = rtProps.get(p.name);
    if (rt) {
      // Runtime evaluates defaults that static analysis cannot.
      if (
        rt.hasDefault &&
        (out.default === undefined ||
          (out.default.source === 'static' &&
            rt.defaultValue !== undefined &&
            out.default.value === undefined))
      ) {
        out.default = {
          value: rt.defaultValue,
          source: 'runtime',
          note:
            out.default?.source === 'static'
              ? 'static default unevaluable; runtime value used'
              : undefined,
        };
      }
      // Disagreement on requiredness -> human adjudication.
      if (out.required && out.required.value !== rt.required) {
        gaps.push(
          `${c.name}:props.${p.name}.required (static=${out.required.value} runtime=${rt.required})`,
        );
      }
    }
    return out;
  });

  const events = c.events.map((ev) => {
    const evEvent = evidence?.events?.[ev.name];
    const out = { ...ev };
    if (evEvent?.description) {
      out.description = { value: evEvent.description, source: 'manual' };
    } else if (!out.description) {
      gaps.push(`${c.name}:events.${ev.name}.description`);
    }
    return out;
  });

  // Runtime emits must include every typed event and vice versa.
  const staticEventNames = new Set(events.map((e) => e.name));
  for (const declared of extraction.declaredEmits) {
    if (!staticEventNames.has(declared)) {
      gaps.push(`${c.name}:events.${declared} (declared at runtime, missing type)`);
    }
  }
  for (const ev of events) {
    if (!extraction.declaredEmits.includes(ev.name)) {
      gaps.push(`${c.name}:events.${ev.name} (typed but not in runtime emits)`);
    }
  }

  // Slots: cannot be inferred. Manual evidence is required for every slot
  // candidate found in the component source.
  const described = new Set<string>();
  const slots: SlotDoc[] = (evidence?.slots ?? []).map((s) => {
    described.add(s.name);
    return {
      name: s.name,
      description: { value: s.description, source: 'manual' as const },
      required: s.required,
    };
  });
  const undescribedSlots = extraction.slotCandidates.filter(
    (name) => !described.has(name),
  );
  for (const name of undescribedSlots) {
    gaps.push(`${c.name}:slots.${name}`);
  }

  return {
    contract: {
      name: c.name,
      description: c.description,
      props,
      events,
      slots,
    },
    gaps,
    undescribedSlots,
  };
}

export function mergePackage(
  extractions: StaticExtraction[],
  runtime: RuntimeComponent[],
  evidence: EvidenceManifest | undefined,
): MergeReport {
  const components = extractions.map((ex) =>
    mergeComponent(
      ex,
      runtime.find((r) => r.name === ex.component.name),
      evidence?.components?.[ex.component.name],
    ),
  );
  return {
    components,
    gaps: components.flatMap((c) => c.gaps),
  };
}

export function provenanceOf(type: TypeShape | undefined): string {
  return type?.source ?? 'unknown';
}
