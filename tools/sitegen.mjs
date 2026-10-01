#!/usr/bin/env node
// Dependency-free static site generator.
//
// It renders the SAME data a standard VitePress build would consume
// (docs/**/index.md + docs/.vitepress are also emitted for `vitepress build`
// when the npm registry is available). Offline, this generator produces a
// fully working site under dist/ so acceptance tests need no network.
//
// Invariants enforced here:
//  * page URL embeds component + VERSION; each page only renders that version's
//    pinned build (old docs can never load the newest component);
//  * section anchors are STABLE ACROSS versions (#props/#events/#slots/#examples)
//    so the version switcher can preserve the reader's location;
//  * only uploaded+passed examples are embedded (the API already filters them);
//  * any iframe/load failure is contained by an error boundary.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[3] || 'dist';
const dataUrl = process.argv[2] || 'http://127.0.0.1:4173/api/site-data';
const previewOrigin = process.argv[4] || 'http://127.0.0.1:4174';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (s) => s.toLowerCase();

function propTable(props) {
  if (!props.length) return '<p class="empty">（该版本无属性）</p>';
  return `<table class="vp-table">
<thead><tr><th>名称</th><th>类型</th><th>必填</th><th>默认值</th><th>说明</th><th>来源</th></tr></thead><tbody>
${props.map((p) => `<tr${p.deprecated ? ' class="deprecated"' : ''}>
<td><code>${esc(p.name)}</code>${p.deprecated ? `<span class="tag tag-dep">deprecated ${esc(p.deprecated.since)}</span>` : ''}${p.renamedFrom ? `<span class="tag tag-break">renamed from <code>${esc(p.renamedFrom)}</code></span>` : ''}</td>
<td><code>${esc(p.type)}</code></td>
<td>${p.required ? '是' : '否'}</td>
<td>${p.default == null ? '<span class="dim">—</span>' : `<code>${esc(p.default)}</code>`}</td>
<td>${esc(p.description || '')}${p.deprecated?.note ? `<div class="dim">${esc(p.deprecated.note)}</div>` : ''}</td>
<td>${p.inferred ? `<span title="静态提取">static</span>` : `<span class="tag tag-manual" title="无法自动推断，已人工补证">manual</span>`}</td>
</tr>`).join('\n')}
</tbody></table>`;
}
function eventTable(events) {
  if (!events.length) return '<p class="empty">（无事件）</p>';
  return `<table class="vp-table"><thead><tr><th>事件</th><th>说明</th></tr></thead><tbody>
${events.map((e) => `<tr><td><code>${esc(e.name)}</code></td><td>${esc(e.description)}</td></tr>`).join('\n')}</tbody></table>`;
}
function slotTable(slots) {
  if (!slots.length) return '<p class="empty">（无插槽）</p>';
  return `<table class="vp-table"><thead><tr><th>插槽</th><th>说明</th><th>来源</th></tr></thead><tbody>
${slots.map((s) => `<tr><td><code>${esc(s.name)}</code></td><td>${esc(s.description)}</td><td>${s.inferred ? 'static' : '<span class="tag tag-manual">manual</span>'}</td></tr>`).join('\n')}</tbody></table>`;
}
function typeList(types) {
  if (!types.length) return '';
  return `<ul class="types">${types.map((t) => `<li><code>${esc(t.name)}</code> = <code>${esc(t.raw)}</code>${t.recursive ? '<span class="tag tag-rec">递归别名（已展开保护）</span>' : ''} <span class="dim">${esc(t.description)}</span></li>`).join('')}</ul>`;
}

function exampleBlock(ex, previewOrigin) {
  // The iframe points ONLY at content-addressed artifacts that uploaded and
  // passed. sandbox without allow-same-origin => opaque origin, no storage,
  // no access to the parent document/cookies.
  return `<div class="demo" data-example="${esc(ex.name)}">
  <h4>${esc(ex.name)}</h4>
  <div class="demo-frame" id="frame-wrap-${esc(ex.name)}">
    <iframe title="示例预览 ${esc(ex.name)}" loading="lazy"
      sandbox="allow-scripts"
      csp="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"
      src="${previewOrigin}/preview/${ex.hash}"></iframe>
  </div>
  <p class="demo-meta">门控事件：<code>${esc(JSON.stringify(ex.events))}</code> · ${ex.durationMs}ms</p>
</div>`;
}

