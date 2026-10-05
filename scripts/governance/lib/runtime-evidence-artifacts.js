#!/usr/bin/env node
'use strict';

/**
 * runtime-evidence-artifacts.js — fonte UNICA da classificacao de artefatos por
 * MODO DE PRODUCAO.
 *
 * Existe por causa de um defeito real: `qa-mesh/go-no-go-report.json`, gerado
 * em 2026-09-18T10:46:59.739Z, foi estampado por
 * `scripts/governance/stamp-report-lineage.js` com o `runId`/`sourceFingerprint`
 * de um GovernanceRun criado ~9h32 depois. O `generatedAt` original foi
 * PRESERVADO, entao o relatorio passou a afirmar que um run de 20:18 produziu
 * algo das 10:46. Nenhum status foi alterado — e justamente por isso o defeito
 * era silencioso e pior que a ausencia de lineage: ele elimina a duvida
 * (o artefato parece pertencer ao run) sem criar a prova (nada rodou nele).
 *
 * MODOS
 *   RUNTIME_EVIDENCE — resultado de EXECUCAO (mesh, smoke, replay, vertical).
 *     So e prova do run em que foi executado. Exige lineage NA ORIGEM: o
 *     produtor recebe runId/sourceFingerprint ANTES de executar.
 *     NUNCA pode ser estampado a posteriori.
 *   DERIVED_REPORT — recomputavel pelo source atual por um validador
 *     deterministico. Pode ser estampado, e o stamp legitimo enquanto o
 *     conteudo foi produzido por esse validador.
 *
 * Zero I/O de banco: modulo puro, usado tanto pela guarda do produtor
 * (`stamp-report-lineage.js`) quanto pelo validador
 * (`validate-qa-evidence-same-run.js`).
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'config', 'runtime-evidence-artifacts.json');

const MODES = Object.freeze({
  RUNTIME_EVIDENCE: 'RUNTIME_EVIDENCE',
  DERIVED_REPORT: 'DERIVED_REPORT',
  CERTIFICATION_ARTIFACT: 'CERTIFICATION_ARTIFACT',
  HISTORICAL_REPORT: 'HISTORICAL_REPORT',
  TRANSITIONAL_REPORT: 'TRANSITIONAL_REPORT',
});

/** Modos que SUSTENTAM decisão (score, gate, readiness). Exigem a regra temporal. */
const AUTHORITATIVE_MODES = Object.freeze([
  MODES.RUNTIME_EVIDENCE,
  MODES.DERIVED_REPORT,
  MODES.CERTIFICATION_ARTIFACT,
]);

/** Modos que NUNCA sustentam decisão (permanecem no pacote, sem autoridade). */
const NON_AUTHORITATIVE_MODES = Object.freeze([
  MODES.HISTORICAL_REPORT,
  MODES.TRANSITIONAL_REPORT,
]);

const REASONS = Object.freeze({
  RUNTIME_EVIDENCE_REQUIRES_ORIGIN_LINEAGE: 'runtime_evidence_requires_origin_lineage',
  // Regra central desta missão: artefato produzido ANTES do início do run não
  // sustenta o run, mesmo que carregue o runId/sourceFingerprint atuais.
  STALE_ARTIFACT_PRE_RUN: 'stale_artifact_pre_run',
  REJECTED_STALE_ARTIFACT: 'rejected_stale_artifact',
  UNCLASSIFIED_AUTHORITATIVE_ARTIFACT: 'unclassified_authoritative_artifact',
});

const STATUS = Object.freeze({
  SAME_RUN: 'SAME_RUN',
  STALE_ARTIFACT: 'STALE_ARTIFACT',
  WRONG_RUN: 'WRONG_RUN',
  INVALID: 'INVALID',
  UNCLASSIFIED: 'UNCLASSIFIED',
  HISTORICAL: 'HISTORICAL',
  TRANSITIONAL: 'TRANSITIONAL',
  MISSING: 'MISSING',
});

let cachedConfig = null;

function loadConfig() {
  if (cachedConfig) return cachedConfig;
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const modes = raw && raw.modes ? raw.modes : {};
  const artifacts = {};
  for (const mode of Object.values(MODES)) {
    const entry = modes[mode] || {};
    for (const artifact of entry.artifacts || []) {
      artifacts[normalizeArtifactPath(artifact)] = mode;
    }
  }
  const globs = [];
  for (const mode of NON_AUTHORITATIVE_MODES) {
    const entry = modes[mode] || {};
    for (const glob of entry.globs || []) {
      globs.push({ mode, glob: normalizeArtifactPath(glob) });
    }
  }
  cachedConfig = {
    configPath: CONFIG_PATH,
    sameRunRule: raw.sameRunRule || null,
    sameRunProof: (modes.RUNTIME_EVIDENCE && modes.RUNTIME_EVIDENCE.sameRunProof) || null,
    lineageFields: (modes.RUNTIME_EVIDENCE && modes.RUNTIME_EVIDENCE.lineageFields) || [],
    artifacts,
    globs,
    producers: raw.producers || {},
  };
  return cachedConfig;
}

