#!/usr/bin/env node
'use strict';

/**
 * resolve-run-lineage.js — resolve o run governado ANTES da execução de um
 * artefato de RUNTIME_EVIDENCE.
 *
 * Por que isso é um módulo separado: o defeito de lineage de 2026-09-19 só foi
 * possível porque o run era descoberto DEPOIS (o estampador lia "o run mais
 * recente" e anexava a um relatório antigo). Aqui a identidade é resolvida
 * ANTES do produtor executar, então o relatório nasce dentro do run.
 *
 * Ordem:
 *   1. env explícito do orquestrador (GOVERNANCE_RUN_ID/SOURCE_FINGERPRINT);
 *   2. `governance/.current-run.json` (escrito por create-governed-run.js no
 *      momento da criação do run).
 *
 * Sem run governado devolve {} — NUNCA inventa identidade. O produtor grava
 * null e o gate `validate:qa-evidence-same-run` reprova com
 * QA_EVIDENCE_LINEAGE_MISSING. "Não sei a qual run pertence" é um resultado
 * honesto; "pertence ao run X" sem ter rodado nele não é.
 */

const fs = require('fs');
const path = require('path');

const CURRENT_RUN_RELATIVE_PATH = path.join('governance', '.current-run.json');

function readEnv(env, name) {
  const value = env && env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {object} [options]
 * @param {object} [options.env]  ambiente (default: process.env)
 * @param {string} [options.rootDir] raiz do repositório (default: process.cwd())
 * @returns {{ runId: string|null, sourceFingerprint: string|null, sourceCommit: string|null, sourceTree: string|null, source: 'env'|'current-run-file'|'none' }}
 */
function resolveRunLineage(options = {}) {
  const env = options.env || process.env;
  const rootDir = options.rootDir || process.cwd();

  const envRunId = readEnv(env, 'GOVERNANCE_RUN_ID');
  const envFingerprint = readEnv(env, 'GOVERNANCE_SOURCE_FINGERPRINT');
  if (envRunId && envFingerprint) {
    return {
      runId: envRunId,
      sourceFingerprint: envFingerprint,
      sourceCommit: readEnv(env, 'GOVERNANCE_SOURCE_COMMIT'),
      sourceTree: readEnv(env, 'GOVERNANCE_SOURCE_TREE'),
      source: 'env',
    };
  }

  try {
    const contextPath = path.join(rootDir, CURRENT_RUN_RELATIVE_PATH);
    const context = JSON.parse(fs.readFileSync(contextPath, 'utf8'));
    const runId = typeof context.runId === 'string' ? context.runId.trim() : '';
    const fingerprint = typeof context.sourceFingerprint === 'string'
      ? context.sourceFingerprint.trim()
      : '';
    if (runId && fingerprint) {
      return {
        runId,
        sourceFingerprint: fingerprint,
        sourceCommit: null,
        sourceTree: null,
        source: 'current-run-file',
      };
    }
  } catch (_) {
    // ausência/parse inválido => sem run governado
  }

  return {
    runId: null,
    sourceFingerprint: null,
    sourceCommit: null,
    sourceTree: null,
    source: 'none',
  };
}

/** Converte para o formato de env consumido pelos produtores (omite null). */
function toLineageEnv(lineage) {
  const result = {};
  if (lineage && lineage.runId) result.GOVERNANCE_RUN_ID = lineage.runId;
  if (lineage && lineage.sourceFingerprint) {
    result.GOVERNANCE_SOURCE_FINGERPRINT = lineage.sourceFingerprint;
  }
  if (lineage && lineage.sourceCommit) result.GOVERNANCE_SOURCE_COMMIT = lineage.sourceCommit;
  if (lineage && lineage.sourceTree) result.GOVERNANCE_SOURCE_TREE = lineage.sourceTree;
  return result;
}

module.exports = {
  CURRENT_RUN_RELATIVE_PATH,
  resolveRunLineage,
  toLineageEnv,
};
