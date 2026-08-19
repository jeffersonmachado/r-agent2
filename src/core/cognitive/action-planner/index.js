'use strict';

/**
 * Action Planner do Cognitive Core.
 *
 * Transforma intenção em plano executável determinístico (templates por intent).
 *
 * Garantias:
 *  - valida tenant
 *  - valida permissões do ator contra as tools do plano (via Tool Registry)
 *  - ações críticas exigem confirmação explícita antes da execução
 *  - ações obrigatórias (requiredAction do outcome contract) NUNCA podem ser
 *    removidas silenciosamente: se negadas, o plano inteiro é rejeitado
 *  - INVARIANTE 4: tools com `sideEffects: true` só executam sob um Outcome
 *    Contract explícito — intents de MUTATION sem contrato são rejeitadas
 *    (`outcome_contract_required`); intents READ_ONLY/INFORMATIONAL têm os
 *    steps com sideEffects negados explicitamente (intents informativas
 *    nunca mutam)
 *  - steps com toolId=null recebem tipagem explícita (CONTEXT_ASSERTION,
 *    DOMAIN_QUERY, etc.) e NUNCA são marcados como resolved_from_context
 *    sem prova
 *  - todo plano gerado é registrado (o orchestrator persiste no execution record)
 */

const crypto = require('crypto');
const { canAccess } = require('../visibility');
const { getOutcomeContract, getIntentClass, INTENT_CLASSES, stepType } = require('../outcome');

/**
 * Templates determinísticos: intent → passos.
 * `toolId: null` indica passo que requer tipagem explícita (ver STEP_TYPE_MAP em outcome/).
 * `required: true` indica passo de negócio obrigatório — se negado, o plano falha.
 * `critical: true` exige `payload.confirmed === true` para executar.
 */
const PLAN_TEMPLATES = {
  criar_lead: [
    { id: 'find_customer', toolId: 'searchCustomer' },
    { id: 'create_lead', toolId: 'createLead', required: true },
  ],
  qualificar_lead: [
    { id: 'find_customer', toolId: 'searchCustomer' },
    { id: 'update_lead', toolId: 'updateLead', required: true },
  ],
  agendar: [
    { id: 'find_customer', toolId: 'searchCustomer' },
    { id: 'check_availability', toolId: 'schedule.findAvailability' },
    { id: 'create_appointment', toolId: 'createAppointment', required: true },
    { id: 'send_confirmation', toolId: 'sendWhatsappMessage', optional: true },
  ],
  remarcar_agendamento: [
    { id: 'find_customer', toolId: 'searchCustomer' },
    { id: 'find_current_appointment', toolId: 'schedule.listAppointments' },
    { id: 'check_availability', toolId: 'schedule.findAvailability' },
    { id: 'reschedule_appointment', toolId: 'rescheduleAppointment', required: true },
    { id: 'notify_professional', toolId: null, optional: true },
    { id: 'send_confirmation', toolId: 'sendWhatsappMessage', optional: true },
  ],
  cancelar_agendamento: [
    { id: 'find_customer', toolId: 'searchCustomer' },
    { id: 'find_current_appointment', toolId: 'schedule.listAppointments' },
    { id: 'cancel_appointment', toolId: 'cancelAppointment', critical: true, required: true },
    { id: 'send_confirmation', toolId: 'sendWhatsappMessage', optional: true },
  ],
  consultar_status: [
    { id: 'find_customer', toolId: 'searchCustomer' },
    { id: 'collect_status', toolId: null, optional: true },
  ],
  abrir_ticket: [
    { id: 'find_customer', toolId: 'searchCustomer' },
    { id: 'create_ticket', toolId: 'createTicket', required: true },
  ],
  transferir_humano: [
    { id: 'transfer_conversation', toolId: 'transferConversation', required: true },
  ],
  enviar_proposta: [
    { id: 'find_customer', toolId: 'searchCustomer' },
    { id: 'create_opportunity', toolId: 'createOpportunity', critical: true, required: true },
    { id: 'send_proposal_message', toolId: 'sendWhatsappMessage' },
  ],
  iniciar_campanha: [
    { id: 'create_campaign', toolId: 'createCampaign', critical: true, required: true },
  ],
  consultar_metricas: [
    { id: 'collect_metrics', toolId: null },
    { id: 'generate_insight', toolId: 'generateInsight', optional: true },
  ],
};

function defaultLogger() {
  return require('../../../../api/utils/logger');
}