function migrationSection(v) {
  if (!v.migration) return '';
  return `<section id="migration"><h2>迁移说明</h2><pre class="md">${esc(v.migration.body)}</pre><p class="dim">迁移文档锁定提交 <code>${esc(v.migration.commit_sha)}</code></p></section>`;
}

function deprecationBanner(v) {
  return v.deprecations.length ? `<div class="banner">本版本存在弃用：${v.deprecations.map((d) => `<code>${esc(d.subjectName)}</code>（${esc(d.since_version)}${d.removed_in_version ? ` → 移除于 ${esc(d.removed_in_version)}` : '，移除版本待定'}）`).join('；')}。弃用范围按实际版本声明。</div>` : '';
}

function page(component, v, allVersions) {
  const switcher = `<label class="ver-switch">版本
  <select data-component="${esc(component.name)}" aria-label="切换文档版本">
    ${allVersions.map((x) => `<option value="${esc(x.version)}" ${x.version === v.version ? 'selected' : ''}>${esc(x.version)}${x.channel ? ' (' + esc(x.channel) + ')' : ''}</option>`).join('')}
  </select></label>`;
  const title = `${component.name} ${v.version}`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="build-id" content="${v.buildId}"><meta name="commit" content="${esc(v.commit)}">
<title>${esc(title)} · 组件文档</title>
<link rel="stylesheet" href="/assets/style.css"></head>
<body data-component="${esc(component.name)}" data-version="${esc(v.version)}">
<header class="vp-nav"><a class="brand" href="/">UI Library Docs</a><nav><a href="/components/${esc(component.name)}/${esc(v.version)}/#install">安装</a>
<a href="/components/${esc(component.name)}/${esc(v.version)}/#props">属性</a>
<a href="/components/${esc(component.name)}/${esc(v.version)}/#events">事件</a>
<a href="/components/${esc(component.name)}/${esc(v.version)}/#slots">插槽</a>
<a href="/components/${esc(component.name)}/${esc(v.version)}/#examples">示例</a></nav>${switcher}</header>
<main class="vp-doc">
<div class="pin">本文档由构建 <code>#${v.buildId}</code> 生成，锁定提交 <code>${esc(v.commit)}</code>${v.branch ? `（分支 <code>${esc(v.branch)}</code>）` : ''}。属性表、事件与示例均来自同一构建。</div>
${deprecationBanner(v)}
<h1>${esc(component.name)} <span class="ver">${esc(v.version)}</span></h1>
<section id="install"><h2>安装</h2><pre><code>npm install ui-library@${esc(v.version)}
# 解析到不可变提交 ${esc(v.commit)}</code></pre></section>
<section id="props"><h2>属性</h2>${propTable(v.props)}${typeList(v.types)}</section>
<section id="events"><h2>事件</h2>${eventTable(v.events)}</section>
<section id="slots"><h2>插槽</h2>${slotTable(v.slots)}</section>
<section id="examples"><h2>交互示例</h2>
${v.examples.length ? v.examples.map((ex) => exampleBlock(ex, previewOrigin)).join('\n') : '<p class="empty">没有通过门控并完成上传的示例可用于正式页面。</p>'}
${v.blockedExamples.length ? `<details class="blocked"><summary>${v.blockedExamples.length} 个示例未进入正式页面</summary><ul>${v.blockedExamples.map((b) => `<li><code>${esc(b.example)}</code>：${esc(b.status)}${b.uploaded ? '' : '（产物未上传）'}</li>`).join('')}</ul></details>` : ''}
</section>
${migrationSection(v)}
</main>
<script type="module" src="/assets/app.js"></script>
</body></html>`;
}

async function main() {
  const res = await fetch(dataUrl);
  const data = await res.json();
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'assets'), { recursive: true });

  const index = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>UI Library Docs</title><link rel="stylesheet" href="/assets/style.css"></head><body>
<header class="vp-nav"><span class="brand">UI Library Docs</span></header><main class="vp-doc">
<h1>开源组件文档站</h1><p>每个组件的每个版本都构建自<strong>不可变提交</strong>，旧版文档永远不会意外加载最新版组件。</p>
${Object.values(data.components).map((c) => `<section><h2>${esc(c.name)}</h2><ul>${[...c.versions].reverse().map((v) => `<li><a href="/components/${esc(c.name)}/${esc(v.version)}/">${esc(c.name)} ${esc(v.version)}</a> ${v.channel ? `<span class="tag">${esc(v.channel)}</span>` : ''}</li>`).join('')}</ul></section>`).join('')}
</main></body></html>`;
  writeFileSync(join(out, 'index.html'), index);

  // expose data for the runtime (artifact hash discovery + version switching)
  writeFileSync(join(out, 'assets', 'site-data.json'), JSON.stringify(data));

  for (const c of Object.values(data.components)) {
    for (const v of c.versions) {
      const dir = join(out, 'components', c.name, v.version);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'index.html'), page(c, v, c.versions));
    }
  }
  writeAssets();
  emitVitePressSources(data);
  console.log(`site generated -> ${out}`);
}

