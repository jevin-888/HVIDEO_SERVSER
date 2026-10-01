/**
 * 修复手机端导航问题
 * 添加错误处理和调试信息
 */

const fs = require('fs');

console.log('🔧 修复手机端导航问题...\n');

// 1. 在底部导航UI中添加更好的错误处理
console.log('📝 优化底部导航UI的错误处理...');

const bottomNavPath = 'static/vod_song/mobile/navigation/bottomNav/BottomNavUI.js';
let bottomNavContent = fs.readFileSync(bottomNavPath, 'utf8');

// 检查是否已经有错误处理
if (!bottomNavContent.includes('setupErrorPanel')) {
  console.log('  ✅ 添加错误处理方法');
  
  // 在文件末尾添加错误处理方法
  const errorHandlingMethods = `

  /**
   * 设置错误面板
   */
  setupErrorPanel(panelId, panel, errorMessage) {
    const errorContent = \`
      <div class="fixed inset-0 z-[10004]">
        <div class="fixed inset-0 bg-black/20 backdrop-blur opacity-0 transition-opacity duration-300" id="\${panelId}-overlay"></div>
        <div class="fixed bottom-[80px] left-0 right-0 bg-white dark:bg-gray-800 rounded-t-2xl p-4 h-[70vh] overflow-hidden transform translate-y-full transition-transform duration-300">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-xl font-bold text-red-600 dark:text-red-400">加载失败</h3>
            <button class="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 close-panel-btn">
              <i class="fa fa-times text-lg"></i>
            </button>
          </div>
          <div class="text-center py-10">
            <i class="fa fa-exclamation-triangle text-4xl text-red-500 mb-4"></i>
            <p class="text-gray-600 dark:text-gray-400 mb-2">面板加载失败</p>
            <p class="text-sm text-gray-500 dark:text-gray-500">\${errorMessage}</p>
            <button class="mt-4 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors retry-btn">
              重试
            </button>
          </div>
        </div>
      </div>\`;
    
    panel.innerHTML = errorContent;
    
    // 绑定重试按钮
    const retryBtn = panel.querySelector('.retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        this.closePanel(panelId);
        setTimeout(() => this.togglePanel(panelId), 300);
      });
    }
    
    // 绑定关闭按钮
    const closeBtn = panel.querySelector('.close-panel-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.closePanel(panelId);
      });
    }
  }

  /**
   * 设置默认面板
   */
  setupDefaultPanel(panelId, panel) {
    const defaultContent = \`
      <div class="fixed inset-0 z-[10004]">
        <div class="fixed inset-0 bg-black/20 backdrop-blur opacity-0 transition-opacity duration-300" id="\${panelId}-overlay"></div>
        <div class="fixed bottom-[80px] left-0 right-0 bg-white dark:bg-gray-800 rounded-t-2xl p-4 h-[70vh] overflow-hidden transform translate-y-full transition-transform duration-300">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-xl font-bold text-gray-800 dark:text-white">\${panelId}</h3>
            <button class="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 close-panel-btn">
              <i class="fa fa-times text-lg"></i>
            </button>
          </div>
          <div class="text-center py-10">
            <i class="fa fa-cog text-4xl text-gray-400 mb-4"></i>
            <p class="text-gray-500 dark:text-gray-400">功能开发中...</p>
          </div>
        </div>
      </div>\`;
    
    panel.innerHTML = defaultContent;
    
    // 绑定关闭按钮
    const closeBtn = panel.querySelector('.close-panel-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.closePanel(panelId);
      });
    }
  }`;

  // 在类的最后一个方法之前插入新方法
  const insertPosition = bottomNavContent.lastIndexOf('}');
  bottomNavContent = bottomNavContent.slice(0, insertPosition) + errorHandlingMethods + '\n' + bottomNavContent.slice(insertPosition);
  
  fs.writeFileSync(bottomNavPath, bottomNavContent);
} else {
  console.log('  ✅ 错误处理方法已存在');
}

// 2. 优化createPanel方法的错误处理
console.log('📝 优化createPanel方法的错误处理...');

