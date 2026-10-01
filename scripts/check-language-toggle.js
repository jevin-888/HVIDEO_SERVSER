/**
 * 检查所有页面的语言切换实现
 * 
 * 需求：
 * 1. 中文固定显示
 * 2. 只切换其他语言（如印尼语）的显示/隐藏
 * 3. 检查所有使用 indonesian-translation 类的地方
 */

const fs = require('fs');
const path = require('path');

// 需要检查的文件模式
const filesToCheck = [
  'static/vod_song/client/index.html',
  'static/vod_song/client/**/*.js',
  'static/vod_song/client/**/*.css',
  'static/vod_song/shared/**/*.js'
];

// 检查结果
const results = {
  languageToggleButton: null,
  indonesianTranslationUsage: [],
  languageSwitchLogic: [],
  cssRules: [],
  recommendations: []
};

console.log('=== 语言切换实现检查 ===\n');

// 1. 检查语言切换按钮
console.log('1. 检查语言切换按钮...');
const indexHtmlPath = 'static/vod_song/client/index.html';
if (fs.existsSync(indexHtmlPath)) {
  const content = fs.readFileSync(indexHtmlPath, 'utf-8');
  const languageToggleMatch = content.match(/<button\s+id="languageToggle"[\s\S]*?<\/button>/);
  if (languageToggleMatch) {
    results.languageToggleButton = {
      found: true,
      isHidden: languageToggleMatch[0].includes('hidden'),
      content: languageToggleMatch[0]
    };
    console.log('   ✓ 找到语言切换按钮');
    console.log(`   - 当前状态: ${results.languageToggleButton.isHidden ? '隐藏' : '显示'}`);
  } else {
    results.languageToggleButton = { found: false };
    console.log('   ✗ 未找到语言切换按钮');
  }
} else {
  console.log('   ✗ index.html 文件不存在');
}

console.log('\n2. 检查 indonesian-translation 类的使用...');
// 递归查找所有JS文件
function findFiles(dir, pattern, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      if (!file.includes('node_modules') && !file.includes('.git')) {
        findFiles(filePath, pattern, fileList);
      }
    } else if (file.endsWith(pattern)) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

// 检查JS文件中的 indonesian-translation 使用
const jsFiles = [
  ...findFiles('static/vod_song/client', '.js'),
  ...findFiles('static/vod_song/shared', '.js')
];

jsFiles.forEach(file => {
  const content = fs.readFileSync(file, 'utf-8');
  const matches = content.match(/indonesian-translation/g);
  if (matches) {
    results.indonesianTranslationUsage.push({
      file: file.replace(/\\/g, '/'),
      count: matches.length
    });
  }
});

console.log(`   找到 ${results.indonesianTranslationUsage.length} 个文件使用了 indonesian-translation 类`);
results.indonesianTranslationUsage.forEach(item => {
  console.log(`   - ${item.file}: ${item.count} 处`);
});

console.log('\n3. 检查CSS规则...');
const cssFiles = findFiles('static/vod_song/client/assets/css', '.css');
cssFiles.forEach(file => {
  const content = fs.readFileSync(file, 'utf-8');
  const matches = content.match(/\.indonesian-translation[^{]*\{[^}]*\}/g);
  if (matches) {
    results.cssRules.push({
      file: file.replace(/\\/g, '/'),
      rules: matches
    });
  }
});

console.log(`   找到 ${results.cssRules.length} 个CSS文件定义了 indonesian-translation 样式`);
results.cssRules.forEach(item => {
  console.log(`   - ${item.file}: ${item.rules.length} 条规则`);
});

console.log('\n4. 检查语言切换逻辑...');
// 查找 LangService 相关代码
const langServicePath = 'static/vod_song/shared/services/LangService/LangService.js';
if (fs.existsSync(langServicePath)) {
  const content = fs.readFileSync(langServicePath, 'utf-8');
  const hasToggleMethod = content.includes('switchLanguage') || content.includes('toggleLanguage');
  const hasSetLanguageMethod = content.includes('setLanguage');
  
  results.languageSwitchLogic.push({
    file: langServicePath,
    hasToggleMethod,
    hasSetLanguageMethod
  });
  
  console.log('   ✓ 找到 LangService');
  console.log(`   - 有切换方法: ${hasToggleMethod ? '是' : '否'}`);
  console.log(`   - 有设置方法: ${hasSetLanguageMethod ? '是' : '否'}`);
} else {
  console.log('   ✗ 未找到 LangService');
}

console.log('\n=== 分析结果 ===\n');

// 生成建议
if (!results.languageToggleButton || !results.languageToggleButton.found) {
  results.recommendations.push({
    priority: 'HIGH',
    issue: '未找到语言切换按钮',
    suggestion: '需要在 index.html 中添加语言切换按钮'
  });
} else if (results.languageToggleButton.isHidden) {
  results.recommendations.push({
    priority: 'MEDIUM',
    issue: '语言切换按钮被隐藏',
    suggestion: '如果需要语言切换功能，需要移除 hidden 类并添加点击事件'
  });
}

if (results.indonesianTranslationUsage.length > 0) {
  results.recommendations.push({
    priority: 'INFO',
    issue: `发现 ${results.indonesianTranslationUsage.length} 个文件使用了 indonesian-translation 类`,
    suggestion: '需要添加CSS规则来控制印尼语的显示/隐藏，例如：body:not(.show-indonesian) .indonesian-translation { display: none; }'
  });
}

const hasDisplayControl = results.cssRules.some(item => 
  item.rules.some(rule => rule.includes('display') || rule.includes('visibility'))
);

if (!hasDisplayControl) {
  results.recommendations.push({
    priority: 'HIGH',
    issue: 'CSS中没有控制 indonesian-translation 显示/隐藏的规则',
    suggestion: '需要添加CSS规则来控制印尼语的显示/隐藏'
  });
}

