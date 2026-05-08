'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.html']);
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);

function walkFiles(dirPath, files = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (_) {
    return files;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      walkFiles(fullPath, files);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!DEFAULT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    files.push(fullPath);
  }

  return files;
}

function getLineNumber(content, index) {
  if (index <= 0) return 1;
  return content.slice(0, index).split('\n').length;
}

function extractTagOpen(source, index) {
  const left = source.lastIndexOf('<', index);
  const right = source.indexOf('>', index);
  if (left < 0 || right < 0) return null;
  return source.slice(left, right + 1);
}

function parseTagName(tagOpen = '') {
  const match = tagOpen.match(/^<\s*([a-zA-Z0-9-]+)/);
  return match ? match[1].toLowerCase() : null;
}

function hasA11yHints(tagOpen = '') {
  return /(aria-label|aria-labelledby|role=|tabindex=)/i.test(tagOpen);
}

function isAccessibleTag(tagName) {
  return ['button', 'a', 'input', 'select', 'textarea', 'summary', 'label'].includes(String(tagName || '').toLowerCase());
}

function normalizeRelative(rootDir, filePath) {
  return path.relative(rootDir, filePath).replace(/\\/g, '/');
}

function scanDataTestIds(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, '..', '..', '..', '..');
  const frontendDir = options.frontendDir || path.join(rootDir, 'frontend', 'src');
  const files = walkFiles(frontendDir, []);
  const occurrencesById = new Map();
  const catalog = [];

  for (const filePath of files) {
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (_) {
      continue;
    }

    const regex = /data-testid\s*=\s*["'`]([^"'`]+)["'`]/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const testId = String(match[1] || '').trim();
      if (!testId) continue;

      const tagOpen = extractTagOpen(content, match.index) || '';
      const tagName = parseTagName(tagOpen);
      const accessibility = isAccessibleTag(tagName) || hasA11yHints(tagOpen);

      const occurrence = {
        file: normalizeRelative(rootDir, filePath),
        line: getLineNumber(content, match.index),
        column: 1,
        tagName,
        accessible: accessibility,
      };

      if (!occurrencesById.has(testId)) {
        occurrencesById.set(testId, []);
      }
      occurrencesById.get(testId).push(occurrence);
      catalog.push({ testId, ...occurrence });
    }
  }

  const uniqueIds = Array.from(occurrencesById.keys()).sort();
  const duplicates = uniqueIds
    .filter((id) => (occurrencesById.get(id) || []).length > 1)
    .map((id) => ({ testId: id, occurrences: occurrencesById.get(id) || [] }));
  const inaccessible = uniqueIds
    .filter((id) => (occurrencesById.get(id) || []).some((item) => item.accessible !== true))
    .map((id) => ({ testId: id, occurrences: occurrencesById.get(id) || [] }));

  return {
    generatedAt: new Date().toISOString(),
    rootDir,
    frontendDir,
    count: {
      filesScanned: files.length,
      uniqueIds: uniqueIds.length,
      totalOccurrences: catalog.length,
      duplicates: duplicates.length,
      inaccessible: inaccessible.length,
    },
    uniqueIds,
    duplicates,
    inaccessible,
    catalog,
    occurrencesById: Object.fromEntries(uniqueIds.map((id) => [id, occurrencesById.get(id) || []])),
  };
}

function tokenizeCapability(capability = {}) {
  const id = String(capability.id || '').toLowerCase();
  const name = String(capability.name || '').toLowerCase();
  const source = `${id} ${name}`.trim();
  return source
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3);
}

function validateCapabilityDataTestIds(capability = {}, scanResult = null) {
  const current = scanResult || scanDataTestIds({});
  const tokens = tokenizeCapability(capability);
  const related = current.uniqueIds.filter((testId) => {
    const lower = String(testId).toLowerCase();
    return tokens.some((token) => lower.includes(token));
  });

  const missing = [];
  const remediation = [];

  if (related.length === 0) {
    missing.push('missing_data_testid');
    remediation.push({
      type: 'add_data_testid',
      capability: capability.id || capability.name || 'unknown',
      action: 'Adicionar data-testid reais e únicos nos elementos operacionais da capability',
    });
  }

  const duplicatedRelated = current.duplicates.filter((item) => related.includes(item.testId));
  if (duplicatedRelated.length > 0) {
    missing.push('duplicated_data_testid');
    remediation.push({
      type: 'deduplicate_data_testid',
      capability: capability.id || capability.name || 'unknown',
      action: 'Garantir unicidade de data-testid para seleção determinística',
      duplicated: duplicatedRelated.map((item) => item.testId),
    });
  }

  const inaccessibleRelated = current.inaccessible.filter((item) => related.includes(item.testId));
  if (inaccessibleRelated.length > 0) {
    missing.push('inaccessible_data_testid');
    remediation.push({
      type: 'fix_accessibility',
      capability: capability.id || capability.name || 'unknown',
      action: 'Adicionar atributos de acessibilidade (aria-label/role/tabindex) quando necessário',
      affected: inaccessibleRelated.map((item) => item.testId),
    });
  }

  return {
    status: missing.length === 0 ? 'GO' : 'NO_GO',
    capabilityId: capability.id || null,
    relatedTestIds: related,
    missing,
    remediation,
  };
}

module.exports = {
  scanDataTestIds,
  validateCapabilityDataTestIds,
};