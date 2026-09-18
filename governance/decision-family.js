'use strict';

/**
 * decision-family.js — FAMÍLIA de uma decisão de governança.
 *
 * Por que existe: as fontes canônicas nomeiam o mesmo bloqueio de formas
 * DIFERENTES e igualmente legítimas:
 *
 *   governance/final-readiness-report.json  → `NO_GO:MANDATORY_GATE_BLOCKED [governance=NO_GO]`
 *   governance/final-governance-report.json → `NO_GO`
 *
 * Comparar as duas por IGUALDADE TEXTUAL produzia um falso bloqueio: o produtor
 * de projeções se recusava a projetar, a projeção do ciclo anterior permanecia
 * no disco e os documentos passavam a exibir `78/78, Below 10: 0` enquanto a
 * canônica dizia NO_GO — o falso verde que o produtor existe para impedir.
 *
 * O que importa é a FAMÍLIA: bloqueado × aprovado. Um rótulo nomeia a CAUSA do
 * bloqueio; o outro é o veredito mínimo. Ambos são bloqueio.
 *
 * Esta é a fonte única: produtor de projeções e validador importam daqui.
 */

/** Famílias possíveis de uma decisão. */
const DECISION_FAMILY = Object.freeze({
  BLOCKED: 'BLOCKED',
  GO_FAMILY: 'GO_FAMILY',
  UNKNOWN: 'UNKNOWN',
});

/**
 * Família de uma decisão.
 *
 * `PENDING` é bloqueio (nada foi aprovado ainda). Qualquer coisa que não comece
 * com `NO_GO` é da família GO — o veredito específico (`AUTONOMOUS_READY_GO`,
 * `PASS_WITH_DEFERRED_PACKAGE_GATE`, `GO`) continua legível no próprio campo.
 *
 * @param {*} value
 * @returns {'BLOCKED'|'GO_FAMILY'|'UNKNOWN'}
 */
function decisionFamily(value) {
  const text = String(value ?? '').trim();
  if (!text) return DECISION_FAMILY.UNKNOWN;
  if (text.startsWith('NO_GO') || text === 'PENDING') return DECISION_FAMILY.BLOCKED;
  return DECISION_FAMILY.GO_FAMILY;
}

/**
 * As duas decisões canônicas concordam?
 *
 * @returns {{agree: boolean, left: string, right: string, reason: string|null}}
 */
function decisionsAgree(left, right) {
  const leftFamily = decisionFamily(left);
  const rightFamily = decisionFamily(right);
  if (leftFamily === DECISION_FAMILY.UNKNOWN || rightFamily === DECISION_FAMILY.UNKNOWN) {
    return { agree: false, left: leftFamily, right: rightFamily, reason: 'decision_missing' };
  }
  return {
    agree: leftFamily === rightFamily,
    left: leftFamily,
    right: rightFamily,
    reason: leftFamily === rightFamily ? null : 'decision_family_divergence',
  };
}

module.exports = { DECISION_FAMILY, decisionFamily, decisionsAgree };