// 输出建议
results.recommendations.forEach((rec, index) => {
  console.log(`${index + 1}. [${rec.priority}] ${rec.issue}`);
  console.log(`   建议: ${rec.suggestion}\n`);
});

console.log('\n=== 实现方案 ===\n');
console.log('要实现"中文固定显示，只切换其他语言"的功能，需要：\n');
console.log('1. CSS方案（推荐）：');
console.log('   - 默认隐藏印尼语：.indonesian-translation { display: none; }');
console.log('   - 当body有特定类时显示：body.show-indonesian .indonesian-translation { display: block; }');
console.log('   - 中文始终显示（不添加特殊类）\n');

console.log('2. JavaScript方案：');
console.log('   - 在 index.html 中添加语言切换按钮的点击事件');
console.log('   - 点击时切换 body 的 show-indonesian 类');
console.log('   - 保存用户选择到 localStorage\n');

console.log('3. 需要修改的文件：');
console.log('   - static/vod_song/client/assets/css/style-client.css（添加CSS规则）');
console.log('   - static/vod_song/client/index.js（添加语言切换事件监听）');
console.log('   - static/vod_song/client/index.html（移除 hidden 类，如果需要显示按钮）\n');

// 保存结果到文件
const reportPath = 'docs/troubleshooting/language-toggle-check-report.md';
let report = '# 语言切换实现检查报告\n\n';
report += `生成时间: ${new Date().toLocaleString('zh-CN')}\n\n`;
report += '## 检查结果\n\n';
report += '### 1. 语言切换按钮\n\n';
if (results.languageToggleButton && results.languageToggleButton.found) {
  report += `- 状态: ${results.languageToggleButton.isHidden ? '隐藏' : '显示'}\n`;
  report += '```html\n' + results.languageToggleButton.content + '\n```\n\n';
} else {
  report += '- 状态: 未找到\n\n';
}

report += '### 2. indonesian-translation 类使用情况\n\n';
results.indonesianTranslationUsage.forEach(item => {
  report += `- ${item.file}: ${item.count} 处\n`;
});
report += '\n';

report += '### 3. CSS规则\n\n';
if (results.cssRules.length > 0) {
  results.cssRules.forEach(item => {
    report += `#### ${item.file}\n\n`;
    item.rules.forEach(rule => {
      report += '```css\n' + rule + '\n```\n\n';
    });
  });
} else {
  report += '未找到相关CSS规则\n\n';
}

report += '### 4. 语言切换逻辑\n\n';
results.languageSwitchLogic.forEach(item => {
  report += `- ${item.file}\n`;
  report += `  - 有切换方法: ${item.hasToggleMethod ? '是' : '否'}\n`;
  report += `  - 有设置方法: ${item.hasSetLanguageMethod ? '是' : '否'}\n`;
});
report += '\n';

report += '## 建议\n\n';
results.recommendations.forEach((rec, index) => {
  report += `${index + 1}. **[${rec.priority}]** ${rec.issue}\n`;
  report += `   - 建议: ${rec.suggestion}\n\n`;
});

report += '## 实现方案\n\n';
report += '### 方案一：CSS + JavaScript（推荐）\n\n';
report += '#### 1. 添加CSS规则\n\n';
report += '在 `static/vod_song/client/assets/css/style-client.css` 中添加：\n\n';
report += '```css\n';
report += '/* 默认隐藏印尼语翻译 */\n';
report += '.indonesian-translation {\n';
report += '  display: none;\n';
report += '}\n\n';
report += '/* 当启用印尼语时显示 */\n';
report += 'body.show-indonesian .indonesian-translation {\n';
report += '  display: inline;\n';
report += '}\n';
report += '```\n\n';

report += '#### 2. 添加JavaScript逻辑\n\n';
report += '在 `static/vod_song/client/index.js` 的初始化函数中添加：\n\n';
report += '```javascript\n';
report += '// 初始化语言切换\n';
report += 'function initLanguageToggle() {\n';
report += '  const toggleBtn = document.getElementById("languageToggle");\n';
report += '  if (!toggleBtn) return;\n\n';
report += '  // 从 localStorage 读取用户选择\n';
report += '  const showIndonesian = localStorage.getItem("showIndonesian") === "true";\n';
report += '  if (showIndonesian) {\n';
report += '    document.body.classList.add("show-indonesian");\n';
report += '  }\n\n';
report += '  // 更新按钮文本\n';
report += '  const updateButtonText = () => {\n';
report += '    const isShowing = document.body.classList.contains("show-indonesian");\n';
report += '    const langSpan = toggleBtn.querySelector("#language");\n';
report += '    if (langSpan) {\n';
report += '      langSpan.textContent = isShowing ? "印尼语" : "中文";\n';
report += '    }\n';
report += '  };\n\n';
report += '  updateButtonText();\n\n';
report += '  // 点击切换\n';
report += '  toggleBtn.addEventListener("click", () => {\n';
report += '    const isShowing = document.body.classList.toggle("show-indonesian");\n';
report += '    localStorage.setItem("showIndonesian", isShowing);\n';
report += '    updateButtonText();\n';
report += '  });\n';
report += '}\n';
report += '```\n\n';

report += '#### 3. 移除按钮的 hidden 类\n\n';
report += '在 `static/vod_song/client/index.html` 中，将：\n\n';
report += '```html\n';
report += '<button id="languageToggle" class="... hidden" ...>\n';
report += '```\n\n';
report += '改为：\n\n';
report += '```html\n';
report += '<button id="languageToggle" class="..." ...>\n';
report += '```\n\n';

fs.writeFileSync(reportPath, report, 'utf-8');
console.log(`\n报告已保存到: ${reportPath}`);
