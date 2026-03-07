'use strict';

const crypto = require('crypto');

const CAMPAIGN_STATUSES = new Set(['open', 'running', 'filled', 'expired', 'canceled', 'cancelled', 'completed']);
const CANDIDATE_STATUSES = new Set(['pending', 'sent', 'accepted', 'rejected', 'expired', 'cooldown', 'skipped']);
const CAMPAIGN_SOURCES = new Set(['detected_gap', 'cancellation', 'manual', 'reactivation']);

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function parseHourMinute(raw, fallback) {
  const value = String(raw || fallback || '').trim();
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return (Number(match[1]) * 60) + Number(match[2]);
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function getJson(row) {
  return row && row.toJSON ? row.toJSON() : row;
}

function utcWeekday(date) {
  const d = new Date(date);
  return d.getUTCDay();
}

function utcMinutesOfDay(date) {
  const d = new Date(date);
  return (d.getUTCHours() * 60) + d.getUTCMinutes();
}

function intersectsWindow(startAt, endAt, startMin, endMin) {
  const start = utcMinutesOfDay(startAt);
  const end = utcMinutesOfDay(endAt);
  return start >= startMin && end <= endMin;
}

module.exports = {
  CAMPAIGN_STATUSES,
  CANDIDATE_STATUSES,
  CAMPAIGN_SOURCES,
  newId,
  parseHourMinute,
  clampInt,
  toIso,
  getJson,
  utcWeekday,
  utcMinutesOfDay,
  intersectsWindow,
};
