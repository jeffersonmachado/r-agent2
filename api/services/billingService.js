'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { BillingTransaction, BillingSubscription, VerticalSessionBundle } = require('../db/models');
const { Op } = require('sequelize');
const paymentProvider = require('../integrations/paymentProvider');
const { updateBillingStatus, reactivateMembership, blockMembership } = require('./vertical/billingOrchestrationService');

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
}

function dbAvailable() {
  return !!getSequelize();
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeVertical(vertical) {
  const v = String(vertical || '').trim().toLowerCase();
  return v === 'fitness' ? 'fitness' : 'beauty';
}

function normalizeType(type, vertical) {
  const t = String(type || '').trim().toLowerCase();
  if (t === 'subscription' || t === 'recurring') return 'subscription';
  if (t === 'one_time' || t === 'single') return 'one_time';
  return normalizeVertical(vertical) === 'fitness' ? 'subscription' : 'one_time';
}

function shouldApplyWebhookTransition(currentStatus, nextStatus) {
  const current = String(currentStatus || 'pending').toLowerCase();
  const next = String(nextStatus || 'pending').toLowerCase();
  if (current === next) return false;

  // Prevent out-of-order regressions from webhook retries/events.
  if (current === 'pending') return true;
  if (current === 'overdue') return ['confirmed', 'cancelled', 'refunded', 'chargeback'].includes(next);
  if (current === 'confirmed') return ['cancelled', 'refunded', 'chargeback'].includes(next);
  if (['cancelled', 'refunded', 'chargeback'].includes(current)) return false;
  return true;
}

async function createCharge(payload = {}) {
  if (!dbAvailable()) {
    const err = new Error('billing_db_unavailable');
    err.code = 'billing_db_unavailable';
    throw err;
  }

  const tenantId = String(payload.tenantId || '').trim();
  if (!tenantId) {
    const err = new Error('tenantId required');
    err.code = 'validation_error';
    throw err;
  }

  const vertical = normalizeVertical(payload.vertical);
  const chargeType = normalizeType(payload.type, vertical);
  const amount = toNumber(payload.amount, 0);
  if (amount <= 0) {
    const err = new Error('amount must be > 0');
    err.code = 'validation_error';
    throw err;
  }

  const idempotencyKey = String(payload.idempotencyKey || `billing:${tenantId}:${vertical}:${payload.membershipId || payload.bundleId || payload.subjectId || 'na'}:${amount}:${payload.dueDate || ''}:${chargeType}`);

  const Tx = BillingTransaction();
  const existing = await Tx.findOne({
    where: {
      tenant_key: tenantId,
      idempotency_key: idempotencyKey,
    },
  }).catch(() => null);

  if (existing) {
    const data = existing.toJSON ? existing.toJSON() : existing;
    return { idempotent: true, transaction: data };
  }

  const provider = paymentProvider.normalizeProvider(payload.provider);

  const customer = await paymentProvider.createCustomer({
    provider,
    tenantId,
    customer: {
      name: payload.customerName,
      email: payload.customerEmail,
      phone: payload.customerPhone,
      document: payload.customerDocument,
      externalId: payload.customerId || payload.subjectId,
      subjectId: payload.subjectId,
      customerId: payload.customerId,
    },
    idempotencyKey: `${idempotencyKey}:customer`,
  });

  let subscription = null;
  if (chargeType === 'subscription') {
    subscription = await paymentProvider.createRecurringSubscription({
      provider,
      customerId: customer.id,
      amount,
      nextDueDate: payload.dueDate || null,
      cycle: String(payload.cycle || 'MONTHLY').toUpperCase(),
      description: payload.description || `Assinatura ${vertical}`,
      metadata: {
        reference: idempotencyKey,
        currency: payload.currency || 'BRL',
        email: payload.customerEmail || null,
      },
      idempotencyKey: `${idempotencyKey}:subscription`,
    });

    const Sub = BillingSubscription();
    const row = await Sub.create({
      id: makeId('bs'),
      tenant_key: tenantId,
      vertical,
      membership_id: payload.membershipId || null,
      bundle_id: payload.bundleId || null,
      subject_id: payload.subjectId || null,
      customer_id: payload.customerId || null,
      provider,
      external_customer_id: customer.id || null,
      external_subscription_id: subscription.subscriptionId || null,
      status: subscription.status || 'pending',
      amount,
      currency: payload.currency || 'BRL',
      cycle: String(payload.cycle || 'MONTHLY').toUpperCase(),
      next_charge_at: payload.dueDate ? new Date(payload.dueDate) : null,
      metadata: payload.metadata || {},
    });

    const createdSub = row.toJSON ? row.toJSON() : row;
    logger.info('[Billing] assinatura criada', {
      tenantId,
      vertical,
      provider,
      subscriptionId: createdSub.id,
      externalSubscriptionId: createdSub.external_subscription_id,
    });
  }

  const charge = await paymentProvider.createSingleCharge({
    provider,
    customerId: customer.id,
    amount,
    dueDate: payload.dueDate || null,
    description: payload.description || `Cobranca ${vertical}`,
    metadata: {
      reference: idempotencyKey,
      vertical,
      membershipId: payload.membershipId || null,
      bundleId: payload.bundleId || null,
    },
    idempotencyKey: `${idempotencyKey}:charge`,
  });

  const created = await Tx.create({
    id: makeId('bt'),
    tenant_key: tenantId,
    vertical,
    membership_id: payload.membershipId || null,
    bundle_id: payload.bundleId || null,
    subject_id: payload.subjectId || null,
    customer_id: payload.customerId || null,
    provider,
    type: chargeType,
    amount,
    currency: payload.currency || 'BRL',
    status: charge.status || 'pending',
    due_at: payload.dueDate ? new Date(payload.dueDate) : null,
    external_customer_id: customer.id || null,
    external_transaction_id: charge.transactionId || null,
    external_subscription_id: subscription?.subscriptionId || null,
    idempotency_key: idempotencyKey,
    metadata: {
      paymentUrl: charge.paymentUrl || null,
      providerRaw: charge.raw || {},
      ...(payload.metadata || {}),
    },
  });

  const transaction = created.toJSON ? created.toJSON() : created;

  if (vertical === 'fitness' && payload.membershipId) {
    await updateBillingStatus({
      tenantId,
      membershipId: payload.membershipId,
      toStatus: 'delinquent',
      reason: 'charge_created_waiting_payment',
      actor: 'billing_service',
    }).catch((err) => {
      logger.warn('[Billing] falha ao ajustar status fitness apos criar cobranca', {
        tenantId,
        membershipId: payload.membershipId,
        error: err?.message,
      });
    });
  }

  try {
    const { enqueueNotification } = require('./notificationService');
    await enqueueNotification({
      tenantId,
      vertical,
      channel: 'whatsapp',
      eventType: 'billing_charge_created',
      transactionId: transaction.id,
      membershipId: payload.membershipId || null,
      bundleId: payload.bundleId || null,
      subjectId: payload.subjectId || null,
      customerId: payload.customerId || null,
      recipient: payload.customerPhone || payload.customerEmail || payload.customerId || payload.subjectId || null,
      metadata: {
        vertical,
        amount,
        dueDate: payload.dueDate || null,
        paymentUrl: charge.paymentUrl || null,
      },
    }).catch(() => {});
  } catch (_) {}

  return {
    idempotent: false,
    transaction,
    paymentUrl: charge.paymentUrl || null,
  };
}

async function listTransactions({ tenantId, vertical = null, status = null, limit = 200, offset = 0 } = {}) {
  if (!dbAvailable()) return { total: 0, items: [] };
  const Tx = BillingTransaction();
  const where = { tenant_key: String(tenantId || '').trim() };
  if (vertical) where.vertical = String(vertical).trim().toLowerCase();
  if (status) where.status = String(status).trim().toLowerCase();

  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 2000);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const { count, rows } = await Tx.findAndCountAll({
    where,
    order: [['updated_at', 'DESC'], ['created_at', 'DESC']],
    limit: safeLimit,
    offset: safeOffset,
  }).catch(() => ({ count: 0, rows: [] }));

  return {
    total: count,
    items: rows.map((row) => (row.toJSON ? row.toJSON() : row)),
    limit: safeLimit,
    offset: safeOffset,
  };
}

