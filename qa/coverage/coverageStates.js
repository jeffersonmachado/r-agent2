'use strict';

/**
 * Estados formais de cobertura de um item rastreável.
 *
 * Semântica:
 * - UNCOVERED: nunca executado.
 * - VISITED: executado, mas sem validação completa (sem assertivas obrigatórias avaliadas).
 * - VALIDATED: executado e todas as assertivas obrigatórias passaram.
 * - FAILED: executado com divergência (ao menos uma assertiva obrigatória falhou).
 * - BLOCKED: execução bloqueada por dependência/precondição.
 * - STALE: validado anteriormente, mas a evidência foi invalidada (artefato mudou).
 * - REVALIDATION_REQUIRED: revalidação exigida por política/impacto.
 * - ORPHANED: item sem ligação a qualquer jornada/onda no grafo de rastreabilidade.
 * - NOT_APPLICABLE: fora do escopo; não conta como elegível.
 */
const COVERAGE_STATES = Object.freeze({
  UNCOVERED: 'UNCOVERED',
  VISITED: 'VISITED',
  VALIDATED: 'VALIDATED',
  FAILED: 'FAILED',
  BLOCKED: 'BLOCKED',
  STALE: 'STALE',
  REVALIDATION_REQUIRED: 'REVALIDATION_REQUIRED',
  ORPHANED: 'ORPHANED',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
});

/** Estados que contam para cobertura visitada. */
const COUNTS_AS_VISITED = Object.freeze([
  COVERAGE_STATES.VISITED,
  COVERAGE_STATES.VALIDATED,
  COVERAGE_STATES.FAILED,
]);

/** Estados que contam para cobertura validada. */
const COUNTS_AS_VALIDATED = Object.freeze([COVERAGE_STATES.VALIDATED]);

/**
 * Resolve o estado de um item a partir de sinais de execução.
 * Precedência (maior primeiro):
 * NOT_APPLICABLE > ORPHANED > STALE > BLOCKED > FAILED > VALIDATED > VISITED > UNCOVERED
 *
 * @param {object} signals
 * @param {boolean} [signals.executed]
 * @param {number} [signals.assertionsPassed]
 * @param {number} [signals.assertionsTotal]
 * @param {boolean} [signals.blocked]
 * @param {boolean} [signals.stale]
 * @param {boolean} [signals.orphaned]
 * @param {boolean} [signals.notApplicable]
 * @returns {string} um valor de COVERAGE_STATES
 */
function resolveItemState(signals = {}) {
  const {
    executed = false,
    assertionsPassed = 0,
    assertionsTotal = 0,
    blocked = false,
    stale = false,
    orphaned = false,
    notApplicable = false,
  } = signals;

  if (notApplicable) return COVERAGE_STATES.NOT_APPLICABLE;
  if (orphaned) return COVERAGE_STATES.ORPHANED;
  if (stale) return COVERAGE_STATES.STALE;
  if (blocked) return COVERAGE_STATES.BLOCKED;

  if (executed) {
    if (assertionsTotal > 0) {
      if (assertionsPassed < assertionsTotal) return COVERAGE_STATES.FAILED;
      return COVERAGE_STATES.VALIDATED;
    }
    return COVERAGE_STATES.VISITED;
  }

  return COVERAGE_STATES.UNCOVERED;
}

module.exports = {
  COVERAGE_STATES,
  COUNTS_AS_VISITED,
  COUNTS_AS_VALIDATED,
  resolveItemState,
};
