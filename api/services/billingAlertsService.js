'use strict';

const { Op } = require('sequelize');
const { EventLedger } = require('../db/models');
const { appendEventV1 } = require('./eventLedgerService');
const { getBillingSloHealth } = require('./billingSloHealthService');

const ALERT_SOURCE = 'ops.billing.alert';

function safeString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function mapViolationToAlert(violation) {
  const key = safeString(violation?.key || '').trim();
  if (!key) return null;

  if (key === 'deadJobs') {
    return {
      code: 'billing_reconciliation_recurring_failure',
      severity: 'critical',
      title: 'Falhas recorrentes na reconciliação de billing',
      message: `Jobs dead acima do limite (${violation.actual} > ${violation.target})`,
    };
  }

  if (key === 'pendingLagSec') {
    return {
      code: 'billing_reconciliation_backlog_aged',
      severity: 'high',
      title: 'Backlog envelhecido na reconciliação',
      message: `Lag de fila acima do limite (${violation.actual}s > ${violation.target}s)`,
    };
  }

  if (key === 'chargebackRatePct') {
    return {
      code: 'billing_chargeback_spike',
      severity: 'critical',
      title: 'Spike de chargeback',
      message: `Taxa de chargeback acima do SLO (${violation.actual}% > ${violation.target}%)`,
    };
  }

  if (key === 'problematicRatePct' || key === 'overdueRatePct' || key === 'pendingRatePct') {
    return {
      code: 'billing_problematic_volume_high',
      severity: 'high',
      title: 'Volume de transações problemáticas elevado',
      message: `${key} acima do SLO (${violation.actual} > ${violation.target})`,
    };
  }

  if (key === 'refundRatePct') {
    return {
      code: 'billing_refund_rate_high',
      severity: 'medium',
      title: 'Taxa de refund elevada',
      message: `Taxa de refund acima do SLO (${violation.actual}% > ${violation.target}%)`,
    };
  }

  return {
    code: `billing_slo_${key}`,
    severity: 'medium',
    title: 'Violação de SLO de billing',
    message: `${key} acima do SLO (${violation.actual} > ${violation.target})`,
  };
}

function dedupeAlerts(items) {
  const map = new Map();
  for (const item of items) {
    const key = safeString(item?.code || '');
    if (!key) continue;
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

function toAlertHistoryItem(row) {
  const json = typeof row?.toJSON === 'function' ? row.toJSON() : row;
  const payload = json?.payload || {};
  return {
    id: json?.id || null,
    timestamp: json?.occurred_at ? new Date(json.occurred_at).toISOString() : null,
    code: safeString(payload.code || ''),
    severity: safeString(payload.severity || 'medium'),
    title: safeString(payload.title || ''),
    message: safeString(payload.message || ''),
    indicatorKey: safeString(payload.indicatorKey || ''),
    actual: Number(payload.actual || 0),
    target: Number(payload.target || 0),
    status: safeString(payload.status || 'active'),
    source: safeString(json?.source || ALERT_SOURCE, ALERT_SOURCE),
  };
}

async function persistAlerts({ tenantId, alerts, health }) {
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  for (const alert of alerts) {
    const idem = `${alert.code}:${tenantId}:${dateKey}`;
    try {
      await appendEventV1({
        tenantId,
        type: 'VerticalJourney_Custom',
        source: ALERT_SOURCE,
        subject: { type: 'tenant', id: tenantId },
        actor: { type: 'system', id: 'billing_alerts' },
        idempotencyKey: idem,
        payload: {
          kind: 'billing_alert',
          status: 'active',
          code: alert.code,
          severity: alert.severity,
          title: alert.title,
          message: alert.message,
          indicatorKey: alert.indicatorKey,
          actual: alert.actual,
          target: alert.target,
          tenantId,
          healthStatus: health?.status || 'unknown',
        },
      });
    } catch (_) {}
  }
}

async function listBillingAlertHistory({ tenantId, limit = 30 }) {
  const rows = await EventLedger().findAll({
    where: {
      tenant_key: String(tenantId),
      type: 'VerticalJourney_Custom',
      source: ALERT_SOURCE,
      occurred_at: { [Op.gte]: new Date(Date.now() - 30 * 86400000) },
    },
    order: [['occurred_at', 'DESC']],
    limit: Math.min(Math.max(Number(limit) || 30, 1), 200),
  }).catch(() => []);

  return (Array.isArray(rows) ? rows : []).map(toAlertHistoryItem);
}

async function evaluateBillingAlerts({ tenantId, windowDays = 30, persist = true, historyLimit = 30 } = {}) {
  const health = await getBillingSloHealth({ tenantId, windowDays });
  if (!health?.ok) {
    return { ok: false, error: health?.error || 'billing_slo_unavailable' };
  }

  const mapped = (health.violations || [])
    .map((v) => {
      const base = mapViolationToAlert(v);
      if (!base) return null;
      return {
        ...base,
        indicatorKey: v.key,
        actual: v.actual,
        target: v.target,
      };
    })
    .filter(Boolean);

  const alerts = dedupeAlerts(mapped);

  if (persist && alerts.length) {
    await persistAlerts({ tenantId, alerts, health });
  }

  const history = await listBillingAlertHistory({ tenantId, limit: historyLimit });

  return {
    ok: true,
    tenantId: String(tenantId),
    windowDays: Number(windowDays) || 30,
    status: health.status,
    alerts,
    history,
    slo: {
      targets: health.targets,
      indicators: health.indicators,
      violations: health.violations,
    },
  };
}

module.exports = {
  evaluateBillingAlerts,
};
