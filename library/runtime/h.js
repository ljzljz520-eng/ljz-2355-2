// Minimal VNode helper shared by component sources, the Node harness and the browser preview runtime.
export function h(tag, props, children) {
  return { tag, props: props || {}, children: normalize(children) };
}
function normalize(c) {
  if (c == null || c === false) return [];
  if (Array.isArray(c)) return c.flat();
  return [c];
}
