import { defineComponent, defineProps } from './component.js';
import type {
  ButtonProps,
  ButtonEvents,
  ButtonVariant,
  ButtonSize,
} from './types.js';

/** cw-button triggers actions with a single tap. */
export const CwButton = defineComponent<ButtonProps, ButtonEvents>({
  name: 'cw-button',
  description: 'Trigger an action with a single tap.',
  props: defineProps<ButtonProps>({
    variant: {
      type: String as unknown as ButtonVariant,
      required: true,
      default: 'solid',
    },
    size: { type: String as unknown as ButtonSize, default: 'md' },
    loading: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    ariaLabel: { type: String },
  }),
  emits: ['click', 'loadingChange'],
  render({ props, slots }) {
    const content = slots.default ? slots.default() : '';
    const icon = slots.icon ? slots.icon({ loading: props.loading }) : '';
    return `<button class="cw-button"${
      props.ariaLabel ? ` aria-label="${props.ariaLabel}"` : ''
    }${props.disabled ? ' disabled' : ''}>${icon}${content}</button>`;
  },
});
