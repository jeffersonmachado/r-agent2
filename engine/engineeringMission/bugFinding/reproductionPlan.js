'use strict';

/**
 * engine/engineeringMission/bugFinding/reproductionPlan.js
 *
 * REPRODUÇÃO CONTROLADA. A missão exige que um SUSPECTED reproduzível tenha uma tentativa
 * controlada de reprodução — preferencialmente um teste mínimo que fica VERMELHO, para que depois o
 * mesmo teste fique verde. É isso que impede "corrigir" algo que nunca foi comprovado.
 *
 * Semântica (nunca achatada):
 *   REPRODUCED     — a falha observada aconteceu, com base objetiva;
 *   NOT_REPRODUCED — a tentativa rodou e NÃO falhou: o bug não se manifesta nessas condições;
 *   INCONCLUSIVE   — a tentativa não chegou a rodar (infra) ou estourou deadline (TIMEOUT). TIMEOUT
 *                    isolado NUNCA é tratado como reprodução (BUG-12).
 *
 * Módulo PURO — a execução real do comando acontece no serviço (`bugReproductionService`).
 */

const { CONFIRMATION_BASES, BUG_FAILURE_CODES } = require('./constants');

const REPRODUCTION_KINDS = Object.freeze(['COMMAND', 'INVARIANT', 'UNAVAILABLE']);

const REPRODUCTION_OUTCOMES = Object.freeze({
  REPRODUCED: 'REPRODUCED',
  NOT_REPRODUCED: 'NOT_REPRODUCED',
  INCONCLUSIVE: 'INCONCLUSIVE',
});

/**
 * Constrói o plano de reprodução a partir do Finding. O plano é DERIVADO dos dados do finding, não
 * inventado: sem comando nem invariante declarado, o plano é `UNAVAILABLE` e o finding NÃO pode ser
 * confirmado por reprodução (permanece SUSPECTED, ou é confirmado por outra base objetiva).
 */
function buildReproductionPlan(finding = {}) {
  const reproduction = finding.reproduction || {};
  if (Array.isArray(reproduction.invariants) && reproduction.invariants.length > 0) {
    return {
      kind: 'INVARIANT',
      required: true,
      invariants: reproduction.invariants,
      rationale: 'invariante determinístico declarado — violação é base objetiva de confirmação',
    };
  }
  if (typeof reproduction.command === 'string' && reproduction.command.trim() !== '') {
    return {
      kind: 'COMMAND',
      required: true,
      command: reproduction.command.trim(),
      // `expect` é o que a REPRODUÇÃO deve observar. Default FAIL: o bug reproduz quando o comando
      // falha. Nunca default PASS — senão um comando já verde "reproduziria" o bug.
      expect: String(reproduction.expect || 'FAIL').toUpperCase() === 'PASS' ? 'PASS' : 'FAIL',
      cwdRequired: true,
      rationale: 'comando de reprodução declarado (teste mínimo/fixture), executado em workspace isolado',
    };
  }
  return {
    kind: 'UNAVAILABLE',
    required: true,
    rationale: 'sem comando nem invariante de reprodução declarado — confirmação só por outra base objetiva',
    code: BUG_FAILURE_CODES.REPRODUCTION_PLAN_MISSING,
  };
}

/**
 * Avalia o RESULTADO de uma tentativa contra o plano.
 *
 * @param {object} params
 * @param {object} params.plan  plano de `buildReproductionPlan`
 * @param {object} [params.run] resultado de execução (formato de `testRunnerService.runTestCommands`):
 *                              `{ allPass, outcome: 'PASS'|'FAIL'|'TIMEOUT'|'INFRA_ERROR'|'BLOCKED', results: [] }`
 * @param {object[]} [params.invariantResults] `[{ id, violated, detail }]`
 */
function evaluateReproduction({ plan = {}, run = null, invariantResults = null } = {}) {
  if (plan.kind === 'INVARIANT') {
    const results = Array.isArray(invariantResults) ? invariantResults : [];
    if (results.length === 0) {
      return {
        outcome: REPRODUCTION_OUTCOMES.INCONCLUSIVE,
        reason: 'invariante declarado mas nenhum resultado de avaliação fornecido',
        code: BUG_FAILURE_CODES.REPRODUCTION_INCONCLUSIVE,
      };
    }
    const violated = results.filter((r) => r && r.violated === true);
    if (violated.length === 0) {
      return { outcome: REPRODUCTION_OUTCOMES.NOT_REPRODUCED, reason: 'todos os invariantes declarados foram satisfeitos', results };
    }
    return {
      outcome: REPRODUCTION_OUTCOMES.REPRODUCED,
      basis: 'DETERMINISTIC_INVARIANT_VIOLATION',
      reason: `invariante(s) violado(s): ${violated.map((v) => v.id).join(', ')}`,
      results: violated,
    };
  }

  if (plan.kind !== 'COMMAND') {
    return {
      outcome: REPRODUCTION_OUTCOMES.INCONCLUSIVE,
      reason: plan.rationale || 'sem plano de reprodução executável',
      code: BUG_FAILURE_CODES.REPRODUCTION_PLAN_MISSING,
    };
  }

  if (!run) {
    return {
      outcome: REPRODUCTION_OUTCOMES.INCONCLUSIVE,
      reason: 'nenhuma execução de reprodução fornecida',
      code: BUG_FAILURE_CODES.REPRODUCTION_INCONCLUSIVE,
    };
  }

  const outcome = String(run.outcome || '').toUpperCase();
  if (outcome === 'TIMEOUT') {
    return {
      outcome: REPRODUCTION_OUTCOMES.INCONCLUSIVE,
      reason: 'TIMEOUT na reprodução: deadline estourado não prova bug (classificar como infra/configuração antes)',
      code: BUG_FAILURE_CODES.REPRODUCTION_INCONCLUSIVE,
      run,
    };
  }
  if (outcome === 'INFRA_ERROR' || outcome === 'BLOCKED') {
    return {
      outcome: REPRODUCTION_OUTCOMES.INCONCLUSIVE,
      reason: `reprodução não executou (${outcome}): infraestrutura/allowlist — nada foi provado`,
      code: BUG_FAILURE_CODES.REPRODUCTION_INCONCLUSIVE,
      run,
    };
  }

  const failed = run.allPass === false;
  if (plan.expect === 'FAIL') {
    return failed
      ? {
        outcome: REPRODUCTION_OUTCOMES.REPRODUCED,
        basis: 'REPRODUCED_TEST_FAILURE',
        reason: 'o comando de reprodução falhou conforme esperado — falha reproduzível',
        run,
      }
      : { outcome: REPRODUCTION_OUTCOMES.NOT_REPRODUCED, reason: 'o comando de reprodução passou — a falha não se manifesta', run };
  }
  // expect === 'PASS' (bug é "o teste não roda" / "o arquivo não existe")
  return run.allPass === true
    ? { outcome: REPRODUCTION_OUTCOMES.REPRODUCED, basis: 'UNEQUIVOCAL_EVIDENCE', reason: 'o comando passou quando deveria falhar (comportamento observado esperado)', run }
    : { outcome: REPRODUCTION_OUTCOMES.NOT_REPRODUCED, reason: 'comportamento esperado na reprodução não foi observado', run };
}

/** A base de confirmação é objetiva e reconhecida? (nunca LLM/heurística/timout) */
function basisIsObjective(basis) {
  return CONFIRMATION_BASES.includes(basis);
}

module.exports = {
  REPRODUCTION_KINDS,
  REPRODUCTION_OUTCOMES,
  buildReproductionPlan,
  evaluateReproduction,
  basisIsObjective,
};
