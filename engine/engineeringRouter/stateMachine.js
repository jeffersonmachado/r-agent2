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
  GOVERNANCE: ['GREEN', 'RED', 'CANCELLED', 'BLOCKED'],
  GREEN: [],
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
