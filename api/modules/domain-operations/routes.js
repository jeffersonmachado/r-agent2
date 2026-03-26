'use strict';

const express = require('express');
const { createInboxRoutes } = require('../inbox/routes');
const { createSchedulingSupportRoutes } = require('../scheduling-support/routes');
const { createSupervisorRoutes } = require('../supervisor/routes');
const { createTaskRoutes } = require('../task/routes');

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

      const [rows] = await sequelize.query(
        `SELECT
           COUNT(*)::int AS total_leads,
           COUNT(DISTINCT NULLIF(TRIM(COALESCE(email, phone, id::text)), ''))::int AS total_contacts,
           COUNT(DISTINCT NULLIF(TRIM(COALESCE(
             attributes->>'accountId',
             attributes->>'account_id',
             attributes->>'companyId',
             attributes->>'company_id',
             attributes->>'company',
             attributes->>'account'
           )), ''))::int AS total_accounts,
           COUNT(*) FILTER (
             WHERE LOWER(COALESCE(stage, '')) IN ('opportunity', 'proposal', 'negotiation', 'won', 'closed_won', 'closed_lost', 'lost')
           )::int AS total_opportunities,
           COUNT(*) FILTER (
             WHERE LOWER(COALESCE(stage, '')) IN ('won', 'closed_won', 'sale', 'converted')
           )::int AS won_count,
           COUNT(*) FILTER (
             WHERE LOWER(COALESCE(stage, '')) IN ('lost', 'closed_lost')
           )::int AS lost_count,
           COALESCE(SUM(
             CASE
               WHEN COALESCE(
                 attributes->>'dealValue',
                 attributes->>'deal_value',
                 attributes->>'opportunityValue',
                 attributes->>'opportunity_value',
                 attributes->>'value',
                 attributes->>'amount'
               ) ~ '^-?[0-9]+(\\.[0-9]+)?$'
               THEN (
                 COALESCE(
                   attributes->>'dealValue',
                   attributes->>'deal_value',
                   attributes->>'opportunityValue',
                   attributes->>'opportunity_value',
                   attributes->>'value',
                   attributes->>'amount'
                 )::numeric
               )
               ELSE 0
             END
           ), 0)::float AS total_value
         FROM marketing_leads
         WHERE tenant_key = :tenantId`,
        { replacements: { tenantId } }
      );

      const row = Array.isArray(rows) && rows[0] ? rows[0] : {};
      const won = Number(row.won_count || 0);
      const lost = Number(row.lost_count || 0);
      const winBase = won + lost;
      const winRate = winBase > 0 ? `${Math.round((won / winBase) * 100)}%` : '0%';

      ctx.sendJson(res, 200, {
        ok: true,
        dashboard: {
          summary: {
            totalAccounts: Number(row.total_accounts || 0),
            totalContacts: Number(row.total_contacts || 0),
            totalLeads: Number(row.total_leads || 0),
            totalOpportunities: Number(row.total_opportunities || 0),
          },
          opportunity: {
            totalValue: Number(row.total_value || 0),
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
