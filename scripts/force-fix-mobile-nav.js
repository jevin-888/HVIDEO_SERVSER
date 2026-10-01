/**
 * 强制修复手机端导航问题
 * 添加备用初始化和错误恢复机制
 */

const fs = require('fs');

console.log('🔧 强制修复手机端导航问题...\n');

// 1. 在HTML文件末尾添加备用初始化脚本
console.log('📝 添加备用初始化脚本...');

const htmlPath = 'static/vod_song/mobile/index.html';
let htmlContent = fs.readFileSync(htmlPath, 'utf8');

// 检查是否已经有备用脚本
if (!htmlContent.includes('<!-- 备用导航初始化脚本 -->')) {
  const backupScript = `
    <!-- 备用导航初始化脚本 -->
    <script>
        // 备用底部导航初始化
        function initBackupBottomNav() {
            console.log('[备用] 开始初始化底部导航...');
            
            // 检查是否已经有底部导航
            if (document.getElementById('bottom-nav')) {
                console.log('[备用] 底部导航已存在，跳过初始化');
                return;
            }
            
            // 创建简单的底部导航
            const nav = document.createElement('footer');
            nav.id = 'bottom-nav';
            nav.className = 'fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 z-[10005] border-t border-gray-100 dark:border-gray-700 rounded-t-lg shadow-lg';
            nav.style.paddingBottom = 'env(safe-area-inset-bottom)';
            
            nav.innerHTML = \`
                <div class="flex justify-around items-center py-2">
                    <button data-panel="smart" class="control-btn bottom-nav-btn flex flex-col items-center justify-center p-2 relative group">
                        <i class="fa fa-magic text-lg text-gray-500 dark:text-white group-[.active]:text-primary transition-colors duration-300"></i>
                        <span class="text-xs mt-1 text-gray-500 dark:text-white group-[.active]:text-primary transition-colors duration-300">控制</span>
                    </button>
                    <button data-panel="scene" class="control-btn bottom-nav-btn flex flex-col items-center justify-center p-2 relative group">
                        <i class="fa fa-image text-lg text-gray-500 dark:text-white group-[.active]:text-primary transition-colors duration-300"></i>
                        <span class="text-xs mt-1 text-gray-500 dark:text-white group-[.active]:text-primary transition-colors duration-300">场景</span>
                    </button>
                    <button data-panel="selected" class="control-btn bottom-nav-btn flex flex-col items-center justify-center p-2 relative group">
                        <i class="fa fa-music text-lg text-gray-500 dark:text-white group-[.active]:text-primary transition-colors duration-300"></i>
                        <span class="text-xs mt-1 text-gray-500 dark:text-white group-[.active]:text-primary transition-colors duration-300">已选</span>
                        <span id="selected-badge" class="selected-badge absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center hidden">0</span>
                    </button>
                </div>\`;
            
            document.body.appendChild(nav);
            
            // 绑定点击事件
            nav.querySelectorAll('.bottom-nav-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const panelId = e.currentTarget.dataset.panel;
                    console.log('[备用] 底部导航按钮被点击:', panelId);
                    
                    // 尝试使用正常的togglePanel方法
                    if (window.bottomNavUI && typeof window.bottomNavUI.togglePanel === 'function') {
                        window.bottomNavUI.togglePanel(panelId);
                    } else {
                        // 备用面板显示
                        showBackupPanel(panelId);
                    }
                });
            });
            
            console.log('[备用] 底部导航初始化完成');
        }
        
        // 备用面板显示
        function showBackupPanel(panelId) {
            console.log('[备用] 显示面板:', panelId);
            
            // 移除现有面板
            const existingPanel = document.getElementById(\`\${panelId}-panel\`);
            if (existingPanel) {
                existingPanel.remove();
            }
            
            // 创建简单面板
            const panel = document.createElement('div');
            panel.id = \`\${panelId}-panel\`;
            panel.className = 'fixed inset-0 z-[10004]';
            
            const panelNames = {
                'smart': '控制',
                'scene': '场景', 
                'selected': '已选'
            };
            
            panel.innerHTML = \`
                <div class="fixed inset-0 bg-black/20 backdrop-blur" onclick="this.parentElement.remove()"></div>
                <div class="fixed bottom-[80px] left-0 right-0 bg-white dark:bg-gray-800 rounded-t-2xl p-4 h-[70vh] overflow-hidden">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-xl font-bold text-gray-800 dark:text-white">\${panelNames[panelId] || panelId}</h3>
                        <button onclick="this.closest('#\${panelId}-panel').remove()" class="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                            <i class="fa fa-times text-lg"></i>
                        </button>
                    </div>
                    <div class="text-center py-10">
                        <i class="fa fa-exclamation-triangle text-4xl text-yellow-500 mb-4"></i>
                        <p class="text-gray-600 dark:text-gray-400 mb-2">面板加载中...</p>
                        <p class="text-sm text-gray-500 dark:text-gray-500">正在尝试加载完整功能</p>
                        <button onclick="location.reload()" class="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
                            刷新页面
                        </button>
                    </div>
                </div>\`;
            
            document.body.appendChild(panel);
            
            // 尝试加载完整功能
            setTimeout(() => {
                if (window.bottomNavUI && typeof window.bottomNavUI.togglePanel === 'function') {
                    panel.remove();
                    window.bottomNavUI.togglePanel(panelId);
                }
            }, 2000);
        }
        
        // 监听DOM加载完成
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(initBackupBottomNav, 2000); // 延迟2秒，给正常初始化时间
            });
        } else {
            setTimeout(initBackupBottomNav, 2000);
        }
        
        // 监听错误并提供恢复选项
        window.addEventListener('error', (event) => {
            console.error('[备用] 检测到错误:', event.error);
            
            // 如果是模块加载错误，显示恢复提示
            if (event.error.message.includes('import') || event.error.message.includes('module')) {
                setTimeout(() => {
                    if (!document.getElementById('bottom-nav')) {
                        initBackupBottomNav();
                    }
                }, 1000);
            }
        });
    </script>

    <!-- 调试信息显示 -->
    <script>
        // 添加调试信息显示
        function showDebugInfo() {
            const debugDiv = document.createElement('div');
            debugDiv.id = 'debug-info';
            debugDiv.style.cssText = \`
                position: fixed;
                top: 10px;
                right: 10px;
                background: rgba(0,0,0,0.8);
                color: white;
                padding: 10px;
                border-radius: 5px;
                font-size: 12px;
                z-index: 20000;
                max-width: 300px;
                display: none;
            \`;
            
            function updateDebugInfo() {
                const info = [
                    \`时间: \${new Date().toLocaleTimeString()}\`,
                    \`bottomNavUI: \${window.bottomNavUI ? '✅' : '❌'}\`,
                    \`底部导航元素: \${document.getElementById('bottom-nav') ? '✅' : '❌'}\`,
                    \`smartlUI: \${window.smartlUI ? '✅' : '❌'}\`,
                    \`displayUI: \${window.displayUI ? '✅' : '❌'}\`,
                    \`logService: \${window.logService ? '✅' : '❌'}\`
                ];
                debugDiv.innerHTML = info.join('<br>');
            }
            
            document.body.appendChild(debugDiv);
            
            // 双击右上角显示/隐藏调试信息
            document.addEventListener('dblclick', (e) => {
                if (e.clientX > window.innerWidth - 100 && e.clientY < 100) {
                    debugDiv.style.display = debugDiv.style.display === 'none' ? 'block' : 'none';
                    if (debugDiv.style.display === 'block') {
                        updateDebugInfo();
                        setInterval(updateDebugInfo, 1000);
                    }
                }
            });
        }
        
        document.addEventListener('DOMContentLoaded', showDebugInfo);
    </script>
</body>
</html>`;

  // 在</body>标签前插入备用脚本
  htmlContent = htmlContent.replace('</body>', backupScript);
  fs.writeFileSync(htmlPath, htmlContent);
  console.log('  ✅ 备用初始化脚本已添加');
} else {
  console.log('  ✅ 备用初始化脚本已存在');
}

