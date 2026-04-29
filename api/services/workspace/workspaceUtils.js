'use strict';

function safeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function normalizePhone(value) {
  const raw = safeString(value).trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  return digits || raw;
}

function normalizeEmail(value) {
  return safeString(value).trim().toLowerCase();
}

function toPlain(row) {
  if (!row) return null;
  return row.toJSON ? row.toJSON() : row;
}

function toDate(value, fallback = null) {
  const date = value ? new Date(value) : null;
  if (date && Number.isFinite(date.getTime())) return date;
  return fallback;
}

function clampLimit(value, fallback = 50, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.trunc(n), max));
}

function offsetValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function uniqBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function compactObject(value = {}) {
  const out = {};
  Object.entries(value).forEach(([key, item]) => {
    if (item !== undefined && item !== null && item !== '') out[key] = item;
  });
  return out;
}

module.exports = {
  safeString,
  normalizePhone,
  normalizeEmail,
  toPlain,
  toDate,
  clampLimit,
  offsetValue,
  uniqBy,
  compactObject,
};
