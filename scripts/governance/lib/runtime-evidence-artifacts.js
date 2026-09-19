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
});

const REASONS = Object.freeze({
  RUNTIME_EVIDENCE_REQUIRES_ORIGIN_LINEAGE: 'runtime_evidence_requires_origin_lineage',
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
  cachedConfig = {
    configPath: CONFIG_PATH,
    sameRunProof: (modes.RUNTIME_EVIDENCE && modes.RUNTIME_EVIDENCE.sameRunProof) || null,
    lineageFields: (modes.RUNTIME_EVIDENCE && modes.RUNTIME_EVIDENCE.lineageFields) || [],
    artifacts,
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

/** Para testes: descarta o cache e forca releitura do arquivo. */
function resetCache() {
  cachedConfig = null;
}

module.exports = {
  MODES,
  REASONS,
  CONFIG_PATH,
  normalizeArtifactPath,
  getModeForArtifact,
  isRuntimeEvidenceArtifact,
  isDerivedReportArtifact,
  listRuntimeEvidenceArtifacts,
  loadConfig,
  resetCache,
};
