'use strict';

/**
 * engine/engineeringMission/bugFinding/preventiveRules.js
 *
 * ENGINEERING MEMORY — ciclo governado de PROBLEMA CONHECIDO.
 *
 *   INCIDENT → ROOT_CAUSE → KNOWN_PROBLEM → PREVENTIVE_RULE → EXECUTABLE_TEST
 *            → REGRESSION → VERIFIED
 *
 * DEFEITO MEDIDO (auditoria 2026-10-08). O registro `EngineeringBugFinding` já tinha causa raiz,
 * componentes afetados, evidências tipadas, correção, teste de regressão e estado de verificação —
 * mas NÃO tinha (a) regra preventiva, (b) versão de introdução/correção, nem (c) identidade estável
 * desacoplada do algoritmo de fingerprint. Pior: a memória de engenharia era puramente ADITIVA
 * (`blocksAutoApproval: false`, consulta opcional), então nada impedia que a MESMA classe de falha
 * voltasse — a "prevenção" era detectar a reincidência depois do fato.
 *
 * Duas invariantes que este módulo garante, ambas fail-closed:
 *
 *  1. REGRA NÃO VERIFICADA NUNCA VIRA OBRIGATÓRIA. Só um registro `ACTIVE` é retornado por
 *     `activeRules()`; a ativação é recusada enquanto o finding não chegou a
 *     `REGRESSION_VALIDATED`/`CLOSED` (ou seja, enquanto a prevenção não foi provada por execução).
 *  2. REGISTRO INCOMPLETO NÃO ATIVA. `validateKnownProblem` exige os 11 campos do problema
 *     conhecido, inclusive um TESTE EXECUTÁVEL — uma "regra" sem teste não é prevenção, é prosa.
 *
 * Módulo PURO (sem I/O, sem clock): `now` é sempre injetado pelo chamador.
 */

const crypto = require('crypto');

const PREVENTIVE_RULE_STATES = Object.freeze(['PROPOSED', 'ACTIVE', 'RETIRED']);

/** Estados do finding a partir dos quais a prevenção pode ser considerada PROVADA. */
const VERIFIED_FINDING_STATUSES = Object.freeze(['REGRESSION_VALIDATED', 'CLOSED']);

/**
 * Campos do registro de PROBLEMA CONHECIDO. Cada um responde a uma pergunta de auditoria que,
 * sem o campo, ficaria sem resposta verificável.
 */
const KNOWN_PROBLEM_REQUIRED_FIELDS = Object.freeze([
  'knownProblemId',       // identificador estável (independente da versão do algoritmo de fingerprint)
  'rootCause',            // causa raiz
  'affectedComponents',   // componentes afetados (paths/subsistemas)
  'occurrenceEvidence',   // evidências de ocorrência (refs tipadas)
  'fix',                  // correção aplicada
  'preventiveRule',       // regra preventiva (texto acionável, alvo do teste)
  'regressionTest',       // teste de não regressão EXECUTÁVEL
  'introducedIn',         // versão de introdução
  'fixedIn',              // versão de correção
  'verificationState',    // estado de verificação
  'provenance',           // proveniência
]);

const PREVENTIVE_RULE_FAILURE_CODES = Object.freeze({
  KNOWN_PROBLEM_INCOMPLETE: 'KNOWN_PROBLEM_INCOMPLETE',
  PREVENTIVE_RULE_MISSING: 'PREVENTIVE_RULE_MISSING',
  PREVENTIVE_RULE_UNVERIFIED: 'PREVENTIVE_RULE_UNVERIFIED',
  PREVENTIVE_RULE_NOT_EXECUTABLE: 'PREVENTIVE_RULE_NOT_EXECUTABLE',
  PREVENTIVE_RULE_INVALID_STATE: 'PREVENTIVE_RULE_INVALID_STATE',
  // A regra aponta para um teste que NUNCA foi executado (ou cuja execução não
  // passou). Existir o caminho não prova que o teste roda nem que passa.
  PREVENTIVE_RULE_TEST_NOT_EXECUTED: 'PREVENTIVE_RULE_TEST_NOT_EXECUTED',
  // A execução não diz a que código corresponde (sem commit/fingerprint): não é
  // possível afirmar que ela é a do código corrigido.
  PREVENTIVE_RULE_TEST_PROVENANCE_MISSING: 'PREVENTIVE_RULE_TEST_PROVENANCE_MISSING',
  // Causa raiz sem proveniência demonstrável: sintoma não é causa.
  ROOT_CAUSE_UNVERIFIED: 'ROOT_CAUSE_UNVERIFIED',
});

const EMPTY = (value) => value === null || value === undefined
  || (typeof value === 'string' && value.trim() === '')
  || (Array.isArray(value) && value.length === 0);

