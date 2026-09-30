'use strict';

/**
 * scripts/governance/lib/v2SealFreshness.js — FRESCOR DO SELO V2 (núcleo PURO).
 *
 * O selo do Engineering Router V2 é a autorização para publicar. Um selo de OUTRA fonte (ou de outro
 * run, ou velho) não autoriza o release deste código: é exatamente o "verde emprestado" que a
 * governança do repositório já teve de corrigir em outros artefatos (adoção retroativa de lineage,
 * evidência vencida degradada para STALE).
 *
 * Este módulo só DECIDE; quem lê arquivos é o verificador. Sem I/O aqui, a regra é testável nos dois
 * sentidos e não pode divergir entre o gate e quem o consome.
 *
 * Códigos (todos fail-closed):
 *   SEAL_MISSING           — não existe selo para julgar;
 *   SEAL_NOT_GO            — o selo existe e não está GO;
 *   SEAL_NO_SOURCE_BINDING — selo sem sourceFingerprint: não há como provar que é deste código;
 *   STALE_SEAL_SOURCE      — selo de OUTRO source (o código mudou depois de selado);
 *   SEAL_FOREIGN_RUN       — selo de outro run governado;
 *   STALE_SEAL_AGE         — selo mais velho que a janela permitida;
 *   SEAL_INVALID_TIMESTAMP — generatedAt ausente/ inválido (sem carimbo não há frescor).
 */

const CODES = Object.freeze({
  SEAL_MISSING: 'SEAL_MISSING',
  SEAL_NOT_GO: 'SEAL_NOT_GO',
  SEAL_NO_SOURCE_BINDING: 'SEAL_NO_SOURCE_BINDING',
  STALE_SEAL_SOURCE: 'STALE_SEAL_SOURCE',
  SEAL_FOREIGN_RUN: 'SEAL_FOREIGN_RUN',
  STALE_SEAL_AGE: 'STALE_SEAL_AGE',
  SEAL_INVALID_TIMESTAMP: 'SEAL_INVALID_TIMESTAMP',
});

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function parseTime(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {object} params
 * @param {object|null} params.seal        relatório de execução do selo (já lido do disco)
 * @param {string}      params.sourceFingerprint fingerprint do source ATUAL
 * @param {object|null} [params.lineage]   lineage do run governado corrente (autoridade única)
 * @param {number}      [params.now]       instante da avaliação (injetável para teste)
 * @param {number}      [params.maxAgeMs]  janela de validade do selo
 * @returns {{ok:boolean, codes:string[], violations:Array, ageMs:number|null, sealFingerprint:string|null, sealRunId:string|null}}
 */
function evaluateSealFreshness({
  seal = null,
  sourceFingerprint = null,
  lineage = null,
  now = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
} = {}) {
  const codes = [];
  const violations = [];

  if (!seal || typeof seal !== 'object') {
    codes.push(CODES.SEAL_MISSING);
    violations.push({ code: CODES.SEAL_MISSING, detail: 'nenhum selo V2 encontrado para julgar' });
    return { ok: false, codes, violations, ageMs: null, sealFingerprint: null, sealRunId: null, status: null };
  }

  const status = typeof seal.status === 'string' ? seal.status : null;
  const sealFingerprint = typeof seal.sourceFingerprint === 'string' && seal.sourceFingerprint.trim() !== ''
    ? seal.sourceFingerprint.trim()
    : null;
  const sealRunId = typeof seal.runId === 'string' && seal.runId.trim() !== '' ? seal.runId.trim() : null;
  const generatedAtMs = parseTime(seal.generatedAt);
  const ageMs = generatedAtMs === null ? null : Math.max(0, now - generatedAtMs);

  if (status !== 'GO') {
    codes.push(CODES.SEAL_NOT_GO);
    violations.push({ code: CODES.SEAL_NOT_GO, detail: `selo com status ${status || '(ausente)'} — só GO autoriza publicar`, status });
  }

  // BINDING AO SOURCE: sem fingerprint não há prova de que o selo é deste código.
  if (sourceFingerprint && !sealFingerprint) {
    codes.push(CODES.SEAL_NO_SOURCE_BINDING);
    violations.push({
      code: CODES.SEAL_NO_SOURCE_BINDING,
      detail: 'selo sem sourceFingerprint: publicado assim, ele autorizaria qualquer código, não o que foi selado',
    });
  } else if (sourceFingerprint && sealFingerprint && sealFingerprint !== sourceFingerprint) {
    codes.push(CODES.STALE_SEAL_SOURCE);
    violations.push({
      code: CODES.STALE_SEAL_SOURCE,
      detail: `selo de OUTRO source (selo=${String(sealFingerprint).slice(0, 12)}… atual=${String(sourceFingerprint).slice(0, 12)}…): o código mudou depois de selado`,
      sealFingerprint,
      sourceFingerprint,
    });
  }

  // BINDING AO RUN: selo de outro run governado não é prova deste.
  if (lineage && lineage.runId && sealRunId && sealRunId !== lineage.runId) {
    codes.push(CODES.SEAL_FOREIGN_RUN);
    violations.push({
      code: CODES.SEAL_FOREIGN_RUN,
      detail: `selo do run ${sealRunId} usado como prova do run ${lineage.runId}`,
      sealRunId,
      runId: lineage.runId,
    });
  }

  // FRESCOR TEMPORAL: sem carimbo não há frescor; velho demais é evidência vencida.
  if (generatedAtMs === null) {
    codes.push(CODES.SEAL_INVALID_TIMESTAMP);
    violations.push({ code: CODES.SEAL_INVALID_TIMESTAMP, detail: 'selo sem generatedAt válido: frescor não é presumível', generatedAt: seal.generatedAt || null });
  } else if (Number.isFinite(maxAgeMs) && maxAgeMs > 0 && ageMs > maxAgeMs) {
    codes.push(CODES.STALE_SEAL_AGE);
    violations.push({
      code: CODES.STALE_SEAL_AGE,
      detail: `selo com ${Math.round(ageMs / 60000)} min (janela permitida: ${Math.round(maxAgeMs / 60000)} min)`,
      ageMs,
      maxAgeMs,
    });
  }

  return {
    ok: violations.length === 0,
    codes,
    violations,
    ageMs,
    sealFingerprint,
    sealRunId,
    status,
    generatedAt: seal.generatedAt || null,
  };
}

module.exports = { CODES, DEFAULT_MAX_AGE_MS, evaluateSealFreshness, parseTime };
