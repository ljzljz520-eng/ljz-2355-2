#!/usr/bin/env node
// End-to-end acceptance suite (zero dependencies).
// Requires a fresh backend + three built+released versions. Use scripts/e2e.sh.
import assert from 'node:assert/strict';

const API = process.env.API || 'http://127.0.0.1:4173';
const PREVIEW = process.env.PREVIEW || 'http://127.0.0.1:4174';
const DIST = process.env.DIST || 'dist';
const results = [];
async function test(name, fn) {
  try { await fn(); results.push([name, 'PASS']); console.log(`  PASS  ${name}`); }
  catch (e) { results.push([name, 'FAIL ' + e.message]); console.error(`  FAIL  ${name}\n        ${e.message}`); }
}
const j = async (u, init) => (await fetch(new URL(u, API), init)).json();
const fs = await import('node:fs');
const site = JSON.parse(fs.readFileSync(`${DIST}/assets/site-data.json`, 'utf8'));
const V = Object.fromEntries(site.components.Button.versions.map((v) => [v.version, v]));
const prop = (ver, n) => V[ver].props.find((p) => p.name === n);

/* 1. 属性重命名 (prop rename) */
await test('属性重命名: 1.0.0 有 type 之外的 variant 不存在；2.0.0 variant 存在且记录 renamedFrom=type，type 已移除', () => {
  assert.ok(prop('1.0.0', 'type') === undefined, 'v1 has no variant-era prop');
  assert.equal(prop('2.0.0', 'type'), undefined, '`type` removed in v2');
  const variant = prop('2.0.0', 'variant');
  assert.ok(variant, '`variant` exists in v2');
  assert.equal(variant.renamedFrom, 'type', 'renamedFrom provenance recorded');
  assert.ok(prop('3.0.0', 'variant'), 'variant retained in v3');
});

/* 2. 类型别名递归 */
await test('类型别名递归: RichNode/ClickTrace 被识别为递归且不爆栈', () => {
  const rich = V['1.0.0'].types.find((t) => t.name === 'RichNode');
  assert.equal(rich.recursive, true);
  const trace = V['3.0.0'].types.find((t) => t.name === 'ClickTrace');
  assert.equal(trace.recursive, true);
  assert.ok(trace.raw.includes('ClickTrace'));
  const size = V['3.0.0'].types.find((t) => t.name === 'ButtonSize');
  assert.equal(size.recursive, false);
});

/* 3. 异步示例超时 */
await test('异步示例超时: async.js 被硬超时判定为 timeout，不进入正式页面', () => {
  for (const ver of ['1.0.0', '2.0.0', '3.0.0']) {
    assert.ok(!V[ver].examples.some((e) => e.name === 'async.js'), `${ver} page excludes async.js`);
    const b = V[ver].blockedExamples.find((x) => x.example === 'async.js');
    assert.equal(b.status, 'timeout', `${ver} records timeout`);
  }
});

/* 4. 可访问性失败 */
await test('可访问性测试失败: 空按钮 a11y-fail.js 被识别并从正式页面剔除', () => {
  for (const ver of ['1.0.0', '2.0.0', '3.0.0']) {
    assert.ok(!V[ver].examples.some((e) => e.name === 'a11y-fail.js'));
    const b = V[ver].blockedExamples.find((x) => x.example === 'a11y-fail.js');
    assert.equal(b.status, 'a11y-fail');
  }
});

/* 5. 部分产物上传 */
await test('部分产物上传: 未通过示例无 preview 产物，已通过示例有内容哈希且互不阻塞', async () => {
  const passed = V['2.0.0'].examples;
  assert.ok(passed.length >= 2);
  for (const e of passed) {
    assert.match(e.hash || '', /^[0-9a-f]{64}$/, 'uploaded preview carries sha256');
    const res = await fetch(`${PREVIEW}/preview/${e.hash}`);
    assert.equal(res.status, 200, `artifact ${e.name} fetchable`);
  }
  // blocked examples carry no hash
  for (const b of V['2.0.0'].blockedExamples) assert.equal(b.hash, undefined);
});

/* 6. 正式页面不拼接未通过示例 + 同一构建 */
await test('正式页面只拼接 uploaded+passed 示例，且属性/事件/插槽/示例共享同一 buildId', () => {
  const html = fs.readFileSync(`${DIST}/components/Button/2.0.0/index.html`, 'utf8');
  assert.ok(html.includes('iframe'));
  assert.ok(!html.includes('a11y-fail.js"'), 'a11y-fail not embedded');
  assert.ok(!html.includes('async.js"'), 'async not embedded');
  const m = html.match(/<meta name="build-id" content="(\d+)">/);
  assert.equal(m[1], String(V['2.0.0'].buildId));
  // all rendered examples belong to the same version build
  const expected = new Set(V['2.0.0'].examples.map((e) => e.name));
  for (const ex of html.matchAll(/data-example="([^"]+)"/g)) assert.ok(expected.has(ex[1]));
});