/**
 * Identificador ESTÁVEL do problema conhecido.
 *
 * Diferente do `fingerprint` (derivado do sintoma e sensível à versão do algoritmo — mudar o
 * algoritmo órfãa todo o histórico), este id é derivado de (fingerprint, versão do fingerprint,
 * classe de causa raiz). É EXPLÍCITO que ele muda quando a versão do algoritmo muda: o registro
 * guarda `fingerprintVersion` junto, então a migração pode re-mapear o histórico em vez de
 * perdê-lo em silêncio.
 */
function computeKnownProblemId({ fingerprint = '', fingerprintVersion = '', rootCauseClass = '' } = {}) {
  const digest = crypto.createHash('sha256')
    .update(`${fingerprintVersion}\u0000${fingerprint}\u0000${rootCauseClass}`, 'utf8')
    .digest('hex')
    .slice(0, 24);
  return `kp-${digest}`;
}

/**
 * Constrói o registro normalizado de problema conhecido. SEMPRE nasce `PROPOSED` — ativação
 * exige prova de execução (ver `canActivate`).
 */
function buildKnownProblem({
  fingerprint = '', fingerprintVersion = '', rootCauseClass = '',
  rootCause = null, affectedComponents = [], occurrenceEvidence = [], fix = null,
  preventiveRule = null, regressionTest = null, introducedIn = null, fixedIn = null,
  verificationState = null, provenance = null,
} = {}) {
  return {
    knownProblemId: computeKnownProblemId({ fingerprint, fingerprintVersion, rootCauseClass }),
    fingerprint,
    fingerprintVersion,
    rootCauseClass,
    state: 'PROPOSED',
    rootCause,
    affectedComponents: Array.isArray(affectedComponents) ? [...affectedComponents] : [],
    occurrenceEvidence: Array.isArray(occurrenceEvidence) ? [...occurrenceEvidence] : [],
    fix,
    preventiveRule,
    regressionTest,
    introducedIn,
    fixedIn,
    verificationState,
    provenance,
    activatedAt: null,
  };
}

/** Um teste de não regressão é EXECUTÁVEL quando aponta para um arquivo OU para um comando. */
function isExecutableRegressionTest(test) {
  if (!test || typeof test !== 'object') return false;
  const path = typeof test.path === 'string' ? test.path.trim() : '';
  const command = typeof test.command === 'string' ? test.command.trim() : '';
  return path !== '' || command !== '';
}

/**
 * O teste preventivo foi REALMENTE EXECUTADO, passou e é rastreável ao código?
 *
 * DEFEITO MEDIDO (auditoria 2026-10-10): `isExecutableRegressionTest` só checava
 * se o campo `path`/`command` era uma string não-vazia — ou seja, uma regra
 * preventiva podia virar OBRIGATÓRIA citando um teste que não existe, que nunca
 * rodou ou que nunca passou. "Prevenção" sem execução é prosa.
 *
 * Exige, na ativação:
 *   - `execution.status === 'PASS'` e `execution.exitCode === 0`;
 *   - PROCEDÊNCIA da execução (`sourceFingerprint` ou `commit`), senão não há como
 *     afirmar que a execução corresponde ao código CORRIGIDO.
 *
 * @returns {{ok:boolean, code?:string, reason?:string}}
 */
function evaluateRegressionTestExecution(test) {
  if (!isExecutableRegressionTest(test)) {
    return {
      ok: false,
      code: PREVENTIVE_RULE_FAILURE_CODES.PREVENTIVE_RULE_NOT_EXECUTABLE,
      reason: 'teste de não regressão sem caminho nem comando',
    };
  }
  const execution = test.execution;
  if (!execution || typeof execution !== 'object') {
    return {
      ok: false,
      code: PREVENTIVE_RULE_FAILURE_CODES.PREVENTIVE_RULE_TEST_NOT_EXECUTED,
      reason: 'teste preventivo NUNCA executado (sem registro de execução) — apontar para um arquivo não prova que ele roda',
    };
  }
  const status = String(execution.status || '').toUpperCase();
  const exitCode = execution.exitCode === undefined || execution.exitCode === null
    ? null : Number(execution.exitCode);
  if (status !== 'PASS' || exitCode !== 0) {
    return {
      ok: false,
      code: PREVENTIVE_RULE_FAILURE_CODES.PREVENTIVE_RULE_TEST_NOT_EXECUTED,
      reason: `execução do teste preventivo não é verde (status=${status || 'ausente'} exitCode=${exitCode})`,
    };
  }
  const fingerprint = typeof execution.sourceFingerprint === 'string' ? execution.sourceFingerprint.trim() : '';
  const commit = typeof execution.commit === 'string' ? execution.commit.trim() : '';
  if (fingerprint === '' && commit === '') {
    return {
      ok: false,
      code: PREVENTIVE_RULE_FAILURE_CODES.PREVENTIVE_RULE_TEST_PROVENANCE_MISSING,
      reason: 'execução sem procedência (sourceFingerprint/commit) — não é possível ligá-la ao código corrigido',
    };
  }
  return { ok: true, evidence: { status, exitCode, sourceFingerprint: fingerprint || null, commit: commit || null } };
}

