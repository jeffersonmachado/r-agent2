'use strict';

/**
 * Execution Engine do Cognitive Core.
 *
 * Executa planos do Action Planner exclusivamente via Tool Registry.
 *
 * Garantias:
 *  - passos obrigatórios executam em ordem; erro crítico interrompe o plano
 *  - passos críticos sem confirmação param a execução (halted_awaiting_confirmation)
 *  - rollback best-effort dos passos já executados quando suportado pela tool
 *  - entradas/saídas registradas sempre sanitizadas
 *  - nenhum detalhe técnico interno é exposto no resultado de negócio
 *  - P0: step typology — toolId=null NUNCA é auto-resolvido como sucesso
 */

const { sanitize } = require('../sanitize');
const { STEP_TYPES } = require('../outcome');

function defaultLogger() {
  return require('../../../../api/utils/logger');
}

/**
 * Valida step de CONTEXT_ASSERTION: exige predicate, actual data e validation.
 */
function validateContextAssertion(step, context, input) {
  const predicate = step.predicate || input[step.id]?.predicate || null;
  if (!predicate) {
    return { passed: false, reason: 'context_assertion_missing_predicate' };
  }
  // Predicate deve ser uma função ou expressão avaliável.
  if (typeof predicate === 'function') {
    try {
      const result = predicate({ context, input: input[step.id] || input.shared || {} });
      return { passed: !!result, reason: result ? 'predicate_satisfied' : 'predicate_failed' };
    } catch (error) {
      return { passed: false, reason: `predicate_error: ${error.message}` };
    }
  }
  // Predicate como string: campo deve existir e ser truthy no input/context.
  const value = input[step.id]?.[predicate]
    || input.shared?.[predicate]
    || context[predicate]
    || null;
  return { passed: !!value, reason: value ? 'predicate_field_exists' : 'predicate_field_missing', value };
}

