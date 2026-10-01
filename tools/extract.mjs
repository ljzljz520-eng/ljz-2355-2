#!/usr/bin/env node
// Static contract extractor.
// Usage: node tools/extract.mjs <commit> <component> [--repo=dir]
// Output: contract JSON on stdout.
//
// Design choice (see docs/decisions/static-vs-runtime.md):
//  * STATIC extraction is the single source of truth for props/events/slots/types.
//  * Everything the source cannot prove (free-form VNodes, icon registries...)
//    is marked `inferred:false` and must be completed via *.manual.json ("人工补证").
import { show, ls, tryShow } from './git.mjs';

function scanTypeAliases(block) {
  // Nesting-aware: the terminating ';' must be at brace/bracket/paren/angle
  // depth 0 (object aliases themselves contain ';').
  const aliases = {};
  const re = /\/\*\*([\s\S]*?)\*\/\s*export\s+type\s+([A-Za-z0-9_]+)\s*=\s*/g;
  let m;
  while ((m = re.exec(block))) {
    let i = re.lastIndex, depth = 0, inStr = null;
    for (; i < block.length; i++) {
      const ch = block[i];
      if (inStr) { if (ch === '\\') i++; else if (ch === inStr) inStr = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
      if ('{[(<'.includes(ch)) depth++;
      else if ('}])>'.includes(ch)) depth--;
      else if (ch === ';' && depth === 0) break;
    }
    const description = m[1].split('\n').map((l) => l.replace(/^\s*\*\s?/, '')).join(' ').trim();
    aliases[m[2]] = { name: m[2], raw: block.slice(re.lastIndex, i).trim().replace(/\s+/g, ' '), description };
    re.lastIndex = i + 1;
  }
  return aliases;
}

// Resolve an alias to its referenced alias names, guarding recursion.
function resolveAlias(name, aliases, seen = new Set(), depth = 0) {
  if (seen.has(name) || depth > 50) return { recursive: true, refs: [...seen] };
  if (!aliases[name]) return { recursive: false, refs: [...seen] };
  const refs = [...aliases[name].raw.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)].map((x) => x[1]).filter((r) => aliases[r]);
  const next = new Set(seen); next.add(name);
  const recursive = refs.some((r) => next.has(r));
  for (const r of refs) {
    const sub = resolveAlias(r, aliases, new Set(next), depth + 1);
    if (sub.recursive) return { recursive: true, refs: [...new Set([...next, r, ...sub.refs])] };
  }
  return { recursive, refs: [...next] };
}

function leadingComment(src, openBrace) {
  // Find the nearest comment block ending right before the prop line start.
  const lineStart = src.lastIndexOf('\n', openBrace) + 1;
  const before = src.slice(0, lineStart);
  const m = before.match(/\/\*\*([\s\S]*?)\*\/\s*$/);
  if (!m) return '';
  return m[1].split('\n').map((l) => l.replace(/^\s*\*\s?/, '')).join('\n');
}

