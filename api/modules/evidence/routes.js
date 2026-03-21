'use strict';

const express = require('express');
const evidenceService = require('../../services/evidenceService');

function toList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function boolValue(value, defaultValue = false) {
  if (value == null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function numberValue(value, fallback, { min = 1, max = 100 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function requireAuthenticatedTenant(req, res, deps) {
  const authResult = deps.requireAuth(req);
  if (!authResult.valid) {
    deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return null;
  }
  const tenantId = deps.requireTenant(req, res);
  if (!tenantId) return null;
  return tenantId;
}

function buildSearchArgs(tenantId, payload = {}) {
  return {
    tenantId,
    context: payload.context || {},
    filters: {
      category: toList(payload.filters?.category || payload.category),
      type: toList(payload.filters?.type || payload.type),
      theme: toList(payload.filters?.theme || payload.theme),
    },
    query: payload.query || payload.q || '',
    options: {
      limit: numberValue(payload.options?.limit || payload.limit, 5, { min: 1, max: 20 }),
      includeWeak: boolValue(payload.options?.includeWeak ?? payload.includeWeak, false),
    },
  };
}

function buildContextFromRequest(payload = {}) {
  return {
    ticketId: payload.ticketId || null,
    conversationId: payload.conversationId || null,
    phone: payload.phone || null,
    entityType: payload.entityType || null,
    entityId: payload.entityId || null,
    membershipId: payload.membershipId || null,
    subjectId: payload.subjectId || null,
    customerId: payload.customerId || null,
    contactId: payload.contactId || null,
  };
}

function createEvidenceRoutes({ buildDeps }) {
  const router = express.Router();

  router.get('/api/evidence/entity/history', async (req, res, next) => {
    const deps = buildDeps(req, res);
    const tenantId = requireAuthenticatedTenant(req, res, deps);
    if (!tenantId) return;

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const context = buildContextFromRequest({
        ticketId: urlObj.searchParams.get('ticketId'),
        conversationId: urlObj.searchParams.get('conversationId'),
        phone: urlObj.searchParams.get('phone'),
        entityType: urlObj.searchParams.get('entityType'),
        entityId: urlObj.searchParams.get('entityId'),
        membershipId: urlObj.searchParams.get('membershipId'),
        subjectId: urlObj.searchParams.get('subjectId'),
        customerId: urlObj.searchParams.get('customerId'),
        contactId: urlObj.searchParams.get('contactId'),
      });
      const result = await evidenceService.getEntityHistory({
        tenantId,
        context,
        limit: numberValue(urlObj.searchParams.get('limit'), 5, { min: 1, max: 20 }),
        includeWeak: boolValue(urlObj.searchParams.get('includeWeak'), false),
      });
      deps.sendJson(res, 200, result);
    } catch (err) {
      next(err);
    }
  });

  router.get('/api/evidence/entity/search', async (req, res, next) => {
    const deps = buildDeps(req, res);
    const tenantId = requireAuthenticatedTenant(req, res, deps);
    if (!tenantId) return;

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const result = await evidenceService.searchEvidence({
        tenantId,
        ...buildSearchArgs(tenantId, {
          context: buildContextFromRequest({
            ticketId: urlObj.searchParams.get('ticketId'),
            conversationId: urlObj.searchParams.get('conversationId'),
            phone: urlObj.searchParams.get('phone'),
            entityType: urlObj.searchParams.get('entityType'),
            entityId: urlObj.searchParams.get('entityId'),
            membershipId: urlObj.searchParams.get('membershipId'),
            subjectId: urlObj.searchParams.get('subjectId'),
            customerId: urlObj.searchParams.get('customerId'),
            contactId: urlObj.searchParams.get('contactId'),
          }),
          category: urlObj.searchParams.get('category'),
          type: urlObj.searchParams.get('type'),
          theme: urlObj.searchParams.get('theme'),
          q: urlObj.searchParams.get('q'),
          limit: urlObj.searchParams.get('limit'),
          includeWeak: urlObj.searchParams.get('includeWeak'),
        }),
      });
      deps.sendJson(res, 200, result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/api/evidence/search', async (req, res, next) => {
    const deps = buildDeps(req, res);
    const tenantId = requireAuthenticatedTenant(req, res, deps);
    if (!tenantId) return;

    try {
      const body = await deps.parseJsonBody(req);
      const result = await evidenceService.searchEvidence({
        tenantId,
        ...buildSearchArgs(tenantId, body),
      });
      deps.sendJson(res, 200, result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/api/evidence/backfill', async (req, res, next) => {
    const deps = buildDeps(req, res);
    const tenantId = requireAuthenticatedTenant(req, res, deps);
    if (!tenantId) return;

    try {
      const body = await deps.parseJsonBody(req);
      const scope = String(body.scope || 'entity');
      let result = null;
      if (scope === 'tenant') {
        result = await evidenceService.backfillEvidenceForTenant({
          tenantId,
          dryRun: boolValue(body.dryRun, false),
          includeWeak: boolValue(body.includeWeak, false),
          limit: numberValue(body.limit, 100, { min: 1, max: 500 }),
        });
      } else {
        result = await evidenceService.backfillEvidenceForEntity({
          tenantId,
          dryRun: boolValue(body.dryRun, false),
          includeWeak: boolValue(body.includeWeak, false),
          ...buildContextFromRequest(body),
          context: buildContextFromRequest(body),
        });
      }
      deps.sendJson(res, 200, result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = {
  createEvidenceRoutes,
};
