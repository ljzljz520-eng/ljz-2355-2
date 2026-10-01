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
