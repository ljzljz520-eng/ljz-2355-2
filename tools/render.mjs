// Serialize a VNode tree (tools/runtime/h.js shape) to an HTML string.
// Shared by the Node gate and the browser preview runtime.
export function renderToHtml(node) {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return escape(String(node));
  if (Array.isArray(node)) return node.map(renderToHtml).join('');
  const { tag, props = {}, children = [] } = node;
  const attrs = [];
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on') || k === 'ref') continue;
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class' && Array.isArray(v)) {
      const cls = v.flatMap((x) => typeof x === 'object' ? Object.entries(x).filter(([, on]) => on).map(([c]) => c) : [x]).join(' ');
      if (cls) attrs.push(`class="${escape(cls)}"`);
      continue;
    }
    if (v === true) attrs.push(k);
    else attrs.push(`${k}="${escape(String(v))}"`);
  }
  return `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>${children.map(renderToHtml).join('')}</${tag}>`;
}
function escape(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// Build a tiny element-like wrapper around a VNode so example play() code can
// use querySelector/textContent/getAttribute/disabled like a real DOM.
export function buildFakeDom(vnode) {
  const all = [];
  function wrap(n, parent) {
    if (!n || typeof n !== 'object') return null;
    const el = {
      tag: (n.tag || '').toUpperCase(), __vn: n, parentNode: parent,
      get textContent() { return textV(n); },
      get className() { return n.props?.class ? flatClass(n.props.class).join(' ') : ''; },
      getAttribute(k) { const v = n.props?.[k]; return v === undefined || v === null ? null : String(v); },
      hasAttribute(k) { return n.props?.[k] !== undefined; },
      get disabled() { return n.props?.disabled === true; },
      querySelector, querySelectorAll,
    };
    all.push(el);
    el.childElements = (n.children || []).map((c) => wrap(c, el)).filter(Boolean);
    return el;
  }
  function textV(n) {
    if (typeof n === 'string' || typeof n === 'number') return String(n);
    return (n.children || []).map(textV).join('');
  }
  function flatClass(c) {
    if (Array.isArray(c)) return c.flatMap((x) => typeof x === 'object' ? Object.entries(x).filter(([, on]) => on).map(([z]) => z) : [x]);
    return [c];
  }
  function matches(el, sel) {
    const m = sel.match(/^([a-z0-9]+)?(?:#([\w-]+))?(?:\[([^\]=]+)(?:=["']?([^\]"']+)["']?)?\])?$/i);
    if (!m) return false;
    if (m[1] && el.tag !== m[1].toUpperCase()) return false;
    if (m[2] && el.getAttribute('id') !== m[2]) return false;
    if (m[3] && !el.hasAttribute(m[3])) return false;
    if (m[3] && m[4] !== undefined && el.getAttribute(m[3]) !== m[4]) return false;
    return true;
  }
  function querySelectorAll(sel) { return all.filter((e) => matches(e, sel)); }
  function querySelector(sel) { return all.find((e) => matches(e, sel)) || null; }
  const root = wrap(vnode, null);
  return { root, querySelector, querySelectorAll,
    fire: {
      click(el) { const vn = el?.__vn; const fn = vn?.props?.onClick; if (fn) fn({ type: 'click', target: el }); },
    } };
}
