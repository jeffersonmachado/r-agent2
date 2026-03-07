'use strict';

const { AutonomousSchedulePolicy } = require('../../db/models');
const { newId, getJson } = require('./shared');
const { DEFAULT_SETTINGS, normalizeWeekdays, resolvePolicy } = require('./runtime');

const DEFAULT_POLICY = Object.freeze({
  channel: 'whatsapp',
  enabled: true,
  autoFillEnabled: true,
  waitingListEnabled: true,
  reactivationEnabled: true,
  minNoticeMinutes: 30,
  fillHorizonHours: 48,
  maxInvitesPerCampaign: 8,
  maxInvitesPerContactDay: 2,
  maxInvitesPerContactWeek: 5,
  cooldownHoursAfterReject: 48,
  cooldownHoursAfterNoResponse: 24,
  minGapDurationMinutes: 30,
  sendWindowStart: '08:00',
  sendWindowEnd: '19:00',
  allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
  settings: DEFAULT_SETTINGS,
});

function mapPolicy(row) {
  if (!row) return resolvePolicy(DEFAULT_POLICY);
  const json = getJson(row);
  return resolvePolicy({
    id: json.id,
    tenantId: json.tenant_key,
    channel: json.channel || 'whatsapp',
    enabled: !!json.enabled,
    autoFillEnabled: !!json.auto_fill_enabled,
    waitingListEnabled: !!json.waiting_list_enabled,
    reactivationEnabled: !!json.reactivation_enabled,
    minNoticeMinutes: Number(json.min_notice_minutes || 30),
    fillHorizonHours: Number(json.fill_horizon_hours || 48),
    maxInvitesPerCampaign: Number(json.max_invites_per_campaign || 8),
    maxInvitesPerContactDay: Number(json.max_invites_per_contact_day || 2),
    maxInvitesPerContactWeek: Number(json.max_invites_per_contact_week || 5),
    cooldownHoursAfterReject: Number(json.cooldown_hours_after_reject || 48),
    cooldownHoursAfterNoResponse: Number(json.cooldown_hours_after_no_response || 24),
    minGapDurationMinutes: Number(json.min_gap_duration_minutes || json.min_notice_minutes || 30),
    sendWindowStart: json.send_window_start || '08:00',
    sendWindowEnd: json.send_window_end || '19:00',
    allowedWeekdays: Array.isArray(json.allowed_weekdays) ? json.allowed_weekdays : [0, 1, 2, 3, 4, 5, 6],
    settings: json.settings || {},
  });
}

async function getPolicy(tenantId) {
  const row = await AutonomousSchedulePolicy().findOne({ where: { tenant_key: String(tenantId) } });
  return mapPolicy(row);
}

async function upsertPolicy({ tenantId, patch = {} }) {
  const Model = AutonomousSchedulePolicy();
  const existing = await Model.findOne({ where: { tenant_key: String(tenantId) } });
  const current = mapPolicy(existing);
  const merged = resolvePolicy({
    ...current,
    ...patch,
    allowedWeekdays: Array.isArray(patch.allowedWeekdays) ? normalizeWeekdays(patch.allowedWeekdays) : current.allowedWeekdays,
    settings: patch.settings && typeof patch.settings === 'object'
      ? { ...(current.settings || {}), ...patch.settings }
      : current.settings,
  });
  if (!existing) {
    const row = await Model.create({
      id: newId('asp'),
      tenant_key: String(tenantId),
      channel: merged.channel,
      enabled: merged.enabled,
      auto_fill_enabled: merged.autoFillEnabled,
      waiting_list_enabled: merged.waitingListEnabled,
      reactivation_enabled: merged.reactivationEnabled,
      min_notice_minutes: merged.minNoticeMinutes,
      fill_horizon_hours: merged.fillHorizonHours,
      max_invites_per_campaign: merged.maxInvitesPerCampaign,
      max_invites_per_contact_day: merged.maxInvitesPerContactDay,
      max_invites_per_contact_week: merged.maxInvitesPerContactWeek,
      cooldown_hours_after_reject: merged.cooldownHoursAfterReject,
      cooldown_hours_after_no_response: merged.cooldownHoursAfterNoResponse,
      min_gap_duration_minutes: merged.minGapDurationMinutes,
      send_window_start: merged.sendWindowStart,
      send_window_end: merged.sendWindowEnd,
      allowed_weekdays: merged.allowedWeekdays,
      settings: merged.settings,
    });
    return { ok: true, policy: mapPolicy(row) };
  }
  await existing.update({
    channel: merged.channel,
    enabled: merged.enabled,
    auto_fill_enabled: merged.autoFillEnabled,
    waiting_list_enabled: merged.waitingListEnabled,
    reactivation_enabled: merged.reactivationEnabled,
    min_notice_minutes: merged.minNoticeMinutes,
    fill_horizon_hours: merged.fillHorizonHours,
    max_invites_per_campaign: merged.maxInvitesPerCampaign,
    max_invites_per_contact_day: merged.maxInvitesPerContactDay,
    max_invites_per_contact_week: merged.maxInvitesPerContactWeek,
    cooldown_hours_after_reject: merged.cooldownHoursAfterReject,
    cooldown_hours_after_no_response: merged.cooldownHoursAfterNoResponse,
    min_gap_duration_minutes: merged.minGapDurationMinutes,
    send_window_start: merged.sendWindowStart,
    send_window_end: merged.sendWindowEnd,
    allowed_weekdays: merged.allowedWeekdays,
    settings: merged.settings,
  });
  return { ok: true, policy: mapPolicy(existing) };
}

module.exports = { DEFAULT_POLICY, getPolicy, upsertPolicy, mapPolicy };
