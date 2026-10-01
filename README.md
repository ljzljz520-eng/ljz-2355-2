# 开源组件文档平台（compodoc-platform）

面向开源组件库的文档与发布平台：从**指定源码提交（git tag/sha）**提取组件契约，
用 **VitePress** 渲染安装、属性表、事件、插槽与交互示例；契约、测试产物与发布
关系持久化到 **SQLite**。交互示例在**受限预览环境**中运行，与主站登录上下文隔离。

## 为什么这样设计

| 需求 | 落实方式 |
| --- | --- |
| 属性表/事件/插槽与示例来自**同一构建** | 一次入库（一个 `buildId`）从同一个 `git worktree` 快照生成契约、运行示例、产出 docs manifest |
| 分支更新不能让旧版文档加载最新组件 | 文档只读取已固定的 `(package, version, commit, treeHash)`；构建在 detached worktree 中完成；重复版本换 commit 直接报错 |
| 静态提取 vs 运行时反射 | 两者都做并合并：静态负责结构类型/JSDoc（含递归别名展开），运行时负责求值默认值；无法推断的（插槽、描述）走 `evidence/<version>.json` 人工补证，缺口计入 gate |
| 示例与主站登录隔离 | 预览在独立源 `preview.example.invalid`，`sandbox="allow-scripts"`（无 `allow-same-origin`）、CSP `frame-ancestors`/`connect-src 'none'`、COOP/COEP/CORP、无凭证 |
| 失败不拖垮站点 | 每个示例独立 worker 线程；超时终止、崩溃/抛错/a11y 违规仅标记该示例；正式页面**不拼接任何未通过示例**；预览源故障只显示兜底 |
| 破坏变更关联迁移与复验 | diff 引擎检测重命名/类型/移除，每项必须在 `migrations/<ver>.json` 配迁移说明+复验案例，复验在同构建的已通过示例上执行；任一缺失则发布被门禁阻断 |
| 弃用按真实版本声明 | `@deprecated since removeIn replacement` 解析后校验版本必须存在、`removeIn > since`、为合法 semver |
| 部分产物上传 | 每个产物一行 SQL，上传成功落库，失败可续传；必需产物缺失/失败 → release 非 complete |
| 版本切换保持章节定位 | 路由解析版本/section/`#hash`，切换版本保留 `#props/#events/#slots/#examples`；组件被移除走迁移回退；未知版本绝不隐式跳到 latest |

## 目录结构

```
packages/
  core/            # 契约提取、示例运行、diff/迁移/复验、SQL、docs 数据与脚手架
    src/extract/   #   TS 编译器静态提取 + 递归类型展开 + 运行时反射 + 三源合并
    src/examples/  #   worker 线程示例运行器、a11y 检查、ESM loader 钩子
    src/docs/      #   docs manifest、版本化页面脚手架、版本切换路由
    src/db/        #   schema.sql + better-sqlite3 repository
  ui-lib/          # 示例组件库（自身是独立 git 仓库，含 v1.0.0 / v2.0.0 标签）
  preview-server/  # 受限预览 HTTP 服务（严格隔离响应头，仅服务已通过示例）
docs/              # VitePress 站点（组件表、版本切换、沙箱 iframe）
test/              # node:test 验收测试（27 个）
scripts/build-core.sh
```

## 快速开始

```bash
npm install
bash scripts/build-core.sh
bash scripts/bootstrap-ui-lib.sh   # 重建带 v1.0.0/v2.0.0 标签的示例组件库

# 从固定标签入库两个版本（产物落到本地 published/）
node packages/core/dist/cli/ingest.js --repo packages/ui-lib --ref v1.0.0 \
  --version 1.0.0 --db .data/docs.db --timeout 500
node packages/core/dist/cli/ingest.js --repo packages/ui-lib --ref v2.0.0 \
  --version 2.0.0 --db .data/docs.db --timeout 500

# 生成 docs/.generated（正式构建只含 complete 版本与已通过示例）
node packages/core/dist/cli/docs-data.js --db .data/docs.db --docs docs

# 构建 VitePress
node_modules/.bin/vitepress build docs

# 受限预览服务（默认 :8899）
node packages/preview-server/server.mjs

# 测试
npm test
```

`docs-data` 支持 `--draft`：草稿数据会包含 partial 版本并为失败示例保留占位
（带失败原因），但**正式（默认）构建永远不包含失败示例**。

## v1 → v2 演示的破坏变更

- 属性重命名 `cw-button: loading → busy`（类型同时从 boolean 变为对象，迁移映射显式声明）
- 事件重命名 `loadingChange → busyChange`（载荷字段变化，启发式 + 显式映射）
- 属性重命名 `cw-tree: expanded → initiallyExpanded`
- 属性移除 `cw-tree: guides`、插槽移除 `cw-tree: guide`
- `cw-button: size` 自 2.0.0 弃用，计划 3.0.0 移除
- 失败示例夹具：`a11y-fail`（无 Accessible Name）、`timeout`（永不 resolve）、`crash`（worker 非零退出）

每条破坏变更都带迁移指南与复验案例；复验在同构建的已通过示例渲染结果上断言。

## 关键不变量

1. **不可变性**：`(package, version)` 只能对应一个 commit；换分支推送后用同 tag
   重新入库，解析出的仍是标签 commit，且 DB 拒绝改写。
2. **同源构建**：docs manifest、属性/事件/插槽表、示例渲染结果均带版本 commit/treeHash。
3. **门禁**：迁移说明+复验全过、必需产物全部上传、弃用版本合法 ⇒ `complete`；否则
   `partial/blocked`，且不会出现在正式 docs 数据中。
4. **隔离**：不可信示例代码仅在浏览器沙箱 iframe（独立源）执行；构建期在一次性
   worktree 与独立 worker 中执行，任何单点失败都不会影响其他示例或主站。
