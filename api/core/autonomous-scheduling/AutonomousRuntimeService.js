'use strict';

const { AutonomousRuntime } = require('../../db/models');
const { newId, getJson, parseHourMinute, clampInt } = require('./shared');
const { normalizeChannels } = require('./runtime');
const { getPreset } = require('./VerticalTemplateRegistry');
const { getPolicy } = require('./AutonomousSchedulePolicyService');

const DEFAULT_RUNTIME = Object.freeze({
  autoDetectEnabled: false,
  autoCampaignEnabled: false,
  autoExpireEnabled: true,
  predictiveEnabled: true,
  revenueEnabled: true,
  kioskEnabled: false,
  snapshotGenerationEnabled: false,
  recommendationsEnabled: true,
  simulationMode: true,
  runIntervalMinutes: 10,
  maxCampaignsPerRun: 10,
  maxInvitesPerRun: 50,
  maxRecommendationsPerRun: 10,
  maxSnapshotsPerDay: 8,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  enabledChannelsJson: ['whatsapp'],
  safetyMode: 'manual',
  runtimeNotes: '',
});

function normalizeSafetyMode(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['manual', 'guarded', 'dry_run'].includes(normalized)) return normalized;
  return fallback;
}

function normalizeRuntime(payload = {}, verticalTemplate = 'beauty') {
  const preset = getPreset(verticalTemplate).runtimeDefaults || {};
  const runtime = {
    autoDetectEnabled: payload.autoDetectEnabled === true,
    autoCampaignEnabled: payload.autoCampaignEnabled === true,
    autoExpireEnabled: payload.autoExpireEnabled !== false,
    predictiveEnabled: payload.predictiveEnabled !== false,
    revenueEnabled: payload.revenueEnabled !== false,
    kioskEnabled: payload.kioskEnabled === true,
    snapshotGenerationEnabled: payload.snapshotGenerationEnabled === true,
    recommendationsEnabled: payload.recommendationsEnabled !== false,
    simulationMode: payload.simulationMode !== false,
    runIntervalMinutes: clampInt(payload.runIntervalMinutes, 5, 24 * 60, preset.runIntervalMinutes || DEFAULT_RUNTIME.runIntervalMinutes),
    maxCampaignsPerRun: clampInt(payload.maxCampaignsPerRun, 1, 100, preset.maxCampaignsPerRun || DEFAULT_RUNTIME.maxCampaignsPerRun),
    maxInvitesPerRun: clampInt(payload.maxInvitesPerRun, 1, 500, preset.maxInvitesPerRun || DEFAULT_RUNTIME.maxInvitesPerRun),
    maxRecommendationsPerRun: clampInt(payload.maxRecommendationsPerRun, 1, 100, preset.maxRecommendationsPerRun || DEFAULT_RUNTIME.maxRecommendationsPerRun),
    maxSnapshotsPerDay: clampInt(payload.maxSnapshotsPerDay, 1, 48, preset.maxSnapshotsPerDay || DEFAULT_RUNTIME.maxSnapshotsPerDay),
    quietHoursStart: parseHourMinute(payload.quietHoursStart, preset.quietHoursStart || DEFAULT_RUNTIME.quietHoursStart) === null
      ? (preset.quietHoursStart || DEFAULT_RUNTIME.quietHoursStart)
      : String(payload.quietHoursStart || preset.quietHoursStart || DEFAULT_RUNTIME.quietHoursStart),
    quietHoursEnd: parseHourMinute(payload.quietHoursEnd, preset.quietHoursEnd || DEFAULT_RUNTIME.quietHoursEnd) === null
      ? (preset.quietHoursEnd || DEFAULT_RUNTIME.quietHoursEnd)
      : String(payload.quietHoursEnd || preset.quietHoursEnd || DEFAULT_RUNTIME.quietHoursEnd),
    enabledChannelsJson: normalizeChannels(payload.enabledChannelsJson, preset.enabledChannelsJson || DEFAULT_RUNTIME.enabledChannelsJson),
    safetyMode: normalizeSafetyMode(payload.safetyMode, preset.safetyMode || DEFAULT_RUNTIME.safetyMode),
    runtimeNotes: String(payload.runtimeNotes || '').trim(),
  };

  if (runtime.autoCampaignEnabled && !runtime.autoDetectEnabled) {
    runtime.autoCampaignEnabled = false;
  }
  if (runtime.kioskEnabled && !runtime.enabledChannelsJson.includes('kiosk')) {
    runtime.enabledChannelsJson = normalizeChannels([...runtime.enabledChannelsJson, 'kiosk']);
  }
  if (!runtime.recommendationsEnabled) {
    runtime.maxRecommendationsPerRun = 0;
  }
  if (runtime.safetyMode === 'manual') {
    runtime.autoDetectEnabled = false;
    runtime.autoCampaignEnabled = false;
  }

  return runtime;
}

