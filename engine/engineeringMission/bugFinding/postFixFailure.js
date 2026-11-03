'use strict';

/**
 * engine/engineeringMission/bugFinding/postFixFailure.js
 *
 * CLASSIFICAÇÃO DE FALHA PÓS-FIX — distingue "o bug voltou" de "o coder não conseguiu entregar
 * patch nenhum".
 *
 * DEFEITO MEDIDO (run 40786037745, `governanceApprovalFullWorkerE2E`): depois de o fix ser
 * integrado na fonte e do finding ser fechado, a task substituta foi reexecutada e o coder devolveu
 * um patch do que JÁ existia; o `git apply` recusou (`failureKind=PATCH_CONTRACT_VIOLATION`) e a
 * falha foi registrada como REINCIDÊNCIA do finding recém-fechado (`recurrenceCount=1`,
 * `previousStatus=CLOSED`). O bug não voltou — o trabalho é que foi inventado.
 *
 * A regra é ESTREITA de propósito (não mascara recorrência real): só é tratada como falha de
 * contrato do coder a falha cujo modo é de patch (formato/aplicação/escopo) ocorrida quando já
 * existe, para a MESMA missão, um finding em estado pós-correção. Qualquer outra falha — teste
 * falhando, regressão, governança, provider, infraestrutura — continua indo pelo caminho normal e
 * pode sim caracterizar recorrência.
 *
 * Módulo puro: sem I/O, sem relógio, sem aleatório.
 */

const CODER_CONTRACT_FAILURE_KINDS = Object.freeze([
  'PATCH_CONTRACT_VIOLATION',
  'PATCH_NOT_APPLICABLE',
]);

const CODER_CONTRACT_REASON_CODES = Object.freeze([
  'PATCH_INVALID_FORMAT',
  'PATCH_BODY_MISSING_PREFIX',
  'PATCH_APPLY_FAILED',
  'PATCH_OUTSIDE_ALLOWED_SCOPE',
  'PATCH_SYMLINK_FORBIDDEN',
  'PATCH_REMOVES_TESTS',
  'PATCH_TOO_LARGE',
  'PATCH_UNEXPECTED_DELETE',
  'PATCH_BINARY_CHANGE',
  // CONTRATO DE EXECUÇÃO DA TASK (não é o bug voltando): a task substituta da retomada nasce com
  // `scopeDeferred` (o spec traz `allowedPaths: []` e o escopo é resolvido no planejamento). Quando
  // o escopo não é resolvido, o patch é recusado ANTES de aplicar (`NO_PATCH_SCOPE`) — medido no
  // ciclo local de 2026-10-29. Também entram aqui as falhas de INFRA que impedem a tentativa
  // (nenhum coder qualificado, provider indisponível): nenhuma delas é o comportamento do produto
  // regredindo, e todas são registradas como finding PRÓPRIO, nunca como recorrência do bug.
  // Falha de TESTE (a spec falhando de verdade) NUNCA entra nesta lista: essa é recorrência real.
  'NO_PATCH_SCOPE',
  'NO_QUALIFIED_CODER',
  'NO_ALTERNATIVE_CANDIDATE',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_EXHAUSTED',
]);

/** Estados em que o finding da missão já foi corrigido e validado (pós-correção). */
const POST_FIX_FINDING_STATUSES = Object.freeze(['FIXED', 'REGRESSION_VALIDATED', 'CLOSED']);

/**
 * @returns {{
 *   isCoderContractFailure: boolean,
 *   hasPostFixFinding: boolean,
 *   isFalseRecurrence: boolean,
 *   fingerprintScope: 'coder_contract'|'application',
 *   reason: string,
 * }}
 */
function classifyPostFixFailure({ failureKind = null, failureKinds = [], reasonCode = null, reasonCodes = [], findings = [] } = {}) {
  const normalizar = (v) => (typeof v === 'string' ? v.trim().toUpperCase() : '');
  // FONTE MÚLTIPLA DE PROPÓSITO: a task pode terminar em `ENGINEERING_TASK_EXHAUSTED` (o código de
  // FORA) enquanto o modo REAL de falha — patch recusado — está no `failure_bundle` de cada
  // tentativa. Olhar só `result.reasonCode` perderia exatamente o caso medido em 2026-10-29.
  const kinds = [...(Array.isArray(failureKinds) ? failureKinds : []), failureKind].map(normalizar).filter(Boolean);
  const codes = [...(Array.isArray(reasonCodes) ? reasonCodes : []), reasonCode].map(normalizar).filter(Boolean);
  const kind = kinds[0] || '';
  const code = codes[0] || '';
  const isCoderContractFailure = kinds.some((k) => CODER_CONTRACT_FAILURE_KINDS.includes(k))
    || codes.some((c) => CODER_CONTRACT_REASON_CODES.includes(c));

  const lista = Array.isArray(findings) ? findings : [];
  const postFix = lista.find((f) => POST_FIX_FINDING_STATUSES.includes(String((f && f.status) || '').toUpperCase())) || null;
  const hasPostFixFinding = Boolean(postFix);

  const isFalseRecurrence = isCoderContractFailure && hasPostFixFinding;
  return {
    isCoderContractFailure,
    hasPostFixFinding,
    isFalseRecurrence,
    // A FINGERPRINT é o que decide recorrência: escopo próprio para a falha de contrato garante que
    // ela nunca reabra o finding corrigido, e continua sendo um finding próprio — visível e
    // corrigível, com contagem de ocorrências.
    fingerprintScope: isFalseRecurrence ? 'coder_contract' : 'application',
    reason: isFalseRecurrence
      ? `falha de contrato do coder (${kind || code}) com finding pós-correção (${postFix.status}) para a mesma missão — não é recorrência do bug`
      : (isCoderContractFailure
        ? `falha de contrato do coder (${kind || code}) sem finding pós-correção — comportamento normal`
        : 'falha não é de contrato do coder — caminho normal'),
  };
}

module.exports = {
  classifyPostFixFailure,
  CODER_CONTRACT_FAILURE_KINDS,
  CODER_CONTRACT_REASON_CODES,
  POST_FIX_FINDING_STATUSES,
};
