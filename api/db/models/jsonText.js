'use strict';

function parseJsonText(raw, fallback) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function stringifyJsonText(value, fallback) {
  const normalized = value && typeof value === 'object' ? value : fallback;
  return JSON.stringify(normalized);
}

module.exports = {
  parseJsonText,
  stringifyJsonText,
};
