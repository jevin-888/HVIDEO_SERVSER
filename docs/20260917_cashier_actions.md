# 2026-09-17 收银业务入口修复

- Flutter 收银端原四个按钮为占位回调，现通过 `desktop_bridge.js` 调用原开房、点单、结账、打印流程；不新增或改变业务 HTTP API。
- 原生端发送 `hvideoDesktopCashierAction({id, action, roomId})`，桥接校验收银模块权限并重新获取服务器房间、类型、区域、会员和预定。使用请求编号回传 `cashierActionReady`、`cashierActionError`、`cashierReturn`，防止迟到结果影响新页面。
- 内嵌模式打印复用原账单 HTML，通过页面内 iframe 预览和打印按钮调用打印；普通浏览器保留原打印窗口。完成或返回时通知原生端刷新房态、账单和商品明细。
- 更新 `index.html` 的静态脚本缓存版本；部署文件为 `static/cashier/{index.html,desktop_bridge.js,cashier.js,cashier_room_pos.js}`。
- 回归：`node scripts/cashier-desktop-ui.test.mjs`、`node scripts/cashier-actions-ui.test.mjs` 通过。新增回归实际点击原业务表单，使用隔离内存 API 验证开房/定时、点单提交、账单预览/打印调用、收款取消/确认、结账台、选中房间、权限和请求失败，不写入营业数据库。实体打印机出纸未验证。
- 对应客户端：`D:\HVIDEO\hvideo_cashier_flutter`，静态分析无问题、30 项 Flutter 测试通过。
