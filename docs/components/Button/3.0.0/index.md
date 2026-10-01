---
buildId: 3
commit: v3.0.0
component: Button
version: 3.0.0
---
# Button 3.0.0

> 构建 #3 · 锁定提交 `v3.0.0`。属性表、事件与示例来自同一构建。

## 安装

```bash
npm install ui-library@3.0.0
```

## 属性

| 名称 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `disabled` | boolean | 否 | false | Disabled state.  |
| `icon` | union | 否 | null | Leading icon name or VNode. Allowed names: 'check' \| 'arrow' (see icon pack). 🧑‍🔧manual |
| `loading` | boolean | 否 | false |   |
| `variant` | string | 否 | 'default' | Visual style of the button.  |

**类型别名**

- `ButtonSize` = `'sm' | 'md' | 'lg'`
- `RichNode` = `{ text?: string; child?: RichNode }`（递归）
- `ClickTrace` = `{ at: number; next?: ClickTrace }`（递归）

## 事件

| 事件 | 说明 |
|---|---|
| `click` | Fired when the button is activated; payload is a recursive ClickTrace. |

## 插槽

| 插槽 | 说明 |
|---|---|
| `default` | Button content (required since 3.0.0; the label prop was removed).  |
| `icon` | Optional leading icon slot. 🧑‍🔧manual |

## 交互示例

<ExampleGallery component="Button" version="3.0.0" preview-origin="http://127.0.0.1:4174" />

> ⚠️ 2 个示例未通过门控或未完成上传，不会出现在正式页面：a11y-fail.js(a11y-fail), async.js(timeout)

## 迁移说明

> 迁移文档锁定提交 `v3.0.0`

```md
# Button 3.0.0 迁移说明

## BREAKING 移除 `label`

2.0.0 弃用的 `label` 属性已在 3.0.0 移除。默认插槽是唯一的内容入口。

```diff
- <ui-button label="保存" variant="primary" />
+ <ui-button variant="primary">保存</ui-button>
```

弃用范围按实际版本声明：`label` 仅在 `>=2.0.0 <3.0.0` 标记为 deprecated；3.0.0 起从契约中移除。

## 复验案例

见 `retest/3.0.0.json`：`button.label-removed`。

```
