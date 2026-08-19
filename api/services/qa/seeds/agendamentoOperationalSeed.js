'use strict';

/**
 * agendamentoOperationalSeed.js
 *
 * Seed operacional para a jornada `agendamento` (vertical fitness).
 *
 * DIFERENTE de support/fitness, esta jornada NÃO exige provisionamento de dados
 * prévio via API: a própria UI cria a tarefa (POST /api/tasks) e o agendamento
 * (scheduleService em memória). O seed apenas expõe os dados que os steps
 * canônicos preenchem na UI e declara o contrato de mutação esperado.
 *
 * Antes da execução: NADA é criado (a tarefa é criada pela UI na jornada).
 * Depois da execução valida:
 *   - db.task.count incrementou (task_created na tabela `tasks`)
 */

const logger = require('../../../utils/logger');

/**
 * Data/hora local no formato aceito por inputs `datetime-local`
 * (YYYY-MM-DDTHH:mm), sempre no futuro: padrão é "amanhã" no horário pedido.
 * Datas fixas no passado quebram a jornada (UI rejeita agendamento retroativo).
 */
function defaultFutureLocalDatetime(hour) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Retorna spec do seed operacional de agendamento.
 */
function buildAgendamentoOperationalSeedSpec(options = {}) {
  const suffix = options.suffix || String(Date.now());
  // FASE 15 — tenant ausente é erro explícito; fallback silencioso é proibido.
  const tenantId = options.tenantId || process.env.DEFAULT_TENANT_ID || null;
  if (!tenantId) {
    const error = new Error('tenantId obrigatório para seed operacional de agendamento');
    error.code = 'tenant_required';
    throw error;
  }

  return {
    journeyId: 'agendamento',
    seedType: 'operational_ui_driven',
    tenantId,
    suffix,

    // ── Dados preenchidos na UI (não provisionados) ──
    taskTitle: options.taskTitle || 'Aula experimental QA',
    taskDueDate: options.taskDueDate || defaultFutureLocalDatetime(9),
    scheduleStartAt: options.scheduleStartAt || defaultFutureLocalDatetime(10),
    schedulePurpose: options.schedulePurpose || 'aula experimental',
    scheduleNotes: options.scheduleNotes || 'Cliente interessado em pilates; confirmar unidade Paulista.',

    // ── Estado inicial esperado (snapshot before) ──
    beforeStateKeys: [
      'db.task.count',
    ],

    // ── Ações operacionais esperadas ──
    expectedOperationalActions: [
      'access_workspace',
      'open_builder_tasks',
      'create_task',
      'open_schedule',
      'confirm_schedule',
    ],

    // ── Side effects obrigatórios ──
    requiredSideEffects: [
      'task_created',
    ],

    // ── Validações pós-execução ──
    postValidation: {
      taskCountIncremented: true,
    },
  };
}

/**
 * Provisionamento do seed (NO-OP): a jornada cria os próprios dados pela UI.
 * Retorna { ok, reason, beforeSnapshot }.
 */
async function provisionAgendamentoSeed(seedSpec = {}, httpClient = null) {
  // httpClient não é necessário: a mutação (task_created) nasce na UI.
  void httpClient;

  if (!seedSpec || !seedSpec.journeyId) {
    logger.warn('[AgendamentoOperationalSeed] seedSpec inválido');
    return {
      ok: false,
      reason: 'invalid_seed_spec',
      beforeSnapshot: null,
    };
  }

  const beforeSnapshot = {
    seedSuffix: seedSpec.suffix,
    tenantId: seedSpec.tenantId,
    journeyId: seedSpec.journeyId,
    taskTitle: seedSpec.taskTitle,
    capturedAt: new Date().toISOString(),
    db: {
      task: { count: null, exists: false },
    },
  };

  return {
    ok: true,
    reason: null,
    beforeSnapshot,
  };
}

/**
 * Valida estado pós-execução da jornada `agendamento`.
 * Retorna { ok, blockers, goNoGo }.
 */
function validateAgendamentoSeedPostExecution(beforeSnapshot = {}, afterSnapshot = {}, options = {}) {
  void options;
  const blockers = [];

  // A mutação persistente é a criação da tarefa (tabela tasks).
  const beforeCount = Number(beforeSnapshot?.db?.task?.count ?? 0);
  const afterCount = Number(
    afterSnapshot?.db?.task?.count
    ?? afterSnapshot?.db?.tasks?.count
    ?? afterSnapshot?.db?.task?.count ?? 0
  );

  if (afterCount <= beforeCount) {
    blockers.push({
      reason: 'agendamento_post_validation_task_not_created',
      beforeCount,
      afterCount,
    });
  }

  return {
    ok: blockers.length === 0,
    blockers,
    goNoGo: blockers.length > 0 ? 'NO_GO' : 'GO',
  };
}

module.exports = {
  buildAgendamentoOperationalSeedSpec,
  provisionAgendamentoSeed,
  validateAgendamentoSeedPostExecution,
  defaultFutureLocalDatetime,
};
