'use strict';

/**
 * Execution Router — decisão de execução do Cognitive Core.
 *
 *   ATOMIC  → Execution Engine → Tool Registry
 *   DURABLE → Process Runtime (api/core/process-runtime) — estado durável,
 *             timers, waiting, eventos externos, retry, compensação multi-step.
 *
 * Critérios de DURABLE (explícitos, auditáveis):
 *  - plan.durable ou payload.durable declarado;
 *  - passo com waiting/timer/human task;
 *  - tool do passo com executionMode 'durable';
 *  - specialistContext.processPolicy.durablePreferred;
 *  - payload aguardando evento externo (waitForEvent) ou timer (waitTimerMs).
 *
 * Não é um workflow runtime novo: DURABLE delega ao Durable Process Runtime
 * existente. Se o runtime estiver indisponível, a falha é explícita
 * (process_runtime_unavailable) — nunca fake success.
 */

function defaultLogger() {
  return require('../../../../api/utils/logger');
}

const { STEP_TYPES } = require('../outcome');
const { buildDurableEvidence } = require('./durable-evidence-adapter');

const DURABLE_STEP_FLAGS = ['waiting', 'timer', 'humanTask', 'durable', 'waitForEvent'];

/** Decide ATOMIC vs DURABLE com razão auditável. */
function decideExecutionMode({ plan, payload = {}, toolRegistry = null, specialistContext = null } = {}) {
  if (!plan || !Array.isArray(plan.steps)) throw new Error('execution_router_plan_required');

  // P1: processPolicy do especialista — durablePreferred força modo durável.
  if (specialistContext?.processPolicy?.durablePreferred) {
    return { mode: 'durable', reason: 'specialist_process_policy_durable_preferred' };
  }

  if (plan.durable === true || payload.durable === true) {
    return { mode: 'durable', reason: 'explicit_durable_flag' };
  }
  if (payload.waitForEvent || payload.waitTimerMs) {
    return { mode: 'durable', reason: 'external_event_or_timer_wait' };
  }

  for (const step of plan.steps) {
    for (const flag of DURABLE_STEP_FLAGS) {
      if (step[flag]) return { mode: 'durable', reason: `step_${step.id}_${flag}` };
    }
    if (step.toolId && toolRegistry) {
      const tool = toolRegistry.get(step.toolId);
      if (tool && tool.executionMode === 'durable') {
        return { mode: 'durable', reason: `tool_execution_mode_durable:${tool.id}` };
      }
    }
  }

  return { mode: 'atomic', reason: 'default_atomic' };
}

/**
 * Converte um plano cognitivo em definição canônica de processo durável
 * (start → task.service por passo → end). Cada nó de serviço referencia o
 * toolId canônico — a execução real continua passando pelo Tool Registry
 * via serviceExecutor injetado no Process Runtime.
 */
function planToCanonicalProcessDefinition(plan, { tenantId }) {
  const nodes = [{ id: 'start', type: 'start', name: 'start' }];
  const edges = [];
  let previous = 'start';

  plan.steps.forEach((step, index) => {
    const nodeId = `step_${index}_${step.id}`.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const stepType = step.stepType || STEP_TYPES.TOOL;

    if (stepType === STEP_TYPES.WAIT_EVENT) {
      nodes.push({
        id: nodeId, type: 'event.wait', name: step.id,
        config: { planStepId: step.id, eventType: step.eventType || 'external' },
      });
    } else if (stepType === STEP_TYPES.HUMAN_TASK) {
      nodes.push({
        id: nodeId, type: 'task.human', name: step.id,
        config: { planStepId: step.id, assignment: step.assignment || null },
      });
    } else if (stepType === STEP_TYPES.NOOP) {
      nodes.push({
        id: nodeId, type: 'task.script', name: step.id,
        config: { script: 'return null;', planStepId: step.id, noop: true, optional: step.optional === true },
      });
    } else if (stepType === STEP_TYPES.CONTEXT_ASSERTION) {
      nodes.push({
        id: nodeId, type: 'task.script', name: step.id,
        config: { script: 'return context.variables;', planStepId: step.id, contextAssertion: true },
      });
    } else if (step.toolId) {
      nodes.push({
        id: nodeId, type: 'task.service', name: step.id,
        config: { toolId: step.toolId, planStepId: step.id, stepType, optional: step.optional === true },
      });
    } else {
      // P1: DOMAIN_QUERY sem toolId → erro (não cria NOOP silencioso).
      nodes.push({
        id: nodeId, type: 'task.script', name: step.id,
        config: { script: 'throw new Error("domain_query_requires_tool");', planStepId: step.id, error: 'domain_query_requires_tool' },
      });
    }
    edges.push({ source: previous, target: nodeId, priority: 0 });
    previous = nodeId;
  });

  nodes.push({ id: 'end', type: 'end', name: 'end' });
  edges.push({ source: previous, target: 'end', priority: 0 });

  return {
    id: `cognitive-plan-${plan.intent}`,
    name: `Cognitive Plan: ${plan.intent}`,
    version: 1,
    metadata: { tenantId, planId: plan.planId, intent: plan.intent, source: 'cognitive-execution-router' },
    nodes,
    edges,
    entrypoints: ['start'],
  };
}