// 2. 创建独立的导航测试页面
console.log('\n📝 创建独立导航测试页面...');

const testPageContent = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>导航功能测试</title>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 min-h-screen">
    <div class="container mx-auto p-4">
        <h1 class="text-2xl font-bold mb-6 text-center">手机端导航功能测试</h1>
        
        <div class="bg-white rounded-lg shadow-md p-6 mb-6">
            <h2 class="text-lg font-semibold mb-4">快速测试</h2>
            <div class="grid grid-cols-1 gap-3">
                <button onclick="testNavigation()" class="w-full p-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
                    🔍 测试导航功能
                </button>
                <button onclick="forceCreateNav()" class="w-full p-3 bg-green-500 text-white rounded-lg hover:bg-green-600">
                    🔧 强制创建导航
                </button>
                <button onclick="openPanel('smart')" class="w-full p-3 bg-purple-500 text-white rounded-lg hover:bg-purple-600">
                    🎛️ 打开控制面板
                </button>
                <button onclick="openPanel('selected')" class="w-full p-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600">
                    🎵 打开已选面板
                </button>
                <button onclick="openPanel('scene')" class="w-full p-3 bg-pink-500 text-white rounded-lg hover:bg-pink-600">
                    🖼️ 打开场景面板
                </button>
            </div>
        </div>
        
        <div class="bg-white rounded-lg shadow-md p-6">
            <h2 class="text-lg font-semibold mb-4">测试结果</h2>
            <div id="test-results" class="space-y-2 text-sm"></div>
        </div>
    </div>

    <script>
        function log(message, type = 'info') {
            const results = document.getElementById('test-results');
            const div = document.createElement('div');
            const colors = {
                info: 'text-blue-600',
                success: 'text-green-600', 
                error: 'text-red-600',
                warning: 'text-yellow-600'
            };
            div.className = \`p-2 rounded \${colors[type] || colors.info}\`;
            div.innerHTML = \`<strong>\${new Date().toLocaleTimeString()}</strong>: \${message}\`;
            results.appendChild(div);
            results.scrollTop = results.scrollHeight;
            console.log(message);
        }

        function testNavigation() {
            log('开始导航功能测试...', 'info');
            
            // 检查底部导航元素
            const bottomNav = document.getElementById('bottom-nav');
            log(\`底部导航元素: \${bottomNav ? '✅ 存在' : '❌ 不存在'}\`, bottomNav ? 'success' : 'error');
            
            // 检查全局对象
            const globals = ['bottomNavUI', 'smartlUI', 'displayUI', 'logService'];
            globals.forEach(name => {
                const exists = window[name];
                log(\`\${name}: \${exists ? '✅ 存在' : '❌ 不存在'}\`, exists ? 'success' : 'error');
            });
            
            // 检查方法
            if (window.bottomNavUI) {
                const methods = ['togglePanel', 'createPanel', 'closePanel'];
                methods.forEach(method => {
                    const exists = typeof window.bottomNavUI[method] === 'function';
                    log(\`bottomNavUI.\${method}: \${exists ? '✅ 存在' : '❌ 不存在'}\`, exists ? 'success' : 'error');
                });
            }
        }

        function forceCreateNav() {
            log('强制创建底部导航...', 'info');
            
            // 移除现有导航
            const existing = document.getElementById('bottom-nav');
            if (existing) {
                existing.remove();
                log('已移除现有导航', 'warning');
            }
            
            // 创建新导航
            const nav = document.createElement('footer');
            nav.id = 'bottom-nav';
            nav.className = 'fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg z-50';
            nav.innerHTML = \`
                <div class="flex justify-around items-center py-3">
                    <button onclick="openPanel('smart')" class="flex flex-col items-center p-2">
                        <i class="fa fa-magic text-lg mb-1"></i>
                        <span class="text-xs">控制</span>
                    </button>
                    <button onclick="openPanel('scene')" class="flex flex-col items-center p-2">
                        <i class="fa fa-image text-lg mb-1"></i>
                        <span class="text-xs">场景</span>
                    </button>
                    <button onclick="openPanel('selected')" class="flex flex-col items-center p-2">
                        <i class="fa fa-music text-lg mb-1"></i>
                        <span class="text-xs">已选</span>
                    </button>
                </div>\`;
            
            document.body.appendChild(nav);
            log('✅ 底部导航创建成功', 'success');
        }

        function openPanel(panelId) {
            log(\`尝试打开面板: \${panelId}\`, 'info');
            
            // 尝试使用正常方法
            if (window.bottomNavUI && typeof window.bottomNavUI.togglePanel === 'function') {
                try {
                    window.bottomNavUI.togglePanel(panelId);
                    log(\`✅ 使用正常方法打开面板: \${panelId}\`, 'success');
                    return;
                } catch (error) {
                    log(\`❌ 正常方法失败: \${error.message}\`, 'error');
                }
            }
            
            // 备用方法
            createSimplePanel(panelId);
        }

        function createSimplePanel(panelId) {
            log(\`使用备用方法创建面板: \${panelId}\`, 'warning');
            
            // 移除现有面板
            const existing = document.getElementById(\`\${panelId}-panel\`);
            if (existing) existing.remove();
            
            // 创建简单面板
            const panel = document.createElement('div');
            panel.id = \`\${panelId}-panel\`;
            panel.className = 'fixed inset-0 z-40';
            
            const titles = { smart: '控制', scene: '场景', selected: '已选' };
            
            panel.innerHTML = \`
                <div class="fixed inset-0 bg-black bg-opacity-50" onclick="this.parentElement.remove()"></div>
                <div class="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl p-6 h-96">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-xl font-bold">\${titles[panelId] || panelId}</h3>
                        <button onclick="this.closest('div[id$=\\"-panel\\"]').remove()" class="text-gray-500 hover:text-gray-700">
                            <i class="fa fa-times text-lg"></i>
                        </button>
                    </div>
                    <div class="text-center py-8">
                        <i class="fa fa-cog text-4xl text-gray-400 mb-4"></i>
                        <p class="text-gray-600">面板功能正在开发中...</p>
                        <button onclick="location.reload()" class="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg">
                            刷新页面
                        </button>
                    </div>
                </div>\`;
            
            document.body.appendChild(panel);
            log(\`✅ 备用面板创建成功: \${panelId}\`, 'success');
        }

        // 页面加载完成后自动测试
        document.addEventListener('DOMContentLoaded', () => {
            log('页面加载完成', 'info');
            setTimeout(testNavigation, 1000);
        });
    </script>
</body>
</html>`;

fs.writeFileSync('static/vod_song/mobile/nav-test.html', testPageContent);

console.log('\n📊 强制修复完成报告:');
console.log('✅ 添加了备用底部导航初始化');
console.log('✅ 添加了错误恢复机制');
console.log('✅ 添加了调试信息显示');
console.log('✅ 创建了独立测试页面');

console.log('\n🔧 使用说明:');
console.log('1. 访问原页面，双击右上角显示调试信息');
console.log('2. 访问测试页面: /vod_song/mobile/nav-test.html');
console.log('3. 如果2秒后仍无导航，会自动创建备用导航');
console.log('4. 备用导航提供基本功能和恢复选项');

console.log('\n💡 故障排除:');
console.log('- 如果页面完全无响应，检查JavaScript控制台错误');
console.log('- 如果导航按钮无反应，使用测试页面的强制创建功能');
console.log('- 如果面板无法打开，点击刷新页面按钮');

process.exit(0);