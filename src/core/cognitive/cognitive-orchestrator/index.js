'use strict';

/**
 * Cognitive Orchestrator — núcleo obrigatório do RAP.
 *
 * Fluxo obrigatório:
 *
 *   INPUT → CONTEXT ENGINE → INTENT ENGINE → ACTION PLANNER →
 *   EXECUTION ENGINE → VALIDATION ENGINE → LEARNING ENGINE
 *
 * API: cognitiveOrchestrator.process({ tenantId, channel, userId, message, eventType, payload })
 *
 * Toda execução gera registro estruturado com os campos mínimos:
 * executionId, tenantId, channel, intent, confidence, plan, toolsExecuted,
 * result, latencyMs, fallback, humanHandoff, createdAt.
 *
 * O retorno para a camada operacional contém apenas resultado de negócio —
 * nunca engines internas, QA, replay, seeds, mesh ou RPA.
 */

const crypto = require('crypto');

const { createContextEngine } = require('../context-engine');
const { createIntentEngine } = require('../intent-engine');
const { createActionPlanner } = require('../action-planner');
const { createExecutionEngine } = require('../execution-engine');
const { createValidationEngine } = require('../validation-engine');
const { createLearningEngine } = require('../learning-engine');
const { createToolRegistry, registerDefaultTools } = require('../tool-registry');
const { sanitize } = require('../sanitize');

function defaultLogger() {
  return require('../../../../api/utils/logger');
}