function createExecutionEngine({ toolRegistry, logger, toolEventEmitter } = {}) {
  if (!toolRegistry) throw new Error('cognitive_execution_registry_required');
  const log = logger || defaultLogger();

  /** P1: Emite eventos tool.execution.* (best-effort, nunca quebra execução). */
  async function emitToolEvent(type, details) {
    if (!toolEventEmitter || typeof toolEventEmitter !== 'function') return;
    try { await toolEventEmitter(type, details); } catch (_) { /* best-effort */ }
  }

  /**
   * @param {object} args
   * @param {object} args.plan      plano do Action Planner
   * @param {object} args.context   contexto operacional (tenantId obrigatório)
   * @param {object} [args.actor]
   * @param {object} [args.input]   entradas por passo: { [stepId]: {...} }
   */
  async function execute({ plan, context = {}, actor = {}, input = {} } = {}) {
    if (!plan || !Array.isArray(plan.steps)) throw new Error('cognitive_execution_plan_required');
    const tenantId = String(context.tenantId || '').trim();
    if (!tenantId) throw new Error('cognitive_execution_tenant_required');
    if (plan.tenantId && plan.tenantId !== tenantId) {
      throw new Error('cognitive_execution_tenant_mismatch');
    }

    const executedSteps = [];
    const toolsExecuted = [];
    let status = 'completed';
    let haltReason = null;
    let failure = null;

    for (const step of plan.steps) {
      const startedAt = Date.now();

      if (step.requiresConfirmation) {
        status = 'halted_awaiting_confirmation';
        haltReason = `passo crítico '${step.id}' exige confirmação explícita`;
        executedSteps.push({
          id: step.id,
          toolId: step.toolId,
          status: 'awaiting_confirmation',
          startedAt: new Date(startedAt).toISOString(),
          durationMs: 0,
        });
        break;
      }

      // P0: Step typology — cada tipo tem executor/validator real.
      const stepType = step.stepType || STEP_TYPES.TOOL;

      if (stepType === STEP_TYPES.NOOP) {
        // NOOP: placeholder — nunca conta como mandatory success.
        executedSteps.push({
          id: step.id,
          toolId: step.toolId,
          stepType,
          status: step.optional ? 'skipped_noop' : 'noop_not_allowed_for_mandatory',
          startedAt: new Date(startedAt).toISOString(),
          durationMs: 0,
        });
        if (!step.optional) {
          status = 'failed';
          failure = { step: step.id, error: `mandatory step cannot be NOOP: ${step.id}` };
          break;
        }
        continue;
      }

      if (stepType === STEP_TYPES.CONTEXT_ASSERTION) {
        // P0: CONTEXT_ASSERTION exige predicate + actual data + validation.
        // Steps opcionais sem predicate são informativos (agregação de contexto).
        const assertion = validateContextAssertion(step, context, input);
        if (!assertion.passed && step.optional) {
          // CONTEXT_ASSERTION opcional sem predicate: passa como informativa.
          executedSteps.push({
            id: step.id,
            toolId: null,
            stepType,
            status: 'context_assertion_informational',
            startedAt: new Date(startedAt).toISOString(),
            durationMs: Date.now() - startedAt,
            evidence: { note: 'optional context assertion — no predicate required' },
          });
          continue;
        }
        executedSteps.push({
          id: step.id,
          toolId: null,
          stepType,
          status: assertion.passed ? 'assertion_passed' : 'assertion_failed',
          startedAt: new Date(startedAt).toISOString(),
          durationMs: Date.now() - startedAt,
          evidence: assertion,
        });
        if (!assertion.passed && !step.optional) {
          status = 'failed';
          failure = { step: step.id, error: `context_assertion_failed: ${assertion.reason}` };
          break;
        }
        continue;
      }

      if (stepType === STEP_TYPES.DOMAIN_QUERY) {
        // P0: DOMAIN_QUERY precisa de tool real — toolId:null não é aceitável.
        if (!step.toolId) {
          executedSteps.push({
            id: step.id,
            toolId: null,
            stepType,
            status: 'failed',
            startedAt: new Date(startedAt).toISOString(),
            durationMs: 0,
            error: 'domain_query_requires_tool: step has toolId=null',
          });
          if (!step.optional) {
            status = 'failed';
            failure = { step: step.id, error: `domain_query_requires_tool: ${step.id}` };
            break;
          }
          continue;
        }
        // Fall through to tool execution below.
      }

      if (stepType === STEP_TYPES.WAIT_EVENT || stepType === STEP_TYPES.HUMAN_TASK) {
        // P0: WAIT_EVENT e HUMAN_TASK precisam de Process Runtime.
        executedSteps.push({
          id: step.id,
          toolId: step.toolId,
          stepType,
          status: 'requires_durable_execution',
          startedAt: new Date(startedAt).toISOString(),
          durationMs: 0,
          error: `${stepType}_requires_process_runtime`,
        });
        if (!step.optional) {
          status = 'failed';
          failure = { step: step.id, error: `${stepType}_requires_process_runtime: ${step.id}` };
          break;
        }
        continue;
      }

      if (!step.toolId) {
        // P0: TOOL sem toolId → erro (nunca resolved_from_context).
        executedSteps.push({
          id: step.id,
          toolId: null,
          stepType,
          status: 'failed',
          startedAt: new Date(startedAt).toISOString(),
          durationMs: 0,
          error: 'tool_step_requires_toolId',
        });
        if (!step.optional) {
          status = 'failed';
          failure = { step: step.id, error: `tool_step_requires_toolId: ${step.id}` };
          break;
        }
        continue;
      }

      const stepInput = input[step.id] || input.shared || {};
      const toolEventPayload = {
        tenantId,
        planId: plan.planId,
        stepId: step.id,
        executionId: context.executionId || null,
        correlationId: context.correlationId || null,
        toolId: step.toolId,
        input: sanitize(stepInput),
      };
      await emitToolEvent('tool.execution.started', toolEventPayload);

      try {
        const result = await toolRegistry.execute(step.toolId, stepInput, {
          tenantId,
          actor,
          planId: plan.planId,
          stepId: step.id,
          executionId: context.executionId || null,
          correlationId: context.correlationId || null,
          specialistContext: context.specialistContext || null,
          // Idempotência propagada do evento → plano → tool: chave determinística
          // por execução+passo quando o chamador não fornece uma explicitamente.
          idempotencyKey: context.idempotencyKey
            || `${context.executionId || plan.planId}:${step.id}`,
        });
        toolsExecuted.push(step.toolId);

        await emitToolEvent('tool.execution.completed', {
          ...toolEventPayload,
          durationMs: result.durationMs,
          output: sanitize(result.output),
        });

        executedSteps.push({
          id: step.id,
          toolId: step.toolId,
          status: 'executed',
          startedAt: new Date(startedAt).toISOString(),
          durationMs: result.durationMs,
          input: sanitize(stepInput),
          output: sanitize(result.output),
        });
      } catch (error) {
        await emitToolEvent('tool.execution.failed', {
          ...toolEventPayload,
          error: error.message,
          durationMs: Date.now() - startedAt,
        });

        executedSteps.push({
          id: step.id,
          toolId: step.toolId,
          status: 'failed',
          startedAt: new Date(startedAt).toISOString(),
          durationMs: Date.now() - startedAt,
          input: sanitize(stepInput),
          error: error.message,
        });

        if (step.optional) {
          log.warn('[CognitiveExecutionEngine] Optional step failed (continuing)', {
            tenantId, planId: plan.planId, step: step.id, error: error.message,
          });
          continue;
        }

        // Erro crítico: interrompe e tenta rollback dos passos já executados.
        status = 'failed';
        failure = { step: step.id, toolId: step.toolId, error: error.message };
        await rollbackExecuted({ executedSteps, context: { tenantId, actor }, input, plan });
        break;
      }
    }

    return {
      planId: plan.planId,
      tenantId,
      status,
      haltReason,
      failure,
      steps: executedSteps,
      toolsExecuted,
    };
  }

  async function rollbackExecuted({ executedSteps, context, input, plan }) {
    const executed = executedSteps.filter((s) => s.status === 'executed' && s.toolId);
    for (const step of executed.reverse()) {
      try {
        const result = await toolRegistry.rollback(step.toolId, input[step.id] || {}, context, step.output);
        step.rollback = result.supported ? 'done' : 'unsupported';
      } catch (error) {
        step.rollback = 'failed';
        log.error('[CognitiveExecutionEngine] Rollback failed', {
          tenantId: context.tenantId,
          planId: plan.planId,
          step: step.id,
          error: error.message,
        });
      }
    }
  }

  return { execute };
}

module.exports = { createExecutionEngine };
