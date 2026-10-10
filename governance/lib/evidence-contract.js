'use strict';

/**
 * CONTRATO ÚNICO DE EVIDÊNCIA.
 *
 * Achado P1 (auditoria 2026-10-10): não existia um contrato único. Havia duas
 * famílias de artefatos com vocabulários distintos — o `evidence-manifest`
 * (`governance/proof-engine/index.js`) e a identidade/lineage de candidato/payload
 * (`governance/release-artifact-identity.js`) — e campos que a missão exige
 * simplesmente NÃO existiam em lugar nenhum (`environmentFingerprint`,
 * `configuration_hash`, `producer` como identidade verificável do executor).
 * Cada gate conferia o que lembrava, e "evidência ausente" podia virar PASS.
 *
 * Este módulo define o conjunto mínimo de campos e as recusas correspondentes, em
 * uma decisão PURA (sem `fs`, sem clock) que qualquer gate pode consumir — e que
 * pode ser medida ANTES de virar bloqueio (`report-evidence-contract.js`), para o
 * endurecimento não ser um pulo no escuro.
 *
 * Vocabulário de resultado: PASS | FAIL | INCOMPLETE | NOT_APPLICABLE. `INCOMPLETE`
 * é distinto de `FAIL`: o artefato existe, mas não carrega o que prova o vínculo
 * (é o caso que antes passava em silêncio).
 */

/** Campos mínimos de um artefato de evidência governado. */
const REQUIRED_FIELDS = Object.freeze([
  'runId',                    // qual run produziu
  'sourceCommit',             // sobre qual commit — nunca "o HEAD de agora"
  'candidateCommit',          // qual candidato foi avaliado
  'artifactHash',             // hash do próprio artefato
  'environmentFingerprint',   // onde rodou (ambiente)
  'configurationHash',        // sob qual configuração
  'policyVersion',            // sob qual política foi avaliado
  'testPlanHash',             // o que foi planejado executar
  'testResultHash',           // o que efetivamente rodou
  'evidenceManifestHash',     // vínculo com o manifesto de evidência
  'sourceFingerprint',        // qual árvore (código/cenários/políticas)
  'startedAt',                // início da execução
  'finishedAt',               // fim da execução
  'producer',                 // quem produziu (identidade verificável)
  'result',                   // veredito do artefato
  'blockingFindings',         // o que bloqueia (lista vazia ≠ ausente)
]);

/**
 * Aliases aceitos por campo (o vocabulário do repo não é uniforme; normalizar aqui
 * evita que cada gate invente a própria lista).
 */
const FIELD_ALIASES = Object.freeze({
  runId: ['runId', 'run_id', 'governanceRunId'],
  sourceCommit: ['sourceCommit', 'source_commit', 'gitCommit', 'git_commit'],
  candidateCommit: ['candidateCommit', 'candidate_commit'],
  artifactHash: ['artifactHash', 'artifact_hash', 'hash', 'sha256'],
  environmentFingerprint: ['environmentFingerprint', 'environment_fingerprint', 'runtimeRoot'],
  configurationHash: ['configurationHash', 'configuration_hash', 'configHash'],
  policyVersion: ['policyVersion', 'policy_version'],
  testPlanHash: ['testPlanHash', 'test_plan_hash'],
  testResultHash: ['testResultHash', 'test_result_hash'],
  evidenceManifestHash: ['evidenceManifestHash', 'evidence_manifest_hash'],
  sourceFingerprint: ['sourceFingerprint', 'source_fingerprint'],
  startedAt: ['startedAt', 'started_at'],
  finishedAt: ['finishedAt', 'finished_at', 'completedAt', 'completed_at'],
  producer: ['producer', 'producerId', 'generated_by', 'generator', 'engine'],
  result: ['result', 'decision', 'status', 'proofStatus'],
  blockingFindings: ['blockingFindings', 'blocking_findings', 'blocking'],
  // Campo de conveniência para a checagem de evidência PRÉ-RUN (não é campo do
  // contrato da missão; `timestamp` do artefato serve de `generatedAt`).
  generatedAt: ['generatedAt', 'generated_at', 'createdAt', 'timestamp'],
});

const CODES = Object.freeze({
  OK: 'EVIDENCE_OK',
  FIELD_MISSING: 'EVIDENCE_FIELD_MISSING',
  FOREIGN_RUN: 'EVIDENCE_FOREIGN_RUN',
  STALE: 'EVIDENCE_STALE',
  RESULT_MISSING: 'EVIDENCE_RESULT_MISSING',
  NOT_AN_OBJECT: 'EVIDENCE_NOT_AN_OBJECT',
});

function pick(record, field) {
  if (!record || typeof record !== 'object') return undefined;
  for (const alias of FIELD_ALIASES[field] || [field]) {
    const value = record[alias];
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    return value;
  }
  return undefined;
}

