'use strict';

/**
 * Tool Registry do Cognitive Core — Capability Kernel.
 *
 * Toda ação de negócio executada pela plataforma passa por aqui — nenhuma
 * execução direta de serviço a partir do pipeline cognitivo é permitida.
 * Este registry é também a FONTE DA VERDADE para o MCP Server Adapter:
 * uma alteração de assinatura aqui é detectável por todos os consumidores.
 *
 * Contrato CognitiveTool (backward compatible — campos novos são opcionais):
 *   {
 *     id: 'namespace.actionName',          // id canônico estável
 *     aliases: ['legacyName'],             // ids legados (deprecated)
 *     capability: 'schedule.manage',       // capability canônica de negócio
 *     visibility: 'PRODUCTION'|'SUPPORT'|'DEVELOPMENT',
 *     permissions: string[],
 *     description,
 *     inputSchema?: JSON Schema,           // validado com AJV antes do serviço
 *     outputSchema?: JSON Schema,          // validado após o serviço
 *     riskLevel?: 'low'|'medium'|'high',
 *     sideEffects?: boolean,
 *     confirmationPolicy?: 'autonomous'|'policy_based'|'confirmation_required',
 *     idempotencyPolicy?: 'none'|'recommended'|'required',
 *     retryPolicy?: object, timeoutPolicy?: object,
 *     auditPolicy?: object, redactionPolicy?: object,
 *     version?: string,
 *     executionMode?: 'atomic'|'durable',
 *     execute(input, context),
 *     rollback?(input, context, output),
 *   }
 *
 * Validações obrigatórias em execução: tenant, permissionamento, visibility,
 * input schema e (para tools com sideEffects + idempotencyPolicy 'required')
 * propagação de idempotencyKey. As tools delegam para serviços já existentes
 * do RAP (não duplicam domínio).
 */

const { sanitize } = require('../sanitize');
const { VISIBILITY, isValidVisibility, canAccess } = require('../visibility');

const RISK_LEVELS = Object.freeze(['low', 'medium', 'high']);
const CONFIRMATION_POLICIES = Object.freeze(['autonomous', 'policy_based', 'confirmation_required']);
const IDEMPOTENCY_POLICIES = Object.freeze(['none', 'recommended', 'required']);
const EXECUTION_MODES = Object.freeze(['atomic', 'durable']);

function defaultLogger() {
  // Lazy para não acoplar carga do logger em testes puros.
  return require('../../../../api/utils/logger');
}

let ajvInstance = null;