function splitTopEntries(objBody) {
  const entries = [];
  let depth = 0, start = 0, inStr = null;
  for (let i = 0; i < objBody.length; i++) {
    const ch = objBody[i];
    if (inStr) { if (ch === '\\') i++; else if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    if (ch === '}' || ch === ']' || ch === ')') depth--;
    if (ch === ',' && depth === 0) { entries.push(objBody.slice(start, i)); start = i + 1; }
  }
  if (start < objBody.length) entries.push(objBody.slice(start));
  return entries.map((e) => e.trim()).filter(Boolean);
}

function matchBalanced(src, openIdx, open = '{', close = '}') {
  let depth = 0, inStr = null;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (inStr) { if (ch === '\\') i++; else if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function parseTags(comment, trailing = '') {
  const text = comment + '\n' + trailing;
  const tags = {};
  const dep = text.match(/@deprecated\s+since\s+([0-9][0-9A-Za-z.\-]*)/);
  if (dep) tags.deprecated = { since: dep[1], removedIn: null, note: text.replace(/@deprecated[^\n]*/, '').trim() };
  const since = text.match(/@since\s+([0-9][0-9A-Za-z.\-]*)/);
  if (since) tags.since = since[1];
  const rename = text.match(/@rename\s+from\s+`?([A-Za-z0-9_]+)`?/);
  if (rename) tags.renamedFrom = rename[1];
  if (/@manual/.test(text)) {
    const mm = text.match(/@manual\s+since\s+([0-9][0-9A-Za-z.\-]*)\s*:?\s*(.*)/);
    tags.manual = mm ? { since: mm[1], reason: mm[2].trim() } : {};
  }
  return tags;
}

function extractProps(src) {
  const m = src.match(/props\s*:\s*\{/);
  if (!m) return {};
  const open = src.indexOf('{', m.index);
  const close = matchBalanced(src, open);
  const body = src.slice(open + 1, close);
  const props = {};
  for (const entry of splitTopEntries(body)) {
    // Entries may start with a leading JSDoc; key on the last `name:` whose
    // name is a bare identifier (e.g. not `type:` inside the descriptor).
    const names = [...entry.matchAll(/(?:^|[\s}])\*?\s*([A-Za-z0-9_]+)\s*:\s*([^:\s])/g)]
      .map((x) => x[1]).filter((n) => !['type', 'required', 'default'].includes(n));
    const name = names[0];
    if (!name) continue;
    const keyIdx = entry.search(new RegExp(`\\b${name}\\s*:`));
    const rhs = entry.slice(keyIdx + name.length + 1);
    const pm = [, name, rhs];
    // description: from a leading JSDoc inside the entry, or trailing // comment
    const comment = (entry.match(/^\s*\/\*\*([\s\S]*?)\*\//) || [, ''])[1]
      .split('\n').map((l) => l.replace(/^\s*\*\s?/, '')).join('\n');
    const descFromComment = comment.replace(/@\w+[^\n]*(\n|$)/g, '').trim();
    const trail = rhs.match(/\/\/\s*(.*)$/);
    const description = descFromComment || (trail ? trail[1].replace(/@\w+/g, '').trim() : '');
    const tags = parseTags(comment, trail ? trail[1] : '');
    // type
    let type = 'unknown';
    const tm = rhs.match(/type\s*:\s*([^,}\n]+)/);
    if (tm) {
      const t = tm[1].trim();
      if (t === 'String') type = 'string';
      else if (t === 'Boolean') type = 'boolean';
      else if (t === 'Number') type = 'number';
      else if (/^\[/.test(t)) type = 'union';
      else type = t;
    }
    let required = /required\s*:\s*true/.test(rhs);
    let def = null;
    const dm = rhs.match(/default\s*:\s*([^,}\n]+)/);
    if (dm) def = dm[1].trim();
    props[name] = {
      name: name, type, required, default: def,
      description, inferred: !tags.manual,
      ...tags,
    };
  }
  return props;
}

function extractEmits(src) {
  const m = src.match(/emits\s*:\s*\[([\s\S]*?)\]/);
  const events = {};
  if (!m) return events;
  // gather /** ... */ 'name' pairs
  const re = /\/\*\*([\s\S]*?)\*\/\s*'([A-Za-z0-9_:-]+)'/g;
  let x;
  while ((x = re.exec(m[1]))) {
    events[x[2]] = { name: x[2], description: x[1].split('\n').map((l) => l.replace(/^\s*\*\s?/, '')).join(' ').trim(), inferred: true };
  }
  for (const s of m[1].matchAll(/'([A-Za-z0-9_:-]+)'/g)) {
    if (!events[s[1]]) events[s[1]] = { name: s[1], description: '', inferred: true };
  }
  return events;
}

function extractSlots(src) {
  const slots = {};
  const re = /@slot\s+([A-Za-z0-9_]+)\s*-\s*([^\n]*)/g;
  let m;
  while ((m = re.exec(src))) {
    const line = m[2];
    const tags = parseTags('', line);
    slots[m[1]] = { name: m[1] === 'default' ? 'default' : m[1], description: line.replace(/@\w+[^\n]*/g, '').trim(), inferred: !tags.manual, ...tags };
  }
  return slots;
}

export function extract(commit, component, repo) {
  const dir = `library/${component.toLowerCase()}`;
  const src = show(commit, `${dir}/index.js`, repo);
  const aliasBlock = (src.match(/typeAliases\s*=\s*`([\s\S]*?)`/) || [])[1] || '';
  const aliases = scanTypeAliases(aliasBlock);
  for (const a of Object.values(aliases)) {
    const r = resolveAlias(a.name, aliases);
    a.recursive = r.recursive;
    a.refs = r.refs.filter((x) => x !== a.name);
  }
  const props = extractProps(src);
  const events = extractEmits(src);
  const slots = extractSlots(src);

  const manualRaw = tryShow(commit, `${dir}/${component.toLowerCase()}.manual.json`, repo);
  const manual = manualRaw ? JSON.parse(manualRaw) : {};
  const evidence = [];
  function applyManual(kind, collection) {
    for (const [name, add] of Object.entries(manual[kind] || {})) {
      if (collection[name]) {
        Object.assign(collection[name], add, { inferred: false, evidence: 'manual' });
        evidence.push({ kind, name, since: add.since, reason: add.reason });
      } else {
        evidence.push({ kind, name, error: 'manual evidence references a missing contract entry' });
      }
    }
  }
  applyManual('props', props); applyManual('events', events); applyManual('slots', slots);

  // examples for THIS commit only
  const exampleFiles = ls(commit, `${dir}/examples`, repo).filter((f) => f.endsWith('.js'));
  const examples = exampleFiles.map((f) => {
    const code = show(commit, f, repo);
    const meta = {};
    const mm = code.match(/export\s+const\s+meta\s*=\s*\{([\s\S]*?)\};/);
    if (mm) {
      meta.name = (mm[1].match(/name:\s*'([^']+)'/) || [])[1];
      meta.title = (mm[1].match(/title:\s*'([^']+)'/) || [])[1];
      meta.a11y = /a11y:\s*true/.test(mm[1]);
      const to = mm[1].match(/timeoutMs:\s*(\d+)/);
      meta.timeoutMs = to ? Number(to[1]) : 3000;
      const rb = mm[1].match(/relatedBreaking:\s*'([^']+)'/);
      if (rb) meta.relatedBreaking = rb[1];
    }
    return { file: f.split('/').pop(), hasRender: /export\s+function\s+render/.test(code), hasPlay: /export\s+async\s+function\s+play/.test(code), ...meta };
  });

  // Any prop whose SOURCE entry carries an inline `// @manual` marker MUST end
  // up inferred:false via *.manual.json. If the evidence file omitted it, the
  // hard build gate fails (人工补证不得悬空). We scan the parsed props block and
  // match markers to entries, instead of re-searching the whole file.
  const manualMarked = new Set();
  {
    const pm = src.match(/props\s*:\s*\{/);
    const open = src.indexOf('{', pm.index);
    const close = matchBalanced(src, open);
    for (const entry of splitTopEntries(src.slice(open + 1, close))) {
      const mm = entry.match(/^\/\*\*[\s\S]*?\*\/\s*([A-Za-z0-9_]+)\s*:/) || entry.match(/\b([A-Za-z0-9_]+)\s*:\s*\{/);
      if (mm && /@manual/.test(entry)) manualMarked.add(mm[1]);
    }
  }
  const missingEvidence = [];
  for (const name of manualMarked) {
    const p = props[name];
    if (!p || p.inferred) missingEvidence.push({ kind: 'props', name });
  }
  for (const [name, s] of Object.entries(slots)) {
    if (s.manual && s.inferred) missingEvidence.push({ kind: 'slots', name });
  }

  return {
    schema: 'component-contract/v1',
    component: component[0].toUpperCase() + component.slice(1),
    commit,
    extractedAt: new Date().toISOString(),
    props: Object.fromEntries(Object.entries(props).sort()),
    events, slots,
    types: aliases,
    examples,
    manualEvidence: evidence,
    missingEvidence,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [commit, component] = process.argv.slice(2);
  if (!commit || !component) { console.error('usage: extract.mjs <commit> <component>'); process.exit(2); }
  process.stdout.write(JSON.stringify(extract(commit, component), null, 2));
}
