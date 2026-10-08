'use strict';

/**
 * engine/engineeringRouter/executionFailurePolicy.js
 *
 * Uma falha CORRENTE só deve reduzir a prioridade de um candidato quando ela revela algo sobre a
 * CAPACIDADE dele. Indisponibilidade de provider — resposta vazia, timeout do provedor, quota
 * esgotada, rate limit — é INFRAESTRUTURA: não diz nada sobre a capacidade de um modelo gerar
 * patch aplicável, e penalizá-lo por isso retira do jogo exatamente o candidato melhor avaliado.
 *
 * Achado medido (auditoria de 2026-10-07, `AI_MEMORY/evidence/2026-10-07-pool-audit-controlado.json`):
 * em 50 tentativas dos incrementos INC-3A/3B/3B1, 23 foram `PROVIDER_UNAVAILABLE` e o modelo com
 * maior `P(patch aplicável E teste passando)` do pool (`deepseek:deepseek-flash`, medido em 60% para
 * BUG_FIX) era abandonado já na primeira tentativa por causa de uma resposta vazia do provedor —
 * enquanto `excludedModelKeys` já garante a rotação dentro da mesma execução.
 *
 * Este módulo NÃO decide seleção: apenas classifica se a falha corrente deve ser registrada como
 * falha determinística do modelo (mérito) ou ignorada para fins de prioridade (infraestrutura).
 */

/** Classes de falha que são INFRAESTRUTURA do provider (nada revelam sobre o modelo). */
const INFRA_FAILURE_CLASSES = Object.freeze([
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_QUOTA',
  'PROVIDER_RATE_LIMITED',
]);

/** Motivos (códigos) que também são infraestrutura do provider. */
const INFRA_FAILURE_REASONS = Object.freeze([
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'PROVIDER_EXHAUSTED',
]);

/**
 * @param {string|null} failureClass classe de falha vinda do invoker (ex.: PROVIDER_TIMEOUT)
 * @param {string|null} reasonCode     código do motivo (ex.: PROVIDER_UNAVAILABLE)
 * @returns {boolean} true quando a falha NÃO deve reduzir a prioridade do modelo
 */
function isInfrastructureFailure(failureClass, reasonCode = null) {
  const cls = failureClass === null || failureClass === undefined ? '' : String(failureClass);
  const reason = reasonCode === null || reasonCode === undefined ? '' : String(reasonCode);
  if (cls && INFRA_FAILURE_CLASSES.includes(cls)) return true;
  if (reason && INFRA_FAILURE_REASONS.includes(reason)) return true;
  return false;
}

/**
 * Rótulo da falha de MÉRITO a registrar quando a falha corrente não é de infraestrutura.
 * @returns {'timeout'|'provider'|'unknown'}
 */
function meritFailureKindOf(failureClass) {
  const cls = failureClass === null || failureClass === undefined ? '' : String(failureClass);
  if (cls === 'PROVIDER_TIMEOUT') return 'timeout';
  if (cls) return 'provider';
  return 'unknown';
}

module.exports = {
  INFRA_FAILURE_CLASSES,
  INFRA_FAILURE_REASONS,
  isInfrastructureFailure,
  meritFailureKindOf,
};
