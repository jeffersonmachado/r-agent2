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
const { execSync } = require('child_process');

const CURRENT_RUN_RELATIVE_PATH = path.join('governance', '.current-run.json');

function readEnv(env, name) {
  const value = env && env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readContextField(context, name) {
  const value = context && context[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Identidade git best-effort (HEAD e HEAD^{tree}) no momento da execução.
 * Usada apenas para COMPLEMENTAR um lineage já resolvido (env/arquivo): nunca
 * cria runId/fingerprint e falha fechada — qualquer erro (fora de worktree,
 * git ausente) devolve nulls. Identidade inventada é pior que ausente.
 */
function resolveGitIdentity(rootDir) {
  const read = (args) => {
    try {
      const out = execSync(`git ${args}`, {
        cwd: rootDir,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 10000,
      }).toString('utf8').trim();
      return /^[0-9a-f]{40}$/.test(out) ? out : null;
    } catch (_) {
      return null;
    }
  };
  // A branch NÃO passa pelo validador de SHA: `dev/engineering-hardening` não é
  // 40-hex, e reusar `read` aqui devolvia null silenciosamente (medido hipótese
  // errada de "branch ausente"). Leitura própria, também fail-closed.
  const readTexto = (args) => {
    try {
      const out = execSync(`git ${args}`, {
        cwd: rootDir,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 10000,
      }).toString('utf8').trim();
      // `HEAD` destacado devolve a string literal "HEAD": não é branch, é ausência.
      return out && out !== 'HEAD' ? out : null;
    } catch (_) {
      return null;
    }
  };
  return {
    sourceCommit: read('rev-parse HEAD'),
    sourceTree: read('rev-parse HEAD^{tree}'),
    sourceBranch: readTexto('rev-parse --abbrev-ref HEAD'),
  };
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
      // sourceCommit/sourceTree: do arquivo quando o produtor do run os gravou
      // (create-governed-run.js >= 2026-09-19); senão, best-effort do git no
      // momento da execução. Continuam null quando indisponíveis — nunca
      // inventados.
      const git = resolveGitIdentity(rootDir);
      return {
        runId,
        sourceFingerprint: fingerprint,
        sourceCommit: readContextField(context, 'sourceCommit') || git.sourceCommit,
        sourceTree: readContextField(context, 'sourceTree') || git.sourceTree,
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

/**
 * Estampa o lineage resolvido NA ORIGEM num artefato de RUNTIME_EVIDENCE.
 * Campos ausentes viram null explícito — nunca inventados. O gate
 * `validate:qa-evidence-same-run` reprova null com QA_EVIDENCE_LINEAGE_MISSING,
 * que é o resultado honesto para execução fora de run governado.
 */
function applyOriginLineage(payload, lineage) {
  const resolved = lineage || {};
  return {
    ...payload,
    runId: resolved.runId || null,
    sourceFingerprint: resolved.sourceFingerprint || null,
    sourceCommit: resolved.sourceCommit || null,
    sourceTree: resolved.sourceTree || null,
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
  resolveGitIdentity,
  applyOriginLineage,
  toLineageEnv,
};
