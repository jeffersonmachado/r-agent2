'use strict';

const { Op } = require('sequelize');
const logger = require('../../utils/logger');
const { getSequelize } = require('../../db/sequelize');
const { TenantSetting, Tenant } = require('../../db/models');
const googleAdsRecommendationService = require('./googleAdsRecommendationService');
const googleAdsConversionService = require('./googleAdsConversionService');
const googleAdsAttributionMonitorService = require('./googleAdsAttributionMonitorService');
const { appendEventV1 } = require('../eventLedgerService');

let _timer = null;
let _running = false;
let _tickInFlight = false;
let _lastRunAt = null;
let _lastResult = null;
const _lastAttributionAlertAt = new Map();

function dbAvailable() {
  return !!getSequelize();
}

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try {
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function safeErrorMessage(err, fallback = '') {
  if (err == null) return fallback;
  try {
    return String(err.message);
  } catch (_) {
    return safeToString(err, fallback);
  }
}

function buildDefaultWindow() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 30);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function safeInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : fallback;
}

function safeNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

async function discoverEnabledTenants({ limit = 100 } = {}) {
  if (!dbAvailable()) return [];

  const rows = await TenantSetting().findAll({
    where: { key: 'google_ads' },
    attributes: ['tenant_id', 'value'],
    limit: Math.min(Math.max(Number(limit) || 100, 1), 500),
  }).catch(() => []);

  const enabledRows = (rows || []).filter((row) => {
    const json = row.toJSON ? row.toJSON() : row;
    return json?.value?.enabled === true;
  });
  if (!enabledRows.length) return [];

  const tenantIds = enabledRows.map((row) => {
    const json = row.toJSON ? row.toJSON() : row;
    return json.tenant_id;
  }).filter(Boolean);

  const tenantRows = await Tenant().findAll({
    where: { id: { [Op.in]: tenantIds } },
    attributes: ['id', 'tenant_key'],
  }).catch(() => []);
  const tenantMap = new Map((tenantRows || []).map((row) => {
    const json = row.toJSON ? row.toJSON() : row;
    return [safeToString(json.id), safeToString(json.tenant_key)];
  }));

  return enabledRows
    .map((row) => {
      const json = row.toJSON ? row.toJSON() : row;
      const tenantKey = tenantMap.get(safeToString(json.tenant_id));
      if (!tenantKey) return null;
      return {
        tenantId: tenantKey,
        settings: json.value || {},
      };
    })
    .filter(Boolean);
}

async function recordSchedulerEvent({ tenantId, payload }) {
  return appendEventV1({
    tenantId,
    type: 'MarketingGoogleAdsSchedulerTick',
    source: 'marketing.google_ads.scheduler',
    occurredAt: new Date(),
    subject: { type: 'marketing_google_ads', id: tenantId },
    actor: { type: 'system', id: 'marketing_google_ads_scheduler' },
    payload,
  }).catch(() => null);
}

async function recordAttributionAlertEvent({ tenantId, payload }) {
  return appendEventV1({
    tenantId,
    type: 'MarketingGoogleAdsAttributionAlert',
    source: 'marketing.google_ads.scheduler',
    occurredAt: new Date(),
    subject: { type: 'marketing_google_ads', id: tenantId },
    actor: { type: 'system', id: 'marketing_google_ads_scheduler' },
    payload,
  }).catch(() => null);
}

async function evaluateAttributionAlert({ tenantId, cooldownMinutes = 60, windowDays = 1, minRecentMissing = 3, growthFactorThreshold = 2 }) {
  const status = await googleAdsAttributionMonitorService.getOrderAttributionGrowthStatus({
    tenantId,
    windowDays,
    minRecentMissing,
    growthFactorThreshold,
  }).catch((err) => ({ ok: false, error: safeErrorMessage(err, 'attribution_growth_failed') }));

  if (!status?.ok || status.triggered !== true) return status;

  const cooldownMs = Math.max(1, safeInt(cooldownMinutes, 60)) * 60 * 1000;
  const previous = _lastAttributionAlertAt.get(tenantId) || 0;
  const now = Date.now();
  if (now - previous < cooldownMs) {
    return { ...status, cooldownSuppressed: true };
  }

  _lastAttributionAlertAt.set(tenantId, now);
  await recordAttributionAlertEvent({
    tenantId,
    payload: {
      category: 'marketing_attribution_missing_growth',
      severity: status.growthFactor >= Math.max(growthFactorThreshold * 2, 4) ? 'critical' : 'warning',
      ...status,
    },
  });

  logger.warn('[MarketingGoogleAdsScheduler] Alerta de crescimento de exceções de atribuição', {
    tenantId,
    currentCount: status.currentCount,
    previousCount: status.previousCount,
    growthFactor: status.growthFactor,
  });

  return { ...status, alertEmitted: true };
}

