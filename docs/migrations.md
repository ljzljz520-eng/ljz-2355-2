# 迁移指南

破坏变更与迁移说明、复验案例一一对应。只有迁移说明齐全且复验通过的版本才会
进入 `complete` 状态并发布到正式文档。

## 2.0.0

- `cw-button`：`loading`(boolean) → `busy: { pending, progress? }`
- 事件：`loadingChange { loading }` → `busyChange { busy }`
- `cw-tree`：`expanded` → `initiallyExpanded`；移除 `guides` 属性与 `guide` 插槽
- 弃用：`cw-button.size`（since 2.0.0，removeIn 3.0.0）

详见各组件页的 “Breaking changes & migration” 折叠区。
