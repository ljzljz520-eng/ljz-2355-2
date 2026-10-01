---
layout: home
hero:
  name: ACME UI
  text: 开源组件文档
  tagline: 契约从固定提交提取 · 示例同构建验证 · 受限沙箱运行
  actions:
    - theme: brand
      text: 最新版文档
      link: /2.0.0/
    - theme: alt
      text: v1.0.0（旧版）
      link: /1.0.0/
features:
  - title: 安装
    details: npm install @acme/ui —— 每个版本页固定展示该版本提交，分支更新不会影响旧版文档。
  - title: 单一事实来源
    details: 属性表、事件、插槽与交互示例来自同一次构建（同一 commit / buildId）。
  - title: 安全预览
    details: 用户示例运行在独立源的沙箱 iframe，与主站登录 Cookie/存储隔离，失败不影响主站。
  - title: 破坏变更可迁移
    details: 每项破坏变更关联迁移指南与复验案例，未通过门禁的版本不会发布。
---

## 安装

```bash
npm install @acme/ui
# 或指定旧版（旧版文档始终固定在其发布提交）
npm install @acme/ui@1.0.0
```

```js
import { CwButton, CwTree } from '@acme/ui';
```

版本之间切换时，页面会保持在当前章节锚点（属性 / 事件 / 插槽 / 示例）。