async function processTenant({ tenantId, settings, window, autoUploadOnScheduler = true, attributionAlertConfig = {} }) {
  const recommendationOut = await googleAdsRecommendationService.syncRecommendationsFromAnalysis({
    tenantId,
    startDate: window.startDate,
    endDate: window.endDate,
  });

  let uploadOut = null;
  if (autoUploadOnScheduler === true && settings?.autoUpload === true) {
    uploadOut = await googleAdsConversionService.uploadPendingConversions({
      tenantId,
      limit: 50,
    }).catch((err) => ({ ok: false, error: safeErrorMessage(err, 'upload_failed') }));
  }

  const attributionAlert = await evaluateAttributionAlert({
    tenantId,
    cooldownMinutes: attributionAlertConfig.cooldownMinutes,
    windowDays: attributionAlertConfig.windowDays,
    minRecentMissing: attributionAlertConfig.minRecentMissing,
    growthFactorThreshold: attributionAlertConfig.growthFactorThreshold,
  });

  await recordSchedulerEvent({
    tenantId,
    payload: {
      window,
      recommendations: recommendationOut,
      upload: uploadOut,
      attributionAlert,
      autoUploadEnabled: settings?.autoUpload === true,
    },
  });

  return {
    tenantId,
    recommendations: recommendationOut,
    upload: uploadOut,
    attributionAlert,
  };
}

async function tick({ tenantLimit = 50, autoUploadOnScheduler = true } = {}) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  if (_tickInFlight) return { ok: false, error: 'tick_already_running' };

  _tickInFlight = true;
  _lastRunAt = new Date().toISOString();
  const window = buildDefaultWindow();
  const attributionAlertConfig = {
    windowDays: Math.max(1, safeInt(process.env.MARKETING_GOOGLE_ADS_ATTRIBUTION_ALERT_WINDOW_DAYS, 1)),
    minRecentMissing: Math.max(1, safeInt(process.env.MARKETING_GOOGLE_ADS_ATTRIBUTION_ALERT_MIN_EVENTS, 3)),
    growthFactorThreshold: Math.max(1, safeNumber(process.env.MARKETING_GOOGLE_ADS_ATTRIBUTION_ALERT_GROWTH_FACTOR, 2)),
    cooldownMinutes: Math.max(1, safeInt(process.env.MARKETING_GOOGLE_ADS_ATTRIBUTION_ALERT_COOLDOWN_MINUTES, 60)),
  };

  try {
    const tenants = await discoverEnabledTenants({ limit: tenantLimit });
    const items = [];

    for (const tenant of tenants) {
      // eslint-disable-next-line no-await-in-loop
      const out = await processTenant({
        tenantId: tenant.tenantId,
        settings: tenant.settings,
        window,
        autoUploadOnScheduler,
        attributionAlertConfig,
      }).catch((err) => ({ tenantId: tenant.tenantId, ok: false, error: safeErrorMessage(err, 'tenant_tick_failed') }));
      items.push(out);
    }

    _lastResult = {
      ok: true,
      processedTenants: items.length,
      window,
      items,
    };
    return _lastResult;
  } finally {
    _tickInFlight = false;
  }
}

function startMarketingGoogleAdsScheduler({ intervalMs = 300000, tenantLimit = 50, autoUploadOnScheduler = true } = {}) {
  if (_running) return;
  if (!dbAvailable()) {
    logger.warn('[MarketingGoogleAdsScheduler] DB indisponível, scheduler não iniciado');
    return;
  }

  _running = true;
  _timer = setInterval(() => {
    tick({ tenantLimit, autoUploadOnScheduler }).catch((err) => {
      logger.warn('[MarketingGoogleAdsScheduler] tick falhou (ignorado)', { error: safeErrorMessage(err) });
    });
  }, Math.max(30000, Number(intervalMs) || 300000));
  _timer.unref();

  logger.info('[MarketingGoogleAdsScheduler] iniciado', { intervalMs, tenantLimit, autoUploadOnScheduler });
}

function stopMarketingGoogleAdsScheduler() {
  _running = false;
  if (_timer) clearInterval(_timer);
  _timer = null;
}

function getMarketingGoogleAdsSchedulerStatus() {
  return {
    running: _running,
    tickInFlight: _tickInFlight,
    lastRunAt: _lastRunAt,
    lastResult: _lastResult,
  };
}

module.exports = {
  startMarketingGoogleAdsScheduler,
  stopMarketingGoogleAdsScheduler,
  getMarketingGoogleAdsSchedulerStatus,
  discoverEnabledTenants,
  tick,
};