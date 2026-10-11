'use strict';

/**
 * security-gate-state — composição do ESTADO do gate de segurança do release.
 *
 * DEFEITO QUE ISTO CORRIGE (medido 2026-10-11): o gate respondia apenas
 * GO/NO_GO, então três situações com ações corretivas DIFERENTES saíam todas
 * como o mesmo "NO_GO":
 *
 *   1. risco REAL de release (vulnerabilidade crítica aberta, SBOM inválido);
 *   2. EVIDÊNCIA ausente ou não vinculada ao source que está sendo liberado
 *      (coleta falhou, banco fora do ar, SBOM de outro run);
 *   3. análise PARCIAL (cobertura abaixo do mínimo, base de advisories vencida).
 *
 * Quem opera precisa distinguir: (1) exige corrigir dependência, (2) exige
 * restaurar/refazer a medição, (3) exige ampliar a cobertura. O contrato
 * fail-closed é preservado — todo estado diferente de GO bloqueia — e a
 * composição NUNCA promove para GO.
 *
 * Módulo PURO: recebe fatos, devolve estado + razões + exit code.
 */

/** Exit code por estado. GO=0; qualquer outro é bloqueio (fail-closed). */
const STATE_EXIT_CODES = Object.freeze({
  GO: 0,
  NO_GO: 1,
  INCOMPLETE: 2,
  EVIDENCE_UNAVAILABLE: 3,
});

/** Ordem de gravidade: o estado mais grave manda. */
const SEVERIDADE_ESTADO = Object.freeze({
  GO: 0,
  INCOMPLETE: 1,
  EVIDENCE_UNAVAILABLE: 2,
  NO_GO: 3,
});

/**
 * Códigos de proveniência que significam "a evidência não sustenta ESTE run".
 * São os códigos REAIS emitidos por `lib/security-gate-provenance.js` — a lista
 * anterior usava nomes paralelos (`SECURITY_EVIDENCE_STALE`) que não existiam, e
 * um código não reconhecido cai no ramo fail-closed de NO_GO, que descreve a
 * situação errada (não é risco medido, é medição a refazer).
 */
const PROVENANCE_EVIDENCE_CODES = Object.freeze(new Set([
  'SECURITY_GATE_UNAVAILABLE',
  'SECURITY_GATE_NO_GOVERNED_RUN',
  'SECURITY_GATE_STALE_EVIDENCE',
  'SECURITY_GATE_FOREIGN_RUN',
  'SECURITY_EVIDENCE_UNBOUND',
  'SECURITY_EVIDENCE_STALE',
]));

function exitCodeFor(state) {
  return STATE_EXIT_CODES[state] !== undefined ? STATE_EXIT_CODES[state] : STATE_EXIT_CODES.NO_GO;
}

/**
 * Combina a conclusão do MOTOR com o que não pôde ser medido no gate.
 *
 * @param {object} input
 * @param {string} input.evaluationState  estado calculado pelo motor puro
 * @param {Array<string>} [input.evaluationReasons]
 * @param {Array<{code:string}>} [input.provenanceIssues]  problemas de proveniência
 * @param {string|null} [input.collectError]  falha ao coletar os fatos
 * @param {string|null} [input.waiversError]  falha ao ler as isenções vigentes
 * @returns {{state:string, reasons:string[], exitCode:number}}
 */
function composeGateState({
  evaluationState,
  evaluationReasons = [],
  provenanceIssues = [],
  collectError = null,
  waiversError = null,
} = {}) {
  let state = evaluationState || 'NO_GO';
  const reasons = new Set(evaluationReasons);

  const degradarPara = (novo) => {
    const alvo = SEVERIDADE_ESTADO[novo] === undefined ? 'NO_GO' : novo;
    if (SEVERIDADE_ESTADO[alvo] > SEVERIDADE_ESTADO[state]) state = alvo;
  };

  for (const issue of provenanceIssues) {
    const codigo = issue && issue.code;
    if (!codigo) {
      // Proveniência que não sabemos classificar NÃO relaxa o veredito.
      degradarPara('NO_GO');
      continue;
    }
    reasons.add(codigo);
    degradarPara(PROVENANCE_EVIDENCE_CODES.has(codigo) ? 'EVIDENCE_UNAVAILABLE' : 'NO_GO');
  }

  if (collectError) {
    // Não foi possível coletar os fatos: o que faltou é EVIDÊNCIA, não risco medido.
    reasons.add('COLLECTION_FAILED');
    degradarPara('EVIDENCE_UNAVAILABLE');
  }
  if (waiversError) {
    // Sem ler as isenções vigentes a análise é incompleta por definição: o
    // operador pode ver isenções na UI que este veredito não considerou.
    reasons.add('WAIVERS_UNAVAILABLE');
    degradarPara('EVIDENCE_UNAVAILABLE');
  }

  return { state, reasons: [...reasons], exitCode: exitCodeFor(state) };
}

module.exports = {
  STATE_EXIT_CODES,
  SEVERIDADE_ESTADO,
  PROVENANCE_EVIDENCE_CODES,
  exitCodeFor,
  composeGateState,
};
