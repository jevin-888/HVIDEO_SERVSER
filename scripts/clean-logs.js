// 清理项目中的调试日志
const fs = require('fs');
const path = require('path');

// 定义要清理的日志行（完整匹配）
const logsToRemove = [
  // SmartlUI.js 调试日志
  "    logInfo('SmartlUI', '渲染控制面板:', controls);",
  "    logInfo('SmartlUI', '更新控制状态:', status);",
  "    logInfo('SmartlUI', '绑定控制相关事件');",
  "    logInfo('SmartlUI', '========== createSmartlPanel 完成，准备渲染音效按钮 ==========');",
  "      logInfo('SmartlUI', 'createSmartlPanel 的 setTimeout 回调执行，检查面板是否存在...');",
  "        logInfo('SmartlUI', '音效面板已存在，开始调用 renderSoundEffectButtons');",
  "    logInfo('SmartlUI', '智控面板内容已更新');",
  "    logInfo('SmartlUI', `已强制修复 ${volumeButtons.length} 个音量按钮尺寸（使用新方案）`);",
  "    logInfo('SmartlUI', `获取灯光图标: type=${typeStr}, icon=${icon}`);",
  "      logInfo('[SmartlUI] 开始获取灯光预设数据...');",
  "        logInfo('[SmartlUI] 获取到灯光预设:', lightPresets);",
  "        logInfo('[SmartlUI] 灯光预设数量:', lightPresets.length);",
  "        logInfo('[SmartlUI] 生成的灯光按钮HTML长度:', lightButtonsHTML.length);",
  "        logInfo('[SmartlUI] 灯光按钮容器更新完成，子元素数量:', lightButtonsContainer.children.length);",
  "          logInfo('[SmartlUI] 灯光按钮生成完成，当前状态:', state);",
  "      logInfo('[SmartlUI] 空调按钮异步渲染完成');",
  "    logInfo('[SmartlUI] bindPanelEvents 被调用, panelId:', panelId);",
  "    logInfo('[SmartlUI] 找到面板元素:', panel.id);",
  "              logInfo('[SmartlUI] 切换到灯光面板，检查灯光按钮是否已生成');",
  "                  logInfo('[SmartlUI] 灯光按钮未生成，重新生成');",
  "                  logInfo('[SmartlUI] 灯光按钮已生成，数量:', lightButtonsContainer?.children.length);",
  "              logInfo('[SmartlUI] ========== 切换到音效面板 ==========');",
  "                logInfo('[SmartlUI] 检查音效按钮容器...');",
  "                logInfo('[SmartlUI] 容器查找结果:', soundEffectButtonsContainer ? '找到' : '未找到');",
  "                  logInfo('[SmartlUI] 容器子元素数量:', soundEffectButtonsContainer.children.length);",
  "                    logInfo('[SmartlUI] 音效按钮未生成，重新生成');",
  "                    logInfo('[SmartlUI] 音效按钮已生成，数量:', soundEffectButtonsContainer.children.length);",
  "                  logInfo('[SmartlUI] 音效面板存在:', !!audioTab);",
  "                    logInfo('[SmartlUI] 音效面板HTML:', audioTab.innerHTML.substring(0, 200));",
  "      logInfo('[SmartlUI] 检查音量按钮:', volumeBtn);",
  "        logInfo('[SmartlUI] 找到音量按钮，data-volume:', volumeBtn.dataset.volume);",
  "        logInfo('[SmartlUI] 准备调用 handleVolumeChange:', volumeBtn.dataset.volume);",
  "        logInfo('[SmartlUI] handleVolumeChange 调用完成');",
  "      logInfo('SmartlUI', `命令 ${command} 执行成功:`, result);",
  "      logInfo('SmartlUI', `处理音量变化: ${action}`);",
  "      logInfo('SmartlUI', `音量操作 ${action} 执行成功:`, result);",
  "      logInfo(`温度操作 ${action} 执行成功:`, result);",
  "    logInfo('[SmartlUI] 更新音量显示，当前状态:', state);",
  "      logInfo('[SmartlUI] 更新音乐音量显示:', state.volume);",
  "      logInfo('[SmartlUI] 音乐进度条元素:', musicProgress);",
  "      logInfo('[SmartlUI] 设置音乐音量进度条前 style:', musicProgress.style.cssText);",
  "      logInfo('[SmartlUI] 设置音乐音量进度条后 style:', musicProgress.style.cssText);",
  "      logInfo('[SmartlUI] 更新音乐音量进度条:', state.volume + '%');",
  "      logInfo('[SmartlUI] 更新麦克风音量显示:', state.micVolume);",
  "      logInfo('[SmartlUI] 麦克风进度条元素:', micProgress);",
  "      logInfo('[SmartlUI] 设置麦克风音量进度条前 style:', micProgress.style.cssText);",
  "      logInfo('[SmartlUI] 设置麦克风音量进度条后 style:', micProgress.style.cssText);",
  "      logInfo('[SmartlUI] 更新麦克风音量进度条:', state.micVolume + '%');",
  "      logInfo('[SmartlUI] 开始同步初始状态...');",
  "        logWarn('SmartlUI', '音效面板还不存在，延迟500ms后重试');",
  "            logWarn('SmartlUI', `检测到按钮变形: ${width}x${height}, 预期: ${expectedSize}x${expectedSize}`);",
  "            logWarn('SmartlUI', `检测到父容器变化导致按钮变形: ${rect.width}x${rect.height}, 预期: ${expectedSize}x${expectedSize}`);",
  
  // console.log 调用
  "  console.log('[Capacitor] WebSocket 使用服务器 IP:', webSocketHost);",
  "  console.log('[Capacitor] 使用完整 URL 访问服务器');",
  "  console.log('[Capacitor] 服务器 IP:', serverIp);",
  "  console.log('[Capacitor] API BaseURL:', config.mucServer.baseUrl);",
  "  console.log('[AppConfig] 歌星图片使用本地 API 路由');",
  "  console.log('[AppConfig] 新架构：服务器通过客户端IP自动识别房间');",
  "                    console.log('[WebSocketClient] 正在建立连接:', url);",
  "                        console.log('[WebSocketClient] 连接成功:', this.url);",
  "                console.log('[WebSocketClient] 连接关闭');",
  "                console.log('[WebSocketClient] 收到消息:', data);",
  "                    console.log('[WebSocketClient] 收到房间状态变更:', data);",
  "                console.log(`[WebSocketClient] 尝试重连 (第${this.reconnectAttempts}次)`);",
  "            console.log('[WebSocketClient] 正在初始化...');",
  "            console.log('[WebSocketClient] 配置:', wsUrl);",
  "            console.log('[WebSocketClient] 初始化完成');",
  "    console.log('[AndroidInput] 中文输入开始');",
  "    console.log('[AndroidInput] 中文输入更新:', compositionText);",
  "    console.log('[AndroidInput] 中文输入结束:', e.data);",
  "      console.log('[AndroidInput] 输入中，当前值:', e.target.value);",
  "  console.log('[AndroidInput] Android输入法优化已启用');",
  "  console.log('[AndroidInput] 光标修复已启用');",
  "      console.log(`[LangService] 正在请求语言包: ${language} -> ${url}`);",
  "        console.log('[SmartlUI] 等待 smartlService 全局对象...');",
  "    console.log('渲染控制面板:', controls);",
  "    console.log('更新控制状态:', status);",
  "    console.log('绑定控制相关事件');",
  "    console.log('智控面板内容已更新');"
];

