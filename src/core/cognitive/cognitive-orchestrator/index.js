'use strict';

/**
 * Cognitive Orchestrator — núcleo obrigatório do RAP.
 *
 * Fluxo obrigatório:
 *
 *   INPUT → CONTEXT ENGINE → INTENT ENGINE → AGENT SUPERVISOR →
 *   SPECIALIST PROFILE → ACTION PLANNER → EXECUTION ROUTER →
 *   (ATOMIC: Execution Engine → Tool Registry |
 *    DURABLE: Process Runtime) → VALIDATION ENGINE → LEARNING ENGINE
 *
 * API: cognitiveOrchestrator.process({ tenantId, channel, userId, message, eventType, payload, actor })
 *
 * Identidade: nenhuma execução recebe wildcard implícito. Sem `actor`
 * explícito, o pipeline roda com um principal restrito (fail closed — ver
 * src/core/cognitive/principal.js).
 *
 * Toda execução gera registro estruturado com os campos mínimos:
 * executionId, tenantId, channel, intent, confidence, plan, toolsExecuted,
 * result, latencyMs, fallback, humanHandoff, createdAt — além de
 * supervisorDecision e executionMode, ligando evento → decisão → agente →
 * plano → execução → outcome.
 *
 * O retorno para a camada operacional contém apenas resultado de negócio —
 * nunca engines internas, QA, replay, seeds, mesh, RPA ou envelopes de
 * roteamento de agentes.
 */

const crypto = require('crypto');

const { createContextEngine } = require('../context-engine');
const { createRagResolver } = require('../context-engine/ragResolver');
const { createIntentEngine } = require('../intent-engine');
const { createActionPlanner } = require('../action-planner');
const { createExecutionEngine } = require('../execution-engine');
const { createExecutionRouter } = require('../execution-router');
const { createAgentSupervisor } = require('../agent-supervisor');
const { createValidationEngine } = require('../validation-engine');
const { createLearningEngine } = require('../learning-engine');
const { createToolRegistry, registerDefaultTools } = require('../tool-registry');
const { sanitize } = require('../sanitize');
const { normalizeActor, defaultRestrictedPrincipal } = require('../principal');
const { validateBusinessOutcome } = require('../outcome');
const { buildSpecialistRuntimeContext, resolveConfirmationRequirement } = require('../specialist-context');

function defaultLogger() {
  return require('../../../../api/utils/logger');
}

/** Event Fabric: ledger canônico (best-effort — nunca quebra o fluxo de negócio). */
function defaultEventEmitter(log) {
  return async function emitAgentEvent({ type, tenantId, correlationId, subject, actor, payload }) {
    try {
      const { appendEventV1 } = require('../../../../api/services/eventLedgerService');
      await appendEventV1({
        tenantId,
        type,
        source: 'cognitive-core',
        correlationId: correlationId || null,
        subject: subject || null,
        actor: actor || null,
        payload: payload || {},
      });
    } catch (error) {
      log.warn('[CognitiveOrchestrator] Event emit failed (best-effort)', { type, tenantId, error: error.message });
    }
  };
}

