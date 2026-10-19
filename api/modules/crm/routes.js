'use strict';

/**
 * Módulo CRM — CRUD persistido por tenant.
 *
 * Entidades:
 *  - accounts      : empresas e organizações            → `crm_records`
 *  - contacts      : pessoas (MarketingLead)            → `marketing_leads`
 *  - leads         : prospecção e qualificação          → `marketing_leads`
 *  - pipelines     : funis de vendas (com stages)       → `crm_records`
 *  - opportunities : negociações vinculadas a pipelines → `crm_records`
 *  - activities    : log de interações                  → `crm_records`
 *  - timeline      : leitura agregada de atividades por sujeito
 *
 * HISTÓRICO (medido em 2026-10-19, H21): todas as entidades viviam em um `Map`
 * por processo. O registro era aceito com 200, não aparecia na lista seguinte
 * (contatos liam o banco, leads liam o Map) e desaparecia no restart. Havia
 * também fallback silencioso para memória quando o banco falhava — o que a regra
 * do projeto proíbe: falha de persistência é erro explícito
 * (`persistence_required`), nunca "funciona em memória".
 *
 * Leads e contatos compartilham `marketing_leads` porque é dela que o painel
 * (`GET /api/crm/analytics/dashboard`, em `domain-operations`) sempre agregou
 * esses números — antes o painel contava o banco e a escrita ia para o Map, e
 * por isso criar um lead não movia contador nenhum.
 */

const express = require('express');
const crypto = require('crypto');
const { emitEvent } = require('../../services/websocketService');
const logger = require('../../utils/logger');

// ---------------------------------------------------------------------------
// Realtime por PUSH (regra do projeto: PROIBIDO setInterval para sincronizar
// estado). Toda mutação relevante de CRM emite `crm.metrics.updated`; as telas
// apenas escutam o evento via WebSocket e refazem a leitura.
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
// Persistência
// ---------------------------------------------------------------------------

function modeloDe(factory) {
  return typeof factory === 'function' ? factory() : factory;
}

function models() {
  return require('../../db/models');
}

function modelCrmRecord() {
  return modeloDe(models().CrmRecord);
}

function modelMarketingLead() {
  return modeloDe(models().MarketingLead);
}

