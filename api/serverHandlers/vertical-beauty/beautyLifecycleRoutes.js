const { listJourneyEvents, getSubjectTimeline, emitJourneyEvent } = require('../../services/vertical/customerJourneyEngine');
const beautyJourneyService = require('../../services/vertical/beautyJourneyService');
const { createSessionBundle } = require('../../services/vertical/billingOrchestrationService');
const { ensureAuth, tenantId, VERTICAL } = require('./beautyRouteHelpers');

async function handleBeautyLifecycleRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { sendJson, badRequest, hasJsonContentType, parseJsonBody, requireAuth, requireTenant } = deps;

  // GET /api/beauty/journey/:subjectId
  if (method === 'GET' && pathname.match(/^\/api\/beauty\/journey\/([^/]+)$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectId = decodeURIComponent(pathname.split('/').pop());
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const customerId = urlObj.searchParams.get('customerId') || null;
    const limit = Number(urlObj.searchParams.get('limit')) || 100;
    const result = await getSubjectTimeline({ tenantId: tenantId(req), subjectId, customerId, limit });
    sendJson(res, 200, result);
    return true;
  }

  // POST /api/beauty/journey/event
  if (method === 'POST' && pathname === '/api/beauty/journey/event') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const body = await parseJsonBody(req);
    if (!body?.eventType) { badRequest(res, 'eventType required'); return true; }

    const evt = await emitJourneyEvent({
      tenantId: tenantId(req),
      vertical: VERTICAL,
      eventType: body.eventType,
      subjectId: body.subjectId || null,
      customerId: body.customerId || null,
      membershipId: body.membershipId || null,
      scheduleId: body.scheduleId || null,
      channel: body.channel || 'internal',
      triggeredBy: body.triggeredBy || 'manual',
      correlationId: body.correlationId || null,
      idempotencyKey: body.idempotencyKey || null,
      payload: body.payload || {},
      metadata: body.metadata || {},
    });
    sendJson(res, 201, { item: evt });
    return true;
  }

  // GET /api/beauty/reminders/:subjectId
  if (method === 'GET' && pathname.match(/^\/api\/beauty\/reminders\/([^/]+)$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectId = decodeURIComponent(pathname.split('/').pop());
    const result = await listJourneyEvents({
      tenantId: tenantId(req),
      vertical: VERTICAL,
      subjectId,
    });
    const reminders = result.items.filter((e) => ['confirmation_sent', 'reminder_24h', 'reminder_1h'].includes(e.event_type));
    sendJson(res, 200, { items: reminders, total: reminders.length });
    return true;
  }

  // GET /api/beauty/bundle/:subjectId
  if (method === 'GET' && pathname.match(/^\/api\/beauty\/bundle\/([^/]+)$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectId = decodeURIComponent(pathname.split('/').pop());
    const balance = await beautyJourneyService.getCustomerSessionBalance({ tenantId: tenantId(req), subjectId });
    sendJson(res, 200, balance);
    return true;
  }

  // POST /api/beauty/bundle
  if (method === 'POST' && pathname === '/api/beauty/bundle') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const body = await parseJsonBody(req);
    if (!body?.subjectId) { badRequest(res, 'subjectId required'); return true; }
    const bundle = await createSessionBundle({
      tenantId: tenantId(req),
      vertical: VERTICAL,
      subjectId: body.subjectId,
      customerId: body.customerId || null,
      membershipId: body.membershipId || null,
      bundleType: body.bundleType || 'package',
      planName: body.planName || null,
      totalSessions: body.totalSessions || null,
      startAt: body.startAt || null,
      endAt: body.endAt || null,
      dueDate: body.dueDate || null,
      renewalAt: body.renewalAt || null,
      metadata: body.metadata || {},
    });
    sendJson(res, 201, { item: bundle });
    return true;
  }

  // POST /api/beauty/service-completed
  if (method === 'POST' && pathname === '/api/beauty/service-completed') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const body = await parseJsonBody(req);
    if (!body?.subjectId) { badRequest(res, 'subjectId required'); return true; }
    const evt = await beautyJourneyService.recordServiceCompleted({
      tenantId: tenantId(req),
      subjectId: body.subjectId,
      customerId: body.customerId || null,
      scheduleId: body.scheduleId || null,
      bundleId: body.bundleId || null,
      correlationId: body.correlationId || null,
      loyaltyPoints: body.loyaltyPoints !== undefined ? Number(body.loyaltyPoints) : 1,
      metadata: body.metadata || {},
    });
    sendJson(res, 201, { item: evt });
    return true;
  }

  // POST /api/beauty/no-show
  if (method === 'POST' && pathname === '/api/beauty/no-show') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const body = await parseJsonBody(req);
    const evt = await beautyJourneyService.detectNoShow({
      tenantId: tenantId(req),
      subjectId: body.subjectId || null,
      customerId: body.customerId || null,
      scheduleId: body.scheduleId || null,
      correlationId: body.correlationId || null,
      metadata: body.metadata || {},
    });
    sendJson(res, 201, { item: evt });
    return true;
  }

  // POST /api/beauty/follow-up
  if (method === 'POST' && pathname === '/api/beauty/follow-up') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const body = await parseJsonBody(req);
    if (!body?.subjectId && !body?.customerId) {
      badRequest(res, 'subjectId or customerId required');
      return true;
    }
    const evt = await beautyJourneyService.sendFollowUp({
      tenantId: tenantId(req),
      subjectId: body.subjectId || null,
      customerId: body.customerId || null,
      scheduleId: body.scheduleId || null,
      channel: body.channel || 'internal',
      correlationId: body.correlationId || null,
      metadata: body.metadata || { note: body.note || null, triggeredBy: 'manual' },
    });
    sendJson(res, 201, { item: evt });
    return true;
  }

  // POST /api/beauty/confirmation
  if (method === 'POST' && pathname === '/api/beauty/confirmation') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const body = await parseJsonBody(req);
    if (!body?.subjectId) { badRequest(res, 'subjectId required'); return true; }
    const evt = await beautyJourneyService.sendConfirmation({
      tenantId: tenantId(req),
      subjectId: body.subjectId,
      customerId: body.customerId || null,
      scheduleId: body.scheduleId || null,
      channel: body.channel || 'internal',
      correlationId: body.correlationId || null,
      metadata: body.metadata || {},
    });
    sendJson(res, 201, { item: evt });
    return true;
  }

  // POST /api/beauty/reactivation
  if (method === 'POST' && pathname === '/api/beauty/reactivation') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return true; }
    const body = await parseJsonBody(req);
    if (!body?.subjectId) { badRequest(res, 'subjectId required'); return true; }
    const evt = await beautyJourneyService.sendReactivation({
      tenantId: tenantId(req),
      subjectId: body.subjectId,
      customerId: body.customerId || null,
      channel: body.channel || 'internal',
      correlationId: body.correlationId || null,
      metadata: body.metadata || {},
    });
    sendJson(res, 201, { item: evt });
    return true;
  }

  return false;
}

module.exports = { handleBeautyLifecycleRoutes };
