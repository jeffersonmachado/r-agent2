'use strict';

const fs = require('fs');
const path = require('path');

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'logs',
  'tmp',
  'backups',
]);

const CAPABILITY_HINTS = [
  { id: 'customer_identification', tags: ['face', 'identification', 'rfid', 'recognition', 'biometric'] },
  { id: 'membership_validation', tags: ['membership', 'plan', 'subscription'] },
  { id: 'access_decision', tags: ['access', 'authorize', 'permission', 'decision'] },
  { id: 'turnstile_release', tags: ['turnstile', 'catraca', 'unlock', 'release'] },
  { id: 'attendance_record', tags: ['attendance', 'checkin', 'presence', 'clockin'] },
  { id: 'crm_update', tags: ['crm', 'lead', 'contact', 'opportunity'] },
  { id: 'support_ticket_flow', tags: ['support', 'ticket', 'atendimento'] },
  { id: 'support_ticket_reply', tags: ['reply', 'message', 'chat', 'resposta'] },
  { id: 'billing_validation', tags: ['billing', 'invoice', 'payment', 'charge'] },
  { id: 'omnichannel_whatsapp', tags: ['whatsapp', 'waba'] },
  { id: 'omnichannel_webchat', tags: ['webchat', 'chat'] },
  { id: 'omnichannel_pbx', tags: ['pbx', 'voip', 'call'] },
  { id: 'omnichannel_email', tags: ['email', 'smtp'] },
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
    if (!/\.(js|cjs|mjs|ts|tsx|jsx)$/i.test(entry.name)) continue;
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

function extractRoutePaths(content) {
  const paths = [];
  const routeRegex = /\b(router|app)\.(get|post|put|delete|patch|use)\s*\(\s*['\"]([^'\"]+)['\"]/g;
  let match;
  while ((match = routeRegex.exec(content)) !== null) {
    paths.push(match[3]);
  }
  return paths;
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
  const apiDir = path.join(rootDir, 'api');
  const files = [];
  walk(apiDir, files);

  const modules = new Set();
  const services = new Set();
  const routes = new Set();
  const events = new Set();
  const queues = new Set();
  const integrations = new Set();
  const capabilityMatches = new Map();

  for (const filePath of files) {
    const rel = path.relative(rootDir, filePath).replace(/\\/g, '/');
    const content = readSafe(filePath);
    const lc = content.toLowerCase();

    if (rel.startsWith('api/modules/')) modules.add(rel);
    if (rel.startsWith('api/services/')) services.add(rel);
    if (/route/i.test(path.basename(filePath))) {
      for (const routePath of extractRoutePaths(content)) routes.add(routePath);
    }

    const eventRegex = /\bemit(?:Event)?\s*\(\s*['\"]([^'\"]+)['\"]/g;
    let eventMatch;
    while ((eventMatch = eventRegex.exec(content)) !== null) {
      events.add(eventMatch[1]);
    }

    if (/queue|worker|scheduler/i.test(rel) || /queue|worker|scheduler/i.test(lc)) {
      queues.add(rel);
    }

    if (/whatsapp|pbx|email|smtp|crm|billing|redis|postgres|webhook|turnstile|catraca|face/i.test(lc)) {
      integrations.add(rel);
    }

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
      source: 'backend',
      confidence: Math.min(1, value.score / 10),
      evidence: Array.from(new Set(value.evidence)).slice(0, 10),
    }))
    .sort((a, b) => b.confidence - a.confidence);

  return {
    kind: 'backend',
    modules: Array.from(modules).sort(),
    routes: Array.from(routes).sort(),
    services: Array.from(services).sort(),
    events: Array.from(events).sort(),
    queues: Array.from(queues).sort(),
    integrations: Array.from(integrations).sort(),
    inferredCapabilities,
  };
}

module.exports = {
  scan,
};