function writeAssets() {
  writeFileSync(join(out, 'assets', 'style.css'), `
:root{--brand:#3451b2;--dep:#b45309;--break:#b91c1c;--ok:#166534}
body{margin:0;font:15px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif;color:#213547}
.vp-nav{position:sticky;top:0;display:flex;gap:18px;align-items:center;padding:10px 22px;background:#fff;border-bottom:1px solid #e5e7eb;z-index:10}
.vp-nav a{color:#213547;text-decoration:none}.vp-nav .brand{font-weight:700;color:var(--brand)}
.vp-doc{max-width:920px;margin:24px auto;padding:0 20px}
.vp-doc section{margin:34px 0;scroll-margin-top:70px}
h1,h2,h4{scroll-margin-top:70px}h2{border-bottom:1px solid #eee;padding-bottom:6px}
.vp-table{border-collapse:collapse;width:100%;font-size:14px}.vp-table th,.vp-table td{border:1px solid #e5e7eb;padding:7px 10px;text-align:left;vertical-align:top}
.vp-table th{background:#f8fafc}.deprecated{background:#fffbeb}
.tag{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:10px;font-size:11px;background:#eef2ff;color:#3730a3}
.tag-dep{background:#fef3c7;color:#92400e}.tag-break{background:#fee2e2;color:#991b1b}.tag-manual{background:#dcfce7;color:#166534}.tag-rec{background:#ede9fe;color:#5b21b6}
.dim{color:#6b7280;font-size:12px}.pin{font-size:12px;color:#6b7280;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px}
.banner{background:#fffbeb;border:1px solid #fde68a;color:#92400e;padding:10px 14px;border-radius:8px;margin:14px 0}
pre{background:#0f172a;color:#e2e8f0;padding:14px;border-radius:8px;overflow:auto}pre.md{white-space:pre-wrap}
.demo{border:1px solid #e5e7eb;border-radius:10px;padding:12px;margin:14px 0}.demo-frame{min-height:70px;border:1px dashed #d1d5db;border-radius:8px}
iframe{width:100%;min-height:64px;border:0;border-radius:8px;background:#fff}
.demo-meta{font-size:12px;color:#6b7280}.blocked{margin-top:10px;color:#991b1b;font-size:13px}
.ver-switch{margin-left:auto;font-size:13px}select{padding:4px 8px;border-radius:6px;border:1px solid #cbd5e1}
.types li{margin:4px 0}.empty{color:#6b7280;font-style:italic}
.demo-error{color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px;font-size:13px}
`);
  writeFileSync(join(out, 'assets', 'app.js'), `
// Version switcher: preserve the section anchor across versions and keep the
// scroll position for the same anchor. Anchors are stable by contract.
const map = await (await fetch('/assets/site-data.json')).json();
document.querySelectorAll('.ver-switch select').forEach((sel) => {
  sel.addEventListener('change', () => {
    const comp = sel.dataset.component, v = sel.value;
    const hash = location.hash || '';
    const y = hash ? window.scrollY : 0;
    const url = '/components/' + comp + '/' + v + '/' + hash;
    // stash scroll so the target page can restore the same section position
    try { sessionStorage.setItem('vp-switch-y', String(y)); } catch {}
    location.href = url;
  });
});
window.addEventListener('load', () => {
  const y = Number(sessionStorage.getItem('vp-switch-y') || 0);
  if (y) { window.scrollTo(0, y); sessionStorage.removeItem('vp-switch-y'); }
});

// Error boundary around every sandboxed preview: a failed/timeout example must
// never break the surrounding page.
window.addEventListener('message', (e) => {
  if (!e.data || !e.data.type) return;
  if (e.data.type === 'example-error') {
    const f = [...document.querySelectorAll('iframe')].find((x) => x.contentWindow === e.source);
    if (f) { const d = document.createElement('div'); d.className = 'demo-error'; d.textContent = '示例运行失败，已被隔离：' + e.data.message; f.replaceWith(d); }
  }
});
document.querySelectorAll('iframe').forEach((f) => {
  f.addEventListener('error', () => { const d = document.createElement('div'); d.className = 'demo-error'; d.textContent = '预览加载失败（已隔离）'; f.replaceWith(d); });
});
`);
}

