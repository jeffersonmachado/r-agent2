'use strict';

const logger = require('../utils/logger');
const { Op } = require('sequelize');
const { Tenant } = require('../db/models');
const collectOperationalMetricsJob = require('./collectOperationalMetricsJob');
const schedulingHealthService = require('../services/schedulingHealthService');
const { cleanupOldAudits } = require('../services/uraDecisionAuditService');

let timer = null;
let running = false;

function parseIntervalMs() {
  const raw = Number(process.env.OCC_HEALTH_INTERVAL_MS || 5 * 60 * 1000);
  if (Number.isFinite(raw) && raw >= 60000) return Math.trunc(raw);
  return 5 * 60 * 1000;
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
};
