#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readEnvValue(content, key) {
  const matcher = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=\\s*(.*)$`);
  for (const line of String(content || '').split(/\r?\n/)) {
    const match = line.match(matcher);
    if (!match) continue;
    const value = String(match[1] || '').trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    return value;
  }
  return '';
}

function upsertEnvValue(content, key, value) {
  const matcher = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=`);
  const lines = String(content || '').split(/\r?\n/);
  const output = [];
  let replaced = false;
  for (const line of lines) {
    if (!matcher.test(line)) {
      output.push(line);
      continue;
    }
    if (!replaced) {
      output.push(`${key}=${value}`);
      replaced = true;
    }
  }
  if (!replaced) {
    if (output.length > 0 && output[output.length - 1] !== '') output.push('');
    output.push(`${key}=${value}`);
  }
  while (output.length > 1 && output[output.length - 1] === '' && output[output.length - 2] === '') {
    output.pop();
  }
  return `${output.join('\n').replace(/\n*$/, '')}\n`;
}

function isValidEncryptionKey(value) {
  const raw = String(value || '').trim();
  if (/^[a-f0-9]{64}$/i.test(raw)) return true;
  try {
    return /^[A-Za-z0-9+/]+={0,2}$/.test(raw) && Buffer.from(raw, 'base64').length === 32;
  } catch (_) {
    return false;
  }
}

function isValidInternalToken(value) {
  return Buffer.byteLength(String(value || '').trim(), 'utf8') >= 32;
}

function writeAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    fs.writeFileSync(tempPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(tempPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

function ensureLocalSecrets(rootDir) {
  const root = path.resolve(rootDir);
  const rootEnvPath = path.join(root, '.env');
  const ragEnvPath = path.join(root, 'rag-service', '.env');
  let rootContent = fs.existsSync(rootEnvPath) ? fs.readFileSync(rootEnvPath, 'utf8') : '';

  let encryptionKey = readEnvValue(rootContent, 'ENCRYPTION_KEY');
  const encryptionGenerated = !isValidEncryptionKey(encryptionKey);
  if (encryptionGenerated) {
    encryptionKey = crypto.randomBytes(32).toString('hex');
    rootContent = upsertEnvValue(rootContent, 'ENCRYPTION_KEY', encryptionKey);
  }

  let ragToken = readEnvValue(rootContent, 'RAG_INTERNAL_TOKEN');
  const ragTokenGenerated = !isValidInternalToken(ragToken);
  if (ragTokenGenerated) {
    ragToken = crypto.randomBytes(32).toString('hex');
    rootContent = upsertEnvValue(rootContent, 'RAG_INTERNAL_TOKEN', ragToken);
  }
  writeAtomic(rootEnvPath, rootContent);

  let ragContent = fs.existsSync(ragEnvPath) ? fs.readFileSync(ragEnvPath, 'utf8') : '';
  const ragTokenSynchronized = readEnvValue(ragContent, 'RAG_INTERNAL_TOKEN') !== ragToken;
  if (ragTokenSynchronized) {
    ragContent = upsertEnvValue(ragContent, 'RAG_INTERNAL_TOKEN', ragToken);
  }
  writeAtomic(ragEnvPath, ragContent);

  return { encryptionGenerated, ragTokenGenerated, ragTokenSynchronized };
}

if (require.main === module) {
  const rootDir = process.argv[2] || path.join(__dirname, '..', '..');
  const result = ensureLocalSecrets(rootDir);
  // Nunca imprimir valores secretos.
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

module.exports = {
  ensureLocalSecrets,
  isValidEncryptionKey,
  isValidInternalToken,
  readEnvValue,
  upsertEnvValue,
};
