'use strict';

const express = require('express');
const { createInboxRoutes } = require('../inbox/routes');
const { createSchedulingSupportRoutes } = require('../scheduling-support/routes');
const { createSupervisorRoutes } = require('../supervisor/routes');
const { createTaskRoutes } = require('../task/routes');
const { createProjectManagementRoutes } = require('../project-management/routes');

async function resolveAuthenticatedTenant(ctx, req, res) {
  const authResult = ctx.requireAuth(req);
  if (!authResult.valid) {
    ctx.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return null;
  }

  const tenantId = ctx.requireTenant(req, res);
  if (!tenantId) return null;
  return tenantId;
}

function ensurePermission(ctx, req, res, moduleName, actionName) {
  const permResult = ctx.requirePermission(req, moduleName, actionName);
  if (!permResult.allowed) {
    ctx.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return false;
  }
  return true;
}

function parseIntegerQuery(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getSupportMessagesSortColumn(sortBy) {
  const normalized = String(sortBy || '').trim().toLowerCase();
  if (normalized === 'created_at') return 'created_at';
  if (normalized === 'attempts') return 'attempts';
  if (normalized === 'status') return 'status';
  return 'updated_at';
}

async function resolveSupportMessagesSequelize() {
  const { OutboundQueueItem, ChannelMessage } = require('../../db/models');
  const outModel = typeof OutboundQueueItem === 'function' ? OutboundQueueItem() : OutboundQueueItem;
  const msgModel = typeof ChannelMessage === 'function' ? ChannelMessage() : ChannelMessage;
  return outModel?.sequelize || msgModel?.sequelize || null;
}

async function listFailedSupportMessages({ sequelize, tenantId, query }) {
  const limit = Math.min(parseIntegerQuery(query.limit, 50) || 50, 200);
  const offset = parseIntegerQuery(query.offset, 0);
  const status = String(query.status || 'failed').trim().toLowerCase();
  const channel = String(query.channel || '').trim().toLowerCase();
  const searchId = String(query.searchId || '').trim();
  const sortColumn = getSupportMessagesSortColumn(query.sortBy);

  const where = ['tenant_key = :tenantId'];
  const replacements = { tenantId, limit, offset };

  if (status && status !== 'all') {
    where.push('status = :status');
    replacements.status = status;
  }

  if (channel) {
    where.push('LOWER(channel_type) = :channel');
    replacements.channel = channel;
  }

  if (searchId) {
    where.push('(id ILIKE :search OR external_message_id ILIKE :search)');
    replacements.search = `%${searchId}%`;
  }

  const whereSql = where.join(' AND ');

  const [countRows] = await sequelize.query(
    `SELECT COUNT(*)::int AS total
     FROM outbound_queue
     WHERE ${whereSql}`,
    { replacements }
  );

  const [rows] = await sequelize.query(
    `SELECT
       id,
       channel_type,
       channel_account_id,
       conversation_id,
       status,
       attempts,
       next_attempt_at,
       last_error,
       reason_code,
       external_message_id,
       message,
       created_at,
       updated_at
     FROM outbound_queue
     WHERE ${whereSql}
     ORDER BY ${sortColumn} DESC, id DESC
     LIMIT :limit OFFSET :offset`,
    { replacements }
  );

  return {
    messages: Array.isArray(rows) ? rows : [],
    total: countRows?.[0]?.total ?? 0,
    limit,
    offset,
  };
}

async function listDeliveredSupportMessages({ sequelize, tenantId, query }) {
  const limit = Math.min(parseIntegerQuery(query.limit, 50) || 50, 200);
  const offset = parseIntegerQuery(query.offset, 0);
  const channel = String(query.channel || '').trim().toLowerCase();
  const searchId = String(query.searchId || '').trim();
  const sortColumn = getSupportMessagesSortColumn(query.sortBy);

  const where = [
    'tenant_key = :tenantId',
    `direction = 'out'`,
    `status IN ('sent', 'delivered', 'read')`,
  ];
  const replacements = { tenantId, limit, offset };

  if (channel) {
    where.push('LOWER(channel_type) = :channel');
    replacements.channel = channel;
  }

  if (searchId) {
    where.push('(id ILIKE :search OR external_message_id ILIKE :search)');
    replacements.search = `%${searchId}%`;
  }

  const whereSql = where.join(' AND ');

  const [countRows] = await sequelize.query(
    `SELECT COUNT(*)::int AS total
     FROM channel_messages
     WHERE ${whereSql}`,
    { replacements }
  );

  const [rows] = await sequelize.query(
    `SELECT
       id,
       channel_type,
       conversation_id,
       status,
       1 AS attempts,
       NULL::timestamp AS next_attempt_at,
       NULL::text AS last_error,
       NULL::text AS reason_code,
       external_message_id,
       body AS message,
       created_at,
       updated_at
     FROM channel_messages
     WHERE ${whereSql}
     ORDER BY ${sortColumn} DESC, id DESC
     LIMIT :limit OFFSET :offset`,
    { replacements }
  );

  return {
    messages: Array.isArray(rows) ? rows : [],
    total: countRows?.[0]?.total ?? 0,
    limit,
    offset,
  };
}

function createDomainOperationsRoutes({ buildDeps }) {
  const router = express.Router();

  router.use(createTaskRoutes({
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        requireTenant: ctx.requireTenant,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
      };
    },
  }));

  router.use(createProjectManagementRoutes({
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        requireTenant: ctx.requireTenant,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
      };
    },
  }));

  router.use(createSchedulingSupportRoutes({
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
        requireAuth: ctx.requireAuth,
        requireTenant: ctx.requireTenant,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
      };
    },
  }));

  router.use(createInboxRoutes({
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        requireTenant: ctx.requireTenant,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        listAllTickets: ctx.listAllTickets,
        getTicket: ctx.getTicket,
        canAccessTicket: ctx.canAccessTicket,
        canModifyTicket: ctx.canModifyTicket,
        assignTicket: ctx.assignTicket,
        transferTicket: ctx.transferTicket,
        addTicketNote: ctx.addTicketNote,
        triggerWebhooks: ctx.triggerWebhooks,
        emitEvent: ctx.emitEvent,
        logAction: ctx.logAction,
        logger: ctx.logger,
      };
    },
  }));

  router.use(createSupervisorRoutes({
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        requireTenant: ctx.requireTenant,
        sendJson: ctx.sendJson,
        logger: ctx.logger,
        getSupervisorMetrics: ctx.getSupervisorMetrics,
        getGeneralMetrics: ctx.getGeneralMetrics,
        getSupervisorAgentStatus: ctx.getSupervisorAgentStatus,
        getSupervisorQueueStatus: ctx.getSupervisorQueueStatus,
      };
    },
  }));

  router.get('/api/support/dashboard', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = await resolveAuthenticatedTenant(ctx, req, res);
    if (!tenantId) return;
    if (!ensurePermission(ctx, req, res, 'tickets', 'read')) return;

    try {
      const { OutboundQueueItem } = require('../../db/models');
      const Model = typeof OutboundQueueItem === 'function' ? OutboundQueueItem() : OutboundQueueItem;
      const sequelize = Model && Model.sequelize;

      if (!sequelize) {
        ctx.sendJson(res, 200, {
          outboundPendingCount: 0,
          outboundFailedCount: 0,
          recentErrors: [],
          meta: { warning: 'db_unavailable' },
        });
        return;
      }

      const [pending] = await sequelize.query(
        `SELECT COUNT(*)::int AS c FROM outbound_queue WHERE tenant_key = :t AND status = 'pending'`,
        { replacements: { t: tenantId } }
      );

      const [failed] = await sequelize.query(
        `SELECT COUNT(*)::int AS c FROM outbound_queue WHERE tenant_key = :t AND status = 'failed'`,
        { replacements: { t: tenantId } }
      );

      const [errs] = await sequelize.query(
        `SELECT id, channel_type, last_error, attempts, next_attempt_at, updated_at
         FROM outbound_queue
         WHERE tenant_key = :t AND last_error IS NOT NULL
         ORDER BY updated_at DESC
         LIMIT 10`,
        { replacements: { t: tenantId } }
      );

      ctx.sendJson(res, 200, {
        outboundPendingCount: pending?.[0]?.c ?? 0,
        outboundFailedCount: failed?.[0]?.c ?? 0,
        recentErrors: Array.isArray(errs) ? errs : [],
      });
    } catch (err) {
      ctx.logger.error('[DomainOperations] Erro ao obter support dashboard', err);
      ctx.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter dashboard de suporte' });
    }
  });

  router.get('/api/support/failed-messages', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = await resolveAuthenticatedTenant(ctx, req, res);
    if (!tenantId) return;
    if (!ensurePermission(ctx, req, res, 'tickets', 'read')) return;

    try {
      const sequelize = await resolveSupportMessagesSequelize();
      if (!sequelize) {
        ctx.sendJson(res, 200, { messages: [], total: 0, limit: 50, offset: 0, meta: { warning: 'db_unavailable' } });
        return;
      }

      const data = await listFailedSupportMessages({
        sequelize,
        tenantId,
        query: req.query || {},
      });
      ctx.sendJson(res, 200, data);
    } catch (err) {
      ctx.logger.error('[DomainOperations] Erro ao listar mensagens falhadas', err);
      ctx.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar mensagens falhadas' });
    }
  });

  router.get('/api/support/delivered-messages', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = await resolveAuthenticatedTenant(ctx, req, res);
    if (!tenantId) return;
    if (!ensurePermission(ctx, req, res, 'tickets', 'read')) return;

    try {
      const sequelize = await resolveSupportMessagesSequelize();
      if (!sequelize) {
        ctx.sendJson(res, 200, { messages: [], total: 0, limit: 50, offset: 0, meta: { warning: 'db_unavailable' } });
        return;
      }

      const data = await listDeliveredSupportMessages({
        sequelize,
        tenantId,
        query: req.query || {},
      });
      ctx.sendJson(res, 200, data);
    } catch (err) {
      ctx.logger.error('[DomainOperations] Erro ao listar mensagens entregues', err);
      ctx.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar mensagens entregues' });
    }
  });

  router.get('/api/crm/analytics/dashboard', async (req, res) => {
    const ctx = buildDeps(req, res);
    const tenantId = await resolveAuthenticatedTenant(ctx, req, res);
    if (!tenantId) return;
    if (!ensurePermission(ctx, req, res, 'reports', 'read')) return;

    try {
      const { MarketingLead } = require('../../db/models');
      const LeadModel = typeof MarketingLead === 'function' ? MarketingLead() : MarketingLead;
      const sequelize = LeadModel && LeadModel.sequelize;

      if (!sequelize) {
        ctx.sendJson(res, 200, {
          ok: true,
          dashboard: {
            summary: {
              totalAccounts: 0,
              totalContacts: 0,
              totalLeads: 0,
              totalOpportunities: 0,
            },
            opportunity: {
              totalValue: 0,
              winRate: '0%',
            },
          },
          meta: { warning: 'db_unavailable' },
        });
        return;
      }

      // LEADS e CONTATOS vêm de `marketing_leads` (é a fonte que a tela de
      // contatos lista e que o CRM grava em /api/crm/leads e /api/crm/contacts).
      const [rows] = await sequelize.query(
        `SELECT
           COUNT(*)::int AS total_leads,
           COUNT(DISTINCT NULLIF(TRIM(COALESCE(email, phone, id::text)), ''))::int AS total_contacts
         FROM marketing_leads
         WHERE tenant_key = :tenantId`,
        { replacements: { tenantId } }
      );

      // CONTAS, OPORTUNIDADES e VALOR vêm de `crm_records` — a MESMA tabela em
      // que /api/crm/accounts e /api/crm/opportunities gravam. Antes esses
      // números eram derivados de atributos de marketing_leads enquanto a
      // escrita ia para um Map em memória: criar conta/oportunidade não movia
      // contador nenhum (medido em 2026-10-19, H21).
      const [registros] = await sequelize.query(
        `SELECT entity, payload
           FROM crm_records
          WHERE tenant_key = :tenantId
            AND entity IN ('accounts', 'opportunities', 'pipelines')`,
        { replacements: { tenantId } }
      );

      const listaRegistros = Array.isArray(registros) ? registros : [];
      const contas = listaRegistros.filter((r) => r.entity === 'accounts');
      const oportunidades = listaRegistros.filter((r) => r.entity === 'opportunities');
      const pipelines = listaRegistros.filter((r) => r.entity === 'pipelines');

      const nomeDaEtapa = new Map();
      for (const pipeline of pipelines) {
        const payload = pipeline.payload || {};
        for (const etapa of (Array.isArray(payload.stages) ? payload.stages : [])) {
          if (etapa && etapa.id) nomeDaEtapa.set(String(etapa.id), String(etapa.name || '').toLowerCase());
        }
      }

      let totalValue = 0;
      let ganhas = 0;
      let perdidas = 0;
      for (const oportunidade of oportunidades) {
        const payload = oportunidade.payload || {};
        const valor = Number(payload.value);
        if (Number.isFinite(valor)) totalValue += valor;
        const etapa = nomeDaEtapa.get(String(payload.stageId || '')) || '';
        if (/ganho|won|fechad[oa]|convertid/.test(etapa)) ganhas += 1;
        if (/perdid|lost|cancel/.test(etapa)) perdidas += 1;
      }

      const row = Array.isArray(rows) && rows[0] ? rows[0] : {};
      const winBase = ganhas + perdidas;
      const winRate = winBase > 0 ? `${Math.round((ganhas / winBase) * 100)}%` : '0%';

      ctx.sendJson(res, 200, {
        ok: true,
        dashboard: {
          summary: {
            totalAccounts: contas.length,
            totalContacts: Number(row.total_contacts || 0),
            totalLeads: Number(row.total_leads || 0),
            totalOpportunities: oportunidades.length,
          },
          opportunity: {
            totalValue,
            winRate,
          },
        },
        meta: {
          tenantId,
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      ctx.logger.error('[DomainOperations] Erro ao obter CRM analytics dashboard', err);
      ctx.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter dashboard de CRM' });
    }
  });

  return router;
}

module.exports = {
  createDomainOperationsRoutes,
};
