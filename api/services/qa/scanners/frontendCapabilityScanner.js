'use strict';

const fs = require('fs');
const path = require('path');

const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage']);

const CAPABILITY_HINTS = [
  { id: 'support_ticket_flow', tags: ['support', 'ticket', 'atendimento'] },
  { id: 'support_ticket_reply', tags: ['reply', 'mensagem', 'ticket-send-button'] },
  { id: 'turnstile_release', tags: ['turnstile', 'catraca', 'release'] },
  { id: 'customer_identification', tags: ['face', 'rfid', 'identification'] },
  { id: 'attendance_record', tags: ['checkin', 'attendance', 'presenca'] },
  { id: 'omnichannel_webchat', tags: ['webchat', 'chat'] },
];

function walk(dirPath, results) {
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      walk(fullPath, results);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(js|jsx|ts|tsx)$/i.test(entry.name)) continue;
    results.push(fullPath);
  }
}

function readSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return '';
  }
}

function extractDataTestIds(content) {
  const ids = [];
  const regex = /data-testid\s*=\s*['\"]([^'\"]+)['\"]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

function extractRoutes(content) {
  const routes = [];
  const regex = /isRoute\(\s*['\"]([^'\"]+)['\"]\s*\)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    routes.push(match[1]);
  }
  return routes;
}

function scoreCapability(haystack, hint) {
  const text = haystack.toLowerCase();
  let score = 0;
  for (const tag of hint.tags) {
    if (text.includes(String(tag).toLowerCase())) score += 1;
  }
  return score;
}

function scan(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, '..', '..', '..', '..');
  const srcDir = path.join(rootDir, 'frontend', 'src');
  const files = [];
  walk(srcDir, files);

  const pages = new Set();
  const components = new Set();
  const routes = new Set();
  const forms = new Set();
  const buttons = new Set();
  const testIds = new Set();
  const capabilityMatches = new Map();

  for (const filePath of files) {
    const rel = path.relative(rootDir, filePath).replace(/\\/g, '/');
    const content = readSafe(filePath);
    const lc = content.toLowerCase();

    if (rel.startsWith('frontend/src/pages/')) pages.add(rel);
    if (rel.startsWith('frontend/src/components/')) components.add(rel);

    for (const routePath of extractRoutes(content)) routes.add(routePath);
    for (const testId of extractDataTestIds(content)) testIds.add(testId);

    if (/<form\b/i.test(content)) forms.add(rel);
    if (/<button\b/i.test(content) || /type\s*=\s*['\"]button['\"]/i.test(content)) buttons.add(rel);

    const haystack = `${rel} ${lc}`;
    for (const hint of CAPABILITY_HINTS) {
      const score = scoreCapability(haystack, hint);
      if (score < 2) continue;
      const current = capabilityMatches.get(hint.id) || { score: 0, evidence: [] };
      current.score += score;
      current.evidence.push(rel);
      capabilityMatches.set(hint.id, current);
    }
  }

  const inferredCapabilities = Array.from(capabilityMatches.entries())
    .map(([id, value]) => ({
      id,
      source: 'frontend',
      confidence: Math.min(1, value.score / 8),
      evidence: Array.from(new Set(value.evidence)).slice(0, 10),
    }))
    .sort((a, b) => b.confidence - a.confidence);

  return {
    kind: 'frontend',
    pages: Array.from(pages).sort(),
    components: Array.from(components).sort(),
    routes: Array.from(routes).sort(),
    forms: Array.from(forms).sort(),
    buttons: Array.from(buttons).sort(),
    testIds: Array.from(testIds).sort(),
    inferredCapabilities,
  };
}

module.exports = {
  scan,
};