async function applyBillingRules({ tenantId, transaction, status }) {
  const vertical = String(transaction?.vertical || '').toLowerCase();

  if (vertical === 'fitness' && transaction?.membership_id) {
    if (status === 'confirmed') {
      await reactivateMembership({
        tenantId,
        membershipId: transaction.membership_id,
        reason: 'payment_confirmed',
        actor: 'billing_webhook',
      });
      try {
        const { enqueueNotification } = require('./notificationService');
        await enqueueNotification({
          tenantId,
          vertical,
          channel: 'whatsapp',
          eventType: 'billing_confirmed',
          transactionId: transaction.id,
          membershipId: transaction.membership_id,
          subjectId: transaction.subject_id || null,
          customerId: transaction.customer_id || null,
          recipient: transaction.customer_id || transaction.subject_id || null,
          metadata: {
            vertical,
            provider: transaction.provider,
            amount: transaction.amount,
          },
        }).catch(() => {});
      } catch (_) {}
      return;
    }
    if (status === 'overdue') {
      await blockMembership({
        tenantId,
        membershipId: transaction.membership_id,
        reason: 'payment_overdue',
        actor: 'billing_webhook',
      });
      try {
        const { enqueueNotification } = require('./notificationService');
        await enqueueNotification({
          tenantId,
          vertical,
          channel: 'whatsapp',
          eventType: 'billing_overdue',
          transactionId: transaction.id,
          membershipId: transaction.membership_id,
          subjectId: transaction.subject_id || null,
          customerId: transaction.customer_id || null,
          recipient: transaction.customer_id || transaction.subject_id || null,
          metadata: {
            vertical,
            provider: transaction.provider,
            amount: transaction.amount,
          },
        }).catch(() => {});
      } catch (_) {}
      return;
    }
    if (status === 'cancelled' || status === 'refunded' || status === 'chargeback') {
      const reason = status === 'refunded'
        ? 'payment_refunded'
        : status === 'chargeback'
          ? 'payment_chargeback'
          : 'payment_cancelled';
      await updateBillingStatus({
        tenantId,
        membershipId: transaction.membership_id,
        toStatus: 'cancelled',
        reason,
        actor: 'billing_webhook',
      });
    }
    return;
  }

  // Pedidos (food/market): transação vinculada via metadata.orderId reflete
  // o pagamento no pedido (context.payment) — confirmed vira 'paid',
  // overdue vira 'overdue', estorno/cancelamento volta para o pedido.
  const orderId = transaction?.metadata && typeof transaction.metadata === 'object'
    ? transaction.metadata.orderId
    : null;
  if (orderId) {
    try {
      const { markOrderPaymentStatus } = require('./orderService');
      const statusMap = {
        confirmed: 'paid',
        overdue: 'overdue',
        cancelled: 'cancelled',
        refunded: 'refunded',
        chargeback: 'chargeback',
      };
      const orderPaymentStatus = statusMap[status] || null;
      if (orderPaymentStatus) {
        await markOrderPaymentStatus({
          tenantId,
          orderId: String(orderId),
          status: orderPaymentStatus,
          transactionId: transaction.id,
          amount: transaction.amount != null ? Number(transaction.amount) : null,
        });
      }
    } catch (err) {
      logger.warn('[Billing] falha ao refletir pagamento no pedido', {
        tenantId,
        orderId: String(orderId),
        transactionId: transaction.id,
        status,
        error: err?.message,
      });
    }
  }

  if (vertical === 'beauty' && transaction?.bundle_id) {
    const Bundle = VerticalSessionBundle();
    const row = await Bundle.findOne({ where: { tenant_key: tenantId, id: String(transaction.bundle_id) } }).catch(() => null);
    if (!row) return;

    if (status === 'confirmed') {
      await row.update({ billing_status: 'active', status: 'active' });
      try {
        const { enqueueNotification } = require('./notificationService');
        await enqueueNotification({
          tenantId,
          vertical,
          channel: 'whatsapp',
          eventType: 'billing_confirmed',
          transactionId: transaction.id,
          bundleId: transaction.bundle_id,
          subjectId: transaction.subject_id || null,
          customerId: transaction.customer_id || null,
          recipient: transaction.customer_id || transaction.subject_id || null,
          metadata: {
            vertical,
            provider: transaction.provider,
            amount: transaction.amount,
          },
        }).catch(() => {});
      } catch (_) {}
    } else if (status === 'cancelled' || status === 'refunded' || status === 'chargeback') {
      await row.update({ billing_status: 'cancelled', status: 'cancelled' });
    } else if (status === 'overdue') {
      await row.update({ billing_status: 'delinquent' });
      try {
        const { enqueueNotification } = require('./notificationService');
        await enqueueNotification({
          tenantId,
          vertical,
          channel: 'whatsapp',
          eventType: 'billing_overdue',
          transactionId: transaction.id,
          bundleId: transaction.bundle_id,
          subjectId: transaction.subject_id || null,
          customerId: transaction.customer_id || null,
          recipient: transaction.customer_id || transaction.subject_id || null,
          metadata: {
            vertical,
            provider: transaction.provider,
            amount: transaction.amount,
          },
        }).catch(() => {});
      } catch (_) {}
    }
  }
}