/** AJV já é dependência do projeto — reutilizado para validação de schemas. */
function getAjv() {
  if (!ajvInstance) {
    try {
      const Ajv = require('ajv');
      ajvInstance = new Ajv({ allErrors: true, strict: false });
    } catch (error) {
      throw new Error(`configuration_missing: ajv indisponível para validação de tool schemas (${error.message})`);
    }
  }
  return ajvInstance;
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

  // Campos opcionais do Capability Kernel — validados quando presentes.
  if (tool.aliases !== undefined && !Array.isArray(tool.aliases)) {
    throw new Error(`cognitive_tool_invalid: aliases must be an array (tool=${tool.id})`);
  }
  if (tool.capability !== undefined && typeof tool.capability !== 'string') {
    throw new Error(`cognitive_tool_invalid: capability must be a string (tool=${tool.id})`);
  }
  if (tool.riskLevel !== undefined && !RISK_LEVELS.includes(tool.riskLevel)) {
    throw new Error(`cognitive_tool_invalid: riskLevel must be ${RISK_LEVELS.join('|')} (tool=${tool.id})`);
  }
  if (tool.confirmationPolicy !== undefined && !CONFIRMATION_POLICIES.includes(tool.confirmationPolicy)) {
    throw new Error(`cognitive_tool_invalid: confirmationPolicy inválida (tool=${tool.id})`);
  }
  if (tool.idempotencyPolicy !== undefined && !IDEMPOTENCY_POLICIES.includes(tool.idempotencyPolicy)) {
    throw new Error(`cognitive_tool_invalid: idempotencyPolicy inválida (tool=${tool.id})`);
  }
  if (tool.executionMode !== undefined && !EXECUTION_MODES.includes(tool.executionMode)) {
    throw new Error(`cognitive_tool_invalid: executionMode must be atomic|durable (tool=${tool.id})`);
  }
  if (tool.inputSchema !== undefined && (typeof tool.inputSchema !== 'object' || tool.inputSchema === null)) {
    throw new Error(`cognitive_tool_invalid: inputSchema must be a JSON Schema object (tool=${tool.id})`);
  }
  if (tool.outputSchema !== undefined && (typeof tool.outputSchema !== 'object' || tool.outputSchema === null)) {
    throw new Error(`cognitive_tool_invalid: outputSchema must be a JSON Schema object (tool=${tool.id})`);
  }
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
  const aliases = new Map();
  const schemaCache = new Map();
  const log = logger || defaultLogger();

  function compileSchema(toolId, kind, schema) {
    const key = `${toolId}:${kind}`;
    if (!schemaCache.has(key)) {
      schemaCache.set(key, getAjv().compile(schema));
    }
    return schemaCache.get(key);
  }

  function register(tool) {
    assertToolShape(tool);
    if (tools.has(tool.id)) throw new Error(`cognitive_tool_duplicate: ${tool.id}`);
    if (aliases.has(tool.id)) throw new Error(`cognitive_tool_duplicate: ${tool.id} colide com alias existente`);
    for (const alias of tool.aliases || []) {
      if (tools.has(alias) || aliases.has(alias)) {
        throw new Error(`cognitive_tool_duplicate: alias ${alias} (tool=${tool.id})`);
      }
    }
    tools.set(tool.id, tool);
    for (const alias of tool.aliases || []) aliases.set(alias, tool.id);
    return tool;
  }

  function resolveId(id) {
    if (tools.has(id)) return id;
    const canonical = aliases.get(id);
    if (canonical) {
      log.warn('[CognitiveToolRegistry] Alias legado em uso (deprecated)', { alias: id, canonical });
      return canonical;
    }
    return null;
  }

  function get(id) {
    const canonical = resolveId(id);
    return canonical ? tools.get(canonical) : null;
  }

  /**
   * Lista tools visíveis para o ator (somente ids canônicos; aliases nunca
   * são listados). PRODUCTION nunca enxerga SUPPORT/DEVELOPMENT.
   * P1: Quando actor.permissions é fornecido, filtra também por permissões.
   * Se permissions não é fornecido, apenas visibility é aplicada (a execução
   * sempre valida permissions).
   */
  function list(actor = {}) {
    const classification = resolveActorClassification(actor);
    const hasPermissions = Array.isArray(actor.permissions) && actor.permissions.length > 0;
    const grantedPermissions = new Set(hasPermissions ? actor.permissions : []);
    const wildcard = grantedPermissions.has('*');

    return Array.from(tools.values())
      .filter((tool) => canAccess(classification, tool.visibility))
      .filter((tool) => {
        // P1: Se o ator tem permissões declaradas, filtra por elas.
        // Se não tem, mostra todas (a execução valida permissions).
        if (!hasPermissions) return true;
        if (tool.permissions.length === 0) return true;
        if (wildcard) return true;
        return tool.permissions.every((perm) => grantedPermissions.has(perm));
      })
      .map((tool) => ({
        id: tool.id,
        capability: tool.capability || null,
        visibility: tool.visibility,
        permissions: [...tool.permissions],
        description: tool.description,
        riskLevel: tool.riskLevel || 'low',
        sideEffects: tool.sideEffects === true,
        confirmationPolicy: tool.confirmationPolicy || 'autonomous',
        idempotencyPolicy: tool.idempotencyPolicy || 'none',
        executionMode: tool.executionMode || 'atomic',
        version: tool.version || '1.0.0',
        inputSchema: tool.inputSchema || null,
        outputSchema: tool.outputSchema || null,
      }));
  }

  /**
   * Executa uma tool com validação de tenant, visibility, permissionamento,
   * input schema e política de idempotência. Valida output schema quando
   * declarado. Aliases legados resolvem para o id canônico.
   */
  async function execute(id, input, context = {}) {
    const canonicalId = resolveId(id);
    const tool = canonicalId ? tools.get(canonicalId) : null;
    if (!tool) throw new Error(`cognitive_tool_not_found: ${id}`);

    const tenantId = String(context.tenantId || '').trim();
    if (!tenantId) throw new Error(`cognitive_tool_tenant_required: ${canonicalId}`);

    const actor = context.actor || {};
    const classification = resolveActorClassification(actor);
    if (!canAccess(classification, tool.visibility)) {
      throw new Error(`cognitive_tool_visibility_denied: ${canonicalId} (actor=${classification}, tool=${tool.visibility})`);
    }
    if (!actorHasPermissions(actor, tool.permissions)) {
      throw new Error(`cognitive_tool_permission_denied: ${canonicalId} (required=${tool.permissions.join(',')})`);
    }

    // Input schema falha ANTES de tocar o serviço de domínio.
    if (tool.inputSchema) {
      const validate = compileSchema(canonicalId, 'input', tool.inputSchema);
      if (!validate(input || {})) {
        const detail = (validate.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
        throw new Error(`cognitive_tool_input_invalid: ${canonicalId} (${detail})`);
      }
    }

    // Side effect com idempotência obrigatória exige chave propagada.
    if (tool.sideEffects === true && tool.idempotencyPolicy === 'required' && !context.idempotencyKey) {
      throw new Error(`cognitive_tool_idempotency_key_required: ${canonicalId}`);
    }

    // P0: Enforcement de confirmationPolicy — proteção no Capability Kernel.
    // NENHUM caminho (Planner, MCP Server, MCP Client, Process Runtime, API)
    // pode bypassar esta verificação.
    if (tool.confirmationPolicy === 'confirmation_required' && !context.confirmed) {
      const err = new Error(`cognitive_tool_confirmation_required: ${canonicalId}`);
      err.code = 'confirmation_required';
      err.toolId = canonicalId;
      throw err;
    }

    // P0: policy_based enforcement — combina tool policy + specialist context.
    // Usa resolveConfirmationRequirement do specialist-context se specialistContext disponível.
    if (tool.confirmationPolicy === 'policy_based' && !context.confirmed) {
      let requiresConfirmation = true;
      let policyReason = 'policy_based_default_deny';
      if (context.specialistContext) {
        try {
          const { resolveConfirmationRequirement } = require('../specialist-context');
          const resolved = resolveConfirmationRequirement(tool, context.specialistContext);
          requiresConfirmation = resolved.requiresConfirmation;
          policyReason = resolved.reason;
        } catch (_) {
          // Se resolver falhar, fail closed — exige confirmação.
        }
      } else {
        // Sem specialistContext: policy_based com low risk → permite (autônomo por default).
        // Medium/high risk → exige confirmação.
        const toolRisk = tool.riskLevel || 'low';
        if (toolRisk === 'low') {
          requiresConfirmation = false;
          policyReason = 'policy_based_low_risk_no_specialist';
        } else {
          policyReason = `policy_based_${toolRisk}_risk_no_specialist`;
        }
      }
      if (requiresConfirmation) {
        const err = new Error(`cognitive_tool_policy_denied: ${canonicalId} (${policyReason})`);
        err.code = 'policy_denied';
        err.toolId = canonicalId;
        err.policyReason = policyReason;
        throw err;
      }
    }

    const startedAt = Date.now();
    try {
      const output = await tool.execute(input || {}, {
        ...context,
        tenantId,
        toolId: canonicalId,
        requestedToolId: id,
      });

      if (tool.outputSchema) {
        const validateOut = compileSchema(canonicalId, 'output', tool.outputSchema);
        if (!validateOut(output)) {
          const detail = (validateOut.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
          throw new Error(`cognitive_tool_output_invalid: ${canonicalId} (${detail})`);
        }
      }

      return {
        success: true,
        toolId: canonicalId,
        requestedToolId: id,
        output,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      log.error('[CognitiveToolRegistry] Tool execution failed', {
        toolId: canonicalId,
        tenantId,
        error: error.message,
        input: sanitize(input),
      });
      throw error;
    }
  }

  async function rollback(id, input, context, output) {
    const tool = get(id);
    if (!tool || typeof tool.rollback !== 'function') return { supported: false };
    await tool.rollback(input || {}, context || {}, output);
    return { supported: true };
  }

  return {
    register,
    get,
    resolveId,
    list,
    execute,
    rollback,
    size: () => tools.size,
    isAlias: (id) => aliases.has(id),
  };
}

// ---------------------------------------------------------------------------
// Tools padrão — ids canônicos namespacados, aliases para nomes legados.
// Delegam para serviços reais já existentes no RAP.
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
    rag: () => lazy(deps, 'ragService', () => require('../../../../api/services/ragService')),
    testExecution: () => lazy(deps, 'testExecutionService', () => require('../../../../api/services/testExecutionService')),
    qaWaves: () => lazy(deps, 'qaWavesService', () => require('../../../../api/services/qaWavesService')),
    workspaceInsight: () => {
      if (deps.workspaceInsightService) return deps.workspaceInsightService;
      const WorkspaceInsightService = require('../../../../api/services/workspace/WorkspaceInsightService');
      return new WorkspaceInsightService();
    },
  };

  registry.register({
    id: 'crm.searchCustomer',
    aliases: ['searchCustomer'],
    capability: 'crm.read',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['crm.read'],
    description: 'Busca cliente/lead por telefone, e-mail ou nome (marketingService.listLeads/getLeadById).',
    riskLevel: 'low',
    sideEffects: false,
    confirmationPolicy: 'autonomous',
    idempotencyPolicy: 'none',
    inputSchema: {
      type: 'object',
      properties: {
        leadId: { type: 'string' },
        query: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        name: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: true,
    },
    outputSchema: {
      type: 'object',
      required: ['customers'],
      properties: { customers: { type: 'array' } },
    },
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
    id: 'crm.createLead',
    aliases: ['createLead'],
    capability: 'crm.write',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['crm.write'],
    description: 'Cria lead persistido (marketingService.upsertLead).',
    riskLevel: 'medium',
    sideEffects: true,
    confirmationPolicy: 'autonomous',
    idempotencyPolicy: 'required',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string', minLength: 1 } },
      additionalProperties: true,
    },
    execute: async (input, context) => {
      const marketing = svc.marketing();
      const lead = await marketing.upsertLead({ ...input, tenantId: context.tenantId });
      return { lead };
    },
  });

  registry.register({
    id: 'crm.updateLead',
    aliases: ['updateLead'],
    capability: 'crm.write',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['crm.write'],
    description: 'Atualiza lead existente (marketingService.updateLead).',
    riskLevel: 'medium',
    sideEffects: true,
    confirmationPolicy: 'autonomous',
    idempotencyPolicy: 'required',
    inputSchema: {
      type: 'object',
      required: ['leadId'],
      properties: { leadId: { type: 'string', minLength: 1 } },
      additionalProperties: true,
    },
    execute: async (input, context) => {
      const marketing = svc.marketing();
      const lead = await marketing.updateLead({ ...(input.changes || input), tenantId: context.tenantId, leadId: input.leadId });
      return { lead };
    },
  });

  registry.register({
    id: 'crm.createOpportunity',
    aliases: ['createOpportunity'],
    capability: 'crm.opportunity',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['crm.write'],
    description: 'Cria oportunidade vinculada a lead/pipeline (módulo CRM).',
    riskLevel: 'high',
    sideEffects: true,
    confirmationPolicy: 'confirmation_required',
    idempotencyPolicy: 'required',
    execute: async (input, context) => {
      if (deps.crmOpportunityService) {
        return { opportunity: await deps.crmOpportunityService.create({ tenantId: context.tenantId, payload: input }) };
      }
      // Sem service layer de opportunities exportado (gap PARTIAL no CRM):
      // erro explícito em vez de simular sucesso.
      throw new Error('cognitive_tool_unavailable: crm.createOpportunity requires CRM opportunity service (see docs/cognitive-core/gap-analysis.md)');
    },
  });

  registry.register({
    id: 'schedule.listAppointments',
    capability: 'schedule.read',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['agenda.read'],
    description: 'Lista compromissos do tenant (scheduleService.listSchedules).',
    riskLevel: 'low',
    sideEffects: false,
    confirmationPolicy: 'autonomous',
    idempotencyPolicy: 'none',
    inputSchema: {
      type: 'object',
      properties: { scheduleId: { type: 'string' } },
      additionalProperties: true,
    },
    execute: async (input, context) => {
      const schedule = svc.schedule();
      if (input.scheduleId) {
        return { appointments: [schedule.getSchedule({ tenantId: context.tenantId, scheduleId: input.scheduleId })] };
      }
      return { appointments: schedule.listSchedules({ tenantId: context.tenantId, filters: input.filters || {} }) };
    },
  });

  registry.register({
    id: 'schedule.findAvailability',
    capability: 'schedule.read',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['agenda.read'],
    description: 'Verifica disponibilidade de horários (scheduleService.listSchedules).',
    riskLevel: 'low',
    sideEffects: false,
    confirmationPolicy: 'autonomous',
    idempotencyPolicy: 'none',
    inputSchema: {
      type: 'object',
      properties: {
        startAt: { type: 'string' },
        endAt: { type: 'string' },
        contextType: { type: 'string' },
      },
      additionalProperties: true,
    },
    execute: async (input, context) => {
      const schedule = svc.schedule();
      const existing = schedule.listSchedules({
        tenantId: context.tenantId,
        contextType: input.contextType || null,
      });
      const requestedStart = input.startAt ? new Date(input.startAt).getTime() : null;
      const requestedEnd = input.endAt ? new Date(input.endAt).getTime() : null;
      const conflicts = (existing.items || []).filter((item) => {
        if (item.status === 'cancelled') return false;
        const itemStart = new Date(item.startAt).getTime();
        const itemEnd = new Date(item.endAt).getTime();
        if (requestedStart && requestedEnd) {
          return itemStart < requestedEnd && itemEnd > requestedStart;
        }
        return false;
      });
      return {
        available: conflicts.length === 0,
        conflictsCount: conflicts.length,
        existingAppointments: existing.total || 0,
        conflicts: conflicts.slice(0, 5).map((c) => ({ id: c.id, startAt: c.startAt, endAt: c.endAt })),
      };
    },
  });

  registry.register({
    id: 'schedule.createAppointment',
    aliases: ['createAppointment'],
    capability: 'schedule.manage',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['agenda.write'],
    description: 'Cria agendamento (scheduleService.createSchedule).',
    riskLevel: 'medium',
    sideEffects: true,
    confirmationPolicy: 'autonomous',
    idempotencyPolicy: 'required',
    execute: async (input, context) => {
      const schedule = svc.schedule();
      return { appointment: schedule.createSchedule({ tenantId: context.tenantId, payload: input }) };
    },
  });

  registry.register({
    id: 'schedule.rescheduleAppointment',
    aliases: ['rescheduleAppointment'],
    capability: 'schedule.manage',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['agenda.write'],
    description: 'Reagenda compromisso existente (scheduleService.updateScheduleStatus).',
    riskLevel: 'medium',
    sideEffects: true,
    confirmationPolicy: 'policy_based',
    idempotencyPolicy: 'required',
    inputSchema: {
      type: 'object',
      required: ['scheduleId'],
      properties: { scheduleId: { type: 'string', minLength: 1 } },
      additionalProperties: true,
    },
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
    id: 'schedule.cancelAppointment',
    aliases: ['cancelAppointment'],
    capability: 'schedule.manage',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['agenda.write'],
    description: 'Cancela compromisso (scheduleService.updateScheduleStatus).',
    riskLevel: 'medium',
    sideEffects: true,
    confirmationPolicy: 'policy_based',
    idempotencyPolicy: 'required',
    inputSchema: {
      type: 'object',
      required: ['scheduleId'],
      properties: { scheduleId: { type: 'string', minLength: 1 } },
      additionalProperties: true,
    },
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
    id: 'messaging.sendWhatsAppMessage',
    aliases: ['sendWhatsappMessage'],
    capability: 'messaging.send',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['channel.send'],
    description: 'Envia mensagem de texto via WhatsApp (whatsappService.sendTextMessage).',
    riskLevel: 'medium',
    sideEffects: true,
    confirmationPolicy: 'autonomous',
    idempotencyPolicy: 'required',
    inputSchema: {
      type: 'object',
      required: ['to', 'message'],
      properties: {
        to: { type: 'string', minLength: 5 },
        message: { type: 'string', minLength: 1 },
      },
      additionalProperties: true,
    },
    execute: async (input, context) => {
      const whatsapp = svc.whatsapp();
      if (!input.to || !input.message) throw new Error('cognitive_tool_input_invalid: messaging.sendWhatsAppMessage requires to/message');
      const result = await whatsapp.sendTextMessage(input.to, input.message);
      return { delivery: result, tenantId: context.tenantId };
    },
  });

  registry.register({
    id: 'support.createTicket',
    aliases: ['createTicket'],
    capability: 'ticket.manage',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['ticket.write'],
    description: 'Abre ticket de atendimento (queueService.createTicket).',
    riskLevel: 'medium',
    sideEffects: true,
    confirmationPolicy: 'autonomous',
    idempotencyPolicy: 'required',
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
    id: 'support.transferConversation',
    aliases: ['transferConversation'],
    capability: 'ticket.manage',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['conversation.transfer'],
    description: 'Transfere conversa do bot para atendimento humano (handoverService.takeOver).',
    riskLevel: 'medium',
    sideEffects: true,
    confirmationPolicy: 'autonomous',
    idempotencyPolicy: 'required',
    execute: async (input, context) => {
      const handover = svc.handover();
      const ticketId = input.ticketId || input.conversationId;
      if (!ticketId) throw new Error('cognitive_tool_input_invalid: support.transferConversation requires ticketId');
      const agent = input.agentId || context.actor?.userId || 'cognitive-core';
      const result = await handover.takeOver(ticketId, agent, input.reason || 'cognitive_handoff');
      return { handover: result };
    },
  });

  registry.register({
    id: 'voice.originateCall',
    aliases: ['originateCall'],
    capability: 'voice.call',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['pbx.call'],
    description: 'Origina chamada click-to-call (ccClick2CallService.createClick2CallRequest).',
    riskLevel: 'high',
    sideEffects: true,
    confirmationPolicy: 'policy_based',
    idempotencyPolicy: 'required',
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
    id: 'campaign.createCampaign',
    aliases: ['createCampaign'],
    capability: 'campaign.manage',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['campaign.write'],
    description: 'Cria/atualiza campanha de contact center (ccCampaignsService.upsertCampaign).',
    riskLevel: 'high',
    sideEffects: true,
    confirmationPolicy: 'confirmation_required',
    idempotencyPolicy: 'required',
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
    id: 'workspace.generateInsight',
    aliases: ['generateInsight'],
    capability: 'workspace.insight',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['workspace.write'],
    description: 'Persiste insight de negócio no Workspace (WorkspaceInsightService.persistInsight).',
    riskLevel: 'low',
    sideEffects: true,
    confirmationPolicy: 'autonomous',
    idempotencyPolicy: 'required',
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

  registry.register({
    id: 'knowledge.searchOperational',
    capability: 'knowledge.operational',
    visibility: VISIBILITY.PRODUCTION,
    permissions: ['knowledge.read'],
    description: 'Busca conhecimento operacional do tenant (RAG domínio OPERATIONAL; o Domain Router decide o escopo — nunca o input).',
    riskLevel: 'low',
    sideEffects: false,
    confirmationPolicy: 'autonomous',
    idempotencyPolicy: 'none',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string', minLength: 1 } },
      additionalProperties: true,
    },
    execute: async (input, context) => {
      const rag = svc.rag();
      const result = await rag.queryRag(String(input.query), context.tenantId, { actor: context.actor || null }, {});
      if (result && result.success === false) {
        throw new Error(`cognitive_tool_unavailable: knowledge.searchOperational denied (${result.reason || result.error})`);
      }
      return { answer: result.response || null, sources: result.sources || [], confidence: result.confidence ?? null };
    },
  });

  registry.register({
    id: 'knowledge.searchSystem',
    capability: 'knowledge.system',
    visibility: VISIBILITY.SUPPORT,
    permissions: ['knowledge.system'],
    description: 'Busca conhecimento de plataforma (RAG domínio SYSTEM; escopo calculado pelo Domain Router conforme classificação do ator).',
    riskLevel: 'low',
    sideEffects: false,
    confirmationPolicy: 'autonomous',
    idempotencyPolicy: 'none',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string', minLength: 1 } },
      additionalProperties: true,
    },
    execute: async (input, context) => {
      const rag = svc.rag();
      const result = await rag.queryRag(
        String(input.query),
        context.tenantId,
        { actor: context.actor || null },
        { domain: 'SYSTEM' },
      );
      if (result && result.success === false) {
        throw new Error(`cognitive_tool_unavailable: knowledge.searchSystem denied (${result.reason || result.error})`);
      }
      return { answer: result.response || null, sources: result.sources || [], confidence: result.confidence ?? null };
    },
  });

  registry.register({
    id: 'audit.listReplays',
    aliases: ['listReplays'],
    capability: 'audit.replay',
    visibility: VISIBILITY.SUPPORT,
    permissions: ['audit.replay'],
    description: 'Lista replays diagnósticos para auditoria/suporte (testExecutionService.listReplayFiles).',
    riskLevel: 'low',
    sideEffects: false,
    confirmationPolicy: 'autonomous',
    idempotencyPolicy: 'none',
    execute: async (input, context) => {
      const testExecution = svc.testExecution();
      const replays = await testExecution.listReplayFiles(input.query || input || {});
      return { replays };
    },
  });

  registry.register({
    id: 'qa.getWaveStatus',
    capability: 'qa.waves',
    visibility: VISIBILITY.DEVELOPMENT,
    permissions: ['qa.waves'],
    description: 'Consulta status de execução de QA Wave (engenharia; qaWavesService.getExecutionStatus).',
    riskLevel: 'low',
    sideEffects: false,
    confirmationPolicy: 'autonomous',
    idempotencyPolicy: 'none',
    inputSchema: {
      type: 'object',
      required: ['executionId'],
      properties: { executionId: { type: 'string', minLength: 1 } },
      additionalProperties: true,
    },
    execute: async (input, context) => {
      const qaWaves = svc.qaWaves();
      return { waveStatus: await qaWaves.getExecutionStatus(input.executionId) };
    },
  });

  return registry;
}

module.exports = { createToolRegistry, registerDefaultTools };
