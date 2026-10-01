# 客户收银内嵌模块加载排查与资源补齐

前台房态是 Flutter 原生页面；预定、会员、库存、财务、基础设置和系统管理加载服务器 `/static/cashier/index.html?desktop=1`，通过 `desktop_bridge.js` 与桌面窗口握手。前台可用不代表静态页面和 WebView2 正常。

必须在实际运行服务器 EXE 同级保留：

```text
static/cashier/index.html
static/cashier/desktop_bridge.js
static/cashier/cashier.js
static/cashier/cashier_room_pos.js
static/cashier/settings_translations.js
static/cashier/settings_controls.js
static/admin/api.js
static/libs/tailwindcss.js
```

此前 `HVideo-Server-Cashier-Discovery-Update.zip` 仅含 EXE 和发现说明，不包含这些静态文件。旧网页或文件缺失均可能导致内嵌握手失败；也可能是 WebView2 问题，不能仅凭截图认定缺文件。

补齐包：`release/HVideo-Cashier-Server-Resources-20260919.zip`，8 个资源加部署说明，保持 static 相对目录。备份现场对应静态文件后合并覆盖，保留其他 static 资源，禁止覆盖数据库、config.toml 或授权。服务器仍需配套当前业务 API 的 EXE。

验证：本机 8 文件 HTTP 均返回 200，内容逐项与源码及正式部署一致，ZIP 内文件 SHA-256 均匹配。ZIP SHA-256：`1e075fd6b831aa5abdc6974e533d50f08f701fd88f6b775e6de35b1275355c76`。本轮没有修改业务代码，不重新编译 EXE；客户现场尚未验证。

现场先从收银电脑访问 `http://服务器IP:端口/static/cashier/index.html`（不加 desktop 参数）及上述脚本，确认页面/JS 可正常返回。仍失败时检查 Edge WebView2 Runtime，读取收银电脑 `%LOCALAPPDATA%\HVideo Cashier\logs\module-loading.log`；此日志包含 document.readyState、bridge 与 showPage 就绪状态，与连接诊断 cashier.log 不同。
