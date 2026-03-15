'use strict';

const crypto = require('crypto');

function buildId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePeriod(period) {
  const value = String(period || 'month').trim().toLowerCase();
  if (['day', 'week', 'month', 'quarter', 'year', 'custom'].includes(value)) {
    return value;
  }
  return 'month';
}

function resolvePeriodBounds(period, custom = {}) {
  const normalized = parsePeriod(period);
  const now = new Date();

  if (normalized === 'custom' && custom.start && custom.end) {
    const start = new Date(custom.start);
    const end = new Date(custom.end);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start <= end) {
      return {
        type: 'custom',
        start,
        end,
      };
    }
    // Invalid custom dates: fall through to month as a safe default.
  }

  const end = new Date(now);
  const start = new Date(now);

  // Treat 'custom' with invalid/missing dates the same as 'month'.
  const effectiveType = normalized === 'custom' ? 'month' : normalized;

  if (effectiveType === 'day') {
    start.setDate(start.getDate() - 1);
  } else if (effectiveType === 'week') {
    start.setDate(start.getDate() - 7);
  } else if (effectiveType === 'quarter') {
    start.setMonth(start.getMonth() - 3);
  } else if (effectiveType === 'year') {
    start.setFullYear(start.getFullYear() - 1);
  } else {
    start.setMonth(start.getMonth() - 1);
  }

  return {
    type: effectiveType,
    start,
    end,
  };
}

function dateOnlyString(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

module.exports = {
  buildId,
  toNumber,
  parsePeriod,
  resolvePeriodBounds,
  dateOnlyString,
};
