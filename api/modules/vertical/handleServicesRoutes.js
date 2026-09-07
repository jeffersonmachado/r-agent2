'use strict';

/**
 * Services Vertical Routes
 *
 * All routes are authenticated (requireAuth) and tenant-scoped.
 * Follows the exact same pattern as handleClinicRoutes.js.
 *
 * Endpoints:
 * GET  /api/services/dashboard                   – vertical dashboard (pipeline de orçamentos + KPIs)
 * GET  /api/services/metrics                     – vertical KPIs (customer journey metrics)
 * GET  /api/services/subject/:subjectId/timeline – operational timeline
 * POST /api/services/quote                       – emit quote_sent (orçamento)
 * POST /api/services/quote/:quoteId/approve      – record approval (+ cobrança)
 * POST /api/services/quote/:quoteId/decline      – record decline
 * POST /api/services/journey/event               – emit journey event
 */

const { computeVerticalMetrics } = require('../../services/vertical/verticalMetricsEngine');
const { getSubjectTimeline, emitJourneyEvent, listJourneyEvents } = require('../../services/vertical/customerJourneyEngine');
const servicesJourneyService = require('../../services/vertical/servicesJourneyService');
const { getSequelize } = require('../../db/sequelize');
const { BillingTransaction } = require('../../db/models');
const { Op } = require('sequelize');

const VERTICAL = 'services';

function dbAvailable() {
  return !!getSequelize();
}

function ensureAuth(req, res, deps) {
  const { requireAuth, sendJson, requireTenant } = deps;
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }
  const tenantId = requireTenant(req, res);
  if (!tenantId) return false;
  return true;
}

function tenantId(req) {
  return req.tenantId || req.agent?.tenantId || null;
}

async function readBody(req, res, deps) {
  const { badRequest, hasJsonContentType, parseJsonBody } = deps;
  if (!hasJsonContentType(req)) { badRequest(res, 'Content-Type deve ser application/json'); return null; }
  return parseJsonBody(req);
}

/**
 * Quote pipeline summary from journey events: for each quote_sent in the
 * window, resolves its current state (approved/declined/expired/pending).
 */
async function computeQuotePipeline({ tenantId, windowDays }) {
  const since = new Date(Date.now() - windowDays * 86400000);
  const { items } = await listJourneyEvents({ tenantId, vertical: VERTICAL, limit: 500 });
  const quotes = new Map();

  for (const raw of items) {
    const evt = raw.toJSON ? raw.toJSON() : raw;
    const quoteId = evt.payload?.quoteId;
    if (!quoteId) continue;
    if (new Date(evt.occurred_at) < since) continue;

    if (!quotes.has(quoteId)) {
      quotes.set(quoteId, { quoteId, state: 'pending', amount: null, sentAt: null, decidedAt: null });
    }
    const q = quotes.get(quoteId);
    if (evt.event_type === 'quote_sent') {
      q.sentAt = q.sentAt || evt.occurred_at;
      q.amount = q.amount ?? evt.payload?.amount ?? null;
    } else if (evt.event_type === 'quote_approved') {
      q.state = 'approved';
      q.decidedAt = q.decidedAt || evt.occurred_at;
    } else if (evt.event_type === 'quote_declined') {
      q.state = 'declined';
      q.decidedAt = q.decidedAt || evt.occurred_at;
    } else if (evt.event_type === 'quote_expired' && q.state === 'pending') {
      q.state = 'expired';
      q.decidedAt = q.decidedAt || evt.occurred_at;
    }
  }

  const all = Array.from(quotes.values());
  const approved = all.filter((q) => q.state === 'approved');
  const decisionTimes = all
    .filter((q) => q.decidedAt && q.sentAt)
    .map((q) => (new Date(q.decidedAt).getTime() - new Date(q.sentAt).getTime()) / 86400000);

  return {
    total: all.length,
    pending: all.filter((q) => q.state === 'pending').length,
    approved: approved.length,
    declined: all.filter((q) => q.state === 'declined').length,
    expired: all.filter((q) => q.state === 'expired').length,
    approvalRate: all.length > 0 ? Number((approved.length / all.length).toFixed(3)) : 0,
    approvedAmount: Number(approved.reduce((acc, q) => acc + Number(q.amount || 0), 0).toFixed(2)),
    avgDecisionDays: decisionTimes.length > 0
      ? Number((decisionTimes.reduce((a, b) => a + b, 0) / decisionTimes.length).toFixed(1))
      : null,
  };
}