async function processWebhook({ provider, body, headers }) {
  if (!dbAvailable()) {
    const err = new Error('billing_db_unavailable');
    err.code = 'billing_db_unavailable';
    throw err;
  }

  const normalizedProvider = paymentProvider.normalizeProvider(provider);
  const signatureOk = paymentProvider.verifyWebhookSignature({ provider: normalizedProvider, headers });
  if (!signatureOk) {
    const err = new Error('invalid_webhook_signature');
    err.code = 'invalid_webhook_signature';
    throw err;
  }

  const event = paymentProvider.normalizeWebhook({ provider: normalizedProvider, body, headers });
  if (!event.externalTransactionId && !event.externalSubscriptionId) {
    const err = new Error('webhook_missing_reference');
    err.code = 'webhook_missing_reference';
    throw err;
  }

  const Tx = BillingTransaction();
  const where = {
    provider: normalizedProvider,
  };

  if (event.externalTransactionId) where.external_transaction_id = event.externalTransactionId;
  else where.external_subscription_id = event.externalSubscriptionId;

  const row = await Tx.findOne({ where }).catch(() => null);
  if (!row) {
    logger.warn('[Billing] webhook recebido sem transacao local', {
      provider: normalizedProvider,
      externalTransactionId: event.externalTransactionId,
      externalSubscriptionId: event.externalSubscriptionId,
    });
    return { ok: true, ignored: true, reason: 'transaction_not_found' };
  }

  const current = row.toJSON ? row.toJSON() : row;
  const nextStatus = event.status || 'pending';

  const dedupeKey = `${event.eventId || event.externalTransactionId || event.externalSubscriptionId}:${nextStatus}`;
  const metadata = current.metadata && typeof current.metadata === 'object' ? current.metadata : {};
  const seen = Array.isArray(metadata.webhookHistory) ? metadata.webhookHistory : [];
  if (seen.includes(dedupeKey)) {
    return { ok: true, idempotent: true, transactionId: current.id, status: current.status };
  }

  if (!shouldApplyWebhookTransition(current.status, nextStatus)) {
    await row.update({
      metadata: {
        ...metadata,
        webhookLastEventId: event.eventId || null,
        webhookLastStatus: nextStatus,
        webhookUpdatedAt: new Date().toISOString(),
        webhookHistory: [...seen.slice(-20), dedupeKey],
        webhookIgnoredOutOfOrder: true,
      },
    });
    return {
      ok: true,
      ignored: true,
      reason: 'webhook_out_of_order_ignored',
      transactionId: current.id,
      status: current.status,
    };
  }

  const update = {
    status: nextStatus,
    paid_at: nextStatus === 'confirmed' ? new Date() : current.paid_at,
    metadata: {
      ...metadata,
      webhookLastEventId: event.eventId || null,
      webhookLastStatus: nextStatus,
      webhookUpdatedAt: new Date().toISOString(),
      webhookHistory: [...seen.slice(-20), dedupeKey],
      webhookRaw: event.raw || {},
    },
  };

  await row.update(update);
  const updated = row.toJSON ? row.toJSON() : row;

  await applyBillingRules({ tenantId: updated.tenant_key, transaction: updated, status: nextStatus });

  logger.info('[Billing] webhook processado', {
    tenantId: updated.tenant_key,
    provider: normalizedProvider,
    transactionId: updated.id,
    status: nextStatus,
  });

  return {
    ok: true,
    transactionId: updated.id,
    status: nextStatus,
    provider: normalizedProvider,
  };
}

