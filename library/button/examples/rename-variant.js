import { h } from '../../runtime/h.js';
export const meta = { name: 'rename-variant', title: 'variant 属性（原 type）', a11y: true, timeoutMs: 3000, relatedBreaking: 'button.type->variant' };
export function render(api) {
  return h('button', { class: 'ui-btn ui-btn--ghost' }, '幽灵按钮');
}
export async function play(root, api) {
  const btn = root.querySelector('button');
  api.assert(btn.className.includes('ui-btn--ghost'), 'variant class applied');
}
