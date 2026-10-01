export type ButtonVariant = 'solid' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Recursive tree node. The extractor must collapse TreeNode references to
 * $ref rather than loop forever.
 */
export interface TreeNode<T> {
  value: T;
  label: string;
  children?: TreeNode<T>[];
  expanded?: boolean;
}

export type TreeData = TreeNode<string>[];

export interface ButtonProps {
  /** Visual style of the button. */
  variant: ButtonVariant;
  /**
   * Control size.
   * @deprecated since=2.0.0 removeIn=3.0.0 Prefer density settings on the parent container.
   */
  size?: ButtonSize;
  /** Disable interaction. */
  disabled?: boolean;
  /** Accessible label used by icon-only buttons. */
  ariaLabel?: string;
  /** Async busy state (replaces `loading`); carries pending progress. */
  busy?: { pending: boolean; progress?: number };
}

export interface TreeProps {
  /** Recursive tree data rendered by the component. */
  data: TreeData;
  /** Initially expanded node values (renamed from `expanded`). */
  initiallyExpanded?: string[];
}

export interface ButtonEvents {
  /** Fired when the button is activated. */
  click: { originalEvent: Event };
  /** Fired when busy state changes. Renamed from `loadingChange`. */
  busyChange: { busy: boolean };
}

export interface TreeEvents {
  /** Fired when a node is expanded or collapsed. */
  toggle: { value: string; expanded: boolean };
}
