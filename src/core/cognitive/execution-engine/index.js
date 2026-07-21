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
 */

const { sanitize } = require('../sanitize');

function defaultLogger() {
  return require('../../../../api/utils/logger');
}

function createExecutionEngine({ toolRegistry, logger } = {}) {
  if (!toolRegistry) throw new Error('cognitive_execution_registry_required');
  const log = logger || defaultLogger();

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

      if (!step.toolId) {
        // Passo informativo: resolvido a partir do contexto, sem execução de tool.
        executedSteps.push({
          id: step.id,
          toolId: null,
          status: 'resolved_from_context',
          startedAt: new Date(startedAt).toISOString(),
          durationMs: Date.now() - startedAt,
        });
        continue;
      }

      const stepInput = input[step.id] || input.shared || {};
      try {
        const result = await toolRegistry.execute(step.toolId, stepInput, {
          tenantId,
          actor,
          planId: plan.planId,
          stepId: step.id,
        });
        toolsExecuted.push(step.toolId);
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
