---
buildId: 2
commit: v2.0.0
component: Button
version: 2.0.0
---
# Button 2.0.0

> 构建 #2 · 锁定提交 `v2.0.0`。属性表、事件与示例来自同一构建。

## 安装

```bash
npm install ui-library@2.0.0
```

## 属性

| 名称 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `disabled` | boolean | 否 | false | Disabled state.  |
| `icon` | union | 否 | null | Leading icon name or VNode. Allowed names: 'check' \| 'arrow' (see icon pack). 🧑‍🔧manual |
| `label` *(deprecated 2.0.0)* | string | 否 | '' | Text shown on the button.  |
| `loading` | boolean | 否 | false |   |
| `variant` *(renamed from `type`)* | string | 否 | 'default' | Visual style of the button.  |

**类型别名**

- `ButtonSize` = `'sm' | 'md' | 'lg'`
- `RichNode` = `{ text?: string; child?: RichNode }`（递归）
- `Variant` = `NonEmpty<Token>`

## 事件

| 事件 | 说明 |
|---|---|
| `click` | Fired when the button is activated. Not emitted while loading. |

## 插槽

| 插槽 | 说明 |
|---|---|
| `default` | Button content; preferred over the deprecated `label` prop.  |
| `icon` | Optional leading icon slot. 🧑‍🔧manual |

## 交互示例

<ExampleGallery component="Button" version="2.0.0" preview-origin="http://127.0.0.1:4174" />

> ⚠️ 2 个示例未通过门控或未完成上传，不会出现在正式页面：a11y-fail.js(a11y-fail), async.js(timeout)

## 迁移说明

> 迁移文档锁定提交 `v2.0.0`

```md
# Button 2.0.0 迁移说明

## BREAKING `type` → `variant`

属性 `type` 已重命名为 `variant`，取值集合不变（`default | primary | ghost`）。

```diff
- <ui-button type="primary" label="保存" />
+ <ui-button variant="primary">保存</ui-button>
```

## 弃用 `label`

`label` 属性自 2.0.0 起弃用，请改用默认插槽。移除版本将在后续发布时声明。

## 复验案例

见 `retest/2.0.0.json`：`button.type->variant`、`button.label-slot`。

```
