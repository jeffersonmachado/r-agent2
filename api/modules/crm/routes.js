'use strict';

/**
 * Módulo CRM — rotas CRUD com store in-memory por tenant.
 *
 * Entidades:
 *  - accounts      : empresas e organizações
 *  - contacts      : pessoas (proxy sobre MarketingLead quando disponível)
 *  - leads         : prospecção e qualificação
 *  - pipelines     : funis de vendas (com stages)
 *  - opportunities : negociações vinculadas a pipelines
 *  - activities    : log de interações (calls, reuniões, follow-ups)
 *  - timeline      : leitura agregada de atividades por sujeito
 */

const express = require('express');
const crypto = require('crypto');
const { emitEvent } = require('../../services/websocketService');
const logger = require('../../utils/logger');

// ---------------------------------------------------------------------------
// Realtime por PUSH (regra do projeto: PROIBIDO setInterval para sincronizar
// estado). Toda mutação relevante de CRM emite `crm.metrics.updated`; as telas
// (painel CRM e afins) apenas escutam o evento via WebSocket e refazem a leitura.
// Best-effort: falha no emit JAMAIS bloqueia a escrita.
// ---------------------------------------------------------------------------
function emitCrmUpdated(tenantId, { entity, action, entityId }) {
  try {
    emitEvent(
      'crm.metrics.updated',
      { tenantId, entity, action, entityId: entityId || null },
      { tenantId },
    );
  } catch (err) {
    logger.warn('[CRM] Falha ao emitir crm.metrics.updated', { entity, action });
  }
}

// ---------------------------------------------------------------------------
// In-memory store helpers
// ---------------------------------------------------------------------------

const stores = {};

function getTenantStore(tenantId, entity) {
  if (!stores[tenantId]) stores[tenantId] = {};
  if (!stores[tenantId][entity]) stores[tenantId][entity] = new Map();
  return stores[tenantId][entity];
}

function newId() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function paginateList(store, limit = 20, offset = 0) {
  const items = Array.from(store.values()).sort((a, b) =>
    (b.createdAt || '').localeCompare(a.createdAt || ''),
  );
  const total = items.length;
  return { items: items.slice(offset, offset + limit), total, limit, offset };
}

