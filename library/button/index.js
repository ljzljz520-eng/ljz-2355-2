// Button component source (v3).
// BREAKING(3.0.0): deprecated `label` prop removed; default slot is the only content API.
import { h } from '../runtime/h.js';

export const typeAliases = `
/** Button visual size. */
export type ButtonSize = 'sm' | 'md' | 'lg';
/** Recursive tree of rich content nodes. */
export type RichNode = { text?: string; child?: RichNode };
/** Deeply recursive event payload; exercises recursive alias resolution. */
export type ClickTrace = { at: number; next?: ClickTrace };
`;

export const Button = {
  name: 'Button',
  props: {
    /** Visual style of the button. */
    variant: { type: String, default: 'default' }, // 'default' | 'primary' | 'ghost'
    /** Show a loading spinner and block interaction. @since 2.0.0. */
    loading: { type: Boolean, default: false },
    /** Disabled state. */
    disabled: { type: Boolean, default: false },
    // @manual since 1.0.0: describe allowed icon names in docs
    icon: { type: [String, Object], default: null },
  },
  emits: [
    /** Fired when the button is activated; payload is a recursive ClickTrace. */
    'click',
  ],
  render() {
    return h('button', {
      class: ['ui-btn', `ui-btn--${this.variant}`, { 'is-loading': this.loading, 'is-disabled': this.disabled }],
      disabled: this.disabled || this.loading,
      'aria-busy': this.loading ? 'true' : undefined,
      onClick: (e) => { if (!this.loading) this.$emit('click', e, { at: Date.now() }); },
    }, [this.$slots.icon ? h('span', { class: 'ui-btn__icon' }, [this.$slots.icon()]) : null, ...this.$slots.default()]);
  },
};

/**
 * @slot default - Button content (required since 3.0.0; the label prop was removed).
 * @slot icon - Optional leading icon. @manual since 1.0.0: allowed icon set is owned by the icon pack, not this component.
 */
export const __slots = ['default', 'icon'];