function explainRuntime(runtime) {
  const reasons = [];
  if (!runtime.recommendationsEnabled) reasons.push({ code: 'runtime_disabled', message: 'Recomendações desabilitadas no runtime.' });
  if (!runtime.snapshotGenerationEnabled) reasons.push({ code: 'runtime_disabled', message: 'Snapshots manuais permitidos, mas geração recorrente continua desabilitada.' });
  if (runtime.safetyMode === 'manual') reasons.push({ code: 'runtime_disabled', message: 'Modo manual mantém automações recorrentes inativas.' });
  if (runtime.simulationMode) reasons.push({ code: 'simulation_mode', message: 'Modo de simulação ativo para prévias sem efeitos colaterais.' });
  return reasons;
}

function mapRuntime(row, verticalTemplate = 'beauty') {
  const json = getJson(row);
  return normalizeRuntime({
    id: json?.id,
    tenantId: json?.tenant_key,
    autoDetectEnabled: json?.auto_detect_enabled,
    autoCampaignEnabled: json?.auto_campaign_enabled,
    autoExpireEnabled: json?.auto_expire_enabled,
    predictiveEnabled: json?.predictive_enabled,
    revenueEnabled: json?.revenue_enabled,
    kioskEnabled: json?.kiosk_enabled,
    snapshotGenerationEnabled: json?.snapshot_generation_enabled,
    recommendationsEnabled: json?.recommendations_enabled,
    simulationMode: json?.simulation_mode,
    runIntervalMinutes: json?.run_interval_minutes,
    maxCampaignsPerRun: json?.max_campaigns_per_run,
    maxInvitesPerRun: json?.max_invites_per_run,
    maxRecommendationsPerRun: json?.max_recommendations_per_run,
    maxSnapshotsPerDay: json?.max_snapshots_per_day,
    quietHoursStart: json?.quiet_hours_start,
    quietHoursEnd: json?.quiet_hours_end,
    enabledChannelsJson: json?.enabled_channels_json,
    safetyMode: json?.safety_mode,
    runtimeNotes: json?.runtime_notes,
  }, verticalTemplate);
}

async function resolveVerticalTemplate(tenantId) {
  const policy = await getPolicy(tenantId);
  return policy?.settings?.verticalTemplate || 'beauty';
}

async function getRuntime(tenantId) {
  const verticalTemplate = await resolveVerticalTemplate(tenantId);
  const row = await AutonomousRuntime().findOne({ where: { tenant_key: String(tenantId) } });
  const runtime = row
    ? { id: row.id, tenantId: String(tenantId), ...mapRuntime(row, verticalTemplate) }
    : { tenantId: String(tenantId), ...normalizeRuntime({}, verticalTemplate) };
  return {
    ok: true,
    runtime,
    reasons: explainRuntime(runtime),
  };
}

async function upsertRuntime({ tenantId, patch = {} }) {
  const verticalTemplate = await resolveVerticalTemplate(tenantId);
  const Model = AutonomousRuntime();
  const existing = await Model.findOne({ where: { tenant_key: String(tenantId) } });
  const current = existing ? mapRuntime(existing, verticalTemplate) : normalizeRuntime({}, verticalTemplate);
  const merged = normalizeRuntime({ ...current, ...patch }, verticalTemplate);
  const payload = {
    tenant_key: String(tenantId),
    auto_detect_enabled: merged.autoDetectEnabled,
    auto_campaign_enabled: merged.autoCampaignEnabled,
    auto_expire_enabled: merged.autoExpireEnabled,
    predictive_enabled: merged.predictiveEnabled,
    revenue_enabled: merged.revenueEnabled,
    kiosk_enabled: merged.kioskEnabled,
    snapshot_generation_enabled: merged.snapshotGenerationEnabled,
    recommendations_enabled: merged.recommendationsEnabled,
    simulation_mode: merged.simulationMode,
    run_interval_minutes: merged.runIntervalMinutes,
    max_campaigns_per_run: merged.maxCampaignsPerRun,
    max_invites_per_run: merged.maxInvitesPerRun,
    max_recommendations_per_run: merged.maxRecommendationsPerRun,
    max_snapshots_per_day: merged.maxSnapshotsPerDay,
    quiet_hours_start: merged.quietHoursStart,
    quiet_hours_end: merged.quietHoursEnd,
    enabled_channels_json: merged.enabledChannelsJson,
    safety_mode: merged.safetyMode,
    runtime_notes: merged.runtimeNotes || null,
  };

  if (!existing) {
    const row = await Model.create({
      id: newId('art'),
      ...payload,
    });
    const runtime = { id: row.id, tenantId: String(tenantId), ...mapRuntime(row, verticalTemplate) };
    return { ok: true, runtime, reasons: explainRuntime(runtime) };
  }

  await existing.update(payload);
  const runtime = { id: existing.id, tenantId: String(tenantId), ...normalizeRuntime({ ...current, ...merged }, verticalTemplate) };
  return { ok: true, runtime, reasons: explainRuntime(runtime) };
}

module.exports = {
  DEFAULT_RUNTIME,
  normalizeRuntime,
  explainRuntime,
  getRuntime,
  upsertRuntime,
};
