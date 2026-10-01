/**
 * 调试音效按钮点击问题
 */

console.log('=== 音效按钮点击调试 ===\n');

// 1. 检查按钮
const buttons = document.querySelectorAll('.sound-effect-btn');
console.log('1. 音效按钮数量:', buttons.length);

if (buttons.length > 0) {
    const btn = buttons[0];
    console.log('   第一个按钮:');
    console.log('   - data-command:', btn.getAttribute('data-command'));
    console.log('   - data-sound-effect:', btn.getAttribute('data-sound-effect'));
    console.log('   - 父元素:', btn.parentElement?.id);
    console.log('   - 祖父元素:', btn.parentElement?.parentElement?.id);
}

// 2. 检查面板
const panel = document.getElementById('smartl-panel');
console.log('\n2. 智能面板:');
console.log('   存在:', !!panel);

// 3. 检查事件监听器
console.log('\n3. 测试点击事件:');
if (buttons.length > 0) {
    const btn = buttons[0];
    const command = btn.getAttribute('data-command');
    
    console.log('   模拟点击按钮...');
    console.log('   命令:', command);
    
    // 创建点击事件
    const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
    });
    
    btn.dispatchEvent(clickEvent);
    
    console.log('   点击事件已触发');
}

// 4. 检查 SmartlUI 实例
console.log('\n4. SmartlUI 实例:');
if (window.smartlUI) {
    console.log('   存在: ✅');
    console.log('   handleCommand:', typeof window.smartlUI.handleCommand);
} else {
    console.log('   存在: ❌');
}

console.log('\n=== 调试完成 ===');
