'use strict';

const billingService = require('../../services/billingService');
const { appendEventV1 } = require('../../services/eventLedgerService');
const { requireAuth } = require('../../middleware/auth');
const { requireTenant } = require('../../composition/shared/requireTenant');
const { sendJson, badRequest, hasJsonContentType, parseJsonBody } = require('../../express/httpHelpers');
const logger = require('../../utils/logger');

function resolveTenantId(req, body) {
  return req.tenantId || req.agent?.tenantId || body?.tenantId || null;
}

async function handleBillingRoutes({ req, res, method, pathname }) {
  if (method === 'GET' && pathname === '/billing/transactions') {
    const auth = requireAuth(req);
    if (!auth.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return true;
    }
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    const urlObj = new URL(req.url || '/', 'http://localhost');
    const out = await billingService.listTransactions({
      tenantId,
      vertical: urlObj.searchParams.get('vertical') || null,
      status: urlObj.searchParams.get('status') || null,
      limit: urlObj.searchParams.get('limit'),
      offset: urlObj.searchParams.get('offset'),
    });
    sendJson(res, 200, out);
    return true;
  }

  if (method === 'POST' && pathname === '/billing/create-charge') {
    const auth = requireAuth(req);
    if (!auth.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return true;
    }
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    const body = await parseJsonBody(req);
    try {
      const vertical = String(body?.vertical || '').trim().toLowerCase();
      let out;

      if (vertical === 'fitness' && body?.membershipId) {
        const fitnessMembershipService = require('../../services/vertical/fitnessMembershipService');
        out = await fitnessMembershipService.createRecurringMembershipCharge({
          tenantId,
          membershipId: body?.membershipId,
          subjectId: body?.subjectId || null,
          customerId: body?.customerId || null,
          customerName: body?.customerName || null,
          customerEmail: body?.customerEmail || null,
          customerPhone: body?.customerPhone || null,
          customerDocument: body?.customerDocument || null,
          amount: body?.amount,
          dueDate: body?.dueDate,
          cycle: body?.cycle || 'MONTHLY',
          provider: body?.provider || null,
          idempotencyKey: body?.idempotencyKey || null,
          metadata: body?.metadata || {},
        });
      } else if (vertical === 'beauty' && body?.bundleId) {
        const beautyJourneyService = require('../../services/vertical/beautyJourneyService');
        out = await beautyJourneyService.createBeautyOneTimeCharge({
          tenantId,
          bundleId: body?.bundleId,
          subjectId: body?.subjectId || null,
          customerId: body?.customerId || null,
          customerName: body?.customerName || null,
          customerEmail: body?.customerEmail || null,
          customerPhone: body?.customerPhone || null,
          customerDocument: body?.customerDocument || null,
          amount: body?.amount,
          dueDate: body?.dueDate,
          provider: body?.provider || null,
          idempotencyKey: body?.idempotencyKey || null,
          metadata: body?.metadata || {},
        });
      } else {
        out = await billingService.createCharge({
          tenantId,
          provider: body?.provider,
          vertical: body?.vertical,
          type: body?.type,
          amount: body?.amount,
          currency: body?.currency,
          cycle: body?.cycle,
          dueDate: body?.dueDate,
          description: body?.description,
          membershipId: body?.membershipId,
          bundleId: body?.bundleId,
          subjectId: body?.subjectId,
          customerId: body?.customerId,
          customerName: body?.customerName,
          customerEmail: body?.customerEmail,
          customerPhone: body?.customerPhone,
          customerDocument: body?.customerDocument,
          idempotencyKey: body?.idempotencyKey,
          metadata: body?.metadata || {},
        });
      }
      sendJson(res, out.idempotent ? 200 : 201, out);
    } catch (err) {
      logger.warn('[BillingRoute] create-charge failed', { error: err?.message, code: err?.code });
      const status = err?.code === 'validation_error' ? 422 : 500;
      sendJson(res, status, { error: err?.code || 'billing_create_failed', message: err?.message });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/billing/webhook') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    const body = await parseJsonBody(req);
    try {
      const out = await billingService.processWebhook({
        provider: body?.provider || req.headers['x-payment-provider'] || null,
        body,
        headers: req.headers || {},
      });
      sendJson(res, 200, out);
    } catch (err) {
      const code = err?.code || 'billing_webhook_failed';
      const status = code === 'invalid_webhook_signature' ? 401 : 400;
      logger.warn('[BillingRoute] webhook failed', { error: err?.message, code });
      sendJson(res, status, { error: code, message: err?.message });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/billing/reconcile') {
    const auth = requireAuth(req);
    if (!auth.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return true;
    }
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    let limit = 100;
    if (hasJsonContentType(req)) {
      const body = await parseJsonBody(req);
      limit = Number(body?.limit) > 0 ? Number(body.limit) : 100;
    }

    try {
      const [transactions, subscriptions] = await Promise.all([
        billingService.reconcileTransactions({ tenantId, limit }),
        billingService.reconcileSubscriptions({ tenantId, limit }),
      ]);

      appendEventV1({
        tenantId,
        type: 'VerticalJourney_Custom',
        source: 'billing.reconciliation.manual',
        subject: { type: 'tenant', id: tenantId },
        actor: {
          type: req?.agent?.id || req?.agent?.username ? 'agent' : 'system',
          id: req?.agent?.id || req?.agent?.username || 'billing_api',
        },
        payload: {
          kind: 'billing_reconciliation_manual',
          limit,
          transactions,
          subscriptions,
        },
      }).catch((eventErr) => {
        logger.warn('[BillingRoute] reconcile event append failed', {
          error: eventErr?.message,
          tenantId,
        });
      });

      sendJson(res, 200, {
        ok: true,
        transactions,
        subscriptions,
      });
    } catch (err) {
      logger.warn('[BillingRoute] reconcile failed', { error: err?.message, code: err?.code, tenantId });
      sendJson(res, 500, { error: err?.code || 'billing_reconciliation_failed', message: err?.message });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleBillingRoutes,
};
