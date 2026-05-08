'use strict';

const fs = require('fs');
const path = require('path');

const DEVICE_HINTS = [
  { id: 'access-control', tags: ['access-control', 'controle de acesso'] },
  { id: 'face-id', tags: ['face-id', 'faceid', 'face recognition', 'biometric'] },
  { id: 'turnstile', tags: ['turnstile', 'catraca'] },
  { id: 'camera', tags: ['camera', 'video stream'] },
  { id: 'rfid', tags: ['rfid', 'nfc', 'card reader'] },
];

const CHANNEL_HINTS = [
  { id: 'whatsapp', tags: ['whatsapp', 'waba'] },
  { id: 'webchat', tags: ['webchat', 'chat widget'] },
  { id: 'pbx', tags: ['pbx', 'voip', 'sip'] },
  { id: 'email', tags: ['email', 'smtp'] },
];

function walk(dirPath, files) {
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (_) {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(fullPath, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(js|ts|json|md|yaml|yml|conf)$/i.test(entry.name)) continue;
    files.push(fullPath);
  }
}

function readSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return '';
  }
}

function scanHints(text, hints) {
  const normalized = text.toLowerCase();
  const found = [];
  for (const hint of hints) {
    const score = hint.tags.reduce((acc, tag) => acc + (normalized.includes(tag.toLowerCase()) ? 1 : 0), 0);
    if (score > 0) {
      found.push({ id: hint.id, score });
    }
  }
  return found;
}

function scan(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, '..', '..', '..', '..');
  const files = [];
  walk(rootDir, files);

  const devices = new Map();
  const channels = new Map();

  for (const filePath of files) {
    const rel = path.relative(rootDir, filePath).replace(/\\/g, '/');
    const content = readSafe(filePath);
    const haystack = `${rel}\n${content}`;

    for (const match of scanHints(haystack, DEVICE_HINTS)) {
      const rec = devices.get(match.id) || { score: 0, evidence: [] };
      rec.score += match.score;
      rec.evidence.push(rel);
      devices.set(match.id, rec);
    }

    for (const match of scanHints(haystack, CHANNEL_HINTS)) {
      const rec = channels.get(match.id) || { score: 0, evidence: [] };
      rec.score += match.score;
      rec.evidence.push(rel);
      channels.set(match.id, rec);
    }
  }

  return {
    kind: 'device',
    devices: Object.fromEntries(Array.from(devices.entries()).map(([id, value]) => [id, {
      detected: true,
      confidence: Math.min(1, value.score / 10),
      evidence: Array.from(new Set(value.evidence)).slice(0, 10),
    }])),
    channels: Object.fromEntries(Array.from(channels.entries()).map(([id, value]) => [id, {
      detected: true,
      confidence: Math.min(1, value.score / 10),
      evidence: Array.from(new Set(value.evidence)).slice(0, 10),
    }])),
  };
}

module.exports = {
  scan,
};
