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
