'use strict';

const crypto = require('crypto');
const { clampInt, parseHourMinute, utcWeekday, intersectsWindow } = require('./shared');
const { getPreset } = require('./VerticalTemplateRegistry');

const DEFAULT_SETTINGS = Object.freeze({
  verticalTemplate: 'beauty',
  serviceType: null,
  allowedChannels: ['whatsapp'],
  cooldowns: {},
  preferredOwnerId: null,
  preferredTimeWindows: [],
  recurrenceDays: [],
  minGapDurationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  campaignTimeoutMinutes: 120,
});

function normalizeWeekdays(list) {
  const input = Array.isArray(list) ? list : [0, 1, 2, 3, 4, 5, 6];
  return Array.from(new Set(input.map((item) => clampInt(item, 0, 6, null)).filter((item) => item !== null)));
}

function normalizeChannels(list, fallback = ['whatsapp']) {
  const raw = Array.isArray(list) ? list : fallback;
  const out = raw
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);
  return out.length > 0 ? Array.from(new Set(out)) : fallback.slice();
}

function normalizeTimeWindows(windows) {
  if (!Array.isArray(windows)) return [];
  return windows
    .map((item) => {
      const start = String(item?.start || '').trim();
      const end = String(item?.end || '').trim();
      if (parseHourMinute(start, null) === null) return null;
      if (parseHourMinute(end, null) === null) return null;
      return { start, end };
    })
    .filter(Boolean);
}

function getVerticalPreset(verticalTemplate) {
  return getPreset(verticalTemplate).policyDefaults;
}

function resolvePolicy(rawPolicy = {}) {
  const base = rawPolicy && typeof rawPolicy === 'object' ? rawPolicy : {};
  const incomingSettings = base.settings && typeof base.settings === 'object' ? base.settings : {};
  const verticalPreset = getPreset(incomingSettings.verticalTemplate || 'beauty');
  const preset = verticalPreset.policyDefaults || {};
  const settings = {
    ...DEFAULT_SETTINGS,
    ...preset,
    ...incomingSettings,
    verticalTemplate: incomingSettings.verticalTemplate || DEFAULT_SETTINGS.verticalTemplate,
    allowedChannels: normalizeChannels(incomingSettings.allowedChannels || preset.allowedChannels || DEFAULT_SETTINGS.allowedChannels),
    preferredTimeWindows: normalizeTimeWindows(incomingSettings.preferredTimeWindows || preset.preferredTimeWindows || DEFAULT_SETTINGS.preferredTimeWindows),
    recurrenceDays: Array.isArray(incomingSettings.recurrenceDays) ? incomingSettings.recurrenceDays.map((item) => clampInt(item, 1, 365, null)).filter((item) => item !== null) : (preset.recurrenceDays || []),
    minGapDurationMinutes: clampInt(incomingSettings.minGapDurationMinutes, 5, 24 * 60, preset.minGapDurationMinutes || DEFAULT_SETTINGS.minGapDurationMinutes),
    bufferBeforeMinutes: clampInt(incomingSettings.bufferBeforeMinutes, 0, 240, preset.bufferBeforeMinutes || DEFAULT_SETTINGS.bufferBeforeMinutes),
    bufferAfterMinutes: clampInt(incomingSettings.bufferAfterMinutes, 0, 240, preset.bufferAfterMinutes || DEFAULT_SETTINGS.bufferAfterMinutes),
    campaignTimeoutMinutes: clampInt(incomingSettings.campaignTimeoutMinutes, 5, 24 * 60, preset.campaignTimeoutMinutes || DEFAULT_SETTINGS.campaignTimeoutMinutes),
    preferredOwnerId: incomingSettings.preferredOwnerId ? String(incomingSettings.preferredOwnerId) : null,
    rankingWeights: {
      ...(verticalPreset.rankingWeights || {}),
      ...(incomingSettings.rankingWeights || {}),
    },
  };

  return {
    ...base,
    channel: String(base.channel || 'whatsapp').trim().toLowerCase() || 'whatsapp',
    sendWindowStart: parseHourMinute(base.sendWindowStart, '08:00') === null ? '08:00' : String(base.sendWindowStart || '08:00'),
    sendWindowEnd: parseHourMinute(base.sendWindowEnd, '19:00') === null ? '19:00' : String(base.sendWindowEnd || '19:00'),
    allowedWeekdays: normalizeWeekdays(base.allowedWeekdays),
    minNoticeMinutes: clampInt(base.minNoticeMinutes, 0, 24 * 60, 30),
    fillHorizonHours: clampInt(base.fillHorizonHours, 1, 24 * 14, 48),
    maxInvitesPerCampaign: clampInt(base.maxInvitesPerCampaign, 1, 100, 8),
    maxInvitesPerContactDay: clampInt(base.maxInvitesPerContactDay, 0, 100, 2),
    maxInvitesPerContactWeek: clampInt(base.maxInvitesPerContactWeek, 0, 200, 5),
    cooldownHoursAfterReject: clampInt(base.cooldownHoursAfterReject, 0, 24 * 30, 48),
    cooldownHoursAfterNoResponse: clampInt(base.cooldownHoursAfterNoResponse, 0, 24 * 30, 24),
    minGapDurationMinutes: settings.minGapDurationMinutes,
    bufferBeforeMinutes: settings.bufferBeforeMinutes,
    bufferAfterMinutes: settings.bufferAfterMinutes,
    settings,
  };
}

