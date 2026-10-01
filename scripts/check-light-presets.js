/**
 * 查询灯光预设数据
 */

const fetch = require('node-fetch');

async function checkLightPresets() {
    try {
        const response = await fetch('http://192.168.1.28:8080/api/v1/peripheral/presets?ctrl_type=2');
        const data = await response.json();
        
        console.log('灯光场景预设 (ctrlType=2):');
        if (data.code === 0 && data.data) {
            data.data.forEach(preset => {
                console.log(`  code: ${preset.code}, name: ${preset.name}`);
            });
        }
        
        const response2 = await fetch('http://192.168.1.28:8080/api/v1/peripheral/presets?ctrl_type=3');
        const data2 = await response2.json();
        
        console.log('\n自动灯光预设 (ctrlType=3):');
        if (data2.code === 0 && data2.data) {
            data2.data.forEach(preset => {
                console.log(`  code: ${preset.code}, name: ${preset.name}`);
            });
        }
        
    } catch (error) {
        console.error('查询失败:', error);
    }
}

checkLightPresets();
