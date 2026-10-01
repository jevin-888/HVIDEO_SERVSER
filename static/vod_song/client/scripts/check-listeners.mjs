import { promises as fs } from 'fs';
import path from 'path';

const root = process.cwd();
const TARGET_DIRS = ['modules', 'navigation', 'utils', 'services', 'core', 'router', 'websocket'];
const TARGET_FILES = ['index.js'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'android', 'scripts', 'assets', 'build', 'dist', 'coverage']);

const addPatterns = [
  {
    type: 'native-add',
    regex: /([A-Za-z0-9_$.\[\]()>]+)\.addEventListener\s*\(\s*(['"])\s*([^'"\s]+)\2/gs
  },
  {
    type: 'domutils-add',
    regex: /DomUtils\.addEventListener\s*\(\s*([^,]+?)\s*,\s*(['"])\s*([^'"\s]+)\2/gs
  }
];

const removePatterns = [
  {
    type: 'native-remove',
    regex: /([A-Za-z0-9_$.\[\]()>]+)\.removeEventListener\s*\(\s*(['"])\s*([^'"\s]+)\2/gs
  },
  {
    type: 'domutils-remove',
    regex: /DomUtils\.removeEventListener\s*\(\s*([^,]+?)\s*,\s*(['"])\s*([^'"\s]+)\2/gs
  }
];

function normaliseElement(raw) {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^\(/, '')
    .replace(/\)$/, '')
    .trim();
}

function getLine(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function analyseFile(content, filePath) {
  const adds = [];
  const removes = [];

  for (const pattern of addPatterns) {
    let match;
    while ((match = pattern.regex.exec(content))) {
      const elementRaw = normaliseElement(match[1]);
      const event = match[3];
      adds.push({
        type: pattern.type,
        element: elementRaw,
        event,
        index: match.index,
        line: getLine(content, match.index)
      });
    }
  }

  for (const pattern of removePatterns) {
    let match;
    while ((match = pattern.regex.exec(content))) {
      const elementRaw = normaliseElement(match[1]);
      const event = match[3];
      removes.push({
        type: pattern.type,
        element: elementRaw,
        event,
        index: match.index,
        line: getLine(content, match.index)
      });
    }
  }

  const removeMap = new Map();
  removes.forEach(rem => {
    const key = `${rem.element}@@${rem.event}`;
    if (!removeMap.has(key)) {
      removeMap.set(key, []);
    }
    removeMap.get(key).push(rem);
  });

  const dupCandidates = new Map();
  adds.forEach(add => {
    const key = `${add.element}@@${add.event}`;
    if (!dupCandidates.has(key)) {
      dupCandidates.set(key, []);
    }
    dupCandidates.get(key).push(add);
  });

  const duplicates = [];
  dupCandidates.forEach((list, key) => {
    if (list.length > 1) {
      duplicates.push({ key, occurrences: list });
    }
  });

  const missingRemoves = [];
  adds.forEach(add => {
    const key = `${add.element}@@${add.event}`;
    const elementLower = add.element.toLowerCase();
    const isGlobal = ['window', 'document'].includes(elementLower) || elementLower.startsWith('window.') || elementLower.startsWith('document.');
    if (!removeMap.has(key) && !isGlobal) {
      missingRemoves.push(add);
    }
  });

  return { adds, removes, duplicates, missingRemoves };
}

async function walkDirectory(dirPath, fileHandler) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walkDirectory(entryPath, fileHandler);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      await fileHandler(entryPath);
    }
  }
}

async function main() {
  const issues = [];

  async function processFile(filePath) {
    const content = await fs.readFile(filePath, 'utf8');
    const { duplicates, missingRemoves } = analyseFile(content, filePath);
    if (duplicates.length || missingRemoves.length) {
      issues.push({ filePath, duplicates, missingRemoves });
    }
  }

  for (const target of TARGET_DIRS) {
    const fullPath = path.join(root, target);
    try {
      const stats = await fs.stat(fullPath);
      if (stats.isDirectory()) {
        await walkDirectory(fullPath, processFile);
      } else if (stats.isFile()) {
        await processFile(fullPath);
      }
    } catch (error) {
      // ignore missing directories
    }
  }

  for (const file of TARGET_FILES) {
    const fullPath = path.join(root, file);
    try {
      const stats = await fs.stat(fullPath);
      if (stats.isFile()) {
        await processFile(fullPath);
      }
    } catch (error) {
      // ignore
    }
  }

  if (!issues.length) {
    console.log('No potential listener issues detected in scanned sources.');
    return;
  }

  for (const issue of issues) {
    if (!issue.duplicates.length && !issue.missingRemoves.length) continue;
    console.log(`\nFile: ${path.relative(root, issue.filePath)}`);
    if (issue.duplicates.length) {
      console.log('  Possible duplicate listeners:');
      for (const dup of issue.duplicates) {
        const [element, event] = dup.key.split('@@');
        const locations = dup.occurrences.map(item => `${item.line}`).join(', ');
        console.log(`    - element: ${element}, event: ${event} (lines: ${locations})`);
      }
    }
    if (issue.missingRemoves.length) {
      console.log('  Listeners without matching remove:');
      for (const miss of issue.missingRemoves) {
        console.log(`    - ${miss.element}.${miss.event} (line ${miss.line})`);
      }
    }
  }
}

main().catch(err => {
  console.error('Listener analysis failed:', err);
  process.exitCode = 1;
});
