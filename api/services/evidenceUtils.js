'use strict';

const crypto = require('crypto');

function safeString(value, fallback = '') {
  if (value == null) return fallback;
  try {
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function ensureTenantId(tenantId) {
  const normalized = safeString(tenantId).trim();
  if (!normalized) {
    throw new Error('tenantId é obrigatório');
  }
  return normalized;
}

function normalizePhone(phone) {
  const raw = safeString(phone).trim();
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, '');
  if (!digits) return null;
  if (digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }
  return null;
}

function normalizeText(value) {
  return safeString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(value, maxLength = 280) {
  const text = safeString(value).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
}

function createHash(value) {
  return crypto.createHash('sha256').update(safeString(value)).digest('hex');
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqEntities(items = []) {
  const seen = new Set();
  return toArray(items)
    .filter((item) => item && safeString(item.type) && safeString(item.id))
    .map((item) => ({ type: safeString(item.type), id: safeString(item.id) }))
    .filter((item) => {
      const key = `${item.type}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function extractBodyText(body) {
  if (!body) return '';
  if (typeof body === 'string') return body;
  if (typeof body.text === 'string') return body.text;
  if (typeof body.caption === 'string') return body.caption;
  if (typeof body.message === 'string') return body.message;
  if (typeof body.content === 'string') return body.content;
  try {
    return JSON.stringify(body);
  } catch (_) {
    return '';
  }
}

function tokenSet(value) {
  return new Set(
    normalizeText(value)
      .split(/[^a-z0-9_]+/)
      .filter((token) => token && token.length >= 3),
  );
}

function overlapScore(a, b) {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let matches = 0;
  for (const token of setA) {
    if (setB.has(token)) matches += 1;
  }
  return matches / Math.max(setA.size, setB.size);
}

module.exports = {
  safeString,
  ensureTenantId,
  normalizePhone,
  normalizeText,
  compactText,
  createId,
  createHash,
  toArray,
  uniqEntities,
  extractBodyText,
  tokenSet,
  overlapScore,
};
