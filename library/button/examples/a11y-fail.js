import { h } from '../../runtime/h.js';
export const meta = { name: 'a11y-fail', title: '可访问性缺陷示例', a11y: true, timeoutMs: 3000 };
export function render(api) {
  return h('button', { onClick: () => api.emit('click') }, '');
}
