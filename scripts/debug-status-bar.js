/**
 * 调试状态栏显示问题
 * 在浏览器控制台中运行此脚本
 */

console.log('=== 状态栏调试脚本 ===\n');

// 1. 检查状态栏元素
const statusBar = document.getElementById('peripheral-status-bar');
console.log('1. 状态栏元素:');
console.log('   存在:', !!statusBar);
if (statusBar) {
    console.log('   innerHTML:', statusBar.innerHTML);
    console.log('   子元素数量:', statusBar.children.length);
}

// 2. 检查 peripheralStatusBar 对象
console.log('\n2. peripheralStatusBar 对象:');
console.log('   存在:', typeof peripheralStatusBar !== 'undefined');
if (typeof peripheralStatusBar !== 'undefined') {
    console.log('   statusBarElement:', peripheralStatusBar.statusBarElement);
    console.log('   currentRoomId:', peripheralStatusBar.currentRoomId);
}

// 3. 检查当前选中的房间
console.log('\n3. 当前选中房间:');
console.log('   selectedRoomId:', window.selectedRoomId);

// 4. 检查房间缓存
console.log('\n4. 房间缓存:');
if (window.allRoomsCache && window.selectedRoomId) {
    const room = window.allRoomsCache.find(r => r.id === window.selectedRoomId);
    console.log('   当前房间数据:', room);
    if (room) {
        console.log('   acState:', room.acState);
        console.log('   lightState:', room.lightState);
        console.log('   effectState:', room.effectState);
    }
}

// 5. 手动触发更新
console.log('\n5. 手动触发状态栏更新:');
if (typeof peripheralStatusBar !== 'undefined' && window.allRoomsCache && window.selectedRoomId) {
    const room = window.allRoomsCache.find(r => r.id === window.selectedRoomId);
    if (room) {
        console.log('   调用 peripheralStatusBar.updateStatus...');
        peripheralStatusBar.updateStatus(room);
        console.log('   更新完成');
        
        // 再次检查 HTML
        const statusBar = document.getElementById('peripheral-status-bar');
        if (statusBar) {
            console.log('   更新后的 innerHTML:', statusBar.innerHTML);
        }
    } else {
        console.log('   ❌ 未找到当前房间数据');
    }
} else {
    console.log('   ❌ 缺少必要的对象或数据');
}

console.log('\n=== 调试完成 ===');
