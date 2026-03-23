'use strict';

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try {
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function safeTrim(value, fallback = '') {
  const str = safeToString(value, fallback);
  try {
    return str.trim();
  } catch (_) {
    return fallback;
  }
}

function safeTrimLower(value, fallback = '') {
  const str = safeTrim(value, fallback);
  try {
    return str.toLowerCase();
  } catch (_) {
    return fallback;
  }
}

function safeErrorMessage(err, fallback = '') {
  if (err == null) return fallback;
  let message;
  try {
    message = err.message;
  } catch (_) {
    message = null;
  }
  if (message !== null && message !== undefined) {
    return safeToString(message, fallback);
  }
  return safeToString(err, fallback);
}

function safeGet(obj, path, fallback = null) {
  try {
    return path.split('.').reduce((acc, key) => acc?.[key], obj) ?? fallback;
  } catch (_) {
    return fallback;
  }
}

module.exports = {
  safeToString,
  safeTrim,
  safeTrimLower,
  safeErrorMessage,
  safeGet,
};