async function reconcileTransactions({ tenantId = null, limit = 100 } = {}) {
  if (!dbAvailable()) {
    const err = new Error('billing_db_unavailable');
    err.code = 'billing_db_unavailable';
    throw err;
  }

  const Tx = BillingTransaction();
  const where = {
    status: { [Op.in]: ['pending', 'overdue'] },
    external_transaction_id: { [Op.ne]: null },
  };
  if (tenantId) where.tenant_key = String(tenantId);

  const rows = await Tx.findAll({
    where,
    order: [['updated_at', 'ASC']],
    limit: Number(limit) > 0 ? Number(limit) : 100,
  }).catch(() => []);

  const summary = {
    scanned: rows.length,
    updated: 0,
    unchanged: 0,
    failed: 0,
    tenants: new Set(),
  };

  for (const item of rows) {
    const tx = item.toJSON ? item.toJSON() : item;
    summary.tenants.add(String(tx.tenant_key || 'unknown'));
    try {
      const external = await paymentProvider.fetchTransactionStatus({
        provider: tx.provider,
        externalTransactionId: tx.external_transaction_id,
      });
      const nextStatus = String(external?.status || tx.status || 'pending').toLowerCase();

      if (!shouldApplyWebhookTransition(tx.status, nextStatus)) {
        summary.unchanged += 1;
        continue;
      }

      await item.update({
        status: nextStatus,
        paid_at: nextStatus === 'confirmed' ? new Date() : tx.paid_at,
        metadata: {
          ...(tx.metadata && typeof tx.metadata === 'object' ? tx.metadata : {}),
          reconciliation: {
            checkedAt: new Date().toISOString(),
            providerStatus: external?.providerStatus || null,
            source: 'billing_reconciliation_job',
          },
        },
      });

      const updated = item.toJSON ? item.toJSON() : item;
      await applyBillingRules({ tenantId: updated.tenant_key, transaction: updated, status: nextStatus });
      summary.updated += 1;
    } catch (err) {
      summary.failed += 1;
      logger.warn('[Billing] reconciliation failed for transaction', {
        tenantId: tx.tenant_key,
        transactionId: tx.id,
        provider: tx.provider,
        error: err?.message,
      });
    }
  }

  return {
    ok: true,
    scanned: summary.scanned,
    updated: summary.updated,
    unchanged: summary.unchanged,
    failed: summary.failed,
    tenantCount: summary.tenants.size,
  };
}

