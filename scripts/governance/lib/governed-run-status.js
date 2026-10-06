#!/usr/bin/env node
'use strict';

/**
 * governed-run-status.js — decisão ÚNICA sobre como o status do run governado
 * evolui entre o banco (autoridade do desfecho) e `governance/.current-run.json`
 * (ponteiro imutável lido por todo o pipeline).
 *
 * DEFEITO MEDIDO (2026-10-05). O envelope entregue afirmava duas coisas
 * incompatíveis sobre o MESMO run:
 *   scorecard do run           → 78/78, openBlockers=0, overallStatus=VERIFIED
 *   snapshot do run            → runStatus=FAILED, finalDecision=NO_GO
 * A origem não era um número errado: era a AUSÊNCIA de reconciliação. O banco
 * gravava `FAILED` (`certificationService.calculateFinalDecision`), o ponteiro
 * ficava em `RUNNING` — `assertSourceFreeze` só conhecia CREATED→RUNNING — e
 * nenhum dos dois era obrigado a convergir para um estado final antes da
 * certificação. Um run que falha na passagem N e converge na passagem N+1 tinha
 * de ser explicitamente RETOMADO; sem isso, `FAILED` virava o estado permanente
 * do run enquanto os números seguiam subindo.
 *
 * Duas responsabilidades, ambas puras/delegadas (zero regra duplicada):
 *   1. `planRunRecovery` — dado o estado do banco e o do ponteiro, dizer se há
 *      recuperação a fazer e qual transição executar. A tabela de transições
 *      NÃO mora aqui: mora em `governance/shared/run-context.js` (fonte única).
 *   2. `syncRunContextStatus` — aplicar o status do banco no ponteiro usando a
 *      mesma máquina de estados, sem nunca inventar transição inválida.
 */

const { RUN_STATES, ALLOWED_TRANSITIONS, transitionRunContext } = require('../../../governance/shared/run-context');

/** Estados que descrevem um run encerrado SEM sucesso — precisam de retomada. */
const RECOVERABLE_STATUSES = Object.freeze([RUN_STATES.FAILED]);

/** Estado para o qual um run retomável é reconduzido antes de nova avaliação. */
const RECOVERY_TARGET = RUN_STATES.RUNNING;

function normalizeStatus(value) {
  return String(value || '').trim().toUpperCase();
}

/**
 * A transição é permitida pela máquina de estados canônica?
 * @returns {boolean}
 */
function isTransitionAllowed(from, to) {
  const allowed = ALLOWED_TRANSITIONS[normalizeStatus(from)];
  return Boolean(allowed && allowed.has(normalizeStatus(to)));
}

/**
 * Decide se o run precisa ser retomado antes de uma nova avaliação.
 *
 * @param {{dbStatus?:string, runContextStatus?:string}} input
 * @returns {{recover:boolean, fromStatus:string|null, toStatus:string|null, reason:string, code:string|null}}
 */
function planRunRecovery({ dbStatus = null, runContextStatus = null } = {}) {
  const db = normalizeStatus(dbStatus);
  const pointer = normalizeStatus(runContextStatus);

  if (!RECOVERABLE_STATUSES.includes(db)) {
    return {
      recover: false,
      fromStatus: db || null,
      toStatus: null,
      code: null,
      reason: `run em ${db || 'UNKNOWN'} não é um desfecho de falha: nada a retomar`,
    };
  }

  if (!isTransitionAllowed(db, RECOVERY_TARGET)) {
    return {
      recover: false,
      fromStatus: db,
      toStatus: null,
      code: 'RECOVERY_TRANSITION_NOT_ALLOWED',
      reason: `${db} → ${RECOVERY_TARGET} não é permitido pela máquina de estados`,
    };
  }

  // O ponteiro já avançou (ex.: alguém o retomou manualmente): a recuperação do
  // banco continua necessária, e é isso que precisa ser dito — não se assume que
  // o ponteiro estar à frente significa que o banco está são.
  const pointerNote = pointer && pointer !== db ? ` (ponteiro já em ${pointer})` : '';

  return {
    recover: true,
    fromStatus: db,
    toStatus: RECOVERY_TARGET,
    code: null,
    reason: `run ${db} retomado para ${RECOVERY_TARGET} antes da reavaliação${pointerNote}: retomar é explícito e preserva o histórico da falha`,
  };
}

/**
 * Aplica o status alvo ao ponteiro `governance/.current-run.json`, usando a
 * máquina de estados canônica. Nunca lança por já estar no alvo (idempotente) e
 * nunca inventa uma transição: se a máquina proíbe, devolve `skipped` com o
 * motivo em vez de gravar um estado incoerente.
 *
 * @returns {{applied:boolean, fromStatus:string|null, status:string|null, skippedReason:string|null}}
 */
function syncRunContextStatus({ rootDir, targetStatus, now = () => new Date() } = {}) {
  const target = normalizeStatus(targetStatus);
  if (!target) {
    return { applied: false, fromStatus: null, status: null, skippedReason: 'TARGET_STATUS_MISSING' };
  }

  const { readRunContext } = require('../../../governance/shared/run-context');
  const current = readRunContext(rootDir);
  if (!current) {
    return { applied: false, fromStatus: null, status: null, skippedReason: 'RUN_CONTEXT_MISSING' };
  }

  const from = normalizeStatus(current.status);
  if (from === target) {
    return { applied: false, fromStatus: from, status: from, skippedReason: 'ALREADY_AT_TARGET' };
  }
  if (!isTransitionAllowed(from, target)) {
    return {
      applied: false,
      fromStatus: from,
      status: from,
      skippedReason: `TRANSITION_NOT_ALLOWED:${from}->${target}`,
    };
  }

  const next = transitionRunContext({ rootDir, toStatus: target, now });
  return { applied: true, fromStatus: from, status: next.status, skippedReason: null };
}

module.exports = {
  RECOVERABLE_STATUSES,
  RECOVERY_TARGET,
  isTransitionAllowed,
  planRunRecovery,
  syncRunContextStatus,
};
