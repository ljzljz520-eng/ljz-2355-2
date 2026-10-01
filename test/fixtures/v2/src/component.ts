/**
 * Tiny component descriptor used by the sample component library.
 * The platform's static extractor parses the generic type arguments; runtime
 * reflection reads `__props`/`emits` from the imported module.
 */
export interface PropSpec {
  type?: unknown;
  required?: boolean;
  default?: unknown;
}

export interface ComponentDescriptor<Props extends Record<string, unknown>, Events> {
  name: string;
  description?: string;
  props: Record<keyof Props, PropSpec>;
  emits: (keyof Events & string)[];
  render?: (ctx: {
    props: Props;
    slots: Record<string, (p?: unknown) => string>;
  }) => string;
}

export function defineProps<T extends Record<string, unknown>>(
  config: Partial<Record<keyof T, PropSpec>>,
): Partial<Record<keyof T, PropSpec>> {
  return config;
}

export function defineComponent<
  Props extends Record<string, unknown>,
  Events = Record<string, never>,
>(d: ComponentDescriptor<Props, Events>): ComponentDescriptor<Props, Events> & {
  __props: Record<string, PropSpec>;
} {
  return { ...d, __props: d.props as Record<string, PropSpec> };
}
