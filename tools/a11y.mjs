// Deterministic accessibility checks shared by the Node build gate AND the
// browser preview bundle (same build). Operates on serialized HTML so both
// environments agree exactly.
//
// Rules (subset; failures gate production examples):
//  A1 interactive controls must have an accessible name
//  A2 aria-labelledby / aria-describedby must reference existing ids
//  A3 <img> must have alt
//  A4 form controls must be labelled (label[for]|aria-label|wrap)
//  A5 ids must be unique; <html> must declare lang (when html element exists)

export function parseHtml(html) {
  const voidTags = new Set(['img', 'input', 'br', 'hr', 'meta', 'link']);
  const stack = [{ tag: '#root', attrs: {}, children: [] }];
  const re = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>|<([a-zA-Z][a-zA-Z0-9-]*)((?:\s[^<>]*?)?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[2]) {
      const tag = m[2].toLowerCase();
      const attrs = parseAttrs(m[3] || '');
      const node = { tag, attrs, children: [] };
      stack[stack.length - 1].children.push(node);
      if (!voidTags.has(tag) && m[4] !== '/') stack.push(node);
    } else if (m[1]) {
      const close = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === close) { stack.length = i; break; }
    } else if (m[5] !== undefined) {
      const t = m[5];
      if (t.trim()) stack[stack.length - 1].children.push({ tag: '#text', text: t });
    }
  }
  return stack[0];
}
function parseAttrs(s) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s]+))?/g;
  let m;
  while ((m = re.exec(s))) attrs[m[1]] = m[3] ?? m[4] ?? (m[2] === undefined ? true : m[2]);
  return attrs;
}
function textOf(node) {
  if (node.tag === '#text') return node.text;
  return (node.children || []).map(textOf).join('');
}
function walk(node, fn) { fn(node); for (const c of node.children || []) walk(c, fn); }

export function checkA11y(html) {
  const root = parseHtml(html);
  const violations = [];
  const ids = new Map();
  const nodes = [];
  const interactive = new Set(['button', 'a', 'select', 'textarea']);
  walk(root, (n) => {
    nodes.push(n);
    if (n.tag !== '#text' && n.attrs.id !== undefined) ids.set(n.attrs.id, (ids.get(n.attrs.id) || 0) + 1);
  });
  for (const n of nodes) {
    if (n.tag === '#text') continue;
    const a = n.attrs;
    if ((interactive.has(n.tag) || a.role === 'button') && a.disabled !== true) {
      if (n.tag === 'a' && !a.href) continue;
      const name = (textOf(n).trim() || (a['aria-label'] || '') || '').toString();
      const labelled = a['aria-labelledby'];
      const hasName = name.length > 0 || (labelled && ids.has(labelled));
      if (!hasName) violations.push({ code: 'A1', message: `<${n.tag}> has no accessible name (text/aria-label/aria-labelledby)` });
    }
    if (n.tag === 'img' && a.alt === undefined) violations.push({ code: 'A3', message: '<img> missing alt' });
    if (n.tag === 'input' && a.type !== 'hidden') {
      const labelled = a['aria-label'] || a['aria-labelledby'] || a.title || a.id;
      if (!labelled) violations.push({ code: 'A4', message: '<input> has no associated label' });
    }
    for (const ref of ['aria-labelledby', 'aria-describedby']) {
      if (a[ref] && !ids.has(a[ref])) violations.push({ code: 'A2', message: `${ref}="${a[ref]}" references a missing id` });
    }
    if (n.tag === 'html' && !a.lang) violations.push({ code: 'A5', message: '<html> missing lang attribute' });
  }
  for (const [id, count] of ids) if (count > 1) violations.push({ code: 'A5', message: `duplicate id "${id}" x${count}` });
  return violations;
}