function newId() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function parseIntOrDefault(value, fallback) {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Erro de persistência — vira 500 `persistence_required`, nunca fallback. */
class PersistenceError extends Error {
  constructor(causa) {
    super(causa && causa.message ? causa.message : String(causa));
    this.name = 'PersistenceError';
    this.code = 'persistence_required';
  }
}

async function comPersistencia(ctx, res, execucao) {
  try {
    await execucao();
  } catch (err) {
    logger.error('[CRM] Falha de persistência', { erro: err && err.message });
    ctx.sendJson(res, 500, {
      error: 'persistence_required',
      message: 'Falha ao acessar a persistência do CRM.',
    });
  }
}

async function lerRegistros(tenantId, entity, { limit = 20, offset = 0 } = {}) {
  try {
    const Model = modelCrmRecord();
    const { rows, count } = await Model.findAndCountAll({
      where: { tenant_key: String(tenantId), entity },
      order: [['updated_at', 'DESC']],
      limit,
      offset,
    });
    const items = (rows || []).map((row) => {
      const r = row.toJSON ? row.toJSON() : row;
      return { id: r.id, ...(r.payload || {}) };
    });
    return { items, total: Number(count || 0), limit, offset };
  } catch (err) {
    throw new PersistenceError(err);
  }
}

async function lerRegistro(tenantId, entity, id) {
  try {
    const Model = modelCrmRecord();
    const row = await Model.findOne({ where: { id: String(id), tenant_key: String(tenantId), entity } });
    if (!row) return null;
    const r = row.toJSON ? row.toJSON() : row;
    return { id: r.id, ...(r.payload || {}) };
  } catch (err) {
    throw new PersistenceError(err);
  }
}

async function gravarRegistro(tenantId, entity, item) {
  try {
    const Model = modelCrmRecord();
    const { id, tenantId: _tenantIgnorado, ...payload } = item;
    await Model.upsert({ id, tenant_key: String(tenantId), entity, payload });
    return item;
  } catch (err) {
    throw new PersistenceError(err);
  }
}

async function removerRegistro(tenantId, entity, id) {
  try {
    const Model = modelCrmRecord();
    const removidos = await Model.destroy({ where: { id: String(id), tenant_key: String(tenantId), entity } });
    return removidos > 0;
  } catch (err) {
    throw new PersistenceError(err);
  }
}

// ── Leads / contatos (marketing_leads) ─────────────────────────────────────

function mapLead(linha) {
  const r = linha && linha.toJSON ? linha.toJSON() : (linha || {});
  const atributos = r.attributes && typeof r.attributes === 'object' ? r.attributes : {};
  const crm = atributos.crm && typeof atributos.crm === 'object' ? atributos.crm : {};
  return {
    id: r.id,
    name: r.name || null,
    email: r.email || null,
    phone: r.phone || null,
    source: crm.source || null,
    stage: r.stage || null,
    score: r.score ?? 0,
    notes: crm.notes || null,
    department: atributos.department || null,
    attributes: atributos,
    createdAt: r.created_at || r.createdAt || null,
    updatedAt: r.updated_at || r.updatedAt || null,
  };
}

async function lerPessoas(tenantId, { limit = 20, offset = 0, q = '' } = {}) {
  try {
    const Model = modelMarketingLead();
    const { Op } = require('sequelize');
    const where = { tenant_key: String(tenantId) };
    const termo = String(q || '').trim();
    if (termo) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${termo}%` } },
        { email: { [Op.iLike]: `%${termo}%` } },
        { phone: { [Op.iLike]: `%${termo}%` } },
      ];
    }
    const { rows, count } = await Model.findAndCountAll({
      where,
      order: [['updated_at', 'DESC']],
      limit,
      offset,
    });
    return { items: (rows || []).map(mapLead), total: Number(count || 0), limit, offset };
  } catch (err) {
    throw new PersistenceError(err);
  }
}

async function lerPessoa(tenantId, id) {
  try {
    const Model = modelMarketingLead();
    const row = await Model.findOne({ where: { id: String(id), tenant_key: String(tenantId) } });
    return row ? mapLead(row) : null;
  } catch (err) {
    throw new PersistenceError(err);
  }
}

async function gravarPessoa(tenantId, item) {
  try {
    const Model = modelMarketingLead();
    const id = item.id || newId();
    const existente = await Model.findOne({ where: { id: String(id), tenant_key: String(tenantId) } });
    const anterior = existente ? (existente.toJSON ? existente.toJSON() : existente) : null;
    const atributosAnteriores = anterior && anterior.attributes && typeof anterior.attributes === 'object'
      ? anterior.attributes : {};
    const crmAnterior = atributosAnteriores.crm && typeof atributosAnteriores.crm === 'object'
      ? atributosAnteriores.crm : {};
    const atributosEntrada = item.attributes && typeof item.attributes === 'object' ? item.attributes : {};

    const registro = {
      id,
      tenant_key: String(tenantId),
      name: item.name != null ? (String(item.name).trim() || null) : (anterior ? anterior.name : null),
      email: item.email != null ? (item.email || null) : (anterior ? anterior.email : null),
      phone: item.phone != null ? (item.phone || null) : (anterior ? anterior.phone : null),
      stage: item.stage || (anterior && anterior.stage) || 'novo',
      score: item.score != null ? (Number(item.score) || 0) : ((anterior && anterior.score) || 0),
      attributes: {
        ...atributosAnteriores,
        ...atributosEntrada,
        crm: {
          ...crmAnterior,
          source: item.source !== undefined ? (item.source || null) : (crmAnterior.source || null),
          notes: item.notes !== undefined ? (item.notes || null) : (crmAnterior.notes || null),
        },
      },
      last_seen_at: new Date(),
    };

    if (existente) await existente.update(registro);
    else await Model.create(registro);

    return mapLead(registro);
  } catch (err) {
    throw new PersistenceError(err);
  }
}

async function removerPessoa(tenantId, id) {
  try {
    const Model = modelMarketingLead();
    const removidos = await Model.destroy({ where: { id: String(id), tenant_key: String(tenantId) } });
    return removidos > 0;
  } catch (err) {
    throw new PersistenceError(err);
  }
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

    await comPersistencia(ctx, res, async () => {
      const pagina = await lerRegistros(tenantId, 'accounts', {
        limit: parseIntOrDefault(req.query.limit, 20),
        offset: parseIntOrDefault(req.query.offset, 0),
      });
      ctx.sendJson(res, 200, pagina);
    });
  });

  router.get('/api/crm/accounts/:id', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'read')) return;

    await comPersistencia(ctx, res, async () => {
      const item = await lerRegistro(tenantId, 'accounts', req.params.id);
      if (!item) {
        ctx.sendJson(res, 404, { error: 'not_found', message: 'Conta não encontrada' });
        return;
      }
      ctx.sendJson(res, 200, item);
    });
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
      // A tela de Contas tem filtro e coluna de Status; sem persistir o campo o
      // filtro "Ativo" escondia TODAS as contas (medido em 2026-10-19).
      status: String(body.status || 'active').trim().toLowerCase() || 'active',
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

    await comPersistencia(ctx, res, async () => {
      await gravarRegistro(tenantId, 'accounts', item);
      emitCrmUpdated(tenantId, { entity: 'accounts', action: 'created', entityId: id });
      ctx.sendJson(res, 200, item);
    });
  });

  router.delete('/api/crm/accounts/:id', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'delete')) return;

    await comPersistencia(ctx, res, async () => {
      const removidos = await removerRegistro(tenantId, 'accounts', req.params.id);
      if (!removidos) {
        ctx.sendJson(res, 404, { error: 'not_found', message: 'Conta não encontrada' });
        return;
      }
      emitCrmUpdated(tenantId, { entity: 'accounts', action: 'deleted', entityId: req.params.id });
      ctx.sendJson(res, 200, { ok: true });
    });
  });

  // ── CONTACTS (marketing_leads) ───────────────────────────────────────────

  router.get('/api/crm/contacts', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'read')) return;

    await comPersistencia(ctx, res, async () => {
      const pagina = await lerPessoas(tenantId, {
        limit: parseIntOrDefault(req.query.limit, 20),
        offset: parseIntOrDefault(req.query.offset, 0),
        q: req.query.q,
      });
      ctx.sendJson(res, 200, pagina);
    });
  });

  router.get('/api/crm/contacts/:id', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'read')) return;

    await comPersistencia(ctx, res, async () => {
      const item = await lerPessoa(tenantId, req.params.id);
      if (!item) {
        ctx.sendJson(res, 404, { error: 'not_found', message: 'Contato não encontrado' });
        return;
      }
      ctx.sendJson(res, 200, item);
    });
  });

  router.post('/api/crm/contacts', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'create')) return;

    let body;
    try { body = await ctx.parseJsonBody(req); } catch { ctx.badRequest(res, 'JSON inválido'); return; }

    const atributos = body.attributes && typeof body.attributes === 'object' ? { ...body.attributes } : {};
    if (body.department) atributos.department = body.department;

    const item = {
      id: body.id || newId(),
      name: String(body.name || '').trim() || 'Sem nome',
      email: body.email || null,
      phone: body.phone || null,
      stage: body.stage || 'contato',
      score: body.score ?? 0,
      source: body.source || null,
      notes: body.notes || null,
      attributes: atributos,
    };

    await comPersistencia(ctx, res, async () => {
      const salvo = await gravarPessoa(tenantId, item);
      emitCrmUpdated(tenantId, { entity: 'contacts', action: 'created', entityId: salvo.id });
      ctx.sendJson(res, 200, salvo);
    });
  });

  router.delete('/api/crm/contacts/:id', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'delete')) return;

    await comPersistencia(ctx, res, async () => {
      const removidos = await removerPessoa(tenantId, req.params.id);
      if (!removidos) {
        ctx.sendJson(res, 404, { error: 'not_found', message: 'Contato não encontrado' });
        return;
      }
      emitCrmUpdated(tenantId, { entity: 'contacts', action: 'deleted', entityId: req.params.id });
      ctx.sendJson(res, 200, { ok: true });
    });
  });

  // ── LEADS (marketing_leads) ──────────────────────────────────────────────

  router.get('/api/crm/leads', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'read')) return;

    await comPersistencia(ctx, res, async () => {
      const pagina = await lerPessoas(tenantId, {
        limit: parseIntOrDefault(req.query.limit, 20),
        offset: parseIntOrDefault(req.query.offset, 0),
        q: req.query.q,
      });
      ctx.sendJson(res, 200, pagina);
    });
  });

  router.get('/api/crm/leads/:id', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'read')) return;

    await comPersistencia(ctx, res, async () => {
      const item = await lerPessoa(tenantId, req.params.id);
      if (!item) {
        ctx.sendJson(res, 404, { error: 'not_found', message: 'Lead não encontrado' });
        return;
      }
      ctx.sendJson(res, 200, item);
    });
  });

  router.post('/api/crm/leads', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'create')) return;

    let body;
    try { body = await ctx.parseJsonBody(req); } catch { ctx.badRequest(res, 'JSON inválido'); return; }

    const item = {
      id: body.id || newId(),
      name: String(body.name || '').trim() || 'Sem nome',
      email: body.email || null,
      phone: body.phone || null,
      source: body.source || null,
      stage: body.stage || 'novo',
      score: body.score ?? 0,
      notes: body.notes || null,
      attributes: body.attributes && typeof body.attributes === 'object' ? body.attributes : {},
    };

    await comPersistencia(ctx, res, async () => {
      const salvo = await gravarPessoa(tenantId, item);
      emitCrmUpdated(tenantId, { entity: 'leads', action: 'created', entityId: salvo.id });
      ctx.sendJson(res, 200, salvo);
    });
  });

  router.delete('/api/crm/leads/:id', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'delete')) return;

    await comPersistencia(ctx, res, async () => {
      const removidos = await removerPessoa(tenantId, req.params.id);
      if (!removidos) {
        ctx.sendJson(res, 404, { error: 'not_found', message: 'Lead não encontrado' });
        return;
      }
      emitCrmUpdated(tenantId, { entity: 'leads', action: 'deleted', entityId: req.params.id });
      ctx.sendJson(res, 200, { ok: true });
    });
  });

  // ── PIPELINES ───────────────────────────────────────────────────────────

  router.get('/api/crm/pipelines', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'read')) return;

    await comPersistencia(ctx, res, async () => {
      const limit = parseIntOrDefault(req.query.limit, 20);
      const offset = parseIntOrDefault(req.query.offset, 0);
      let pagina = await lerRegistros(tenantId, 'pipelines', { limit, offset });

      if (pagina.total === 0 && offset === 0) {
        const ts = now();
        const padrao = {
          id: newId(),
          tenantId,
          name: 'Pipeline Padrão',
          stages: [
            { id: newId(), name: 'Prospecção', order: 0 },
            { id: newId(), name: 'Qualificação', order: 1 },
            { id: newId(), name: 'Proposta', order: 2 },
            { id: newId(), name: 'Negociação', order: 3 },
            { id: newId(), name: 'Fechamento', order: 4 },
          ],
          createdAt: ts,
          updatedAt: ts,
        };
        await gravarRegistro(tenantId, 'pipelines', padrao);
        pagina = await lerRegistros(tenantId, 'pipelines', { limit, offset });
      }

      ctx.sendJson(res, 200, pagina);
    });
  });

  router.get('/api/crm/pipelines/:id', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'read')) return;

    await comPersistencia(ctx, res, async () => {
      const item = await lerRegistro(tenantId, 'pipelines', req.params.id);
      if (!item) {
        ctx.sendJson(res, 404, { error: 'not_found', message: 'Pipeline não encontrado' });
        return;
      }
      ctx.sendJson(res, 200, item);
    });
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

    await comPersistencia(ctx, res, async () => {
      await gravarRegistro(tenantId, 'pipelines', item);
      emitCrmUpdated(tenantId, { entity: 'pipelines', action: 'created', entityId: id });
      ctx.sendJson(res, 200, item);
    });
  });

  router.delete('/api/crm/pipelines/:id', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'delete')) return;

    await comPersistencia(ctx, res, async () => {
      const removidos = await removerRegistro(tenantId, 'pipelines', req.params.id);
      if (!removidos) {
        ctx.sendJson(res, 404, { error: 'not_found', message: 'Pipeline não encontrado' });
        return;
      }
      emitCrmUpdated(tenantId, { entity: 'pipelines', action: 'deleted', entityId: req.params.id });
      ctx.sendJson(res, 200, { ok: true });
    });
  });

  // ── OPPORTUNITIES ────────────────────────────────────────────────────────

  router.get('/api/crm/opportunities', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'read')) return;

    await comPersistencia(ctx, res, async () => {
      const pagina = await lerRegistros(tenantId, 'opportunities', {
        limit: parseIntOrDefault(req.query.limit, 20),
        offset: parseIntOrDefault(req.query.offset, 0),
      });
      ctx.sendJson(res, 200, pagina);
    });
  });

  router.get('/api/crm/opportunities/:id', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'read')) return;

    await comPersistencia(ctx, res, async () => {
      const item = await lerRegistro(tenantId, 'opportunities', req.params.id);
      if (!item) {
        ctx.sendJson(res, 404, { error: 'not_found', message: 'Oportunidade não encontrada' });
        return;
      }
      ctx.sendJson(res, 200, item);
    });
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

    await comPersistencia(ctx, res, async () => {
      await gravarRegistro(tenantId, 'opportunities', item);
      emitCrmUpdated(tenantId, { entity: 'opportunities', action: 'created', entityId: id });
      ctx.sendJson(res, 200, item);
    });
  });

  router.post('/api/crm/opportunities/:id/move', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'update')) return;

    let body;
    try { body = await ctx.parseJsonBody(req); } catch { ctx.badRequest(res, 'JSON inválido'); return; }

    await comPersistencia(ctx, res, async () => {
      const item = await lerRegistro(tenantId, 'opportunities', req.params.id);
      if (!item) {
        ctx.sendJson(res, 404, { error: 'not_found', message: 'Oportunidade não encontrada' });
        return;
      }
      const atualizado = {
        ...item,
        stageId: body.toStageId || item.stageId,
        updatedAt: now(),
      };
      await gravarRegistro(tenantId, 'opportunities', atualizado);
      emitCrmUpdated(tenantId, { entity: 'opportunities', action: 'moved', entityId: item.id });
      ctx.sendJson(res, 200, atualizado);
    });
  });

  router.delete('/api/crm/opportunities/:id', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'delete')) return;

    await comPersistencia(ctx, res, async () => {
      const removidos = await removerRegistro(tenantId, 'opportunities', req.params.id);
      if (!removidos) {
        ctx.sendJson(res, 404, { error: 'not_found', message: 'Oportunidade não encontrada' });
        return;
      }
      emitCrmUpdated(tenantId, { entity: 'opportunities', action: 'deleted', entityId: req.params.id });
      ctx.sendJson(res, 200, { ok: true });
    });
  });

  // ── ACTIVITIES ───────────────────────────────────────────────────────────

  router.get('/api/crm/activities', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'read')) return;

    await comPersistencia(ctx, res, async () => {
      const pagina = await lerRegistros(tenantId, 'activities', {
        limit: parseIntOrDefault(req.query.limit, 20),
        offset: parseIntOrDefault(req.query.offset, 0),
      });
      ctx.sendJson(res, 200, pagina);
    });
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

    await comPersistencia(ctx, res, async () => {
      await gravarRegistro(tenantId, 'activities', item);
      emitCrmUpdated(tenantId, { entity: 'activities', action: 'created', entityId: id });
      ctx.sendJson(res, 200, item);
    });
  });

  // ── TIMELINE ─────────────────────────────────────────────────────────────

  router.get('/api/crm/timeline', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = resolveAuth(ctx, req, res);
    if (!tenantId) return;
    if (!checkPermission(ctx, req, res, 'read')) return;

    await comPersistencia(ctx, res, async () => {
      const subjectType = String(req.query.subjectType || '').trim();
      const subjectId = String(req.query.subjectId || '').trim();
      const limite = parseIntOrDefault(req.query.limit, 50);

      const pagina = await lerRegistros(tenantId, 'activities', { limit: 500, offset: 0 });
      const items = pagina.items
        .filter((a) => {
          if (subjectType && a.subjectType !== subjectType) return false;
          if (subjectId && a.subjectId !== subjectId) return false;
          return true;
        })
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .slice(0, limite);

      ctx.sendJson(res, 200, { items, total: items.length });
    });
  });

  return router;
}

module.exports = { createCrmRoutes };
