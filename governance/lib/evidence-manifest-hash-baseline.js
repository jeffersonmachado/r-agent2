'use strict';

/**
 * Decisão do check de imutabilidade do `governance/evidence-manifest.json` usado
 * pelo `package-integrity-engine`.
 *
 * Achado P0 (2026-10-10): o check era VACUOSO. O baseline era lido de
 * `final-consistency-report.json` em `packageImmutability.evidenceManifestHash`,
 * bloco que NENHUM produtor criava — a ausência de baseline virava
 * `pass: true` com a nota "No stored hash baseline to compare against".
 * Consequência: o check nunca podia falhar, e um baseline de OUTRO run (ou
 * nenhum) era indistinguível de um baseline correto. O produtor
 * (`update-package-binding.js`) passou a criar o bloco; esta função decide.
 *
 * Módulo PURO (sem `fs`): a decisão é função dos dados, testável offline e sem
 * tocar o workspace real — foi extraída justamente porque inline só era
 * exercitável via o disco do repositório.
 */

const CODES = Object.freeze({
  OK: 'EVIDENCE_MANIFEST_HASH_OK',
  UNREADABLE: 'EVIDENCE_MANIFEST_HASH_UNREADABLE',
  BASELINE_MISSING: 'EVIDENCE_MANIFEST_HASH_BASELINE_MISSING',
  FOREIGN_RUN: 'EVIDENCE_MANIFEST_HASH_BASELINE_FOREIGN_RUN',
  STALE_SOURCE: 'EVIDENCE_MANIFEST_HASH_BASELINE_STALE_SOURCE',
  DIVERGENT: 'EVIDENCE_MANIFEST_HASH_DIVERGENT',
});

function nonEmpty(value) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text === '' ? null : text;
}

/**
 * @param {Object} params
 * @param {string|null} params.computed - sha256 do evidence manifest no disco
 * @param {Object|null} params.baseline - bloco atestado (`packageImmutability`/`evidenceConsistency`)
 * @param {Object|null} params.currentRun - `governance/.current-run.json` (pode ser null)
 * @returns {{pass:boolean, severity:'OK'|'HIGH', code:string, reason:string|null}}
 */
function evaluateEvidenceManifestHashBaseline({ computed, baseline, currentRun } = {}) {
  const computedHash = nonEmpty(computed);

  // 1. Sem hash do arquivo não há o que comparar. Antes, a ausência do PRÓPRIO
  //    manifest já era FAIL; mantém-se (fail-closed) com código próprio.
  if (!computedHash) {
    return {
      pass: false,
      severity: 'HIGH',
      code: CODES.UNREADABLE,
      reason: 'governance/evidence-manifest.json ausente ou ilegível — imutabilidade não verificável',
    };
  }

  const recordedHash = nonEmpty(baseline && baseline.evidenceManifestHash);

  // 2. Ausência de baseline é FALHA, não PASS: sem atestação não existe prova.
  //    "Não há dado" nunca é o mesmo que "o dado confere".
  if (!recordedHash) {
    return {
      pass: false,
      severity: 'HIGH',
      code: CODES.BASELINE_MISSING,
      reason: 'baseline de imutabilidade do evidence manifest ausente — o check não pode passar por falta de dado atestado',
    };
  }

  // 3. Evidência estrangeira: baseline de OUTRO run/árvore. Comparado apenas
  //    quando ambos os lados existem — ausência de run corrente não é provada
  //    como divergência (não se inventa recusa a partir de dado faltante).
  const runId = nonEmpty(currentRun && currentRun.runId);
  const recordedRunId = nonEmpty(baseline && baseline.runId);
  if (runId && recordedRunId && runId !== recordedRunId) {
    return {
      pass: false,
      severity: 'HIGH',
      code: CODES.FOREIGN_RUN,
      reason: `baseline pertence a outro run (${recordedRunId} != ${runId})`,
    };
  }

  const sourceFp = nonEmpty(currentRun && currentRun.sourceFingerprint);
  const recordedFp = nonEmpty(baseline && baseline.sourceFingerprint);
  if (sourceFp && recordedFp && sourceFp !== recordedFp) {
    return {
      pass: false,
      severity: 'HIGH',
      code: CODES.STALE_SOURCE,
      reason: `baseline atestado para outra árvore de código (sourceFingerprint divergente)`,
    };
  }

  // 4. Hash divergente: a evidência mudou depois de atestada.
  if (recordedHash !== computedHash) {
    return {
      pass: false,
      severity: 'HIGH',
      code: CODES.DIVERGENT,
      reason: 'Evidence manifest hash diverge — evidence foi alterada após a atestação',
    };
  }

  return { pass: true, severity: 'OK', code: CODES.OK, reason: null };
}

module.exports = { CODES, evaluateEvidenceManifestHashBaseline };
