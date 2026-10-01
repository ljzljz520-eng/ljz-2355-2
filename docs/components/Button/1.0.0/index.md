---
buildId: 1
commit: v1.0.0
component: Button
version: 1.0.0
---
# Button 1.0.0

> 构建 #1 · 锁定提交 `v1.0.0`。属性表、事件与示例来自同一构建。

## 安装

```bash
npm install ui-library@1.0.0
```

## 属性

| 名称 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `disabled` | boolean | 否 | false |   |
| `icon` | union | 否 | null | Leading icon name or VNode. Allowed names: 'check' \| 'arrow' (see icon pack). 🧑‍🔧manual |
| `label` | string | 是 | — | Text shown on the button.  |

**类型别名**

- `ButtonSize` = `'sm' | 'md' | 'lg'`
- `RichNode` = `{ text?: string; child?: RichNode }`（递归）

## 事件

| 事件 | 说明 |
|---|---|
| `click` | Fired when the button is activated. |

## 插槽

| 插槽 | 说明 |
|---|---|
| `icon` | Optional leading icon slot. 🧑‍🔧manual |

## 交互示例

<ExampleGallery component="Button" version="1.0.0" preview-origin="http://127.0.0.1:4174" />

> ⚠️ 2 个示例未通过门控或未完成上传，不会出现在正式页面：a11y-fail.js(a11y-fail), async.js(timeout)