async function handleServicesRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { sendJson, badRequest, requireAuth, requireTenant } = deps;

  if (!pathname.startsWith('/api/services')) return false;

  // ── GET /api/services/metrics ────────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/services/metrics') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const windowDays = Number(urlObj.searchParams.get('windowDays')) || 30;
    const metrics = await computeVerticalMetrics({ tenantId: tenantId(req), vertical: VERTICAL, windowDays });
    sendJson(res, 200, metrics);
    return true;
  }

  // ── GET /api/services/dashboard ──────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/services/dashboard') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const windowDays = Number(urlObj.searchParams.get('windowDays')) || 30;
    const since = new Date(Date.now() - windowDays * 86400000);
    const tid = tenantId(req);

    const [pipeline, journeyMetrics, revenueRows] = await Promise.all([
      dbAvailable() ? computeQuotePipeline({ tenantId: tid, windowDays }).catch(() => null) : null,
      computeVerticalMetrics({ tenantId: tid, vertical: VERTICAL, windowDays }).catch(() => null),
      dbAvailable()
        ? BillingTransaction().findAll({
          where: {
            tenant_key: tid,
            vertical: VERTICAL,
            status: 'confirmed',
            created_at: { [Op.gte]: since },
          },
          attributes: ['amount'],
          limit: 5000,
        }).catch(() => [])
        : [],
    ]);

    const revenue = (revenueRows || []).reduce((acc, row) => {
      const d = row.toJSON ? row.toJSON() : row;
      return acc + Number(d.amount || 0);
    }, 0);

    sendJson(res, 200, {
      vertical: VERTICAL,
      windowDays,
      metrics: journeyMetrics,
      quotePipeline: pipeline,
      kpis: {
        quotesPending: Number(pipeline?.pending || 0),
        quotesApproved: Number(pipeline?.approved || 0),
        approvalRate: Number(pipeline?.approvalRate || 0),
        avgDecisionDays: pipeline?.avgDecisionDays ?? null,
        approvedAmount: Number(pipeline?.approvedAmount || 0),
        revenue: Number(revenue.toFixed(2)),
      },
    });
    return true;
  }

  // ── GET /api/services/subject/:subjectId/timeline ────────────────────────
  if (method === 'GET' && pathname.match(/^\/api\/services\/subject\/([^/]+)\/timeline$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectId = decodeURIComponent(pathname.split('/')[4]);
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const limit = Number(urlObj.searchParams.get('limit')) || 100;
    const result = await getSubjectTimeline({ tenantId: tenantId(req), subjectId, limit });
    sendJson(res, 200, result);
    return true;
  }

  // ── POST /api/services/quote ─────────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/services/quote') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const body = await readBody(req, res, deps);
    if (!body) return true;
    if (!body.quoteId) { badRequest(res, 'quoteId required'); return true; }
    const evt = await servicesJourneyService.sendQuote({
      tenantId: tenantId(req),
      subjectId: body.subjectId || null,
      customerId: body.customerId || null,
      quoteId: body.quoteId,
      amount: body.amount != null ? Number(body.amount) : null,
      items: Array.isArray(body.items) ? body.items : [],
      validDays: Number(body.validDays) || 15,
      channel: body.channel || 'internal',
      correlationId: body.correlationId || null,
      metadata: body.metadata || {},
    });
    sendJson(res, 201, { item: evt });
    return true;
  }

  // ── POST /api/services/quote/:quoteId/approve ────────────────────────────
  if (method === 'POST' && pathname.match(/^\/api\/services\/quote\/([^/]+)\/approve$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const body = await readBody(req, res, deps);
    if (!body) return true;
    const quoteId = decodeURIComponent(pathname.split('/')[4]);
    const evt = await servicesJourneyService.recordQuoteApproved({
      tenantId: tenantId(req),
      subjectId: body.subjectId || null,
      customerId: body.customerId || null,
      quoteId,
      amount: body.amount != null ? Number(body.amount) : null,
      dueDate: body.dueDate || null,
      correlationId: body.correlationId || null,
      metadata: body.metadata || {},
    });
    sendJson(res, 200, { item: evt });
    return true;
  }

  // ── POST /api/services/quote/:quoteId/decline ────────────────────────────
  if (method === 'POST' && pathname.match(/^\/api\/services\/quote\/([^/]+)\/decline$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const body = await readBody(req, res, deps);
    if (!body) return true;
    const quoteId = decodeURIComponent(pathname.split('/')[4]);
    const evt = await servicesJourneyService.recordQuoteDeclined({
      tenantId: tenantId(req),
      subjectId: body.subjectId || null,
      customerId: body.customerId || null,
      quoteId,
      reason: body.reason || null,
      correlationId: body.correlationId || null,
      metadata: body.metadata || {},
    });
    sendJson(res, 200, { item: evt });
    return true;
  }

  // ── POST /api/services/journey/event ─────────────────────────────────────
  if (method === 'POST' && pathname === '/api/services/journey/event') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const body = await readBody(req, res, deps);
    if (!body) return true;
    if (!body.eventType) { badRequest(res, 'eventType required'); return true; }
    const evt = await emitJourneyEvent({
      tenantId: tenantId(req),
      vertical: VERTICAL,
      eventType: body.eventType,
      subjectId: body.subjectId || null,
      customerId: body.customerId || null,
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

  return false;
}

module.exports = { handleServicesRoutes, computeQuotePipeline };
