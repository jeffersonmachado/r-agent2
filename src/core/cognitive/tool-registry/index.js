'use strict';

/**
 * Tool Registry do Cognitive Core.
 *
 * Toda ação de negócio executada pela plataforma passa por aqui — nenhuma
 * execução direta de serviço a partir do pipeline cognitivo é permitida.
 *
 * Cada tool segue o contrato CognitiveTool:
 *   { id, visibility: 'PRODUCTION'|'SUPPORT'|'DEVELOPMENT', permissions: string[],
 *     description, execute(input, context), rollback?(input, context, output) }
 *
 * Validações obrigatórias em execução: tenant, permissionamento e visibility.
 * As tools delegam para serviços já existentes do RAP (não duplicam domínio).
 */

const { sanitize } = require('../sanitize');
const { VISIBILITY, isValidVisibility, canAccess } = require('../visibility');

function defaultLogger() {
  // Lazy para não acoplar carga do logger em testes puros.
  return require('../../../../api/utils/logger');
}

function assertToolShape(tool) {
  if (!tool || typeof tool !== 'object') throw new Error('cognitive_tool_invalid: tool must be an object');
  if (!tool.id || typeof tool.id !== 'string') throw new Error('cognitive_tool_invalid: id is required');
  if (!isValidVisibility(tool.visibility)) {
    throw new Error(`cognitive_tool_invalid: visibility must be PRODUCTION|SUPPORT|DEVELOPMENT (tool=${tool.id})`);
  }
  if (!Array.isArray(tool.permissions)) throw new Error(`cognitive_tool_invalid: permissions must be an array (tool=${tool.id})`);
  if (!tool.description || typeof tool.description !== 'string') {
    throw new Error(`cognitive_tool_invalid: description is required (tool=${tool.id})`);
  }
  if (typeof tool.execute !== 'function') throw new Error(`cognitive_tool_invalid: execute must be a function (tool=${tool.id})`);
}

function resolveActorClassification(actor) {
  const classification = String(actor?.classification || VISIBILITY.PRODUCTION).toUpperCase();
  return isValidVisibility(classification) ? classification : VISIBILITY.PRODUCTION;
}

function actorHasPermissions(actor, required) {
  if (!required || required.length === 0) return true;
  const granted = new Set(Array.isArray(actor?.permissions) ? actor.permissions : []);
  if (granted.has('*')) return true;
  return required.every((perm) => granted.has(perm));
}