function createActionPlanner({ toolRegistry, logger, planTemplates } = {}) {
  if (!toolRegistry) throw new Error('cognitive_planner_registry_required');
  const log = logger || defaultLogger();
  const templates = planTemplates || PLAN_TEMPLATES;

  /**
   * @param {object} args
   * @param {string} args.intent
   * @param {object} [args.entities]
   * @param {object} args.context  contexto do Context Engine (precisa de tenantId)
   * @param {object} [args.actor]  { userId, classification, permissions }
   * @param {object} [args.payload] payload original (confirmed, etc.)
   */
  function plan({ intent, entities = {}, context = {}, actor = {}, payload = {} } = {}) {
    const tenantId = String(context.tenantId || '').trim();
    if (!tenantId) throw new Error('cognitive_planner_tenant_required');

    const template = templates[intent];
    if (!template) throw new Error(`cognitive_planner_unknown_intent: ${intent}`);

    const confirmed = payload.confirmed === true;
    const grantedPermissions = new Set(Array.isArray(actor.permissions) ? actor.permissions : []);
    const wildcard = grantedPermissions.has('*');
    const classification = String(actor.classification || 'PRODUCTION').toUpperCase();

    // Contrato de outcome: identifica a ação obrigatória de negócio
    const outcomeContract = getOutcomeContract(intent);

    const steps = [];
    const denied = [];
    const requiredDenied = [];

    for (const stepTemplate of template) {
      const step = {
        id: stepTemplate.id,
        toolId: stepTemplate.toolId,
        stepType: stepType(stepTemplate.id, stepTemplate.toolId),
        critical: stepTemplate.critical === true,
        optional: stepTemplate.optional === true,
        required: stepTemplate.required === true,
        requiresConfirmation: stepTemplate.critical === true && !confirmed,
      };

      if (step.toolId) {
        const tool = toolRegistry.get(step.toolId);
        if (!tool) {
          const reason = `tool_not_registered: ${step.toolId}`;
          denied.push({ step: step.id, reason });
          if (step.required) requiredDenied.push({ step: step.id, reason });
          continue;
        }
        if (!canAccess(classification, tool.visibility)) {
          const reason = `visibility_denied: ${step.toolId} (${tool.visibility})`;
          denied.push({ step: step.id, reason });
          if (step.required) requiredDenied.push({ step: step.id, reason });
          continue;
        }
        const missing = tool.permissions.filter((perm) => !wildcard && !grantedPermissions.has(perm));
        if (missing.length > 0) {
          const reason = `permission_denied: ${missing.join(',')}`;
          denied.push({ step: step.id, reason });
          if (step.required) requiredDenied.push({ step: step.id, reason });
          continue;
        }
      }

      steps.push(step);
    }

    // P0: Ação obrigatória de negócio foi negada → plano rejeitado
    if (requiredDenied.length > 0) {
      const message = `cognitive_planner_required_action_denied: ${intent} — ${requiredDenied.map((d) => `${d.step}: ${d.reason}`).join('; ')}`;
      log.error('[CognitiveActionPlanner] Required business action denied', {
        tenantId, intent, requiredDenied,
      });
      const err = new Error(message);
      err.code = 'required_action_denied';
      err.requiredDenied = requiredDenied;
      err.outcomeContract = outcomeContract ? outcomeContract.requiredAction : null;
      throw err;
    }

    // INVARIANTE 4 (NO EXPLICIT BUSINESS OUTCOME → NO BUSINESS SUCCESS):
    // tool com sideEffects só pode ser invocada sob Outcome Contract explícito.
    //  - Intent de MUTATION sem contrato → plano rejeitado (outcome_contract_required).
    //  - Intent READ_ONLY/INFORMATIONAL → step com sideEffects negado
    //    explicitamente: intents informativas nunca executam mutações.
    const intentClass = getIntentClass(intent);
    const allowedSteps = [];
    for (const step of steps) {
      if (!outcomeContract && step.toolId) {
        const tool = toolRegistry.get(step.toolId);
        if (tool && tool.sideEffects === true) {
          if (intentClass === INTENT_CLASSES.MUTATION) {
            const message = `cognitive_planner_outcome_contract_required: ${intent} invoca tool com sideEffects (${step.toolId}) sem Outcome Contract`;
            log.error('[CognitiveActionPlanner] Side-effect tool without outcome contract', {
              tenantId, intent, toolId: step.toolId,
            });
            const err = new Error(message);
            err.code = 'outcome_contract_required';
            err.intent = intent;
            err.toolId = step.toolId;
            throw err;
          }
          denied.push({ step: step.id, reason: `side_effect_denied_in_${intentClass.toLowerCase()}_intent: ${step.toolId}` });
          continue;
        }
      }
      allowedSteps.push(step);
    }
    steps.length = 0;
    steps.push(...allowedSteps);

    if (denied.length > 0) {
      log.warn('[CognitiveActionPlanner] Steps denied during planning', { tenantId, intent, denied });
    }

    const mandatorySteps = steps.filter((s) => !s.optional);
    if (mandatorySteps.length === 0) {
      throw new Error(`cognitive_planner_no_executable_steps: ${intent} (denied=${denied.map((d) => d.reason).join('; ')})`);
    }

    const generatedPlan = {
      planId: crypto.randomUUID(),
      tenantId,
      intent,
      entities,
      steps,
      denied,
      deterministic: true,
      requiresConfirmation: steps.some((s) => s.requiresConfirmation),
      createdAt: new Date().toISOString(),
    };

    log.info('[CognitiveActionPlanner] Plan generated', {
      tenantId,
      intent,
      planId: generatedPlan.planId,
      steps: steps.map((s) => s.id),
      requiresConfirmation: generatedPlan.requiresConfirmation,
    });

    return generatedPlan;
  }

  return { plan };
}

module.exports = { createActionPlanner, PLAN_TEMPLATES };
