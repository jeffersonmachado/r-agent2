'use strict';

/**
 * engine/engineeringRouter/stateMachine.js
 *
 * State machine da EngineeringTask. Transições fora deste mapa são rejeitadas com
 * INVALID_STATE_TRANSITION — nunca aplicadas silenciosamente.
 *
 * Módulo puro (sem I/O).
 */

const { TASK_STATES, TERMINAL_STATES, FAILURE_CODES } = require('./constants');

const STATE_SET = new Set(TASK_STATES);
const TERMINAL_SET = new Set(TERMINAL_STATES);

const TRANSITIONS = Object.freeze({
  CREATED: ['CLASSIFIED', 'CANCELLED', 'BLOCKED'],
  CLASSIFIED: ['ROUTED', 'CANCELLED', 'BLOCKED'],
  ROUTED: ['CODING', 'CANCELLED', 'BLOCKED'],
  // CODING -> RED cobre patch inválido / apply falhou / provider indisponível sem fallback.
  CODING: ['TESTING', 'RED', 'CANCELLED', 'BLOCKED'],
  // TESTING -> CODING é o loop RED→FIX (nova tentativa); TESTING -> RED é ENGINEERING_TASK_EXHAUSTED.
  TESTING: ['REVIEWING', 'CODING', 'RED', 'CANCELLED', 'BLOCKED'],
  // REVIEWING -> CODING é reviewer REJECT com finding BLOCKER/REGRESSION.
  REVIEWING: ['REGRESSION', 'CODING', 'RED', 'CANCELLED', 'BLOCKED'],
  REGRESSION: ['GOVERNANCE', 'RED', 'CANCELLED', 'BLOCKED'],
  // ER-V1-SEAL-002: GOVERNANCE -> PROMOTING é um estado persistido explícito ANTES de
  // promoteValidatedPatch rodar — permite ao reconciliador distinguir "governança passou, mas
  // nunca cheguei a tentar promover" (seguro repetir do zero) de "já estava tentando promover
  // quando morri" (precisa checar evidência externa real — branch candidata já existe? — antes
  // de tentar de novo). GOVERNANCE -> READY_FOR_PROMOTION preservado por compatibilidade com
  // fluxos antigos que já tratavam a reprovação de promoção sem passar por PROMOTING.
  GOVERNANCE: ['PROMOTING', 'READY_FOR_PROMOTION', 'RED', 'CANCELLED', 'BLOCKED'],
  // PROMOTING -> POST_PROMOTION_VERIFY: candidate commit + branch já criados (efeito real e
  // irreversível de "já promovi"), falta só confirmar o smoke pós-promoção.
  // PROMOTING -> READY_FOR_PROMOTION: promoteValidatedPatch reprovou ANTES de criar o candidate
  // (ex.: PROMOTION_TARGET_DIVERGED, PROMOTION_TREE_CONTAMINATED) — nada foi promovido de fato.
  PROMOTING: ['POST_PROMOTION_VERIFY', 'READY_FOR_PROMOTION', 'RED', 'CANCELLED', 'BLOCKED'],
  // POST_PROMOTION_VERIFY -> GREEN: smoke pós-promoção confirmou. -> READY_FOR_PROMOTION: smoke
  // falhou (candidate já existe, mas não verificado como equivalente ao validado).
  POST_PROMOTION_VERIFY: ['GREEN', 'READY_FOR_PROMOTION', 'RED', 'CANCELLED', 'BLOCKED'],
  GREEN: [],
  READY_FOR_PROMOTION: [],
  RED: [],
  BLOCKED: ['CANCELLED'],
  CANCELLED: [],
});

function isValidState(state) {
  return STATE_SET.has(state);
}

function isTerminal(state) {
  return TERMINAL_SET.has(state);
}

function canTransition(from, to) {
  if (!isValidState(from) || !isValidState(to)) return false;
  return (TRANSITIONS[from] || []).includes(to);
}

/**
 * @throws {Error} com `.code = INVALID_STATE_TRANSITION` se a transição não for permitida.
 */
function assertTransition(from, to) {
  // REVERTIDO (2026-09-25): eu havia permitido `from === to` como "retomada idempotente" para
  // resolver IMPLEMENTING->RED — que era, na verdade, vocabulário ERRADO meu nos testes (o estado
  // real é CODING). Medido: com a tolerância, o loop E2E real (RED→FIX→REVIEW→GREEN, fixture real)
  // passou a terminar em RED em vez de GREEN, porque o Router DEPENDE de a transição repetida ser
  // rejeitada para decidir o próximo passo. Não se mexe no motor para acomodar um teste.
  if (!canTransition(from, to)) {
    const err = new Error(`Transição de estado inválida: ${from} -> ${to}`);
    err.code = FAILURE_CODES.INVALID_STATE_TRANSITION;
    err.from = from;
    err.to = to;
    throw err;
  }
  return true;
}

module.exports = {
  TRANSITIONS,
  isValidState,
  isTerminal,
  canTransition,
  assertTransition,
};