// Emit canonical VitePress sources so a networked environment can run the real
// thing: `npm i -D vitepress && npx vitepress build docs`. The generated
// Markdown is version-scoped and consumes the same pinned contract per page.
function emitVitePressSources(data) {
  const root = join('docs');
  mkdirSync(join(root, '.vitepress/theme/components'), { recursive: true });
  let nav = '';
  for (const c of Object.values(data.components)) for (const v of c.versions) {
    const dir = join(root, 'components', c.name, v.version);
    mkdirSync(dir, { recursive: true });
    const md = `---
buildId: ${v.buildId}
commit: ${v.commit}
component: ${c.name}
version: ${v.version}
---
# ${c.name} ${v.version}

> 构建 #${v.buildId} · 锁定提交 \`${v.commit}\`。属性表、事件与示例来自同一构建。

## 安装

\`\`\`bash
npm install ui-library@${v.version}
\`\`\`

## 属性

| 名称 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
${v.props.map((p) => `| \`${p.name}\`${p.deprecated ? ' *(deprecated ' + p.deprecated.since + ')*' : ''}${p.renamedFrom ? ' *(renamed from `' + p.renamedFrom + '`)*' : ''} | ${p.type} | ${p.required ? '是' : '否'} | ${p.default ?? '—'} | ${(p.description || '').replace(/\|/g, '\\|')} ${p.inferred ? '' : '🧑‍🔧manual'} |`).join('\n')}

${v.types.length ? '**类型别名**\n\n' + v.types.map((t) => `- \`${t.name}\` = \`${t.raw}\`${t.recursive ? '（递归）' : ''}`).join('\n') : ''}

## 事件

| 事件 | 说明 |
|---|---|
${v.events.map((e) => `| \`${e.name}\` | ${(e.description || '').replace(/\|/g, '\\|')} |`).join('\n')}

## 插槽

| 插槽 | 说明 |
|---|---|
${v.slots.map((s) => `| \`${s.name}\` | ${(s.description || '').replace(/\|/g, '\\|')} ${s.inferred ? '' : '🧑‍🔧manual'} |`).join('\n')}

## 交互示例

<ExampleGallery component="${c.name}" version="${v.version}" preview-origin="${previewOrigin}" />

${v.blockedExamples.length ? `> ⚠️ ${v.blockedExamples.length} 个示例未通过门控或未完成上传，不会出现在正式页面：${v.blockedExamples.map((b) => b.example + '(' + b.status + ')').join(', ')}` : ''}

${v.migration ? `## 迁移说明\n\n> 迁移文档锁定提交 \`${v.migration.commit_sha}\`\n\n\`\`\`md\n${v.migration.body}\n\`\`\`` : ''}
`;
    writeFileSync(join(dir, 'index.md'), md);
  }
  const config = `import { defineConfig } from 'vitepress'
// Each versioned page lives under /components/<Component>/<version>/ and is
// built from the pinned build recorded in its frontmatter -> old docs can never
// resolve the newest component.
export default defineConfig({
  title: 'UI Library Docs',
  lang: 'zh-CN',
  themeConfig: {
    nav: [{ text: '组件', link: '/' }],
    sidebar: ${JSON.stringify(Object.fromEntries(Object.values(data.components).map((c) => ['/components/' + c.name + '/', c.versions.map((v) => ({ text: c.name + ' ' + v.version, link: '/components/' + c.name + '/' + v.version + '/' }))])) , null, 2)}
  }
})
`;
  writeFileSync(join(root, '.vitepress/config.mjs'), config);
  writeFileSync(join(root, '.vitepress/theme/index.js'), `import DefaultTheme from 'vitepress/theme'
