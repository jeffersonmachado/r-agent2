'use strict';

const fitnessMembershipService = require('../../services/vertical/fitnessMembershipService');

async function handleFitnessMembershipRoutes(ctx) {
  const { req, res, method, pathname, deps, ensureAuth, tenantId } = ctx;
  const {
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    requireAuth,
    requireTenant,
  } = deps;

  // GET /api/fitness/membership/:membershipId
  if (method === 'GET' && pathname.match(/^\/api\/fitness\/membership\/([^/]+)$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const membershipId = decodeURIComponent(pathname.split('/').pop());
    const detail = await fitnessMembershipService.getMembershipDetail({ tenantId: tenantId(req), membershipId });
    if (!detail) {
      sendJson(res, 404, { error: 'membership_not_found' });
      return true;
    }
    sendJson(res, 200, { item: detail });
    return true;
  }

  // PATCH /api/fitness/membership/:membershipId/billing
  if (method === 'PATCH' && pathname.match(/^\/api\/fitness\/membership\/([^/]+)\/billing$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    const membershipId = decodeURIComponent(pathname.split('/')[4]);
    const body = await parseJsonBody(req);
    if (!body?.toStatus) {
      badRequest(res, 'toStatus required');
      return true;
    }

    try {
      const updated = await fitnessMembershipService.reactivateMembership({
        tenantId: tenantId(req),
        membershipId,
        reason: body.reason || '',
        actor: req.agent?.username || 'operator',
      });
      const actual = body.toStatus === 'active'
        ? updated
        : await (async () => {
          const { updateBillingStatus } = require('../../services/vertical/billingOrchestrationService');
          return updateBillingStatus({
            tenantId: tenantId(req),
            membershipId,
            toStatus: body.toStatus,
            reason: body.reason || '',
            actor: req.agent?.username || 'operator',
          });
        })();
      sendJson(res, 200, { item: actual });
    } catch (err) {
      if (err.code === 'membership_not_found') {
        sendJson(res, 404, { error: err.code });
        return true;
      }
      if (err.code === 'invalid_billing_transition') {
        sendJson(res, 422, { error: err.code, message: err.message });
        return true;
      }
      throw err;
    }

    return true;
  }

  // PATCH /api/fitness/membership/:membershipId/details
  if (method === 'PATCH' && pathname.match(/^\/api\/fitness\/membership\/([^/]+)\/details$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    const membershipId = decodeURIComponent(pathname.split('/')[4]);
    const body = await parseJsonBody(req);
    const updated = await fitnessMembershipService.updateMembershipDetails({ tenantId: tenantId(req), membershipId, fields: body });
    if (!updated) {
      sendJson(res, 404, { error: 'membership_not_found' });
      return true;
    }

    sendJson(res, 200, { item: updated });
    return true;
  }

  // POST /api/fitness/membership/:membershipId/grace-period
  if (method === 'POST' && pathname.match(/^\/api\/fitness\/membership\/([^/]+)\/grace-period$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    const membershipId = decodeURIComponent(pathname.split('/')[4]);
    const body = await parseJsonBody(req);
    const updated = await fitnessMembershipService.startGracePeriod({
      tenantId: tenantId(req),
      membershipId,
      graceDays: body?.graceDays || 7,
      actor: req.agent?.username || 'operator',
    });

    sendJson(res, 200, { item: updated });
    return true;
  }

  // POST /api/fitness/membership/:membershipId/renew
  if (method === 'POST' && pathname.match(/^\/api\/fitness\/membership\/([^/]+)\/renew$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    const membershipId = decodeURIComponent(pathname.split('/')[4]);
    const body = await parseJsonBody(req);
    if (!body?.renewalAt) {
      badRequest(res, 'renewalAt required');
      return true;
    }

    const updated = await fitnessMembershipService.processMembershipRenewal({
      tenantId: tenantId(req),
      membershipId,
      renewalAt: body.renewalAt,
      actor: req.agent?.username || 'operator',
    });

    sendJson(res, 200, { item: updated });
    return true;
  }

  // POST /api/fitness/membership/:membershipId/charge
  if (method === 'POST' && pathname.match(/^\/api\/fitness\/membership\/([^/]+)\/charge$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    const membershipId = decodeURIComponent(pathname.split('/')[4]);
    const body = await parseJsonBody(req);
    if (!body?.amount) {
      badRequest(res, 'amount required');
      return true;
    }

    const detail = await fitnessMembershipService.getMembershipDetail({ tenantId: tenantId(req), membershipId });
    if (!detail) {
      sendJson(res, 404, { error: 'membership_not_found' });
      return true;
    }

    const out = await fitnessMembershipService.createRecurringMembershipCharge({
      tenantId: tenantId(req),
      membershipId,
      subjectId: detail.subject_id || null,
      customerId: detail.customer_id || null,
      customerName: body?.customerName || null,
      customerEmail: body?.customerEmail || null,
      customerPhone: body?.customerPhone || null,
      customerDocument: body?.customerDocument || null,
      amount: body.amount,
      dueDate: body?.dueDate || null,
      cycle: body?.cycle || 'MONTHLY',
      provider: body?.provider || null,
      idempotencyKey: body?.idempotencyKey || null,
      metadata: body?.metadata || {},
    });

    sendJson(res, out.idempotent ? 200 : 201, out);
    return true;
  }

  // GET /api/fitness/membership/:membershipId/billing-history
  if (method === 'GET' && pathname.match(/^\/api\/fitness\/membership\/([^/]+)\/billing-history$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const membershipId = decodeURIComponent(pathname.split('/')[4]);
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const limit = Number(urlObj.searchParams.get('limit')) || 50;
    const result = await fitnessMembershipService.getMembershipBillingHistory({ tenantId: tenantId(req), membershipId, limit });
    sendJson(res, 200, result);
    return true;
  }

  return false;
}

module.exports = {
  handleFitnessMembershipRoutes,
};