async function reconcileSubscriptions({ tenantId = null, limit = 100 } = {}) {
  if (!dbAvailable()) {
    const err = new Error('billing_db_unavailable');
    err.code = 'billing_db_unavailable';
    throw err;
  }

  const Sub = BillingSubscription();
  const where = {
    external_subscription_id: { [Op.ne]: null },
    status: { [Op.notIn]: ['cancelled', 'refunded', 'chargeback'] },
  };
  if (tenantId) where.tenant_key = String(tenantId);

  const rows = await Sub.findAll({
    where,
    order: [['updated_at', 'ASC']],
    limit: Number(limit) > 0 ? Number(limit) : 100,
  }).catch(() => []);

  const summary = {
    scanned: rows.length,
    updated: 0,
    unchanged: 0,
    failed: 0,
    tenants: new Set(),
  };

  for (const item of rows) {
    const sub = item.toJSON ? item.toJSON() : item;
    summary.tenants.add(String(sub.tenant_key || 'unknown'));
    try {
      const external = await paymentProvider.fetchSubscriptionStatus({
        provider: sub.provider,
        externalSubscriptionId: sub.external_subscription_id,
      });
      const nextStatus = String(external?.status || sub.status || 'pending').toLowerCase();

      if (!shouldApplyWebhookTransition(sub.status, nextStatus)) {
        summary.unchanged += 1;
        continue;
      }

      await item.update({
        status: nextStatus,
        cancelled_at: ['cancelled', 'refunded', 'chargeback'].includes(nextStatus) ? new Date() : sub.cancelled_at,
        metadata: {
          ...(sub.metadata && typeof sub.metadata === 'object' ? sub.metadata : {}),
          reconciliation: {
            checkedAt: new Date().toISOString(),
            providerStatus: external?.providerStatus || null,
            source: 'billing_reconciliation_job',
          },
        },
      });

      if (sub.vertical === 'fitness' && sub.membership_id) {
        if (nextStatus === 'confirmed') {
          await reactivateMembership({
            tenantId: sub.tenant_key,
            membershipId: sub.membership_id,
            reason: 'subscription_confirmed',
            actor: 'billing_reconciliation',
          }).catch(() => {});
        } else if (['cancelled', 'refunded', 'chargeback'].includes(nextStatus)) {
          const reason = nextStatus === 'refunded'
            ? 'subscription_refunded'
            : nextStatus === 'chargeback'
              ? 'subscription_chargeback'
              : 'subscription_cancelled';
          await updateBillingStatus({
            tenantId: sub.tenant_key,
            membershipId: sub.membership_id,
            toStatus: 'cancelled',
            reason,
            actor: 'billing_reconciliation',
          }).catch(() => {});
        }
      }

      summary.updated += 1;
    } catch (err) {
      summary.failed += 1;
      logger.warn('[Billing] reconciliation failed for subscription', {
        tenantId: sub.tenant_key,
        subscriptionId: sub.id,
        provider: sub.provider,
        error: err?.message,
      });
    }
  }

  return {
    ok: true,
    scanned: summary.scanned,
    updated: summary.updated,
    unchanged: summary.unchanged,
    failed: summary.failed,
    tenantCount: summary.tenants.size,
  };
}

async function findTransactionById({ tenantId, transactionId }) {
  if (!dbAvailable()) return null;
  const Tx = BillingTransaction();
  const row = await Tx.findOne({
    where: { tenant_key: String(tenantId || ''), id: String(transactionId || '') },
  }).catch(() => null);
  return row ? (row.toJSON ? row.toJSON() : row) : null;
}

module.exports = {
  createCharge,
  findTransactionById,
  listTransactions,
  processWebhook,
  reconcileTransactions,
  reconcileSubscriptions,
  shouldApplyWebhookTransition,
};