function isWeekdayAllowed(policy, dateLike) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return true;
  const allowedWeekdays = Array.isArray(policy?.allowedWeekdays) ? policy.allowedWeekdays : [0, 1, 2, 3, 4, 5, 6];
  return allowedWeekdays.includes(utcWeekday(date));
}

function isWithinSendWindow(policy, dateLike) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return true;
  const start = parseHourMinute(policy?.sendWindowStart, '08:00');
  const end = parseHourMinute(policy?.sendWindowEnd, '19:00');
  if (start === null || end === null) return true;
  return intersectsWindow(date, date, start, end);
}

function isChannelAllowed(policy, channel) {
  const normalized = String(channel || policy?.channel || 'whatsapp').trim().toLowerCase();
  const allowed = normalizeChannels(policy?.settings?.allowedChannels || [policy?.channel || 'whatsapp']);
  return allowed.includes(normalized);
}

function matchesPreferredTimeWindows(scope, windowsInput = null) {
  const startAt = scope?.gapStartAt || scope?.startAt || scope?.gap_start_at || null;
  const endAt = scope?.gapEndAt || scope?.endAt || scope?.gap_end_at || null;
  const windows = Array.isArray(windowsInput)
    ? windowsInput
    : (Array.isArray(scope?.settings?.preferredTimeWindows) ? scope.settings.preferredTimeWindows : []);
  if (windows.length === 0) return true;
  return windows.some((window) => {
    const start = parseHourMinute(window?.start, null);
    const end = parseHourMinute(window?.end, null);
    if (start === null || end === null) return false;
    return intersectsWindow(startAt, endAt, start, end);
  });
}

function getCampaignExpiryAt(campaign, policy) {
  const gapStartAt = new Date(campaign?.gapStartAt || campaign?.gap_start_at || null);
  if (Number.isNaN(gapStartAt.getTime())) return null;
  const timeoutMinutes = clampInt(policy?.settings?.campaignTimeoutMinutes, 5, 24 * 60, 120);
  const candidate = new Date(gapStartAt.getTime() - (timeoutMinutes * 60 * 1000));
  return candidate.getTime() > Date.now() ? candidate : gapStartAt;
}

function buildGapFingerprint({ tenantId, gap }) {
  const payload = [
    String(tenantId || ''),
    String(gap?.ownerId || ''),
    String(gap?.teamId || ''),
    String(gap?.gapStartAt || ''),
    String(gap?.gapEndAt || ''),
    String(gap?.serviceType || ''),
    String(gap?.contextType || ''),
    String(gap?.contextId || ''),
  ].join('|');
  return crypto.createHash('sha1').update(payload).digest('hex');
}

function isWithinQuietHours(runtime, dateLike = new Date()) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return false;
  const start = parseHourMinute(runtime?.quietHoursStart, null);
  const end = parseHourMinute(runtime?.quietHoursEnd, null);
  if (start === null || end === null) return false;
  return intersectsWindow(date, date, start, end);
}

function structuredReason(code, message, extra = {}) {
  return { code: String(code), message: String(message), ...extra };
}

module.exports = {
  DEFAULT_SETTINGS,
  getVerticalPreset,
  resolvePolicy,
  normalizeWeekdays,
  normalizeChannels,
  normalizeTimeWindows,
  isWeekdayAllowed,
  isWithinSendWindow,
  isChannelAllowed,
  matchesPreferredTimeWindows,
  getCampaignExpiryAt,
  buildGapFingerprint,
  isWithinQuietHours,
  structuredReason,
};
