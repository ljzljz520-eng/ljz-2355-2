import { h } from '../../runtime/h.js';
export const meta = { name: 'loading', title: '加载态插槽内容', a11y: true, timeoutMs: 3000, slots: ['default'], relatedBreaking: 'button.label-removed' };
export function render(api) {
  return h('button', { class: 'ui-btn', 'aria-busy': 'true', disabled: true }, h('span', { class: 'ui-btn__label' }, '处理中…'));
}
export async function play(root, api) {
  const btn = root.querySelector('button');
  api.assert(btn.getAttribute('aria-busy') === 'true', 'aria-busy exposed');
  api.assert(btn.disabled === true, 'interaction blocked while loading');
}
