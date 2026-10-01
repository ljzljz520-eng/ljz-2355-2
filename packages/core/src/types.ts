/**
 * Shared contract types.
 *
 * A contract is the single source of truth produced by ONE build (one pinned
 * commit). Props tables, event/slot tables and the interactive examples
 * embedded in docs all derive from the same {@link ComponentContract} bundle.
 */

export type EvidenceSource = 'static' | 'runtime' | 'manual';

export interface Sourced<T> {
  value: T;
  source: EvidenceSource;
  /** Human note for manual evidence; diagnostic for inferred values. */
  note?: string;
}

export interface TypeShape {
  /** Display text, e.g. `TreeNode<string>`, `'solid' | 'ghost'`. */
  text: string;
  /**
   * Structurally expanded type. Recursive references are collapsed to
   * `{ $ref: 'TreeNode<string>' }` so expansion always terminates.
   */
  expanded?: unknown;
  source: EvidenceSource;
}

export interface PropDoc {
  name: string;
  description?: Sourced<string>;
  type?: TypeShape;
  required?: Sourced<boolean>;
  default?: Sourced<unknown>;
  deprecated?: DeprecationInfo;
}

export interface EventDoc {
  name: string;
  description?: Sourced<string>;
  payloadType?: TypeShape;
}

export interface SlotDoc {
  name: string;
  description: Sourced<string>;
  required?: boolean;
}

export interface DeprecationInfo {
  since: string;
  /** Version in which the API is scheduled for removal. */
  removeIn: string;
  replacement?: string;
  note?: string;
}

export interface ComponentContract {
  name: string;
  description?: string;
  props: PropDoc[];
  events: EventDoc[];
  slots: SlotDoc[];
}

export type ExampleStatus = 'pending' | 'passed' | 'failed';

export interface A11yViolation {
  rule: string;
  message: string;
  html?: string;
}

export interface ExampleResult {
  slug: string;
  component: string;
  title: string;
  file: string;
  contentHash: string;
  status: ExampleStatus;
  /** Failure category: a11y | timeout | crash | error. */
  failure?: { kind: 'a11y' | 'timeout' | 'crash' | 'error'; message: string };
  durationMs: number;
  renderedHtml?: string;
  a11yViolations?: A11yViolation[];
}

export interface ReverifyCase {
  name: string;
  example: string;
  /** Literal or /regex/ that must appear in rendered HTML. */
  expect: string;
}

export interface MigrationNote {
  title: string;
  guide: string;
  reverify: ReverifyCase[];
}

export type ChangeKind =
  | 'prop-removed'
  | 'prop-added-required'
  | 'prop-type-changed'
  | 'prop-required-changed'
  | 'prop-renamed'
  | 'event-removed'
  | 'event-renamed'
  | 'event-payload-changed'
  | 'slot-removed';

export interface BreakingChange {
  /** Stable key, e.g. `prop-renamed:cw-button:loading->busy`. */
  key: string;
  kind: ChangeKind;
  component: string;
  path: string;
  from?: string;
  to?: string;
  message: string;
  migration?: MigrationNote;
  reverifyPassed?: boolean;
  reverifyError?: string;
}

export interface ArtifactManifestEntry {
  name: string;
  type: 'bundle' | 'types' | 'report' | 'screenshot' | 'metadata';
  path: string;
  required: boolean;
}

export type ReleaseStatus = 'complete' | 'partial' | 'blocked';

export interface ReleaseContract {
  packageName: string;
  version: string;
  commit: string;
  /** git tree-ish hash — the immutable identity of the source snapshot. */
  treeHash: string;
  branch: string;
  components: ComponentContract[];
  examples: ExampleResult[];
  breakingChanges: BreakingChange[];
  deprecations: { component: string; path: string; info: DeprecationInfo }[];
  status: ReleaseStatus;
  gates: {
    migrations: boolean;
    artifacts: boolean;
    gaps: string[];
  };
}

/**
 * Manual evidence file (evidence/<version>.json in the source tree).
 * Fields that cannot be inferred statically or at runtime (notably slots)
 * are supplemented by humans and audited here.
 */
export interface EvidenceManifest {
  version: string;
  components?: Record<
    string,
    {
      slots?: Array<{ name: string; description: string; required?: boolean }>;
      props?: Record<string, { description?: string }>;
      events?: Record<string, { description?: string }>;
    }
  >;
}
