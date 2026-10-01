/**
 * 检查构建时所有需要的文件是否都被复制到 assets 目录
 */

const fs = require('fs');
const path = require('path');

// 需要检查的关键文件列表（保留最核心资源即可）
const requiredFiles = [
  'index.html',
  'index.js',
  'assets/styles/style.css',
  'assets/styles/base.css',
  'modules/songs/songTopUI.js',
  'modules/party/partyUI.js',
  'utils/SongCardFactory.js',
];

// 检查文件是否存在
function checkFile(assetsDir, filePath) {
  const fullPath = path.join(assetsDir, filePath);
  const exists = fs.existsSync(fullPath);
  return {
    path: filePath,
    exists: exists,
    fullPath: fullPath
  };
}

// 主检查函数
function checkBuildFiles() {
  const assetsDir = path.join(__dirname, 'android', 'app', 'src', 'main', 'assets');
  
  console.log('='.repeat(60));
  console.log('='.repeat(60));
  if (!fs.existsSync(assetsDir)) {
    console.error('❌ Assets 目录不存在！');
    return;
  }
  
  const results = requiredFiles.map(file => checkFile(assetsDir, file));
  const missingFiles = results.filter(r => !r.exists);
  const existingFiles = results.filter(r => r.exists);
  
  console.log(`✅ 已存在的文件 (${existingFiles.length}/${requiredFiles.length}):`);
  existingFiles.forEach(r => {
  });
  
  if (missingFiles.length > 0) {
    console.log(`\n❌ 缺失的文件 (${missingFiles.length}):`);
    missingFiles.forEach(r => {
    });
  } else {
  }
  
  // 检查新创建的文件
  console.log('\n' + '='.repeat(60));
}

// 运行检查
checkBuildFiles();