function parseIntOrDefault(value, fallback) {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// ---------------------------------------------------------------------------
// Auth / permission helpers
// ---------------------------------------------------------------------------

function resolveAuth(ctx, req, res) {
  const authResult = ctx.requireAuth(req);
  if (!authResult.valid) {
    ctx.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return null;
  }
  const tenantId = ctx.requireTenant(req, res);
  if (!tenantId) return null;
  return tenantId;
}

function checkPermission(ctx, req, res, action) {
  const result = ctx.requirePermission(req, 'crm', action);
  if (!result.allowed) {
    ctx.sendJson(res, 403, { error: 'forbidden', message: result.error });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Shared contacts via MarketingLead (if available)
// ---------------------------------------------------------------------------

async function listContactsFromDb(tenantId, query) {
  try {
    const getModel = require('../../db/models/MarketingLead');
    const Model = typeof getModel === 'function' ? getModel() : getModel;
    if (!Model || !Model.findAll) return null;

    const limit = parseIntOrDefault(query.limit, 20);
    const offset = parseIntOrDefault(query.offset, 0);
    const q = String(query.q || '').trim().toLowerCase();

    const { Op } = require('sequelize');
    const where = { tenant_key: String(tenantId) };
    if (q) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${q}%` } },
        { email: { [Op.iLike]: `%${q}%` } },
        { phone: { [Op.iLike]: `%${q}%` } },
      ];
    }

    const rows = await Model.findAll({
      where,
      order: [['updated_at', 'DESC']],
      limit,
      offset,
    });

    const items = (rows || []).map((row) => {
      const r = row.toJSON ? row.toJSON() : row;
      return {
        id: r.id,
        name: r.name || null,
        email: r.email || null,
        phone: r.phone || null,
        stage: r.stage || null,
        score: r.score ?? 0,
        externalId: r.external_id || null,
        attributes: r.attributes || {},
        createdAt: r.created_at || null,
        updatedAt: r.updated_at || null,
      };
    });

    return { items, total: items.length, limit, offset };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

function createCrmRoutes({ buildDeps }) {
  const router = express.Router();

  // ── ACCOUNTS ────────────────────────────────────────────────────────────

  router.get('/api/crm/accounts', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'read')) return;

    const limit = parseIntOrDefault(req.query.limit, 20);
    const offset = parseIntOrDefault(req.query.offset, 0);
    const store = getTenantStore(tenantId, 'accounts');
    ctx.sendJson(res, 200, paginateList(store, limit, offset));
  });

  router.get('/api/crm/accounts/:id', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'read')) return;

    const store = getTenantStore(tenantId, 'accounts');
    const item = store.get(req.params.id);
    if (!item) {
      ctx.sendJson(res, 404, { error: 'not_found', message: 'Conta não encontrada' });
      return;
    }
    ctx.sendJson(res, 200, item);
  });

  router.post('/api/crm/accounts', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'create')) return;

    let body;
    try { body = await ctx.parseJsonBody(req); } catch { ctx.badRequest(res, 'JSON inválido'); return; }

    const id = body.id || newId();
    const ts = now();
    const item = {
      id,
      tenantId,
      name: String(body.name || '').trim() || 'Sem nome',
      industry: body.industry || null,
      website: body.website || null,
      phone: body.phone || null,
      email: body.email || null,
      address: body.address || null,
      description: body.description || null,
      tags: Array.isArray(body.tags) ? body.tags : [],
      ownerId: body.ownerId || null,
      createdAt: body.createdAt || ts,
      updatedAt: ts,
    };

    getTenantStore(tenantId, 'accounts').set(id, item);
    emitCrmUpdated(tenantId, { entity: 'accounts', action: 'created', entityId: id });
    ctx.sendJson(res, 200, item);
  });

  router.delete('/api/crm/accounts/:id', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'delete')) return;

    const store = getTenantStore(tenantId, 'accounts');
    if (!store.has(req.params.id)) {
      ctx.sendJson(res, 404, { error: 'not_found', message: 'Conta não encontrada' });
      return;
    }
    store.delete(req.params.id);
    emitCrmUpdated(tenantId, { entity: 'accounts', action: 'deleted', entityId: req.params.id });
    ctx.sendJson(res, 200, { ok: true });
  });

  // ── CONTACTS ────────────────────────────────────────────────────────────

  router.get('/api/crm/contacts', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'read')) return;

    // Tenta DB (MarketingLead) primeiro, senão usa store in-memory
    const dbResult = await listContactsFromDb(tenantId, req.query);
    if (dbResult) {
      ctx.sendJson(res, 200, dbResult);
      return;
    }

    const limit = parseIntOrDefault(req.query.limit, 20);
    const offset = parseIntOrDefault(req.query.offset, 0);
    const store = getTenantStore(tenantId, 'contacts');
    ctx.sendJson(res, 200, paginateList(store, limit, offset));
  });

  router.get('/api/crm/contacts/:id', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'read')) return;

    const store = getTenantStore(tenantId, 'contacts');
    const item = store.get(req.params.id);
    if (!item) {
      ctx.sendJson(res, 404, { error: 'not_found', message: 'Contato não encontrado' });
      return;
    }
    ctx.sendJson(res, 200, item);
  });

  router.post('/api/crm/contacts', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'create')) return;

    let body;
    try { body = await ctx.parseJsonBody(req); } catch { ctx.badRequest(res, 'JSON inválido'); return; }

    const id = body.id || newId();
    const ts = now();
    const item = {
      id,
      tenantId,
      name: String(body.name || '').trim() || 'Sem nome',
      email: body.email || null,
      phone: body.phone || null,
      accountId: body.accountId || null,
      role: body.role || null,
      stage: body.stage || null,
      score: body.score ?? 0,
      attributes: body.attributes || {},
      createdAt: body.createdAt || ts,
      updatedAt: ts,
    };

    getTenantStore(tenantId, 'contacts').set(id, item);
    emitCrmUpdated(tenantId, { entity: 'contacts', action: 'created', entityId: id });
    ctx.sendJson(res, 200, item);
  });

  router.delete('/api/crm/contacts/:id', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'delete')) return;

    const store = getTenantStore(tenantId, 'contacts');
    if (!store.has(req.params.id)) {
      ctx.sendJson(res, 404, { error: 'not_found', message: 'Contato não encontrado' });
      return;
    }
    store.delete(req.params.id);
    emitCrmUpdated(tenantId, { entity: 'contacts', action: 'deleted', entityId: req.params.id });
    ctx.sendJson(res, 200, { ok: true });
  });

  // ── LEADS ───────────────────────────────────────────────────────────────

  router.get('/api/crm/leads', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'read')) return;

    const limit = parseIntOrDefault(req.query.limit, 20);
    const offset = parseIntOrDefault(req.query.offset, 0);
    const store = getTenantStore(tenantId, 'leads');
    ctx.sendJson(res, 200, paginateList(store, limit, offset));
  });

  router.get('/api/crm/leads/:id', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'read')) return;

    const store = getTenantStore(tenantId, 'leads');
    const item = store.get(req.params.id);
    if (!item) {
      ctx.sendJson(res, 404, { error: 'not_found', message: 'Lead não encontrado' });
      return;
    }
    ctx.sendJson(res, 200, item);
  });

  router.post('/api/crm/leads', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'create')) return;

    let body;
    try { body = await ctx.parseJsonBody(req); } catch { ctx.badRequest(res, 'JSON inválido'); return; }

    const id = body.id || newId();
    const ts = now();
    const item = {
      id,
      tenantId,
      name: String(body.name || '').trim() || 'Sem nome',
      email: body.email || null,
      phone: body.phone || null,
      source: body.source || null,
      stage: body.stage || 'novo',
      score: body.score ?? 0,
      ownerId: body.ownerId || null,
      tags: Array.isArray(body.tags) ? body.tags : [],
      notes: body.notes || null,
      attributes: body.attributes || {},
      createdAt: body.createdAt || ts,
      updatedAt: ts,
    };

    getTenantStore(tenantId, 'leads').set(id, item);
    emitCrmUpdated(tenantId, { entity: 'leads', action: 'created', entityId: id });
    ctx.sendJson(res, 200, item);
  });

  router.delete('/api/crm/leads/:id', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'delete')) return;

    const store = getTenantStore(tenantId, 'leads');
    if (!store.has(req.params.id)) {
      ctx.sendJson(res, 404, { error: 'not_found', message: 'Lead não encontrado' });
      return;
    }
    store.delete(req.params.id);
    emitCrmUpdated(tenantId, { entity: 'leads', action: 'deleted', entityId: req.params.id });
    ctx.sendJson(res, 200, { ok: true });
  });

  // ── PIPELINES ───────────────────────────────────────────────────────────

  router.get('/api/crm/pipelines', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'read')) return;

    const limit = parseIntOrDefault(req.query.limit, 20);
    const offset = parseIntOrDefault(req.query.offset, 0);
    const store = getTenantStore(tenantId, 'pipelines');

    // Garantir pipeline padrão se store vazio
    if (store.size === 0) {
      const defaultId = newId();
      const defaultPipeline = {
        id: defaultId,
        tenantId,
        name: 'Pipeline Padrão',
        stages: [
          { id: newId(), name: 'Prospecção', order: 0 },
          { id: newId(), name: 'Qualificação', order: 1 },
          { id: newId(), name: 'Proposta', order: 2 },
          { id: newId(), name: 'Negociação', order: 3 },
          { id: newId(), name: 'Fechamento', order: 4 },
        ],
        createdAt: now(),
        updatedAt: now(),
      };
      store.set(defaultId, defaultPipeline);
    }

    ctx.sendJson(res, 200, paginateList(store, limit, offset));
  });

  router.get('/api/crm/pipelines/:id', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'read')) return;

    const store = getTenantStore(tenantId, 'pipelines');
    const item = store.get(req.params.id);
    if (!item) {
      ctx.sendJson(res, 404, { error: 'not_found', message: 'Pipeline não encontrado' });
      return;
    }
    ctx.sendJson(res, 200, item);
  });

  router.post('/api/crm/pipelines', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'create')) return;

    let body;
    try { body = await ctx.parseJsonBody(req); } catch { ctx.badRequest(res, 'JSON inválido'); return; }

    const id = body.id || newId();
    const ts = now();
    const item = {
      id,
      tenantId,
      name: String(body.name || '').trim() || 'Novo Pipeline',
      stages: Array.isArray(body.stages) ? body.stages : [],
      createdAt: body.createdAt || ts,
      updatedAt: ts,
    };

    getTenantStore(tenantId, 'pipelines').set(id, item);
    emitCrmUpdated(tenantId, { entity: 'pipelines', action: 'created', entityId: id });
    ctx.sendJson(res, 200, item);
  });

  router.delete('/api/crm/pipelines/:id', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'delete')) return;

    const store = getTenantStore(tenantId, 'pipelines');
    if (!store.has(req.params.id)) {
      ctx.sendJson(res, 404, { error: 'not_found', message: 'Pipeline não encontrado' });
      return;
    }
    store.delete(req.params.id);
    emitCrmUpdated(tenantId, { entity: 'pipelines', action: 'deleted', entityId: req.params.id });
    ctx.sendJson(res, 200, { ok: true });
  });

  // ── OPPORTUNITIES ────────────────────────────────────────────────────────

  router.get('/api/crm/opportunities', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'read')) return;

    const limit = parseIntOrDefault(req.query.limit, 20);
    const offset = parseIntOrDefault(req.query.offset, 0);
    const store = getTenantStore(tenantId, 'opportunities');
    ctx.sendJson(res, 200, paginateList(store, limit, offset));
  });

  router.get('/api/crm/opportunities/:id', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'read')) return;

    const store = getTenantStore(tenantId, 'opportunities');
    const item = store.get(req.params.id);
    if (!item) {
      ctx.sendJson(res, 404, { error: 'not_found', message: 'Oportunidade não encontrada' });
      return;
    }
    ctx.sendJson(res, 200, item);
  });

  router.post('/api/crm/opportunities', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'create')) return;

    let body;
    try { body = await ctx.parseJsonBody(req); } catch { ctx.badRequest(res, 'JSON inválido'); return; }

    const id = body.id || newId();
    const ts = now();
    const item = {
      id,
      tenantId,
      name: String(body.name || '').trim() || 'Nova Oportunidade',
      accountId: body.accountId || null,
      contactId: body.contactId || null,
      pipelineId: body.pipelineId || null,
      stageId: body.stageId || null,
      value: body.value ?? 0,
      probability: body.probability ?? 0,
      expectedCloseDate: body.expectedCloseDate || null,
      ownerId: body.ownerId || null,
      tags: Array.isArray(body.tags) ? body.tags : [],
      notes: body.notes || null,
      createdAt: body.createdAt || ts,
      updatedAt: ts,
    };

    getTenantStore(tenantId, 'opportunities').set(id, item);
    emitCrmUpdated(tenantId, { entity: 'opportunities', action: 'created', entityId: id });
    ctx.sendJson(res, 200, item);
  });

  router.post('/api/crm/opportunities/:id/move', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'update')) return;

    let body;
    try { body = await ctx.parseJsonBody(req); } catch { ctx.badRequest(res, 'JSON inválido'); return; }

    const store = getTenantStore(tenantId, 'opportunities');
    const item = store.get(req.params.id);
    if (!item) {
      ctx.sendJson(res, 404, { error: 'not_found', message: 'Oportunidade não encontrada' });
      return;
    }

    const updated = { ...item, stageId: body.toStageId || item.stageId, updatedAt: now() };
    store.set(item.id, updated);
    emitCrmUpdated(tenantId, { entity: 'opportunities', action: 'moved', entityId: item.id });
    ctx.sendJson(res, 200, updated);
  });

  router.delete('/api/crm/opportunities/:id', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'delete')) return;

    const store = getTenantStore(tenantId, 'opportunities');
    if (!store.has(req.params.id)) {
      ctx.sendJson(res, 404, { error: 'not_found', message: 'Oportunidade não encontrada' });
      return;
    }
    store.delete(req.params.id);
    emitCrmUpdated(tenantId, { entity: 'opportunities', action: 'deleted', entityId: req.params.id });
    ctx.sendJson(res, 200, { ok: true });
  });

  // ── ACTIVITIES ───────────────────────────────────────────────────────────

  router.get('/api/crm/activities', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'read')) return;

    const limit = parseIntOrDefault(req.query.limit, 20);
    const offset = parseIntOrDefault(req.query.offset, 0);
    const store = getTenantStore(tenantId, 'activities');
    ctx.sendJson(res, 200, paginateList(store, limit, offset));
  });

  router.post('/api/crm/activities', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'create')) return;

    let body;
    try { body = await ctx.parseJsonBody(req); } catch { ctx.badRequest(res, 'JSON inválido'); return; }

    const id = body.id || newId();
    const ts = now();
    const item = {
      id,
      tenantId,
      type: body.type || 'note',
      subjectType: body.subjectType || null,
      subjectId: body.subjectId || null,
      description: body.description || null,
      dueAt: body.dueAt || null,
      doneAt: body.doneAt || null,
      ownerId: body.ownerId || null,
      createdAt: body.createdAt || ts,
      updatedAt: ts,
    };

    getTenantStore(tenantId, 'activities').set(id, item);
    emitCrmUpdated(tenantId, { entity: 'activities', action: 'created', entityId: id });
    ctx.sendJson(res, 200, item);
  });

  // ── TIMELINE ─────────────────────────────────────────────────────────────

  router.get('/api/crm/timeline', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'read')) return;

    const subjectType = String(req.query.subjectType || '').trim();
    const subjectId = String(req.query.subjectId || '').trim();
    const limit = parseIntOrDefault(req.query.limit, 50);

    const store = getTenantStore(tenantId, 'activities');
    const items = Array.from(store.values())
      .filter((a) => {
        if (subjectType && a.subjectType !== subjectType) return false;
        if (subjectId && a.subjectId !== subjectId) return false;
        return true;
      })
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, limit);

    ctx.sendJson(res, 200, { items, total: items.length });
  });

  // ── ANALYTICS DASHBOARD ──────────────────────────────────────────────────

  // NOTA (medido em 2026-10-19): a rota `GET /api/crm/analytics/dashboard`
  // era definida TAMBEM aqui, devolvendo um contrato DIFERENTE
  // ({accounts, contacts, leads, ...} achatado) do servido de fato por
  // `api/modules/domain-operations/routes.js`
  // ({ok, dashboard:{summary, opportunity}, meta}), que monta ANTES deste
  // router (api/app/routeRegistry.js). O handler daqui era INALCANCAVEL e
  // divergente — removido para não virar armadilha de contrato.

  return router;
}

module.exports = { createCrmRoutes };