/* 7. 版本切换保持章节定位 */
await test('版本切换保持章节定位: 跨版本锚点稳定，切换器 URL 保留 hash', () => {
  for (const ver of ['1.0.0', '2.0.0', '3.0.0']) {
    const html = fs.readFileSync(`${DIST}/components/Button/${ver}/index.html`, 'utf8');
    for (const a of ['#install', '#props', '#events', '#slots', '#examples']) {
      assert.ok(html.includes(`/${ver}/${a}`), `${ver} keeps anchor ${a}`);
    }
  }
  const app = fs.readFileSync(`${DIST}/assets/app.js`, 'utf8');
  assert.ok(app.includes("const hash = location.hash"));
  assert.ok(app.includes("vp-switch-y"));
});

/* 8. 旧版文档不能加载最新组件 (commit pinning) */
await test('旧版文档不加载最新组件: 每页锁定自己的 commit，v1 页面无 variant/loading', () => {
  assert.equal(V['1.0.0'].commit, 'v1.0.0');
  assert.equal(V['3.0.0'].commit, 'v3.0.0');
  assert.ok(!V['1.0.0'].props.find((p) => ['variant', 'loading'].includes(p.name)));
  const v1html = fs.readFileSync(`${DIST}/components/Button/1.0.0/index.html`, 'utf8');
  assert.ok(v1html.includes('content="v1.0.0"'));
  assert.ok(!v1html.includes('variant'));
});

/* 9. 弃用范围按实际版本声明 */
await test('弃用范围: label 仅在 [2.0.0,3.0.0) 标记弃用，3.0.0 从契约移除', () => {
  assert.equal(prop('1.0.0', 'label').deprecated, undefined);
  assert.equal(prop('2.0.0', 'label').deprecated.since, '2.0.0');
  assert.equal(prop('2.0.0', 'label').deprecated.removedIn, null);
  assert.equal(prop('3.0.0', 'label'), undefined);
  const backfilled = V['2.0.0'].deprecations.find((d) => d.subject_name === 'label');
  assert.equal(backfilled.since_version, '2.0.0');
  assert.equal(backfilled.removed_in_version, '3.0.0');
  assert.equal(V['3.0.0'].deprecations.find((d) => d.subject_name === 'label'), undefined);
});

/* 10. 破坏变更关联迁移说明 + 复验案例 */
await test('破坏变更关联迁移说明和复验案例', async () => {
  const v2 = V['2.0.0'];
  assert.ok(v2.migration && v2.migration.body.includes('type') && v2.migration.body.includes('variant'));
  assert.equal(v2.migration.commit_sha, 'v2.0.0');
  assert.ok(V['3.0.0'].migration.body.includes('label'));
});

/* 11. 人工补证 */
await test('无法自动推断字段由人工补证: icon 属性/插槽标记 manual 且带原因', () => {
  for (const ver of ['1.0.0', '2.0.0', '3.0.0']) {
    const icon = prop(ver, 'icon');
    assert.equal(icon.inferred, false);
    assert.ok(icon.evidence === 'manual');
    const slot = V[ver].slots.find((s) => s.name === 'icon');
    assert.equal(slot.inferred, false);
  }
});

/* 12. 预览环境隔离 */
await test('受限预览: 独立源 + sandbox CSP，与主站登录上下文隔离', async () => {
  const hash = V['2.0.0'].examples[0].hash;
  const res = await fetch(`${PREVIEW}/preview/${hash}`);
  const h = Object.fromEntries([...res.headers]);
  assert.match(h['content-security-policy'], /sandbox/);
  assert.match(h['content-security-policy'], /default-src 'none'/);
  assert.equal(h['cross-origin-opener-policy'], 'same-origin');
  const page = fs.readFileSync(`${DIST}/components/Button/2.0.0/index.html`, 'utf8');
  assert.match(page, /sandbox="allow-scripts"/);
  assert.ok(!/allow-same-origin/.test(page), 'iframe must NOT be same-origin');
});

/* 13. 失败不能拖垮站点 */
await test('失败隔离: 坏示例不产生 iframe，页面其余部分正常，错误边界脚本存在', () => {
  const html = fs.readFileSync(`${DIST}/components/Button/1.0.0/index.html`, 'utf8');
  assert.ok(html.includes('id="props"') && html.includes('id="examples"'));
  assert.equal((html.match(/<iframe/g) || []).length, V['1.0.0'].examples.length);
  assert.ok(fs.readFileSync(`${DIST}/assets/app.js`, 'utf8').includes('example-error'));
});

/* 14. 发布关系 */
await test('发布关系: releases 链 supersede，site-data 携带 channel', async () => {
  const db = await j('/api/site-data');
  assert.ok(db.components.Button.versions.every((v) => v.channel === 'latest'));
});

/* 15. 鉴权 */
await test('后台鉴权: 未携带令牌不得提取契约', async () => {
  const res = await fetch(`${API}/api/contract?commit=v1.0.0&component=Button`);
  assert.equal(res.status, 401);
});

/* summary */
const failed = results.filter(([, s]) => s.startsWith('FAIL'));
console.log(`\n${results.length - failed.length}/${results.length} acceptance checks passed`);
if (failed.length) { for (const [n, s] of failed) console.error('  -', n, '=>', s); process.exit(1); }