/**
 * Normaliza o caminho para comparacao: relativo, com separador '/' e sem './'.
 */
function normalizeArtifactPath(artifactPath) {
  return String(artifactPath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

function getModeForArtifact(artifactPath) {
  const config = loadConfig();
  return config.artifacts[normalizeArtifactPath(artifactPath)] || null;
}

function isRuntimeEvidenceArtifact(artifactPath) {
  return getModeForArtifact(artifactPath) === MODES.RUNTIME_EVIDENCE;
}

function isDerivedReportArtifact(artifactPath) {
  return getModeForArtifact(artifactPath) === MODES.DERIVED_REPORT;
}

function listRuntimeEvidenceArtifacts() {
  const config = loadConfig();
  return Object.entries(config.artifacts)
    .filter(([, mode]) => mode === MODES.RUNTIME_EVIDENCE)
    .map(([artifact]) => artifact)
    .sort();
}

/**
 * Casa um caminho contra um glob simples da taxonomia. Suporta apenas o que a
 * taxonomia usa hoje: `prefixo/**` (subarvore) e `*` dentro de um segmento.
 * Deliberadamente minimalista — nao e um motor de glob.
 */
function matchesGlob(artifactPath, glob) {
  const target = normalizeArtifactPath(artifactPath);
  const pattern = normalizeArtifactPath(glob);
  if (!pattern) return false;
  if (pattern.endsWith('/**')) return target.startsWith(pattern.slice(0, -2));
  if (!pattern.includes('*')) return target === pattern;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`).test(target);
}

/**
 * CLASSIFICACAO CANONICA de um artefato. Retorna o modo ou null quando o
 * artefato NAO esta classificado — e artefato nao classificado usado em
 * decisao e NO_GO (fail-closed), nunca "estampavel por desconhecido".
 */
function classifyArtifact(artifactPath) {
  const declared = getModeForArtifact(artifactPath);
  if (declared) return declared;
  const config = loadConfig();
  for (const entry of config.globs) {
    if (matchesGlob(artifactPath, entry.glob)) return entry.mode;
  }
  return null;
}

function isAuthoritativeArtifact(artifactPath) {
  return AUTHORITATIVE_MODES.includes(classifyArtifact(artifactPath));
}

function isHistoricalArtifact(artifactPath) {
  return classifyArtifact(artifactPath) === MODES.HISTORICAL_REPORT;
}

function isTransitionalArtifact(artifactPath) {
  return classifyArtifact(artifactPath) === MODES.TRANSITIONAL_REPORT;
}

/** Artefatos declarados que SUSTENTAM decisao (uniao dos modos autoritativos). */
function listAuthoritativeArtifacts() {
  const config = loadConfig();
  return Object.entries(config.artifacts)
    .filter(([, mode]) => AUTHORITATIVE_MODES.includes(mode))
    .map(([artifact]) => artifact)
    .sort();
}

/** Artefatos declarados que NUNCA sustentam decisão (histórico/transicional). */
function listNonAuthoritativeArtifacts() {
  const config = loadConfig();
  return Object.entries(config.artifacts)
    .filter(([, mode]) => NON_AUTHORITATIVE_MODES.includes(mode))
    .map(([artifact]) => artifact)
    .sort();
}

/** Comando do produtor declarado (reexecucao obrigatoria quando o artefato esta stale). */
function getProducer(artifactPath) {
  const config = loadConfig();
  return config.producers[normalizeArtifactPath(artifactPath)] || null;
}

function runStartMs(run) {
  const raw = run && (run.started_at || run.startedAt);
  const ms = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * AVALIACAO TEMPORAL UNIFICADA — a MESMA autoridade consumida pelo estampador,
 * pelo Master Scorecard, pelo gate CURRENT_RUN_TEMPORAL_INTEGRITY e pelo
 * verificador offline.
 *
 * Todas as checagens sao obrigatorias:
 *   validRunId, validSourceFingerprint, validArtifactType, validVersion,
 *   validGeneratedAt, notFuture, freshEnough, generatedAt >= run.startedAt.
 *
 * A ultima e a que faltava: sem ela, um artefato PRODUZIDO ANTES do run podia
 * ser estampado com o runId/sourceFingerprint atuais e passar em todas as
 * outras checagens — adotando o passado como prova do presente.
 */
function evaluateTemporalIntegrity({ artifactPath, artifact, run, nowMs = Date.now(), futureToleranceMs = 60000, maxAgeMs = null } = {}) {
  const pathKey = normalizeArtifactPath(artifactPath);
  const classification = classifyArtifact(pathKey);
  const startedAtMs = runStartMs(run);
  const base = { artifactPath: pathKey, classification, generatedAtMs: null, runStartedAtMs: startedAtMs };

  if (!classification) {
    return { ...base, status: STATUS.UNCLASSIFIED, code: REASONS.UNCLASSIFIED_AUTHORITATIVE_ARTIFACT, reasons: ['unknown_classification'] };
  }
  if (classification === MODES.HISTORICAL_REPORT) {
    return { ...base, status: STATUS.HISTORICAL, code: 'HISTORICAL_NOT_EVIDENCE', reasons: ['historical_artifact_excluded'] };
  }
  if (classification === MODES.TRANSITIONAL_REPORT) {
    return { ...base, status: STATUS.TRANSITIONAL, code: 'TRANSITIONAL_NOT_EVIDENCE', reasons: ['transitional_artifact_excluded'] };
  }
  if (artifact == null) {
    return { ...base, status: STATUS.MISSING, code: 'ARTIFACT_MISSING', reasons: ['artifact_missing'] };
  }
  if (typeof artifact !== 'object') {
    return { ...base, status: STATUS.INVALID, code: 'ARTIFACT_INVALID', reasons: ['invalid_object'] };
  }

  const reasons = [];
  let wrongRun = false;
  if (!artifact.runId) reasons.push('run_id_missing');
  else if (run && artifact.runId !== run.run_id) {
    wrongRun = true;
    reasons.push('wrong_run');
  }
  if (!artifact.sourceFingerprint) reasons.push('source_fingerprint_missing');
  else if (run && artifact.sourceFingerprint !== run.source_fingerprint) reasons.push('wrong_source_fingerprint');
  if (!artifact.artifactType) reasons.push('artifact_type_missing');
  if (!artifact.artifactVersion) reasons.push('artifact_version_missing');

  let generatedAtMs = null;
  if (!artifact.generatedAt) reasons.push('generated_at_missing');
  else {
    const parsed = Date.parse(artifact.generatedAt);
    if (!Number.isFinite(parsed)) reasons.push('generated_at_invalid');
    else generatedAtMs = parsed;
  }
  if (generatedAtMs !== null && generatedAtMs > nowMs + futureToleranceMs) reasons.push('generated_at_future');

  // REGRA CENTRAL: evidencia PRODUZIDA ANTES do inicio do run nao sustenta o run.
  // Vale mesmo com runId/sourceFingerprint "corretos" (que e exatamente o caso
  // do stamp retroativo que esta missao elimina).
  if (generatedAtMs !== null && startedAtMs !== null && generatedAtMs < startedAtMs) {
    return {
      ...base,
      generatedAtMs,
      status: STATUS.STALE_ARTIFACT,
      code: REASONS.STALE_ARTIFACT_PRE_RUN,
      reasons: [...reasons, 'generated_at_before_run_start'],
    };
  }
  if (Number.isFinite(maxAgeMs) && maxAgeMs > 0 && generatedAtMs !== null && nowMs - generatedAtMs > maxAgeMs) {
    return { ...base, generatedAtMs, status: STATUS.STALE_ARTIFACT, code: 'ARTIFACT_EXPIRED', reasons: [...reasons, 'expired'] };
  }
  if (wrongRun) {
    return { ...base, generatedAtMs, status: STATUS.WRONG_RUN, code: 'FOREIGN_RUN_ARTIFACT', reasons };
  }
  if (reasons.length) {
    return { ...base, generatedAtMs, status: STATUS.INVALID, code: 'TEMPORAL_LINEAGE_VIOLATION', reasons };
  }
  return { ...base, generatedAtMs, status: STATUS.SAME_RUN, code: 'SAME_RUN_OK', reasons: [] };
}

/** Para testes: descarta o cache e forca releitura do arquivo. */
function resetCache() {
  cachedConfig = null;
}

module.exports = {
  MODES,
  AUTHORITATIVE_MODES,
  NON_AUTHORITATIVE_MODES,
  REASONS,
  STATUS,
  CONFIG_PATH,
  normalizeArtifactPath,
  getModeForArtifact,
  classifyArtifact,
  isRuntimeEvidenceArtifact,
  isDerivedReportArtifact,
  isAuthoritativeArtifact,
  isHistoricalArtifact,
  isTransitionalArtifact,
  listRuntimeEvidenceArtifacts,
  listAuthoritativeArtifacts,
  listNonAuthoritativeArtifacts,
  getProducer,
  matchesGlob,
  runStartMs,
  evaluateTemporalIntegrity,
  loadConfig,
  resetCache,
};