import DemoPreview from './components/DemoPreview.vue'
import ExampleGallery from './components/ExampleGallery.vue'
import VersionSwitcher from './components/VersionSwitcher.vue'
export default { extends: DefaultTheme, enhanceApp({ app }) { app.component('DemoPreview', DemoPreview); app.component('ExampleGallery', ExampleGallery); app.component('VersionSwitcher', VersionSwitcher) } }
`);
  // Same pinned build data the static generator used; VitePress pages read the
  // version matching their frontmatter (never a floating "latest").
  mkdirSync(join(root, 'public'), { recursive: true });
  writeFileSync(join(root, 'public', 'site-data.json'), JSON.stringify(data));
  writeFileSync(join(root, '.vitepress/theme/components/DemoPreview.vue'), `<template>
  <div class="demo">
    <h4>{{ example.name }}</h4>
    <!-- isolated origin; user code cannot reach main-site login context -->
    <iframe :title="'示例预览 ' + example.name" sandbox="allow-scripts"
      :src="previewOrigin + '/preview/' + example.hash"
      @error="onError" />
    <div v-if="errorMsg" class="demo-error">{{ errorMsg }}</div>
  </div>
</template>
<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
const props = defineProps({ example: Object, previewOrigin: String })
const errorMsg = ref('')
function onMsg(e) { if (e.data?.type === 'example-error') errorMsg.value = '示例失败已隔离：' + e.data.message }
function onError() { errorMsg.value = '预览加载失败（已隔离）' }
onMounted(() => window.addEventListener('message', onMsg))
onUnmounted(() => window.removeEventListener('message', onMsg))
<\/script>
`);
  writeFileSync(join(root, '.vitepress/theme/components/ExampleGallery.vue'), `<template>
  <div>
    <p v-if="!examples.length" class="empty">没有通过门控并完成上传的示例可用于正式页面。</p>
    <DemoPreview v-for="ex in examples" :key="ex.name" :example="ex" :preview-origin="previewOrigin" />
  </div>
</template>
<script setup>
// Resolves ONLY the examples pinned to this page's component+version, from the
// build-time site-data snapshot. Never fetches a floating "latest" build.
import { ref, onMounted } from 'vue'
import { useData } from 'vitepress'
const props = defineProps({ component: String, version: String, previewOrigin: String })
const { frontmatter } = useData()
const examples = ref([])
onMounted(async () => {
  const all = await (await fetch('/site-data.json')).json()
  const ver = all.components[props.component].versions.find(v => v.version === props.version && v.buildId === frontmatter.buildId)
  examples.value = ver ? ver.examples : []
})
<\/script>
`);
  writeFileSync(join(root, '.vitepress/theme/components/VersionSwitcher.vue'), `<template>
  <select @change="go">
    <option v-for="o in versions" :key="o.version" :selected="o.version === current">{{ o.version }}</option>
  </select>
</template>
<script setup>
// Anchors (#props/#events/#slots/#examples/#install) are stable across versions
// so switching versions keeps the reader on the same section.
import { useRoute, useRouter } from 'vitepress'
const props = defineProps({ versions: Array, current: String, component: String })
function go(e) {
  const hash = location.hash || ''
  const y = hash ? window.scrollY : 0
  sessionStorage.setItem('vp-switch-y', String(y))
  location.href = '/components/' + props.component + '/' + e.target.value + '/' + hash
}
<\/script>
`);
  writeFileSync(join(root, 'index.md'), `# 开源组件文档站

每个组件的每个版本都构建自**不可变提交**，旧版文档永远不会意外加载最新版组件。

${Object.values(data.components).map((c) => `## ${c.name}\n\n${[...c.versions].reverse().map((v) => `- [${c.name} ${v.version}](/components/${c.name}/${v.version}/)`).join('\n')}`).join('\n\n')}
`);
}

main().catch((e) => { console.error(e); process.exit(1); });