if (!bottomNavContent.includes('console.error(`创建面板 ${panelId} 失败:`')) {
  // 更新createPanel方法中的错误处理
  bottomNavContent = bottomNavContent.replace(
    /console\.error\(`创建面板 \${panelId} 失败:\`, error\);/,
    `console.error(\`创建面板 \${panelId} 失败:\`, error);
      console.error('错误详情:', {
        panelId: panelId,
        error: error.message,
        stack: error.stack
      });`
  );
  
  fs.writeFileSync(bottomNavPath, bottomNavContent);
  console.log('  ✅ 已优化错误处理');
} else {
  console.log('  ✅ 错误处理已优化');
}

// 3. 创建调试工具脚本
console.log('📝 创建调试工具脚本...');

const debugScript = `
/**
 * 手机端导航调试工具
 * 在浏览器控制台中使用
 */

// 调试工具对象
window.MobileNavDebug = {
  // 检查底部导航状态
  checkBottomNav() {
    console.log('=== 底部导航状态检查 ===');
    console.log('bottomNavUI:', window.bottomNavUI);
    console.log('当前打开面板:', window.bottomNavUI?.currentOpenPanel);
    
    const navElement = document.getElementById('bottom-nav');
    console.log('导航元素:', navElement);
    
    if (navElement) {
      const buttons = navElement.querySelectorAll('.bottom-nav-btn');
      console.log('导航按钮数量:', buttons.length);
      buttons.forEach((btn, index) => {
        console.log(\`按钮\${index}:\`, {
          panel: btn.dataset.panel,
          active: btn.classList.contains('active'),
          element: btn
        });
      });
    }
  },

  // 检查面板状态
  checkPanels() {
    console.log('=== 面板状态检查 ===');
    const panels = ['smart', 'selected', 'scene'];
    panels.forEach(panelId => {
      const panel = document.getElementById(\`\${panelId}-panel\`);
      console.log(\`\${panelId}面板:\`, {
        exists: !!panel,
        hidden: panel?.classList.contains('hidden'),
        element: panel
      });
    });
  },

  // 强制打开面板
  forceOpenPanel(panelId) {
    console.log(\`强制打开面板: \${panelId}\`);
    if (window.bottomNavUI) {
      window.bottomNavUI.togglePanel(panelId).catch(error => {
        console.error('打开面板失败:', error);
      });
    } else {
      console.error('bottomNavUI 未初始化');
    }
  },

  // 检查服务状态
  checkServices() {
    console.log('=== 服务状态检查 ===');
    console.log('smartlUI:', window.smartlUI);
    console.log('displayUI:', window.displayUI);
    console.log('selectedUI:', window.selectedUI);
    console.log('apiService:', window.apiService);
    console.log('logService:', window.logService);
  },

  // 检查错误日志
  checkErrors() {
    console.log('=== 错误日志检查 ===');
    if (window.logService && window.logService.logs) {
      const errors = window.logService.logs.filter(log => log.level === 'error');
      console.log('错误日志数量:', errors.length);
      errors.slice(-5).forEach(error => {
        console.log('错误:', error);
      });
    } else {
      console.log('无法访问日志服务');
    }
  },

  // 完整诊断
  fullDiagnosis() {
    console.log('🔍 开始完整诊断...');
    this.checkBottomNav();
    this.checkPanels();
    this.checkServices();
    this.checkErrors();
    console.log('✅ 诊断完成');
  }
};

// 自动运行基础检查
console.log('📱 手机端导航调试工具已加载');
console.log('使用 MobileNavDebug.fullDiagnosis() 进行完整诊断');
console.log('使用 MobileNavDebug.forceOpenPanel("smart") 强制打开控制面板');
`;

fs.writeFileSync('static/vod_song/mobile/debug-nav.js', debugScript);

// 4. 创建修复报告
console.log('\n📊 修复完成报告:');
console.log('✅ 优化了底部导航UI的错误处理');
console.log('✅ 添加了错误面板和默认面板');
console.log('✅ 创建了调试工具脚本');

console.log('\n🔧 使用说明:');
console.log('1. 在手机端页面打开开发者工具');
console.log('2. 在控制台加载调试脚本:');
console.log('   const script = document.createElement("script");');
console.log('   script.src = "./debug-nav.js";');
console.log('   document.head.appendChild(script);');
console.log('3. 运行 MobileNavDebug.fullDiagnosis() 进行诊断');
console.log('4. 使用 MobileNavDebug.forceOpenPanel("smart") 测试面板');

console.log('\n💡 如果问题仍然存在，请检查:');
console.log('- 浏览器控制台的JavaScript错误');
console.log('- 网络面板的API请求状态');
console.log('- 确认WebSocket连接是否正常');

process.exit(0);