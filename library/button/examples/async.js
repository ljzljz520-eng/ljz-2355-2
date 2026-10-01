import { h } from '../../runtime/h.js';
export const meta = { name: 'async', title: '异步加载', a11y: true, timeoutMs: 150 };
export function render(api) {
  return h('button', { id: 'async-btn' }, '提交');
}
export async function play(root, api) {
  await api.wait(2000); // intentionally slower than meta.timeoutMs
  api.assert(false, 'should not reach here');
}
