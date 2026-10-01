// Capacitor 环境配置
// APK 中使用 localStorage 存储的 IP 配置，与浏览器版本保持一致
(function() {
  // 检测是否在 Capacitor 环境中运行
  const isCapacitor = window.Capacitor !== undefined;
  
  if (isCapacitor) {
    // 检查是否已有 IP 配置
    const hasConfig = localStorage.getItem('clientIp') !== null;
    
    if (!hasConfig) {
      // 首次运行：从 apiConfig.js 获取默认服务器 IP（避免硬编码）
      // 用户可以通过左上角连续点击5次打开设置修改
      const DEFAULT_SERVER_IP = window.DEFAULT_IP || window.AppConfig?.defaultIp || '192.168.1.28';
      
      localStorage.setItem('clientIp', DEFAULT_SERVER_IP);
      localStorage.setItem('songServerIp', DEFAULT_SERVER_IP);
      localStorage.setItem('cashierServerIp', DEFAULT_SERVER_IP);
    } else {
      console.log('[Capacitor] 当前客户端 IP:', localStorage.getItem('clientIp'));
      console.log('[Capacitor] 当前服务器 IP:', localStorage.getItem('songServerIp') || localStorage.getItem('clientIp'));
    }
    
    // 标记 Capacitor 环境
    window.AppConfig = window.AppConfig || {};
    window.AppConfig.isCapacitor = true;
  }
})();
