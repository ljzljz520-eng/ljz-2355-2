export type ButtonVariant = 'solid' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Recursive tree node used to prove alias-recursion handling in the
 * static extractor. `children` references TreeNode itself.
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
  /** Control size. */
  size?: ButtonSize;
  /** Show a spinner instead of content. */
  loading?: boolean;
  /** Disable interaction. */
  disabled?: boolean;
  /** Accessible label used by icon-only buttons. */
  ariaLabel?: string;
}

export interface TreeProps {
  /** Recursive tree data rendered by the component. */
  data: TreeData;
  /** Show indent guides. */
  guides?: boolean;
  /** Initially expanded node values. */
  expanded?: string[];
}

export interface ButtonEvents {
  /** Fired when the button is activated. */
  click: { originalEvent: Event };
  /** Fired when loading state changes. */
  loadingChange: { loading: boolean };
}

export interface TreeEvents {
  /** Fired when a node is expanded or collapsed. */
  toggle: { value: string; expanded: boolean };
}
