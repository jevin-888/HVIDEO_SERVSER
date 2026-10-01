/**
 * 检查并创建测试房间
 * 用于解决"房间未开房"的问题
 */

const API_BASE = 'http://localhost:8080/api/v1';

async function checkAndCreateTestRoom() {
  console.log('=== 检查房间状态 ===\n');

  try {
    // 1. 检查是否有房间
    console.log('1. 获取所有房间...');
    const roomsResponse = await fetch(`${API_BASE}/rooms/by-terminal?terminalIp=127.0.0.1`);
    
    if (!roomsResponse.ok) {
      console.error(`获取房间失败: ${roomsResponse.status} ${roomsResponse.statusText}`);
      const text = await roomsResponse.text();
      console.error('响应内容:', text);
      return;
    }

    const roomsData = await roomsResponse.json();
    console.log('房间列表响应:', JSON.stringify(roomsData, null, 2));

    if (roomsData.code === 0 && roomsData.data && roomsData.data.length > 0) {
      console.log(`\n找到 ${roomsData.data.length} 个房间:`);
      roomsData.data.forEach(room => {
        const statusText = room.status === 1 ? '开房' : room.status === 2 ? '维修' : '未开房';
        console.log(`  - ${room.name} (ID: ${room.id}, 状态: ${statusText}, 终端IP: ${room.terminalIp || '无'})`);
      });

      // 检查是否有开房状态的房间
      const openRooms = roomsData.data.filter(r => r.status === 1);
      if (openRooms.length > 0) {
        console.log(`\n✅ 有 ${openRooms.length} 个房间处于开房状态`);
        console.log('\n测试访问房间状态:');
        const testRoom = openRooms[0];
        const stateResponse = await fetch(`${API_BASE}/rooms/${testRoom.id}/state`);
        if (stateResponse.ok) {
          const stateData = await stateResponse.json();
          console.log('房间状态:', JSON.stringify(stateData, null, 2));
        } else {
          console.error('获取房间状态失败:', stateResponse.status);
        }
      } else {
        console.log('\n⚠️  所有房间都未开房');
        console.log('\n建议：在管理后台将房间状态设置为"开房"(status=1)');
      }
    } else {
      console.log('\n⚠️  没有找到房间');
      console.log('\n建议：');
      console.log('1. 在管理后台创建房间');
      console.log('2. 或者运行终端发现: POST /api/v1/terminals/discover');
    }

    // 2. 测试使用 'current' 访问
    console.log('\n2. 测试使用 "current" 访问房间状态...');
    const currentResponse = await fetch(`${API_BASE}/rooms/current/state`);
    
    if (currentResponse.ok) {
      const currentData = await currentResponse.json();
      console.log('✅ 使用 "current" 访问成功');
      console.log('房间信息:', JSON.stringify(currentData, null, 2));
    } else {
      console.error(`❌ 使用 "current" 访问失败: ${currentResponse.status}`);
      const errorText = await currentResponse.text();
      console.error('错误信息:', errorText);
      console.log('\n原因分析:');
      console.log('- 后端无法根据客户端IP (127.0.0.1) 找到对应的终端和房间');
      console.log('- 需要在数据库中创建终端记录并绑定到房间');
    }

  } catch (error) {
    console.error('\n❌ 检查失败:', error.message);
  }
}

// 运行检查
checkAndCreateTestRoom().catch(console.error);
