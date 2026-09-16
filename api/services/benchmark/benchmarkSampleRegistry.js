'use strict';

/**
 * benchmarkSampleRegistry — CONSUMIDOR REAL do patch de pesquisa (§B7).
 *
 * `toSamplePatch()` vivia sem chamador. A consequência não foi só código morto:
 * o patch era produzido com `findingsInventory` em formato que o engine REJEITA
 * (objeto de contadores em vez de array de referências) e ninguém nunca
 * descobriu, porque ninguém nunca aplicou.
 *
 * Este módulo fecha o ciclo: aplica o patch derivado de fatos PERSISTIDOS ao
 * sample versionado (`config/benchmarks/<vertical>.json`) de forma TRANSACIONAL.
 *
 * Garantias:
 *   - só campos de PESQUISA são tocados. Arquétipos, baselines, dimensões,
 *     política de criticalidade e `marketScarcityExceptions` NUNCA são alterados;
 *   - `sampleSufficiencyClaim` nunca é escrito: quem declara suficiência é o
 *     engine, não a camada de execução;
 *   - patch sem NENHUM benchmark analisado é RECUSADO (`sample_patch_without_analysis`):
 *     não existe caminho para "atualizar o sample" sem trabalho real;
 *   - a escrita é atômica (tmp no mesmo diretório + rename). Se a validação pós-
 *     escrita falhar, o conteúdo anterior é restaurado;
 *   - `researchState` do sample NÃO é reescrito por conveniência: mudar esse
 *     campo muda a derivação de estado do engine, e isso é decisão do engine.
 */

const fsDefault = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const SAMPLES_DIR = path.join(ROOT_DIR, 'config', 'benchmarks');

const NOVELTY_KEYS = Object.freeze([
  'newCapabilities',
  'newRequiredCapabilities',
  'newCriticalCapabilities',
  'newJourneys',
  'newRequiredJourneys',
  'newCriticalJourneys',
  'newBusinessRules',
  'newRequiredBusinessRules',
  'newCriticalBusinessRules',
]);

const ERROR_CODES = Object.freeze({
  PATCH_WITHOUT_ANALYSIS: 'sample_patch_without_analysis',
  FINDINGS_INVENTORY_INVALID: 'sample_patch_findings_inventory_invalid',
  VERTICAL_MISMATCH: 'sample_patch_vertical_mismatch',
  SAMPLE_NOT_FOUND: 'sample_file_not_found',
  VALIDATION_FAILED: 'sample_patch_validation_failed',
  ENGINE_UNAVAILABLE: 'sample_validation_engine_unavailable',
});

/** Eixos cuja completude PROVA que um inventário vazio é novidade medida (T-B1). */
const RESEARCH_AXIS_IDS = Object.freeze(['CAPABILITY_AXIS', 'JOURNEY_AXIS', 'BUSINESS_RULE_AXIS']);

