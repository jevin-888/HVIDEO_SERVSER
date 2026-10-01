// 诊断 SettingsUI 加载问题
console.log('=== SettingsUI 诊断开始 ===');

// 1. 检查模块加载器
console.log('1. 检查 moduleLoader:', typeof window.moduleLoader);

// 2. 检查 settingsUI 是否已加载
console.log('2. 检查 window.settingsUI:', typeof window.settingsUI);

// 3. 尝试手动加载
async function testLoad() {
  try {
    console.log('3. 尝试加载 SettingsUI...');
    
    // 清除缓存
    const timestamp = Date.now();
    const module = await import(`./navigation/settings/SettingsUI.js?v=${timestamp}`);
    
    console.log('✓ 模块加载成功');
    console.log('  - 默认导出:', typeof module.default);
    console.log('  - showModal 方法:', typeof module.default?.showModal);
    console.log('  - createModal 方法:', typeof module.default?.createModal);
    
    // 4. 尝试打开设置
    if (module.default && typeof module.default.showModal === 'function') {
      console.log('4. 尝试打开设置弹窗...');
      await module.default.showModal();
      console.log('✓ 设置弹窗已打开');
    } else {
      console.error('✗ 模块没有 showModal 方法');
    }
    
  } catch (e) {
    console.error('✗ 加载失败:', e.message);
    console.error('  堆栈:', e.stack);
  }
}

// 5. 检查设置按钮
const settingsBtn = document.getElementById('settings-btn');
console.log('5. 设置按钮:', settingsBtn ? '存在' : '不存在');
if (settingsBtn) {
  console.log('  - 是否隐藏:', settingsBtn.classList.contains('hidden'));
  console.log('  - display:', settingsBtn.style.display);
}

// 执行测试
testLoad();

console.log('=== SettingsUI 诊断结束 ===');
