'use strict';

const { Op } = require('sequelize');
const { getSequelize } = require('../db/sequelize');
const { BillingTransaction } = require('../db/models');

function dbAvailable() {
  return !!getSequelize();
}

async function getBillingOpsMetrics({ tenantId, windowDays = 30 } = {}) {
  if (!tenantId) {
    const err = new Error('tenantId_required');
    err.code = 'validation_error';
    throw err;
  }

  if (!dbAvailable()) {
    return { ok: false, error: 'db_unavailable' };
  }

  const since = new Date(Date.now() - (Number(windowDays) || 30) * 86400000);
  const rows = await BillingTransaction().findAll({
    where: {
      tenant_key: String(tenantId),
      created_at: { [Op.gte]: since },
    },
    attributes: ['status', 'amount', 'provider', 'vertical'],
    limit: 10000,
  }).catch(() => []);

  const summary = {
    totalTransactions: 0,
    confirmedCount: 0,
    overdueCount: 0,
    cancelledCount: 0,
    refundedCount: 0,
    chargebackCount: 0,
    pendingCount: 0,
    grossConfirmedAmount: 0,
    refundedAmount: 0,
    chargebackAmount: 0,
    netRecoveredAmount: 0,
    byProvider: {},
    byVertical: {},
  };

  for (const row of rows) {
    const item = row.toJSON ? row.toJSON() : row;
    const status = String(item.status || 'pending').toLowerCase();
    const provider = String(item.provider || 'unknown');
    const vertical = String(item.vertical || 'unknown');
    const amount = Number(item.amount || 0);

    summary.totalTransactions += 1;
    if (status === 'confirmed') {
      summary.confirmedCount += 1;
      summary.grossConfirmedAmount += amount;
    } else if (status === 'overdue') {
      summary.overdueCount += 1;
    } else if (status === 'cancelled') {
      summary.cancelledCount += 1;
    } else if (status === 'refunded') {
      summary.refundedCount += 1;
      summary.refundedAmount += amount;
    } else if (status === 'chargeback') {
      summary.chargebackCount += 1;
      summary.chargebackAmount += amount;
    } else {
      summary.pendingCount += 1;
    }

    if (!summary.byProvider[provider]) {
      summary.byProvider[provider] = { total: 0, confirmed: 0, refunded: 0, chargeback: 0, overdue: 0 };
    }
    if (!summary.byVertical[vertical]) {
      summary.byVertical[vertical] = { total: 0, confirmed: 0, refunded: 0, chargeback: 0, overdue: 0 };
    }

    summary.byProvider[provider].total += 1;
    summary.byVertical[vertical].total += 1;
    if (status === 'confirmed') {
      summary.byProvider[provider].confirmed += 1;
      summary.byVertical[vertical].confirmed += 1;
    }
    if (status === 'refunded') {
      summary.byProvider[provider].refunded += 1;
      summary.byVertical[vertical].refunded += 1;
    }
    if (status === 'chargeback') {
      summary.byProvider[provider].chargeback += 1;
      summary.byVertical[vertical].chargeback += 1;
    }
    if (status === 'overdue') {
      summary.byProvider[provider].overdue += 1;
      summary.byVertical[vertical].overdue += 1;
    }
  }

  summary.grossConfirmedAmount = Number(summary.grossConfirmedAmount.toFixed(2));
  summary.refundedAmount = Number(summary.refundedAmount.toFixed(2));
  summary.chargebackAmount = Number(summary.chargebackAmount.toFixed(2));
  summary.netRecoveredAmount = Number((summary.grossConfirmedAmount - summary.refundedAmount - summary.chargebackAmount).toFixed(2));

  return {
    ok: true,
    tenantId: String(tenantId),
    windowDays: Number(windowDays) || 30,
    metrics: summary,
  };
}

module.exports = {
  getBillingOpsMetrics,
};