function createToolRegistry({ logger } = {}) {
  const tools = new Map();
  const log = logger || defaultLogger();

  function register(tool) {
    assertToolShape(tool);
    if (tools.has(tool.id)) throw new Error(`cognitive_tool_duplicate: ${tool.id}`);
    tools.set(tool.id, tool);
    return tool;
  }

  function get(id) {
    return tools.get(id) || null;
  }

  /**
   * Lista tools visíveis para o ator. PRODUCTION nunca enxerga SUPPORT/DEVELOPMENT.
   */
  function list(actor = {}) {
    const classification = resolveActorClassification(actor);
    return Array.from(tools.values())
      .filter((tool) => canAccess(classification, tool.visibility))
      .map((tool) => ({
        id: tool.id,
        visibility: tool.visibility,
        permissions: [...tool.permissions],
        description: tool.description,
      }));
  }

  /**
   * Executa uma tool com validação de tenant, visibility e permissionamento.
   */
  async function execute(id, input, context = {}) {
    const tool = tools.get(id);
    if (!tool) throw new Error(`cognitive_tool_not_found: ${id}`);

    const tenantId = String(context.tenantId || '').trim();
    if (!tenantId) throw new Error(`cognitive_tool_tenant_required: ${id}`);

    const actor = context.actor || {};
    const classification = resolveActorClassification(actor);
    if (!canAccess(classification, tool.visibility)) {
      throw new Error(`cognitive_tool_visibility_denied: ${id} (actor=${classification}, tool=${tool.visibility})`);
    }
    if (!actorHasPermissions(actor, tool.permissions)) {
      throw new Error(`cognitive_tool_permission_denied: ${id} (required=${tool.permissions.join(',')})`);
    }

    const startedAt = Date.now();
    try {
      const output = await tool.execute(input || {}, { ...context, tenantId });
      return {
        success: true,
        toolId: id,
        output,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      log.error('[CognitiveToolRegistry] Tool execution failed', {
        toolId: id,
        tenantId,
        error: error.message,
        input: sanitize(input),
      });
      throw error;
    }
  }

  async function rollback(id, input, context, output) {
    const tool = tools.get(id);
    if (!tool || typeof tool.rollback !== 'function') return { supported: false };
    await tool.rollback(input || {}, context || {}, output);
    return { supported: true };
  }

  return { register, get, list, execute, rollback, size: () => tools.size };
}

// ---------------------------------------------------------------------------
// Tools padrão — delegam para serviços reais já existentes no RAP.
// `deps` permite injeção em testes; em runtime os serviços são resolvidos lazy.
// ---------------------------------------------------------------------------

function lazy(deps, key, loader) {
  return deps && deps[key] ? deps[key] : loader();
}

function registerDefaultTools(registry, deps = {}) {
  const svc = {
    marketing: () => lazy(deps, 'marketingService', () => require('../../../../api/services/marketing/marketingService')),
    schedule: () => lazy(deps, 'scheduleService', () => require('../../../../api/services/scheduleService')),
    whatsapp: () => lazy(deps, 'whatsappService', () => require('../../../../api/services/whatsappService')),
    queue: () => lazy(deps, 'queueService', () => require('../../../../api/services/queueService')),
    handover: () => lazy(deps, 'handoverService', () => require('../../../../api/services/handoverService')),
    click2call: () => lazy(deps, 'ccClick2CallService', () => require('../../../../api/services/cc/ccClick2CallService')),
    ccCampaigns: () => lazy(deps, 'ccCampaignsService', () => require('../../../../api/services/cc/ccCampaignsService')),
    workspaceInsight: () => {
      if (deps.workspaceInsightService) return deps.workspaceInsightService;
      const WorkspaceInsightService = require('../../../../api/services/workspace/WorkspaceInsightService');
      return new WorkspaceInsightService();
    },
  };

  registry.register({
    id: 'searchCustomer',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['crm.read'],
    description: 'Busca cliente/lead por telefone, e-mail ou nome (marketingService.listLeads/getLeadById).',
    execute: async (input, context) => {
      const marketing = svc.marketing();
      if (input.leadId) {
        const lead = await marketing.getLeadById({ tenantId: context.tenantId, leadId: input.leadId });
        return { customers: lead ? [lead] : [] };
      }
      const { items } = await marketing.listLeads({ tenantId: context.tenantId, limit: 500, offset: 0 });
      const query = String(input.query || input.phone || input.email || input.name || '').trim().toLowerCase();
      const matches = query
        ? items.filter((lead) => [lead.email, lead.phone, lead.name]
            .some((field) => field && String(field).toLowerCase().includes(query)))
        : items;
      return { customers: matches.slice(0, input.limit || 10) };
    },
  });

  registry.register({
    id: 'createLead',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['crm.write'],
    description: 'Cria lead persistido (marketingService.upsertLead).',
    execute: async (input, context) => {
      const marketing = svc.marketing();
      const lead = await marketing.upsertLead({ ...input, tenantId: context.tenantId });
      return { lead };
    },
  });

  registry.register({
    id: 'updateLead',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['crm.write'],
    description: 'Atualiza lead existente (marketingService.updateLead).',
    execute: async (input, context) => {
      const marketing = svc.marketing();
      const lead = await marketing.updateLead({ ...(input.changes || input), tenantId: context.tenantId, leadId: input.leadId });
      return { lead };
    },
  });

  registry.register({
    id: 'createOpportunity',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['crm.write'],
    description: 'Cria oportunidade vinculada a lead/pipeline (módulo CRM).',
    execute: async (input, context) => {
      if (deps.crmOpportunityService) {
        return { opportunity: await deps.crmOpportunityService.create({ tenantId: context.tenantId, payload: input }) };
      }
      // Sem service layer de opportunities exportado (gap PARTIAL no CRM):
      // erro explícito em vez de simular sucesso.
      throw new Error('cognitive_tool_unavailable: createOpportunity requires CRM opportunity service (see docs/cognitive-core/gap-analysis.md)');
    },
  });

  registry.register({
    id: 'createAppointment',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['agenda.write'],
    description: 'Cria agendamento (scheduleService.createSchedule).',
    execute: async (input, context) => {
      const schedule = svc.schedule();
      return { appointment: schedule.createSchedule({ tenantId: context.tenantId, payload: input }) };
    },
  });

  registry.register({
    id: 'rescheduleAppointment',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['agenda.write'],
    description: 'Reagenda compromisso existente (scheduleService.updateScheduleStatus).',
    execute: async (input, context) => {
      const schedule = svc.schedule();
      return {
        appointment: schedule.updateScheduleStatus({
          tenantId: context.tenantId,
          scheduleId: input.scheduleId,
          action: 'reschedule',
          payload: input,
        }),
      };
    },
  });

  registry.register({
    id: 'cancelAppointment',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['agenda.write'],
    description: 'Cancela compromisso (scheduleService.updateScheduleStatus).',
    execute: async (input, context) => {
      const schedule = svc.schedule();
      return {
        appointment: schedule.updateScheduleStatus({
          tenantId: context.tenantId,
          scheduleId: input.scheduleId,
          action: 'cancel',
          payload: input,
        }),
      };
    },
  });

  registry.register({
    id: 'sendWhatsappMessage',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['channel.send'],
    description: 'Envia mensagem de texto via WhatsApp (whatsappService.sendTextMessage).',
    execute: async (input, context) => {
      const whatsapp = svc.whatsapp();
      if (!input.to || !input.message) throw new Error('cognitive_tool_input_invalid: sendWhatsappMessage requires to/message');
      const result = await whatsapp.sendTextMessage(input.to, input.message);
      return { delivery: result, tenantId: context.tenantId };
    },
  });

  registry.register({
    id: 'createTicket',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['ticket.write'],
    description: 'Abre ticket de atendimento (queueService.createTicket).',
    execute: async (input, context) => {
      const queue = svc.queue();
      const ticket = queue.createTicket({
        tenantId: context.tenantId,
        sessionId: input.sessionId || input.conversationId || null,
        queue: input.queue || 'default',
        lastUserMessage: input.message || '',
        context: input.context || {},
        tags: input.tags || [],
        category: input.category || null,
      });
      return { ticket };
    },
  });

  registry.register({
    id: 'transferConversation',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['conversation.transfer'],
    description: 'Transfere conversa do bot para atendimento humano (handoverService.takeOver).',
    execute: async (input, context) => {
      const handover = svc.handover();
      const ticketId = input.ticketId || input.conversationId;
      if (!ticketId) throw new Error('cognitive_tool_input_invalid: transferConversation requires ticketId');
      const agent = input.agentId || context.actor?.userId || 'cognitive-core';
      const result = await handover.takeOver(ticketId, agent, input.reason || 'cognitive_handoff');
      return { handover: result };
    },
  });

  registry.register({
    id: 'originateCall',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['pbx.call'],
    description: 'Origina chamada click-to-call (ccClick2CallService.createClick2CallRequest).',
    execute: async (input, context) => {
      const click2call = svc.click2call();
      const request = await click2call.createClick2CallRequest({
        tenantKey: context.tenantId,
        payload: {
          target: input.target || input.extension,
          phone: input.phone,
          ddd: input.ddd,
          campaignId: input.campaignId || null,
          extra: input.extra || {},
        },
        actorUserId: context.actor?.userId || null,
      });
      return { call: request };
    },
  });

  registry.register({
    id: 'createCampaign',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['campaign.write'],
    description: 'Cria/atualiza campanha de contact center (ccCampaignsService.upsertCampaign).',
    execute: async (input, context) => {
      const campaigns = svc.ccCampaigns();
      const campaign = await campaigns.upsertCampaign({
        tenantKey: context.tenantId,
        payload: input,
        actorUserId: context.actor?.userId || null,
      });
      return { campaign };
    },
  });

  registry.register({
    id: 'generateInsight',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['workspace.write'],
    description: 'Persiste insight de negócio no Workspace (WorkspaceInsightService.persistInsight).',
    execute: async (input, context) => {
      const insightService = svc.workspaceInsight();
      const insight = await insightService.persistInsight({
        tenantId: context.tenantId,
        entityId: input.entityId,
        insight: insightService.buildInsight({
          type: input.type || 'cognitive',
          description: input.description,
          confidence: input.confidence ?? 0.7,
          source: 'cognitive-core',
          evidence: input.evidence || [],
          severity: input.severity || 'medium',
        }),
      });
      return { insight };
    },
  });

  return registry;
}

module.exports = { createToolRegistry, registerDefaultTools };