// 定义要处理的文件（使用绝对路径）
const rootDir = path.resolve(__dirname, '..');
const files = [
  path.join(rootDir, 'static/vod_song/client/navigation/smartl/SmartlUI.js'),
  path.join(rootDir, 'static/vod_song/client/navigation/display/DisplayUI.js'),
  path.join(rootDir, 'static/vod_song/client/navigation/selected/SelectedUI.js'),
  path.join(rootDir, 'static/vod_song/client/navigation/bottomNav/BottomNavUI.js'),
  path.join(rootDir, 'static/vod_song/shared/config/apiConfig.js'),
  path.join(rootDir, 'static/vod_song/shared/websocket/websocket-client.js'),
  path.join(rootDir, 'static/vod_song/shared/utils/AndroidInputOptimization.js'),
  path.join(rootDir, 'static/vod_song/shared/services/LangService/LangService.js'),
  path.join(rootDir, 'static/vod_song/mobile/navigation/smartl/SmartlUI.js')
];

let totalRemoved = 0;

files.forEach(filePath => {
  if (!fs.existsSync(filePath)) {
    console.log(`⚠ 文件不存在: ${filePath}`);
    return;
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  const originalLines = content.split('\n').length;
  let removed = 0;
  
  logsToRemove.forEach(logLine => {
    const lines = content.split('\n');
    const newLines = lines.filter(line => line.trim() !== logLine.trim());
    if (newLines.length < lines.length) {
      removed += lines.length - newLines.length;
      content = newLines.join('\n');
    }
  });
  
  if (removed > 0) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✓ ${filePath}: 清理了 ${removed} 行`);
    totalRemoved += removed;
  } else {
    console.log(`- ${filePath}: 无需清理`);
  }
});

console.log(`\n✓ 完成！共清理 ${totalRemoved} 行调试日志`);
console.log('建议运行同步脚本将更改同步到安卓项目');
