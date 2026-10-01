# 开源组件文档站平台

为开源 UI 组件库构建版本化文档：**VitePress 呈现安装/属性/事件/插槽/交互示例**，后台从**指定源码提交**提取契约并用 **SQL** 保存组件版本、测试产物与发布关系；示例在**受限沙箱预览**中运行，与主站登录上下文隔离。

本仓库**零运行时第三方依赖**（Node 20 内置能力 + Python3 标准库 + SQLite），可完全离线跑通验收；联网时可用真正的 VitePress 构建 `docs/`（`npm i && npm run build:vitepress`）。

## 核心不变量

1. **同一构建**：属性表、事件、插槽与交互示例全部来自同一个 `buildId`（同一提交、同一次测试）。
2. **提交锁定**：版本行固定不可变 `commit_sha`，页面只渲染该构建；分支更新只影响后续新构建，**旧版文档不会意外加载最新版组件**。
3. **静态提取为主、运行时反射仅用于验证**：见 `docs/decisions/static-vs-runtime.md`。
4. **人工补证**：源码无法证明的字段打 `@manual`，由 `*.manual.json` 补证；缺失则构建被拒绝。
5. **发布门控**：破坏变更必须关联迁移说明 + 复验案例；弃用范围按实际版本声明（如 `[2.0.0,3.0.0)`）。
6. **正式页面不拼接未通过的示例**：超时/断言失败/a11y 失败或产物未上传的示例被排除，且失败不拖垮站点。
7. **预览隔离**：独立源 + `iframe sandbox="allow-scripts"`（无 same-origin）+ 严格 CSP/COOP/CORP。

## 仓库结构

```
library/                 被文档化的组件库（三个真实 git 版本 v1.0.0/v2.0.0/v3.0.0）
  button/index.js        组件源码（JSDoc/@rename/@deprecated/@manual 约定）
  button/examples/*.js   交互示例（render + play，meta.timeoutMs/a11y）
  button/button.manual.json  人工补证
  migrations/*.md        破坏变更迁移说明（随提交锁定）
  retest/*.json          复验案例与 must 断言
tools/
  git.mjs                仅按精确提交读取（git show / ls-tree）
  extract.mjs            静态契约提取器（props/events/slots/类型别名+递归分析）
  a11y.mjs               可访问性检查（A1-A5，HTML 解析，Node/浏览器同一份）
  render.mjs             VNode->HTML + 极简 DOM（门控用）
  harness.mjs            示例测试运行器（硬超时/事件/a11y 产物）
  preview.mjs            自包含沙箱预览包生成器（看门狗+postMessage）
  build.mjs              单版本构建编排：门控→落库→逐产物上传→元数据
  sitegen.mjs            零依赖静态站生成器 + 标准 VitePress 源发射
server/
  schema.sql             SQLite：版本/构建/契约/测试产物/产物/发布关系/破坏/迁移/复验/弃用/会话
  server.py              HTTP API + 静态站 + 独立预览源（鉴权/部分上传/发布门控）
docs/                    VitePress 工程（config/theme 组件 + 版本化 Markdown，由 sitegen 发射）
tests/acceptance.mjs     15 项端到端验收
scripts/e2e.sh           全新环境一键端到端
scripts/e2e-partial-upload.sh  部分产物上传确定性验收
```

## 快速开始

```bash
# 1) 全新端到端（建库→构建三版本→发布→生成站点→跑验收）
bash scripts/e2e.sh

# 2) 或手动：
python3 server/server.py --db docs.db --storage store --site dist &        # 4173 主站 / 4174 预览
TOKEN=$(curl -s -X POST localhost:4173/api/admin/login \
  -H 'Content-Type: application/json' -d '{"password":"dev-password"}' | jq -r .token)
for v in 1.0.0 2.0.0 3.0.0; do
  node tools/build.mjs --component Button --version $v --commit v$v \
    --branch B --server http://127.0.0.1:4173 --token "$TOKEN"
done
# 发布（破坏版本带复验结果；缺迁移说明/复验会被 409 拒绝）
curl -X POST localhost:4173/api/admin/releases -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"component":"Button","version":"2.0.0",
    "retestResults":{"button.type->variant":true,"button.label-slot":true}}'
node tools/sitegen.mjs http://127.0.0.1:4173/api/site-data dist http://127.0.0.1:4174
node tests/acceptance.mjs
```

打开 http://127.0.0.1:4173/ ，进入 `/components/Button/1.0.0|2.0.0|3.0.0/`，用右上角切换器在版本间切换（保留 `#props/#events/#slots/#examples/#install` 章节定位）。

## 内置验收场景（全部真实可跑）

| 验收点 | 体现 |
|---|---|
| 属性重命名 | v1 `type` → v2 `variant`（`renamedFrom`），迁移说明 + `button.type->variant` 复验 |
| 类型别名递归 | `RichNode`（自引用）、`ClickTrace`（字段自引用）标记递归且不爆栈 |
| 异步示例超时 | `async.js` play 等待 2000ms > `timeoutMs:150` → timeout，不进正式页 |
| 可访问性失败 | `a11y-fail.js` 空按钮触发 A1（无可访问名）→ a11y-fail，被剔除 |
| 部分产物上传 | 内容寻址逐产物确认；失败仅标记自身，见 `scripts/e2e-partial-upload.sh` |
| 版本切换定位 | 跨版本锚点稳定 + `sessionStorage` 恢复滚动 |
| 正式页面纯净 | `test_runs.status='pass' AND uploaded=1` 才渲染 iframe |

## API 摘要

* `POST /api/admin/login` → 令牌（默认密码来自 `DOC_ADMIN_PASSWORD`）
* `GET  /api/contract?commit=<sha>&component=<Button>`（需鉴权）
* `POST /api/admin/versions|builds|deprecations|breaking|retest|releases`
* `PUT  /api/admin/artifacts?buildId=&kind=&name=`（逐产物上传，503 即该产物失败）
* `GET  /api/site-data`（发布视图，仅含各版本通过+已上传的示例）
* `GET  /preview/<sha256>`（仅在预览源 4174，沙箱头）

## 联网使用真正的 VitePress

`sitegen` 已把版本化 Markdown 与 `DemoPreview.vue`（隔离 iframe）、`VersionSwitcher.vue`（锚点保留）发射到 `docs/`：

```bash
npm i
npm run docs:dev       # 本地开发
npm run build:vitepress
```
