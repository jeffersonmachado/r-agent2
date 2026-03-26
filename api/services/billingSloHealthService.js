'use strict';

const { BILLING_SLO_TARGETS } = require('./billingSloPolicy');
const { getBillingOpsMetrics } = require('./billingOpsMetricsService');
const { getExecutionQueueMetricsByKind } = require('./executionQueueService');

function pct(part, total) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const p = Number(part || 0);
  return Number(((p / total) * 100).toFixed(2));
}

function computeStatus(violationsCount) {
  if (violationsCount <= 0) return 'healthy';
  if (violationsCount <= 2) return 'degraded';
  return 'unhealthy';
}

async function getBillingSloHealth({ tenantId, windowDays = 30 } = {}) {
  if (!tenantId) {
    const err = new Error('tenantId_required');
    err.code = 'validation_error';
    throw err;
  }

  const [billingOut, queueByKindOut] = await Promise.all([
    getBillingOpsMetrics({ tenantId, windowDays }),
    getExecutionQueueMetricsByKind({ tenantId, kinds: ['billing_reconciliation'] }),
  ]);

  if (!billingOut?.ok) {
    return { ok: false, error: billingOut?.error || 'billing_metrics_unavailable' };
  }

  if (!queueByKindOut?.ok) {
    return { ok: false, error: queueByKindOut?.error || 'queue_metrics_unavailable' };
  }

  const metrics = billingOut.metrics || {};
  const totalTransactions = Number(metrics.totalTransactions || 0);
  const problematicCount = Number(metrics.pendingCount || 0)
    + Number(metrics.overdueCount || 0)
    + Number(metrics.refundedCount || 0)
    + Number(metrics.chargebackCount || 0)
    + Number(metrics.cancelledCount || 0);

  const indicators = {
    problematicRatePct: pct(problematicCount, totalTransactions),
    chargebackRatePct: pct(metrics.chargebackCount || 0, totalTransactions),
    refundRatePct: pct(metrics.refundedCount || 0, totalTransactions),
    pendingRatePct: pct(metrics.pendingCount || 0, totalTransactions),
    overdueRatePct: pct(metrics.overdueCount || 0, totalTransactions),
  };

  const queueItem = Array.isArray(queueByKindOut.items)
    ? queueByKindOut.items.find((x) => String(x?.kind || '') === 'billing_reconciliation')
    : null;

  const queueIndicators = {
    deadJobs: Number(queueItem?.dead || 0),
    pendingLagSec: Number(queueItem?.pendingLagSec || 0),
    pendingJobs: Number(queueItem?.pending || 0),
    processingJobs: Number(queueItem?.processing || 0),
    retryingPendingJobs: Number(queueItem?.retryingPending || 0),
  };

  const violations = [];
  if (indicators.problematicRatePct > BILLING_SLO_TARGETS.maxProblematicRatePct) {
    violations.push({ key: 'problematicRatePct', actual: indicators.problematicRatePct, target: BILLING_SLO_TARGETS.maxProblematicRatePct });
  }
  if (indicators.chargebackRatePct > BILLING_SLO_TARGETS.maxChargebackRatePct) {
    violations.push({ key: 'chargebackRatePct', actual: indicators.chargebackRatePct, target: BILLING_SLO_TARGETS.maxChargebackRatePct });
  }
  if (indicators.refundRatePct > BILLING_SLO_TARGETS.maxRefundRatePct) {
    violations.push({ key: 'refundRatePct', actual: indicators.refundRatePct, target: BILLING_SLO_TARGETS.maxRefundRatePct });
  }
  if (indicators.pendingRatePct > BILLING_SLO_TARGETS.maxPendingRatePct) {
    violations.push({ key: 'pendingRatePct', actual: indicators.pendingRatePct, target: BILLING_SLO_TARGETS.maxPendingRatePct });
  }
  if (indicators.overdueRatePct > BILLING_SLO_TARGETS.maxOverdueRatePct) {
    violations.push({ key: 'overdueRatePct', actual: indicators.overdueRatePct, target: BILLING_SLO_TARGETS.maxOverdueRatePct });
  }
  if (queueIndicators.deadJobs > BILLING_SLO_TARGETS.maxDeadJobs) {
    violations.push({ key: 'deadJobs', actual: queueIndicators.deadJobs, target: BILLING_SLO_TARGETS.maxDeadJobs });
  }
  if (queueIndicators.pendingLagSec > BILLING_SLO_TARGETS.maxPendingLagSec) {
    violations.push({ key: 'pendingLagSec', actual: queueIndicators.pendingLagSec, target: BILLING_SLO_TARGETS.maxPendingLagSec });
  }

  return {
    ok: true,
    tenantId: String(tenantId),
    windowDays: Number(windowDays) || 30,
    status: computeStatus(violations.length),
    targets: BILLING_SLO_TARGETS,
    indicators: {
      ...indicators,
      ...queueIndicators,
      totalTransactions,
      problematicCount,
    },
    violations,
  };
}

module.exports = {
  getBillingSloHealth,
};