function parseTime(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/**
 * Avalia UM artefato de evidência contra o contrato.
 *
 * @param {Object} params
 * @param {Object} params.record - artefato de evidência (já parseado)
 * @param {Object|null} [params.currentRun] - `governance/.current-run.json`
 * @param {string[]} [params.requiredFields] - subconjunto exigido (default: contrato)
 * @param {boolean} [params.allowForeignRun=false] - quando o artefato é legitimamente de outro run
 * @returns {{result:'PASS'|'INCOMPLETE', codes:string[], missing:string[], detail:Object}}
 */
function evaluateEvidenceArtifact({ record, currentRun = null, requiredFields = REQUIRED_FIELDS, allowForeignRun = false } = {}) {
  if (!record || typeof record !== 'object') {
    return {
      result: 'INCOMPLETE',
      codes: [CODES.NOT_AN_OBJECT],
      missing: [...requiredFields],
      detail: { reason: 'artefato de evidência ausente ou não é objeto' },
    };
  }

  const missing = [];
  for (const field of requiredFields) {
    // `pick` normaliza pelos ALIASES do campo — conferir `blockingFindings` fora
    // dessa lista (como uma versão anterior fazia) rejeitava o artefato que usa o
    // vocabulário real do repo (`blocking`), que é exatamente o caso que o teste
    // de aliases cobre. Lista vazia continua VÁLIDA: `pick` só descarta
    // undefined/null/string-vazia, então `[]` significa "nada bloqueia" (presente),
    // enquanto a ausência da chave não prova nada.
    if (pick(record, field) === undefined) missing.push(field);
  }

  const codes = [];
  if (missing.length > 0) codes.push(CODES.FIELD_MISSING);

  // Resultado é o campo cuja ausência silenciosa é mais perigosa: sem veredito,
  // "não sei" passa a ser lido como sucesso.
  if (pick(record, 'result') === undefined) codes.push(CODES.RESULT_MISSING);

  // Evidência ESTRANGEIRA: runId do artefato != run corrente.
  if (!allowForeignRun && currentRun) {
    const recordRunId = pick(record, 'runId');
    const currentRunId = pick(currentRun, 'runId');
    if (recordRunId && currentRunId && String(recordRunId) !== String(currentRunId)) {
      codes.push(CODES.FOREIGN_RUN);
    }
  }

  // Evidência PRÉ-RUN: produzida antes do run começar não pode atestá-lo.
  const generatedAt = parseTime(pick(record, 'generatedAt'));
  const startedAt = currentRun ? parseTime(pick(currentRun, 'startedAt')) : null;
  if (generatedAt !== null && startedAt !== null && generatedAt < startedAt) {
    codes.push(CODES.STALE);
  }

  // FAIL e INCOMPLETE não são sinônimos:
  //   FAIL       — o artefato é INVÁLIDO para este run (de outro run, anterior,
  //                ou nem é artefato): a evidência não pode ser usada;
  //   INCOMPLETE — o artefato é do run, mas não carrega tudo que prova o vínculo
  //                (é o caso que antes passava em silêncio).
  const hardFail = codes.some((code) => [CODES.FOREIGN_RUN, CODES.STALE, CODES.NOT_AN_OBJECT].includes(code));
  const result = codes.length === 0 ? 'PASS' : (hardFail ? 'FAIL' : 'INCOMPLETE');
  return {
    result,
    codes: codes.length === 0 ? [CODES.OK] : codes,
    missing,
    detail: {
      runId: pick(record, 'runId') || null,
      currentRunId: currentRun ? (pick(currentRun, 'runId') || null) : null,
      generatedAt: pick(record, 'generatedAt') || null,
      runStartedAt: currentRun ? (pick(currentRun, 'startedAt') || null) : null,
    },
  };
}

/**
 * Agrega a avaliação de vários artefatos: quantos passam, quais campos faltam e
 * quais códigos dominam. Serve de diagnóstico ANTES de virar gate bloqueante.
 */
function summarizeEvidenceContract({ records = [], currentRun = null, requiredFields = REQUIRED_FIELDS } = {}) {
  const missingByField = {};
  const byCode = {};
  const violations = [];

  for (const entry of Array.isArray(records) ? records : []) {
    const name = entry && (entry.name || entry.path || entry.id) ? String(entry.name || entry.path || entry.id) : 'unnamed';
    const verdict = evaluateEvidenceArtifact({ record: entry && entry.record, currentRun, requiredFields });
    if (verdict.result === 'PASS') continue;
    // `detail` entra na violação de propósito: sem `generatedAt`/`runStartedAt` o
    // relatório diz QUE o artefato é stale, mas não POR QUE (e o "por que" é o que
    // permite corrigir a origem em vez de só re-gerar o arquivo).
    violations.push({ name, codes: verdict.codes, missing: verdict.missing, detail: verdict.detail });
    for (const code of verdict.codes) byCode[code] = (byCode[code] || 0) + 1;
    for (const field of verdict.missing) missingByField[field] = (missingByField[field] || 0) + 1;
  }

  const total = Array.isArray(records) ? records.length : 0;
  return {
    total,
    passed: total - violations.length,
    violations: violations.length,
    missingByField,
    byCode,
    details: violations,
    // Diagnóstico, não gate: quem decide bloquear é a governança de release.
    enforced: false,
  };
}

module.exports = {
  REQUIRED_FIELDS,
  FIELD_ALIASES,
  CODES,
  evaluateEvidenceArtifact,
  summarizeEvidenceContract,
};
