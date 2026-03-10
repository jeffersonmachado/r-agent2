'use strict';

const logger = require('../utils/logger');
const { Op } = require('sequelize');
const { Tenant, OperationalAlert } = require('../db/models');
const collectOperationalMetricsJob = require('./collectOperationalMetricsJob');
const schedulingHealthService = require('../services/schedulingHealthService');
const { cleanupOldAudits } = require('../services/uraDecisionAuditService');
const operationalMetricsService = require('../services/operationalMetricsService');

let timer = null;
let running = false;

function parseIntervalMs() {
  const raw = Number(process.env.OCC_HEALTH_INTERVAL_MS || 5 * 60 * 1000);
  if (Number.isFinite(raw) && raw >= 60000) return Math.trunc(raw);
  return 5 * 60 * 1000;
}

async function syncAiProviderAlert({ tenantId }) {
  const latest = await operationalMetricsService.getLatestTenantSnapshot({ tenantId });
  const snapshot = latest?.item?.snapshot_payload_json || null;
  const providerFailures = Number(snapshot?.ai?.providerFailures || 0);
  const aiStatus = String(snapshot?.health?.aiStatus || '').toLowerCase();
  const existing = await OperationalAlert().findOne({
    where: {
      tenant_key: String(tenantId),
      alert_type: 'ai_provider_failures',
      entity_type: 'tenant',
      entity_id: String(tenantId),
      resolved_at: null,
    },
  });

  if (providerFailures >= 3 || aiStatus === 'red') {
    const severity = providerFailures >= 8 || aiStatus === 'red' ? 'high' : 'medium';
    const description = `Tenant ${tenantId} acumulou ${providerFailures} falha(s) recentes de provider IA no snapshot OCC.`;
    if (existing) {
      await existing.update({ severity, description, resolved_at: null });
      return { ok: true, status: 'updated' };
    }
    await OperationalAlert().create({
      id: `opalert-${Date.now()}-${String(tenantId)}`,
      tenant_key: String(tenantId),
      alert_type: 'ai_provider_failures',
      severity,
      entity_type: 'tenant',
      entity_id: String(tenantId),
      description,
      resolved_at: null,
    });
    return { ok: true, status: 'created' };
  }

  if (existing) {
    await existing.update({ resolved_at: new Date() });
    return { ok: true, status: 'resolved' };
  }

  return { ok: true, status: 'noop' };
}

async function run({ tenantId = null } = {}) {
  const tenants = tenantId
    ? [{ tenant_key: String(tenantId) }]
    : (await Tenant().findAll({ where: { status: { [Op.in]: ['trial', 'active'] } }, limit: 200 })).map((row) => row.toJSON ? row.toJSON() : row);

  const metrics = await collectOperationalMetricsJob.run({ tenantId }).catch((err) => ({ ok: false, error: err?.message || 'metrics_failed' }));
  const health = [];
  for (const tenant of tenants) {
    try {
      const out = await schedulingHealthService.scanTenant({ tenantId: tenant.tenant_key, persist: true });
      await syncAiProviderAlert({ tenantId: tenant.tenant_key }).catch(() => null);
      health.push({ tenantId: tenant.tenant_key, alerts: out.alerts.length });
    } catch (err) {
      logger.warn('[PlatformHealthCheckJob] falha no health check do tenant', {
        tenantId: tenant.tenant_key,
        error: err?.message || String(err || 'unknown_error'),
      });
      health.push({ tenantId: tenant.tenant_key, error: err?.message || 'health_failed' });
    }
  }
  const cleanup = await cleanupOldAudits({ days: Number(process.env.OCC_URA_AUDIT_RETENTION_DAYS || 30) }).catch(() => ({ ok: false, deleted: 0 }));
  return { ok: true, metrics, health, cleanup };
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const out = await run({});
    logger.info('[PlatformHealthCheckJob] ciclo concluido', {
      metricsTenants: out.metrics?.items?.length || 0,
      healthTenants: out.health?.length || 0,
      deletedAudits: out.cleanup?.deleted || 0,
    });
  } catch (err) {
    logger.error('[PlatformHealthCheckJob] erro no ciclo', { error: err?.message || String(err || 'unknown_error') });
  } finally {
    running = false;
  }
}

function start({ intervalMs = null } = {}) {
  if (timer) return;
  const safeInterval = Number.isFinite(Number(intervalMs)) ? Number(intervalMs) : parseIntervalMs();
  timer = setInterval(() => {
    tick().catch(() => null);
  }, safeInterval);
  if (typeof timer.unref === 'function') timer.unref();
  tick().catch(() => null);
  logger.info('[PlatformHealthCheckJob] iniciado', { intervalMs: safeInterval });
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  logger.info('[PlatformHealthCheckJob] parado');
}

module.exports = {
  run,
  start,
  stop,
  syncAiProviderAlert,
};