function registryError(code, message, extra = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeNovelty(novelty) {
  const result = {};
  for (const key of NOVELTY_KEYS) {
    result[key] = Array.isArray(novelty?.[key]) ? novelty[key] : [];
  }
  return result;
}

/**
 * Mescla o patch no sample — função PURA (sem IO), para ser testável e para que
 * o efeito de uma escrita possa ser auditado linha a linha.
 *
 * Fontes são mescladas por URL (preserva `note` e qualquer anotação humana);
 * novidade é substituída APENAS pelas chaves canônicas (um patch não pode
 * introduzir chave arbitrária no contrato do engine).
 *
 * @returns {{sample: object, applied: string[], unmatched: string[]}}
 */
function mergeSamplePatch(sample, patch) {
  if (!sample || typeof sample !== 'object') {
    throw registryError(ERROR_CODES.SAMPLE_NOT_FOUND, 'sample ausente');
  }
  if (!patch || !Array.isArray(patch.benchmarks)) {
    throw registryError(ERROR_CODES.PATCH_WITHOUT_ANALYSIS, 'patch sem benchmarks');
  }
  if (isNonEmptyString(patch.vertical) && isNonEmptyString(sample.vertical)
    && String(patch.vertical) !== String(sample.vertical)) {
    throw registryError(ERROR_CODES.VERTICAL_MISMATCH, `${patch.vertical} != ${sample.vertical}`);
  }

  const analyzed = patch.benchmarks.filter((benchmark) => isNonEmptyString(benchmark?.analyzedAt));
  if (analyzed.length === 0) {
    throw registryError(
      ERROR_CODES.PATCH_WITHOUT_ANALYSIS,
      'nenhum benchmark analisado no patch — não existe atualização sem pesquisa',
    );
  }

  const next = JSON.parse(JSON.stringify(sample));
  const benchmarksById = new Map((next.benchmarks || []).map((benchmark) => [benchmark.id, benchmark]));
  const applied = [];
  const unmatched = [];

  for (const incoming of patch.benchmarks) {
    const target = benchmarksById.get(incoming.id);
    if (!target) {
      unmatched.push(incoming.id);
      continue;
    }
    if (!isNonEmptyString(incoming.analyzedAt)) continue;

    // O inventário de um benchmark ANALISADO é um ARRAY de referências
    // verificadas. Coagir um formato inválido para `[]` esconderia exatamente o
    // bug que motivou este módulo (`findingsInventory` como objeto de
    // contadores): o engine considera análise NÃO PROVADA e a taxa de novidade
    // fica por ausência de trabalho.
    //
    // T-B1 (2026-09-15): o array VAZIO passa a ser legítimo quando — e somente
    // quando — o patch carrega a completude por eixo provando que os três eixos
    // foram efetivamente pesquisados (RESEARCHED_NO_FINDINGS é zero novidade
    // MEDIDO). Sem essa prova, inventário vazio continua recusado: "não
    // pesquisei" nunca pode ser escrito como "zero novidade".
    if (!Array.isArray(incoming.findingsInventory)) {
      throw registryError(
        ERROR_CODES.FINDINGS_INVENTORY_INVALID,
        `benchmark ${incoming.id}: findingsInventory deve ser array de referências verificadas`,
      );
    }
    if (incoming.findingsInventory.length === 0) {
      const axisProof = Array.isArray(incoming.axisCompleteness) ? incoming.axisCompleteness : [];
      const fullyResearched = axisProof.length > 0
        && RESEARCH_AXIS_IDS.every((axis) => axisProof.some(
          (entry) => entry && entry.axis === axis && entry.researched === true,
        ));
      if (!fullyResearched) {
        throw registryError(
          ERROR_CODES.FINDINGS_INVENTORY_INVALID,
          `benchmark ${incoming.id}: findingsInventory vazio exige os três eixos pesquisados (axisCompleteness)`,
        );
      }
    }

    target.analyzedAt = incoming.analyzedAt;
    target.researchVersion = incoming.researchVersion || target.researchVersion || null;
    target.findingsInventory = [...incoming.findingsInventory];
    target.marketArchetypeMapping = incoming.marketArchetypeMapping || null;
    // FITNESS-ABS-13 — frescor derivado da análise (fato + agenda de política)
    // é campo de PESQUISA: o gate de frescor lê `freshness.researchedAt`.
    if (incoming.freshness && typeof incoming.freshness === 'object') {
      target.freshness = { ...incoming.freshness };
    }
    // `analysisEvidence` do engine exige inventoryVersion POR BENCHMARK.
    if (isNonEmptyString(incoming.inventoryVersion) || isNonEmptyString(patch.inventoryVersion)) {
      target.inventoryVersion = incoming.inventoryVersion || patch.inventoryVersion;
    }

    if (Array.isArray(incoming.sources) && incoming.sources.length > 0) {
      const existingByUrl = new Map((target.sources || []).map((source) => [source.url, source]));
      target.sources = incoming.sources.map((source) => ({
        ...(existingByUrl.get(source.url) || {}),
        ...source,
      }));
    }

    if (incoming.novelty) target.novelty = normalizeNovelty(incoming.novelty);
    // "Ainda não classificado" trilha separada da novidade (campo de PESQUISA).
    if (Number.isFinite(incoming.unresolvedSemanticCandidates)) {
      target.unresolvedSemanticCandidates = incoming.unresolvedSemanticCandidates;
    }
    applied.push(incoming.id);
  }

  if (applied.length === 0) {
    throw registryError(
      ERROR_CODES.PATCH_WITHOUT_ANALYSIS,
      'nenhum benchmark do patch existe no sample — aplicar não alteraria nada',
      { unmatched },
    );
  }

  if (Array.isArray(patch.evidence) && patch.evidence.length > 0) {
    const existing = Array.isArray(next.evidence) ? next.evidence : [];
    const byId = new Map(existing.map((entry) => [entry.id, entry]));
    for (const entry of patch.evidence) {
      if (entry && isNonEmptyString(entry.id)) byId.set(entry.id, { ...(byId.get(entry.id) || {}), ...entry });
    }
    next.evidence = [...byId.values()];
  }

  // Registro do holdout: `analysedAt` só é escrito quando o PRÓPRIO benchmark do
  // holdout foi analisado — é um espelho de auditoria, nunca uma afirmação.
  if (next.holdout && isNonEmptyString(next.holdout.benchmarkId)) {
    const holdoutBenchmark = benchmarksById.get(next.holdout.benchmarkId);
    if (holdoutBenchmark && isNonEmptyString(holdoutBenchmark.analyzedAt)) {
      next.holdout.analysedAt = holdoutBenchmark.analyzedAt;
    }
  }

  return { sample: next, applied, unmatched };
}

/**
 * Aplica o patch ao arquivo do sample de forma TRANSACIONAL.
 *
 * @param {object} args
 * @param {object} args.patch
 * @param {string} [args.samplePath]
 * @param {object} [args.fs]           IO injetável (testes)
 * @param {Function} [args.validate]   validação pós-merge (engine); deve LANÇAR
 */
function applySamplePatch({ patch, samplePath = null, fs = fsDefault, validate = null } = {}) {
  const target = samplePath || path.join(SAMPLES_DIR, `${patch?.vertical || 'unknown'}.json`);
  if (!fs.existsSync(target)) {
    throw registryError(ERROR_CODES.SAMPLE_NOT_FOUND, target);
  }

  const original = fs.readFileSync(target, 'utf8');
  const sample = JSON.parse(original);
  const { sample: merged, applied, unmatched } = mergeSamplePatch(sample, patch);

  if (typeof validate === 'function') {
    try {
      validate(merged);
    } catch (error) {
      throw registryError(ERROR_CODES.VALIDATION_FAILED, error.message, { applied, unmatched });
    }
  }

  // Escrita atômica: tmp no MESMO diretório (rename entre dispositivos falharia).
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, target);
  } catch (error) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      fs.writeFileSync(target, original, 'utf8');
    } catch (_) {
      // Restauração é best-effort e declarada: o erro original é o que importa.
    }
    throw error;
  }

  return { samplePath: target, applied, unmatched };
}

module.exports = {
  NOVELTY_KEYS,
  ERROR_CODES,
  SAMPLES_DIR,
  mergeSamplePatch,
  applySamplePatch,
};