/**
 * A causa raiz tem proveniência DEMONSTRÁVEL?
 *
 * Aceita `DERIVED_FROM_OCCURRENCE` (derivada de evidência medida da ocorrência) e
 * `DECLARED` (declaração humana registrada como tal). Recusa ausência de
 * proveniência e `ABSENT`: sem isso, uma descrição de SINTOMA viraria causa raiz e
 * a regra preventiva seria construída sobre uma suposição.
 */
const ACCEPTED_ROOT_CAUSE_SOURCES = Object.freeze(['DECLARED', 'DERIVED_FROM_OCCURRENCE']);

function evaluateRootCauseProvenance(record) {
  const source = record && record.provenance && typeof record.provenance === 'object'
    ? String(record.provenance.rootCauseSource || '').toUpperCase()
    : '';
  if (!ACCEPTED_ROOT_CAUSE_SOURCES.includes(source)) {
    return {
      ok: false,
      code: PREVENTIVE_RULE_FAILURE_CODES.ROOT_CAUSE_UNVERIFIED,
      reason: `causa raiz sem proveniência demonstrável (rootCauseSource=${source || 'ausente'}) — sintoma não é causa`,
    };
  }
  return { ok: true, source };
}

/**
 * Valida a COMPLETUDE do registro. Fail-closed: qualquer campo ausente/vazio reprova.
 * @returns {{ok:boolean, missing:string[], code?:string}}
 */
function validateKnownProblem(record) {
  const missing = [];
  if (!record || typeof record !== 'object') {
    return { ok: false, missing: [...KNOWN_PROBLEM_REQUIRED_FIELDS], code: PREVENTIVE_RULE_FAILURE_CODES.KNOWN_PROBLEM_INCOMPLETE };
  }
  for (const field of KNOWN_PROBLEM_REQUIRED_FIELDS) {
    if (EMPTY(record[field])) missing.push(field);
  }
  // `occurrenceEvidence` e `affectedComponents` são arrays: `EMPTY` já cobre vazio.
  if (!missing.includes('regressionTest') && !isExecutableRegressionTest(record.regressionTest)) {
    return {
      ok: false,
      missing: [...missing, 'regressionTest(executável)'],
      code: PREVENTIVE_RULE_FAILURE_CODES.PREVENTIVE_RULE_NOT_EXECUTABLE,
    };
  }
  if (missing.length > 0) {
    return { ok: false, missing, code: PREVENTIVE_RULE_FAILURE_CODES.KNOWN_PROBLEM_INCOMPLETE };
  }
  if (!PREVENTIVE_RULE_STATES.includes(record.state)) {
    return { ok: false, missing: ['state'], code: PREVENTIVE_RULE_FAILURE_CODES.PREVENTIVE_RULE_INVALID_STATE };
  }
  return { ok: true, missing: [] };
}

/**
 * Uma regra preventiva só pode se tornar OBRIGATÓRIA (ACTIVE) quando:
 *  (a) o registro está completo (inclui teste executável), E
 *  (b) o finding chegou a um estado que PROVA a correção por execução (REGRESSION_VALIDATED/CLOSED).
 *
 * Sem (b), promover seria transformar uma suspeita em regra de obrigação — exatamente o que a
 * missão proíbe ("Impeça que memórias não verificadas se tornem regras obrigatórias").
 */
function canActivate(record, { findingStatus = null } = {}) {
  const validation = validateKnownProblem(record);
  if (!validation.ok) {
    return {
      allowed: false,
      code: validation.code || PREVENTIVE_RULE_FAILURE_CODES.KNOWN_PROBLEM_INCOMPLETE,
      missing: validation.missing,
      reason: `problema conhecido incompleto (faltando: ${validation.missing.join(', ')})`,
    };
  }
  if (!VERIFIED_FINDING_STATUSES.includes(findingStatus)) {
    return {
      allowed: false,
      code: PREVENTIVE_RULE_FAILURE_CODES.PREVENTIVE_RULE_UNVERIFIED,
      missing: ['verificationState(provada por execução)'],
      reason: `finding em ${findingStatus || 'desconhecido'} não prova a correção — regra permanece PROPOSED`,
    };
  }
  // CAUSA RAIZ: sem proveniência demonstrável a regra nasceria de uma suposição.
  const rootCause = evaluateRootCauseProvenance(record);
  if (!rootCause.ok) {
    return { allowed: false, code: rootCause.code, missing: ['rootCause(proveniência)'], reason: rootCause.reason };
  }
  // TESTE PREVENTIVO: precisa ter sido EXECUTADO e passado, com procedência. Citar
  // um caminho não prova que o teste existe, roda ou passa.
  const execution = evaluateRegressionTestExecution(record.regressionTest);
  if (!execution.ok) {
    return { allowed: false, code: execution.code, missing: ['regressionTest(executado)'], reason: execution.reason };
  }
  return {
    allowed: true,
    evidence: {
      findingStatus,
      knownProblemId: record.knownProblemId,
      rootCauseSource: rootCause.source,
      regressionTest: execution.evidence,
    },
  };
}