function createCognitiveOrchestrator(deps = {}) {
  const log = deps.logger || defaultLogger();

  const toolRegistry = deps.toolRegistry || registerDefaultTools(createToolRegistry({ logger: log }), deps.toolDeps || {});

  // RAG como camada de consulta: injeta o resolver `rag` no Context Engine por
  // default. Se o chamador já fornecer `deps.contextResolvers.rag`, prevalece.
  const ragResolver = deps.ragResolver || createRagResolver({ logger: log });
  const mergedResolvers = {
    ...(deps.contextResolvers || {}),
    rag: deps.contextResolvers && deps.contextResolvers.rag ? deps.contextResolvers.rag : ragResolver.rag,
  };
  const contextEngine = deps.contextEngine || createContextEngine({ logger: log, resolvers: mergedResolvers });
  const intentEngine = deps.intentEngine || createIntentEngine({ logger: log, generateAiResponse: deps.generateAiResponse, llmEnabled: deps.llmEnabled !== false });
  const actionPlanner = deps.actionPlanner || createActionPlanner({ toolRegistry, logger: log });
  const emitEvent = deps.eventEmitter || defaultEventEmitter(log);

  // P1: toolEventEmitter — eventos tool.execution.* emitidos pelo execution engine.
  const toolEventEmitter = async (type, details) => {
    await emitEvent({
      type,
      tenantId: details.tenantId,
      correlationId: details.correlationId,
      subject: { type: 'tool', id: details.toolId },
      actor: details.actor || null,
      payload: details,
    });
  };

  const executionEngine = deps.executionEngine || createExecutionEngine({ toolRegistry, logger: log, toolEventEmitter });
  const executionRouter = deps.executionRouter || createExecutionRouter({ executionEngine, toolRegistry, logger: log });
  const agentSupervisor = deps.agentSupervisor === undefined
    ? createAgentSupervisor({ toolRegistry, logger: log })
    : deps.agentSupervisor;
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
   * Restringe o plano às tools permitidas pelo especialista roteado.
   * Passos fora do escopo do especialista são negados explicitamente
   * (nunca executados).
   *
   * P0: allowedTools=[] → NENHUMA tool permitida (não é "sem restrição").
   * P0: Passos required=true NUNCA podem ser removidos — se forem, o plano falha.
   */
  function restrictPlanToSpecialist(plan, supervisorDecision) {
    if (!plan || !Array.isArray(plan.steps)) return plan;
    if (!supervisorDecision || supervisorDecision.status !== 'routed') return plan;
    const allowed = new Set(supervisorDecision.allowedTools || []);

    const steps = [];
    const denied = [...(plan.denied || [])];
    const requiredDenied = [];

    for (const step of plan.steps) {
      if (!step.toolId) {
        // Passos sem tool (CONTEXT_ASSERTION, DOMAIN_QUERY, etc.) preservados.
        steps.push(step);
        continue;
      }
      const tool = toolRegistry.get(step.toolId);
      const canonicalId = tool ? tool.id : step.toolId;
      if (allowed.has(canonicalId) || allowed.has(step.toolId)) {
        steps.push(step);
      } else {
        const reason = `outside_specialist_scope: ${step.toolId} (agent=${supervisorDecision.agentSlug})`;
        denied.push({ step: step.id, reason });
        if (step.required) {
          requiredDenied.push({ step: step.id, reason });
        }
      }
    }

    // P0: required step removido por specialist restriction → plano falha.
    if (requiredDenied.length > 0) {
      const message = `required_action_outside_specialist_scope: ${requiredDenied.map((d) => `${d.step}: ${d.reason}`).join('; ')}`;
      const err = new Error(message);
      err.code = 'required_action_outside_specialist_scope';
      err.requiredDenied = requiredDenied;
      throw err;
    }

    return { ...plan, steps, denied, specialistRestricted: true };
  }

  /**
   * @param {object} args
   * @param {string} args.tenantId   obrigatório
   * @param {string} [args.channel]  whatsapp | inbox | voice | api | workspace ...
   * @param {string} [args.userId]
   * @param {string} [args.message]  texto livre do cliente/operador
   * @param {string} [args.eventType] tipo de evento estruturado
   * @param {object} [args.payload]  dados do evento (confirmed, stepInputs, intent explícito, ...)
   * @param {object} [args.actor]    principal explícito — sem default privilegiado
   * @param {string} [args.vertical] vertical de negócio (policy pack)
   */
  async function process(args = {}) {
    const startedAt = Date.now();
    const executionId = crypto.randomUUID();
    const tenantId = String(args.tenantId || '').trim();
    if (!tenantId) throw new Error('cognitive_orchestrator_tenant_required');

    const channel = args.channel || 'api';
    const payload = args.payload || {};
    // Fail closed: sem actor explícito, principal restrito (sem permissões,
    // classificação PRODUCTION). Nunca wildcard automático.
    const actor = args.actor
      ? normalizeActor(args.actor, { tenantId, channel })
      : defaultRestrictedPrincipal({ tenantId, channel, userId: args.userId || null });
    const correlationId = payload.correlationId || args.correlationId || executionId;

    let context = null;
    let intentResult = null;
    let supervisorDecision = null;
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
        execution = { planId: null, tenantId, status, steps: [], toolsExecuted: [], haltReason: intentResult.rationale, failure: null, executionMode: 'none' };
        validation = { valid: true, checks: [] };
      } else {
        // 3. AGENT SUPERVISOR → SPECIALIST PROFILE (opcional e governado)
        if (agentSupervisor) {
          supervisorDecision = await agentSupervisor.route({
            intent: intentResult.intent,
            context,
            actor,
            tenantId,
            channel,
            vertical: args.vertical || payload.vertical || null,
          });
          if (supervisorDecision.status === 'routed') {
            await emitEvent({
              type: 'agent.routing.completed',
              tenantId,
              correlationId,
              subject: { type: 'agent', id: supervisorDecision.agentId },
              actor: { type: actor.principalType, id: actor.principalId },
              payload: {
                executionId,
                intent: intentResult.intent,
                agentSlug: supervisorDecision.agentSlug,
                confidence: supervisorDecision.confidence,
                capabilities: supervisorDecision.capabilities,
              },
            });
          } else if (supervisorDecision.status === 'no_specialist' || supervisorDecision.status === 'directory_unavailable') {
            // P0: NO_SPECIALIST e DIRECTORY_UNAVAILABLE → NUNCA prosseguir para execução.
            // Qualquer decisão não roteada bloqueia a execução autônoma.
            status = 'cannot_complete';
            execution = {
              planId: null, tenantId, status,
              steps: [], toolsExecuted: [],
              haltReason: `${supervisorDecision.status}: ${supervisorDecision.reason}`,
              failure: null, executionMode: 'none',
            };
            validation = { valid: false, checks: [{ name: 'agent_supervisor', passed: false, detail: `${supervisorDecision.status}: ${supervisorDecision.reason}` }] };
            throw new Error(`cognitive_supervisor_${supervisorDecision.status}: ${supervisorDecision.reason}`);
          }
        }

        // P0: SpecialistRuntimeContext com profile real do CorporateAgent.
        const specialistContext = buildSpecialistRuntimeContext(
          supervisorDecision,
          supervisorDecision?.agentProfile || {}
        );

        // 4. ACTION PLANNER (restrito ao escopo do especialista quando roteado)
        const rawPlan = actionPlanner.plan({
          intent: intentResult.intent,
          entities: intentResult.entities,
          context,
          actor,
          payload,
        });
        plan = restrictPlanToSpecialist(rawPlan, supervisorDecision);

        await emitEvent({
          type: 'agent.execution.started',
          tenantId,
          correlationId,
          subject: { type: 'cognitive_execution', id: executionId },
          actor: { type: actor.principalType, id: actor.principalId },
          payload: { intent: intentResult.intent, planId: plan.planId, agentSlug: supervisorDecision?.agentSlug || null },
        });

        // 5. EXECUTION ROUTER (ATOMIC → Tool Registry | DURABLE → Process Runtime)
        // P1: processPolicy do especialista influencia a decisão ATOMIC vs DURABLE.
        execution = await executionRouter.execute({
          plan,
          context: { ...context, tenantId },
          actor,
          input: buildStepInputs({ payload, entities: intentResult.entities, input: args.input }),
          payload,
          executionId,
          correlationId,
          specialistContext,
        });
        status = execution.status;

        if (execution.executionMode === 'durable') {
          await emitEvent({
            type: 'process.delegated',
            tenantId,
            correlationId,
            subject: { type: 'process_instance', id: execution.processInstanceId },
            actor: { type: actor.principalType, id: actor.principalId },
            payload: { executionId, planId: plan.planId, routeReason: execution.routeReason },
          });
        }

        // 6. VALIDATION ENGINE (interno — nunca exposto à operação)
        validation = validationEngine.validate({ plan, execution, context });
        if (!validation.valid && status === 'completed') {
          status = 'completed_with_validation_warnings';
        }
      }
    } catch (error) {
      // Preserva status específico (cannot_complete, halted_awaiting_confirmation, etc.)
      // Não sobrescreve com 'failed' genérico quando o erro já carrega semântica de negócio.
      if (!status || status === 'completed') {
        status = 'failed';
      }
      execution = execution || { planId: plan?.planId || null, tenantId, status, steps: [], toolsExecuted: [], failure: { error: error.message }, executionMode: 'none' };
      execution.failure = execution.failure || { error: error.message };
      validation = validation || { valid: false, checks: [{ name: 'pipeline_error', passed: false, detail: error.message }] };
      log.error('[CognitiveOrchestrator] Pipeline error', { tenantId, executionId, error: error.message });
    }

    const latencyMs = Date.now() - startedAt;

    // P1: Event semantics — mapear status → evento correto.
    // NUNCA emitir `agent.execution.completed` para cannot_complete / outcome_not_achieved.
    // Handoff humano é categoria própria (`agent.execution.handed_off`): não é
    // sucesso nem falha de negócio e nunca gera eventos business.outcome.* —
    // nenhum caminho pode emitir eventos contraditórios para o mesmo desfecho.
    const effectiveStatus = status;
    const isHandoff = effectiveStatus === 'human_handoff_requested';

    // INVARIANTE 4: o outcome de negócio é calculado ANTES dos eventos e
    // `status === 'completed'` sozinho NÃO é sucesso — planos com contrato
    // exigem `businessOutcome.valid === true`.
    const businessOutcome = validateBusinessOutcome({
      intent: intentResult?.intent || null,
      execution: {
        status: effectiveStatus,
        steps: execution?.steps || [],
        toolsExecuted: execution?.toolsExecuted || [],
      },
    });

    const technicalSuccess = effectiveStatus === 'completed' || effectiveStatus === 'completed_with_validation_warnings';
    const isSuccess = !isHandoff && technicalSuccess && businessOutcome.valid === true;
    const isFailure = !isHandoff && (effectiveStatus === 'failed' || effectiveStatus === 'cannot_complete'
      || effectiveStatus === 'halted_awaiting_confirmation'
      || (technicalSuccess && !businessOutcome.valid));

    const outcomeEventType = isHandoff
      ? 'agent.execution.handed_off'
      : (isFailure ? 'agent.execution.failed' : 'agent.execution.completed');
    await emitEvent({
      type: outcomeEventType,
      tenantId,
      correlationId,
      subject: { type: 'cognitive_execution', id: executionId },
      actor: { type: actor.principalType, id: actor.principalId },
      payload: {
        intent: intentResult?.intent || null,
        status: effectiveStatus,
        executionMode: execution?.executionMode || 'none',
        toolsExecuted: execution?.toolsExecuted || [],
        agentSlug: supervisorDecision?.agentSlug || null,
        latencyMs,
      },
    });

    // P1: Emitir business.outcome.* separadamente (semântica real de negócio).
    // Handoff nunca emite business.outcome.* (desfecho neutro de negócio).
    if (!isHandoff && businessOutcome.valid && isSuccess) {
      await emitEvent({
        type: 'business.outcome.validated',
        tenantId,
        correlationId,
        subject: { type: 'cognitive_execution', id: executionId },
        actor: { type: actor.principalType, id: actor.principalId },
        payload: {
          outcome: businessOutcome.outcome,
          evidence: businessOutcome.evidence,
          intent: intentResult?.intent || null,
        },
      });
    } else if (!isHandoff && (!isSuccess || businessOutcome.outcome === 'outcome_not_achieved')) {
      await emitEvent({
        type: 'business.outcome.failed',
        tenantId,
        correlationId,
        subject: { type: 'cognitive_execution', id: executionId },
        actor: { type: actor.principalType, id: actor.principalId },
        payload: {
          failures: businessOutcome.failures,
          intent: intentResult?.intent || null,
          status: effectiveStatus,
        },
      });
    }

    // Registro estruturado obrigatório (auditável, multi-tenant, sanitizado).
    const executionRecord = {
      executionId,
      tenantId,
      channel,
      userId: args.userId || null,
      principal: {
        principalId: actor.principalId,
        principalType: actor.principalType,
        classification: actor.classification,
      },
      eventType: args.eventType || null,
      correlationId,
      intent: intentResult?.intent || null,
      confidence: intentResult?.confidence ?? null,
      intentSource: intentResult?.source || null,
      intentRationale: intentResult?.rationale || null,
      supervisorDecision: supervisorDecision ? {
        status: supervisorDecision.status,
        agentId: supervisorDecision.agentId || null,
        agentSlug: supervisorDecision.agentSlug || null,
        confidence: supervisorDecision.confidence ?? null,
        capabilities: supervisorDecision.capabilities || [],
        reason: supervisorDecision.reason || null,
      } : null,
      plan: plan ? { planId: plan.planId, intent: plan.intent, steps: plan.steps.map((s) => s.id), requiresConfirmation: plan.requiresConfirmation, denied: plan.denied } : null,
      executionMode: execution?.executionMode || 'none',
      processInstanceId: execution?.processInstanceId || null,
      toolsExecuted: execution?.toolsExecuted || [],
      result: {
        status: effectiveStatus,
        technicalStatus: execution?.failure ? 'failed' : (effectiveStatus === 'completed' ? 'ok' : effectiveStatus),
        businessStatus: businessOutcome.valid ? businessOutcome.outcome : 'outcome_not_achieved',
        businessEvidence: businessOutcome.evidence,
        businessFailures: businessOutcome.failures,
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

    // 7. LEARNING ENGINE (best-effort, nunca quebra o fluxo de negócio)
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
      status: effectiveStatus,
      intent: executionRecord.intent,
      confidence: executionRecord.confidence,
      humanHandoff: executionRecord.humanHandoff,
      fallback: executionRecord.fallback,
      requiresConfirmation: effectiveStatus === 'halted_awaiting_confirmation',
      businessOutcome: businessOutcome.valid ? businessOutcome.outcome : 'outcome_not_achieved',
      businessEvidence: businessOutcome.evidence,
      businessFailures: businessOutcome.failures,
      outputs: (execution?.steps || [])
        .filter((s) => s.status === 'executed')
        .map((s) => ({ step: s.id, output: s.output })),
      latencyMs,
    };
  }

  return {
    process,
    toolRegistry,
    agentSupervisor,
    executionRouter,
    _engines: { contextEngine, intentEngine, actionPlanner, executionEngine, executionRouter, agentSupervisor, validationEngine, learningEngine },
  };
}

let singleton = null;

/** Instância padrão do núcleo cognitivo (serviços reais). */
function getCognitiveOrchestrator() {
  if (!singleton) singleton = createCognitiveOrchestrator();
  return singleton;
}

module.exports = { createCognitiveOrchestrator, getCognitiveOrchestrator };