function createCognitiveOrchestrator(deps = {}) {
  const log = deps.logger || defaultLogger();

  const toolRegistry = deps.toolRegistry || registerDefaultTools(createToolRegistry({ logger: log }), deps.toolDeps || {});
  const contextEngine = deps.contextEngine || createContextEngine({ logger: log, resolvers: deps.contextResolvers });
  const intentEngine = deps.intentEngine || createIntentEngine({ logger: log, generateAiResponse: deps.generateAiResponse, llmEnabled: deps.llmEnabled !== false });
  const actionPlanner = deps.actionPlanner || createActionPlanner({ toolRegistry, logger: log });
  const executionEngine = deps.executionEngine || createExecutionEngine({ toolRegistry, logger: log });
  const validationEngine = deps.validationEngine || createValidationEngine({ logger: log });
  const learningEngine = deps.learningEngine || createLearningEngine({ logger: log });

  /**
   * Constrói entradas por passo a partir de payload/entities/contexto.
   * `payload.stepInputs` permite entradas explícitas por passo.
   */
  function buildStepInputs({ payload = {}, entities = {}, input = {} }) {
    return {
      shared: { ...entities, ...(payload.data || {}) },
      ...(payload.stepInputs || {}),
      ...(input || {}),
    };
  }

  /**
   * @param {object} args
   * @param {string} args.tenantId   obrigatório
   * @param {string} [args.channel]  whatsapp | inbox | voice | api | workspace ...
   * @param {string} [args.userId]
   * @param {string} [args.message]  texto livre do cliente/operador
   * @param {string} [args.eventType] tipo de evento estruturado
   * @param {object} [args.payload]  dados do evento (confirmed, stepInputs, intent explícito, ...)
   * @param {object} [args.actor]    { userId, classification, permissions } — default PRODUCTION
   */
  async function process(args = {}) {
    const startedAt = Date.now();
    const executionId = crypto.randomUUID();
    const tenantId = String(args.tenantId || '').trim();
    if (!tenantId) throw new Error('cognitive_orchestrator_tenant_required');

    const channel = args.channel || 'api';
    const payload = args.payload || {};
    const actor = args.actor || { userId: args.userId || null, classification: 'PRODUCTION', permissions: ['*'] };

    let context = null;
    let intentResult = null;
    let plan = null;
    let execution = null;
    let validation = null;
    let status = 'completed';

    try {
      // 1. CONTEXT ENGINE
      context = await contextEngine.buildContext({
        tenantId,
        channel,
        userId: args.userId || null,
        customerId: payload.customerId || null,
        conversationId: payload.conversationId || null,
        message: args.message || null,
        payload,
      });

      // 2. INTENT ENGINE
      intentResult = await intentEngine.classify({
        tenantId,
        message: args.message,
        eventType: args.eventType,
        payload,
        context,
      });

      // Handoff por baixa confiança sem referência de conversa: sinaliza para a
      // operação sem executar tools (não há o que transferir).
      const conversationRef = payload.ticketId || payload.conversationId || null;
      if (intentResult.fallback && !conversationRef) {
        status = 'human_handoff_requested';
        execution = { planId: null, tenantId, status, steps: [], toolsExecuted: [], haltReason: intentResult.rationale, failure: null };
        validation = { valid: true, checks: [] };
      } else {
        // 3. ACTION PLANNER
        plan = actionPlanner.plan({
          intent: intentResult.intent,
          entities: intentResult.entities,
          context,
          actor,
          payload,
        });

        // 4. EXECUTION ENGINE
        execution = await executionEngine.execute({
          plan,
          context,
          actor,
          input: buildStepInputs({ payload, entities: intentResult.entities, input: args.input }),
        });
        status = execution.status;

        // 5. VALIDATION ENGINE (interno — nunca exposto à operação)
        validation = validationEngine.validate({ plan, execution, context });
        if (!validation.valid && status === 'completed') {
          status = 'completed_with_validation_warnings';
        }
      }
    } catch (error) {
      status = 'failed';
      execution = execution || { planId: plan?.planId || null, tenantId, status: 'failed', steps: [], toolsExecuted: [], failure: { error: error.message } };
      execution.failure = execution.failure || { error: error.message };
      validation = validation || { valid: false, checks: [{ name: 'pipeline_error', passed: false, detail: error.message }] };
      log.error('[CognitiveOrchestrator] Pipeline error', { tenantId, executionId, error: error.message });
    }

    const latencyMs = Date.now() - startedAt;

    // Registro estruturado obrigatório (auditável, multi-tenant, sanitizado).
    const executionRecord = {
      executionId,
      tenantId,
      channel,
      userId: args.userId || null,
      eventType: args.eventType || null,
      intent: intentResult?.intent || null,
      confidence: intentResult?.confidence ?? null,
      intentSource: intentResult?.source || null,
      intentRationale: intentResult?.rationale || null,
      plan: plan ? { planId: plan.planId, intent: plan.intent, steps: plan.steps.map((s) => s.id), requiresConfirmation: plan.requiresConfirmation, denied: plan.denied } : null,
      toolsExecuted: execution?.toolsExecuted || [],
      result: {
        status,
        failure: execution?.failure ? sanitize(execution.failure) : null,
        haltReason: execution?.haltReason || null,
      },
      validation: validation ? { valid: validation.valid, failedChecks: validation.checks.filter((c) => !c.passed).map((c) => c.name) } : null,
      contextTrace: context?.trace || null,
      latencyMs,
      fallback: intentResult?.fallback === true,
      humanHandoff: intentResult?.humanHandoff === true || status === 'human_handoff_requested',
      createdAt: new Date().toISOString(),
    };

    log.info('[CognitiveOrchestrator] Execution record', sanitize(executionRecord));

    // 6. LEARNING ENGINE (best-effort, nunca quebra o fluxo de negócio)
    try {
      await learningEngine.record(executionRecord);
    } catch (error) {
      log.warn('[CognitiveOrchestrator] Learning record failed (best-effort)', {
        tenantId, executionId, error: error.message,
      });
    }

    // Resposta de negócio: apenas resultados, sem engines internas.
    return {
      executionId,
      tenantId,
      status,
      intent: executionRecord.intent,
      confidence: executionRecord.confidence,
      humanHandoff: executionRecord.humanHandoff,
      fallback: executionRecord.fallback,
      requiresConfirmation: status === 'halted_awaiting_confirmation',
      outputs: (execution?.steps || [])
        .filter((s) => s.status === 'executed')
        .map((s) => ({ step: s.id, output: s.output })),
      latencyMs,
    };
  }

  return { process, toolRegistry, _engines: { contextEngine, intentEngine, actionPlanner, executionEngine, validationEngine, learningEngine } };
}

let singleton = null;

/** Instância padrão do núcleo cognitivo (serviços reais). */
function getCognitiveOrchestrator() {
  if (!singleton) singleton = createCognitiveOrchestrator();
  return singleton;
}

module.exports = { createCognitiveOrchestrator, getCognitiveOrchestrator };