/**
 * Ativa o registro (imutável — devolve uma CÓPIA). Nunca ativa por omissão.
 * @throws {Error} com `.code` estável quando `canActivate` recusa.
 */
function activate(record, { findingStatus = null, now = null } = {}) {
  const check = canActivate(record, { findingStatus });
  if (!check.allowed) {
    const err = new Error(check.reason);
    err.code = check.code;
    err.missing = check.missing;
    err.detail = { knownProblemId: record && record.knownProblemId, findingStatus };
    throw err;
  }
  return { ...record, state: 'ACTIVE', activatedAt: now, verificationState: 'VERIFIED' };
}

/**
 * Regras que podem ser IMPOSTAS — somente ACTIVE. Memória não verificada é consultável
 * (`PROPOSED`) mas nunca obrigatória.
 */
function activeRules(records) {
  return (Array.isArray(records) ? records : []).filter((r) => r && r.state === 'ACTIVE');
}

/**
 * Enforcement de fechamento: um finding cuja classe é PERIGOSA (self-modification) ou que já
 * REINCIDIU precisa de prevenção ativa e verificada antes de ser fechado. Recorrência é a prova
 * de que a prevenção anterior falhou; self-modification é onde a ausência de prevenção permite
 * afrouxar o próprio critério de julgamento.
 *
 * @returns {{required:boolean, allowed:boolean, code?:string, reason?:string}}
 */
function requiresActivePrevention({ selfModification = false, recurrenceCount = 0 } = {}) {
  const recurrence = Number(recurrenceCount || 0);
  if (selfModification === true) {
    return { required: true, reason: 'finding de SELF_MODIFICATION' };
  }
  if (Number.isFinite(recurrence) && recurrence > 0) {
    return { required: true, reason: `finding REINCIDENTE (${recurrence}x) — a prevenção anterior falhou` };
  }
  return { required: false };
}

function assertPreventionBeforeClose({ record = null, selfModification = false, recurrenceCount = 0 } = {}) {
  const requirement = requiresActivePrevention({ selfModification, recurrenceCount });
  if (!requirement.required) return { required: false, allowed: true };

  if (!record) {
    return {
      required: true,
      allowed: false,
      code: PREVENTIVE_RULE_FAILURE_CODES.PREVENTIVE_RULE_MISSING,
      reason: `fechamento recusado: ${requirement.reason} exige registro de problema conhecido com regra preventiva e teste de não regressão`,
    };
  }
  if (record.state !== 'ACTIVE') {
    return {
      required: true,
      allowed: false,
      code: PREVENTIVE_RULE_FAILURE_CODES.PREVENTIVE_RULE_UNVERIFIED,
      reason: `fechamento recusado: regra preventiva em ${record.state} — só ACTIVE (verificada por execução) conta`,
    };
  }
  const validation = validateKnownProblem(record);
  if (!validation.ok) {
    return {
      required: true,
      allowed: false,
      code: validation.code || PREVENTIVE_RULE_FAILURE_CODES.KNOWN_PROBLEM_INCOMPLETE,
      missing: validation.missing,
      reason: `fechamento recusado: problema conhecido incompleto (faltando: ${validation.missing.join(', ')})`,
    };
  }
  return { required: true, allowed: true, knownProblemId: record.knownProblemId };
}

module.exports = {
  PREVENTIVE_RULE_STATES,
  VERIFIED_FINDING_STATUSES,
  KNOWN_PROBLEM_REQUIRED_FIELDS,
  PREVENTIVE_RULE_FAILURE_CODES,
  ACCEPTED_ROOT_CAUSE_SOURCES,
  computeKnownProblemId,
  buildKnownProblem,
  isExecutableRegressionTest,
  evaluateRegressionTestExecution,
  evaluateRootCauseProvenance,
  validateKnownProblem,
  canActivate,
  activate,
  activeRules,
  requiresActivePrevention,
  assertPreventionBeforeClose,
};
