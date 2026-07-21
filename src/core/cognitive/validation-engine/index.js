'use strict';

/**
 * Validation Engine do Cognitive Core (interno).
 *
 * Valida pós-execução: ação executada, estado esperado, consistência de dados,
 * resposta/evento gerado e auditoria registrada.
 *
 * IMPORTANTE: este engine é interno (classificação DEVELOPMENT). QA Waves podem
 * validar o Cognitive Core por fora, mas nada daqui é exposto a usuários
 * operacionais — o orchestrator só propaga o veredito (`valid`) e mensagens de
 * negócio, nunca os detalhes técnicos dos checks.
 */

function createValidationEngine({ logger } = {}) {
  const log = logger || require('../../../../api/utils/logger');

  /**
   * @param {object} args
   * @param {object} args.plan       plano gerado
   * @param {object} args.execution  resultado do Execution Engine
   * @param {object} args.context    contexto operacional
   */
  function validate({ plan, execution, context } = {}) {
    const checks = [];
    const add = (name, passed, detail) => checks.push({ name, passed, detail: detail || null });

    const tenantId = String(context?.tenantId || '').trim();
    add('tenant_present', Boolean(tenantId));
    add('plan_present', Boolean(plan && plan.planId));
    add('execution_present', Boolean(execution && execution.planId));

    if (plan && execution) {
      add('plan_execution_linkage', execution.planId === plan.planId,
        execution.planId === plan.planId ? null : `execution.planId=${execution.planId} != plan.planId=${plan.planId}`);
      add('tenant_consistency',
        execution.tenantId === tenantId && (!plan.tenantId || plan.tenantId === tenantId),
        `plan=${plan.tenantId} execution=${execution.tenantId} context=${tenantId}`);

      const mandatory = plan.steps.filter((s) => !s.optional);
      if (execution.status === 'completed') {
        const executedIds = new Set(execution.steps
          .filter((s) => ['executed', 'resolved_from_context'].includes(s.status))
          .map((s) => s.id));
        const missing = mandatory.filter((s) => !executedIds.has(s.id)).map((s) => s.id);
        add('mandatory_steps_executed', missing.length === 0,
          missing.length ? `passos obrigatórios ausentes: ${missing.join(',')}` : null);

        const executedToolSteps = execution.steps.filter((s) => s.status === 'executed');
        add('tool_outputs_present', executedToolSteps.every((s) => s.output !== undefined),
          'todo passo executado deve registrar saída sanitizada');
      } else if (execution.status === 'halted_awaiting_confirmation') {
        add('halt_reason_present', Boolean(execution.haltReason));
      } else if (execution.status === 'failed') {
        add('failure_recorded', Boolean(execution.failure && execution.failure.step));
        const executedAfterFailure = execution.steps
          .slice(execution.steps.findIndex((s) => s.status === 'failed') + 1)
          .filter((s) => s.status === 'executed');
        add('no_execution_after_critical_failure', executedAfterFailure.length === 0);
      }

      // Auditoria: todo passo precisa de timestamps/duração registrados.
      add('audit_trail_complete', execution.steps.every((s) => s.startedAt && s.durationMs !== undefined));
    }

    const failed = checks.filter((c) => !c.passed);
    const valid = failed.length === 0;
    if (!valid) {
      log.warn('[CognitiveValidationEngine] Validation failed', {
        tenantId,
        planId: plan?.planId,
        failedChecks: failed.map((c) => `${c.name}: ${c.detail || ''}`),
      });
    }

    return { valid, checks };
  }

  return { validate };
}

module.exports = { createValidationEngine };
