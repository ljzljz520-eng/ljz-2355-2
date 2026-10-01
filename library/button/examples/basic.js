import { h } from '../../runtime/h.js';
export const meta = { name: 'basic', title: '基础按钮', a11y: true, timeoutMs: 3000 };
export function render(api) {
  return h('button', { class: 'ui-btn ui-btn--primary', onClick: () => api.emit('click', 1) }, '保存');
}
export async function play(root, api) {
  const btn = root.querySelector('button');
  api.fire.click(btn);
  await api.wait(50);
  api.assert(btn.textContent.includes('保存'), 'slot content rendered');
}
