# 决策：受限预览环境

示例代码来自用户/组件贡献者，必须与主站登录上下文隔离：

1. **独立源（origin）**：预览服务监听独立端口（生产为独立域名 `preview.*`）。
2. **双层沙箱**：
   * 响应头 `Content-Security-Policy: default-src 'none'; ...; sandbox`、`Cross-Origin-Opener-Policy: same-origin`、`Cross-Origin-Resource-Policy: same-origin`、`Referrer-Policy: no-referrer`、`X-Content-Type-Options: nosniff`；
   * 内嵌 `<iframe sandbox="allow-scripts">`，**不**给 `allow-same-origin`，因此 iframe 内是 opaque origin：无 cookie、无 localStorage、无法访问父文档或主站登录态。
3. **内容寻址**：预览包按 sha256 存对象库，URL 即哈希；不可变、可缓存校验。
4. **失败隔离**：示例运行有硬超时看门狗；运行错误只通过 `postMessage` 上报，外层错误边界把 iframe 换成提示条。单例崩溃/超时不影响页面其余部分或站点进程。
5. **门控一致性**：iframe 初始 HTML 就是 Node 门控跑出的同一份静态 HTML；未通过（fail/timeout/a11y-fail）或产物未上传成功的示例**根本不生成预览包**，正式页面无从拼接。