/**
 * Bridge nó de processo → Tool Registry. Exportada para que runtimes
 * injetados (testes, composição) usem SEMPRE o mesmo executor governado —
 * o default do ProcessStateMachine sem serviceExecutor é mock ({ok:true}),
 * proibido no caminho cognitivo.
 */
function createToolBridgeServiceExecutor(toolRegistry) {
  return async (node, context, input) => {
    const toolId = node?.config?.toolId;
    if (!toolId) throw new Error('process_node_tool_required');
    const tenantId = context?.metadata?.tenantId || context?.variables?.tenantId;
    const stepInput = { ...(context?.variables?.shared || {}), ...(input || {}) };
    const result = await toolRegistry.execute(toolId, stepInput, {
      tenantId,
      actor: context?.variables?.actor || {},
      executionId: context?.executionId,
      correlationId: context?.variables?.correlationId || null,
      specialistContext: context?.variables?.specialistContext || null,
      idempotencyKey: `${context?.executionId}:${node.id}`,
    });
    const outputVariable = `${String(node.id)}_result`;
    if (typeof context?.setVariable === 'function') context.setVariable(outputVariable, result.output);
    return {
      nextState: null,
      events: [],
      output: { type: 'service', variable: outputVariable, toolId, data: result.output },
    };
  };
}

function createExecutionRouter({ executionEngine, toolRegistry, processRuntime, logger } = {}) {
  if (!executionEngine) throw new Error('execution_router_engine_required');
  const log = logger || defaultLogger();

  let runtimeInstance = processRuntime || null;

  /**
   * Resolve o Process Runtime (lazy). O serviceExecutor é SEMPRE a bridge
   * para o Tool Registry — inclusive quando a instância é injetada sem
   * executor (fail explicit em vez do mock default do state machine).
   */
  function resolveProcessRuntime() {
    if (runtimeInstance) {
      if (typeof runtimeInstance.stateMachine?.serviceExecutor !== 'function') {
        const bridge = createToolBridgeServiceExecutor(toolRegistry);
        if (runtimeInstance.stateMachine) runtimeInstance.stateMachine.serviceExecutor = bridge;
      }
      return runtimeInstance;
    }
    const { ProcessRuntimeService } = require('../../../../api/core/process-runtime/processRuntimeService');
    runtimeInstance = new ProcessRuntimeService({
      serviceExecutor: createToolBridgeServiceExecutor(toolRegistry),
    });
    return runtimeInstance;
  }

  /**
   * @param {object} args
   * @param {object} args.plan
   * @param {object} args.context  { tenantId, ... }
   * @param {object} [args.actor]
   * @param {object} [args.input]   entradas por passo
   * @param {object} [args.payload] payload original (durable, waitForEvent, ...)
   * @param {string} [args.executionId]
   * @param {string} [args.correlationId]
   */
  async function execute({ plan, context = {}, actor = {}, input = {}, payload = {}, executionId = null, correlationId = null, specialistContext = null } = {}) {
    const tenantId = String(context.tenantId || '').trim();
    if (!tenantId) throw new Error('execution_router_tenant_required');

    const decision = decideExecutionMode({ plan, payload, toolRegistry, specialistContext });

    if (decision.mode === 'atomic') {
      const execution = await executionEngine.execute({
        plan,
        context: { ...context, executionId, correlationId, specialistContext },
        actor,
        input,
      });
      return { ...execution, executionMode: 'atomic', routeReason: decision.reason, processInstanceId: null };
    }

    // DURABLE — delega ao Process Runtime existente (estado persistente,
    // sobrevive a restart/deploy/timeout/troca de worker).
    let runtime;
    try {
      runtime = resolveProcessRuntime();
    } catch (error) {
      throw new Error(`process_runtime_unavailable: ${error.message}`);
    }

    const definition = planToCanonicalProcessDefinition(plan, { tenantId });
    log.info('[ExecutionRouter] Delegating durable plan to Process Runtime', {
      tenantId, planId: plan.planId, intent: plan.intent, reason: decision.reason,
    });

    try {
      const result = await runtime.startProcess(definition, {
        tenantId,
        variables: {
          tenantId,
          actor,
          shared: input.shared || {},
          correlationId: correlationId || null,
          specialistContext: specialistContext || null,
        },
        metadata: { tenantId, planId: plan.planId, executionId },
      });

      // P1: DurableEvidenceAdapter — converter resultado do Process Runtime
      // em steps + toolsExecuted para o Validation Engine e Outcome Validator.
      const durableEvidence = buildDurableEvidence(result);

      return {
        planId: plan.planId,
        tenantId,
        status: result.status === 'completed' ? 'completed' : (result.status || 'running'),
        haltReason: null,
        failure: result.error ? { error: result.error } : null,
        steps: durableEvidence.steps,
        toolsExecuted: durableEvidence.toolsExecuted,
        executionMode: 'durable',
        routeReason: decision.reason,
        processInstanceId: result.executionId || result.instanceId || null,
        processResult: result,
      };
    } catch (error) {
      // Falha explícita — nunca converter em sucesso.
      throw new Error(`process_runtime_execution_failed: ${error.message}`);
    }
  }

  return { execute, decideExecutionMode, planToCanonicalProcessDefinition };
}

module.exports = { createExecutionRouter, decideExecutionMode, planToCanonicalProcessDefinition, createToolBridgeServiceExecutor };
