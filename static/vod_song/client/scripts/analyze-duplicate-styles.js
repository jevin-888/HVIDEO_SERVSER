const fs = require('fs');
const path = require('path');

// 读取 CSS 文件
const stylePath = path.join(__dirname, '../assets/styles/style.css');
const materialPath = path.join(__dirname, '../assets/styles/material.css');

function parseCSS(cssContent) {
  const rules = [];
  const lines = cssContent.split('\n');
  let currentRule = null;
  let braceCount = 0;
  let ruleStart = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // 跳过注释和空行
    if (!trimmed || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }
    
    // 检测选择器
    if (trimmed.includes('{') && !trimmed.includes('@')) {
      const selector = trimmed.split('{')[0].trim();
      if (selector) {
        currentRule = {
          selector: selector,
          properties: [],
          line: i + 1,
          fullText: line
        };
        braceCount = (trimmed.match(/{/g) || []).length - (trimmed.match(/}/g) || []).length;
        ruleStart = i;
      }
    } else if (currentRule && trimmed.includes(':')) {
      // 解析属性
      const colonIndex = trimmed.indexOf(':');
      const prop = trimmed.substring(0, colonIndex).trim();
      const value = trimmed.substring(colonIndex + 1).replace(/;.*$/, '').trim();
      currentRule.properties.push({ prop, value });
      
      braceCount += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      
      if (braceCount <= 0 && trimmed.includes('}')) {
        currentRule.endLine = i + 1;
        rules.push(currentRule);
        currentRule = null;
      }
    } else if (trimmed.includes('}') && currentRule) {
      braceCount += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      if (braceCount <= 0) {
        currentRule.endLine = i + 1;
        rules.push(currentRule);
        currentRule = null;
      }
    }
  }
  
  return rules;
}

// 分析重复
function analyzeDuplicates(rules) {
  const duplicates = [];
  const selectorMap = new Map();
  
  // 按选择器分组
  rules.forEach(rule => {
    const normalized = rule.selector.replace(/\s+/g, ' ').trim();
    if (!selectorMap.has(normalized)) {
      selectorMap.set(normalized, []);
    }
    selectorMap.get(normalized).push(rule);
  });
  
  // 找出重复的选择器
  selectorMap.forEach((rules, selector) => {
    if (rules.length > 1) {
      duplicates.push({
        selector,
        occurrences: rules.length,
        rules: rules
      });
    }
  });
  
  // 找出重复的属性组合
  const propertyCombos = new Map();
  rules.forEach(rule => {
    const props = rule.properties.map(p => `${p.prop}:${p.value}`).join('|');
    if (props) {
      if (!propertyCombos.has(props)) {
        propertyCombos.set(props, []);
      }
      propertyCombos.get(props).push(rule);
    }
  });
  
  const duplicateProperties = [];
  propertyCombos.forEach((rules, props) => {
    if (rules.length > 1) {
      const selectors = rules.map(r => r.selector).filter((v, i, a) => a.indexOf(v) === i);
      if (selectors.length > 1) {
        duplicateProperties.push({
          properties: props,
          selectors: selectors,
          count: rules.length
        });
      }
    }
  });
  
  return { duplicateSelectors: duplicates, duplicateProperties };
}

// 主函数
const styleCSS = fs.readFileSync(stylePath, 'utf8');
const materialCSS = fs.readFileSync(materialPath, 'utf8');

const styleRules = parseCSS(styleCSS);
const materialRules = parseCSS(materialCSS);
const allRules = [...styleRules, ...materialRules];
const { duplicateSelectors, duplicateProperties } = analyzeDuplicates(allRules);
duplicateSelectors.slice(0, 30).forEach(dup => {
  dup.rules.forEach(rule => {
  });
});
duplicateProperties.slice(0, 20).forEach(dup => {
  console.log(`\n属性: ${dup.properties.substring(0, 100)}...`);
});

// 统计总体信息
const uniqueSelectors = new Set(allRules.map(r => r.selector.replace(/\s+/g, ' ').trim()));
const totalProperties = allRules.reduce((sum, r) => sum + r.properties.length, 0);