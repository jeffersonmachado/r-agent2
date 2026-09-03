#!/usr/bin/env node
'use strict';

/**
 * Report Lineage — lineage canônico de artefatos de governança no produtor.
 *
 * Todo relatório de governança deve nascer COM lineage completo. Depender de
 * um stamp posterior (scripts/governance/stamp-report-lineage.js) cria uma
 * janela em que o artefato existe sem runId — e qualquer avaliação nessa
 * janela reprova com ARTIFACT_RUN_ID_MISSING (root cause de RAP-052/RAP-054
 * caírem para 6/10 no release r-agent2-20260903-134904). O stamp permanece
 * como backstop, mas os produtores passam a emitir lineage na origem.
 *
 * Fonte do lineage: governance/.current-run.json (run governado atual).
 * Fail-open controlado: se não houver run governado, retorna campos null —
 * os consumidores (scorecard/verifiers) tratam ausência como INVALID, então
 * emitir null explicitamente é equivalente ao comportamento anterior, mas a
 * emissão acontece sempre que o run existe.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CURRENT_RUN_PATH = path.join(ROOT, 'governance', '.current-run.json');

function readCurrentRun(rootDir = ROOT) {
  try {
    const run = JSON.parse(fs.readFileSync(path.join(rootDir, 'governance', '.current-run.json'), 'utf8'));
    return run && typeof run === 'object' ? run : null;
  } catch (_) {
    return null;
  }
}

function currentGitField(args, rootDir = ROOT) {
  try {
    const { execFileSync } = require('child_process');
    return String(execFileSync('git', args, { cwd: rootDir, encoding: 'utf8' }) || '').trim() || null;
  } catch (_) {
    return null;
  }
}

/**
 * Lineage canônico para um artefato de governança.
 *
 * @param {string} artifactType  ex.: 'package-validation-report'
 * @param {object} [opts]
 * @param {string} [opts.rootDir]
 * @param {string} [opts.artifactVersion]
 * @param {boolean} [opts.includeGit]  inclui gitCommit/gitTree (custo de um git rev-parse)
 */
function currentLineage(artifactType, opts = {}) {
  const rootDir = opts.rootDir || ROOT;
  const run = readCurrentRun(rootDir);
  const lineage = {
    artifactType: artifactType || null,
    artifactVersion: opts.artifactVersion || '1.0.0',
    generatedAt: new Date().toISOString(),
    runId: run?.runId || null,
    sourceFingerprint: run?.sourceFingerprint || null,
  };
  if (opts.includeGit) {
    lineage.gitCommit = currentGitField(['rev-parse', 'HEAD'], rootDir);
    lineage.gitTree = currentGitField(['rev-parse', 'HEAD^{tree}'], rootDir);
  }
  return lineage;
}

/**
 * Aplica lineage a um objeto de relatório sem sobrescrever campos de decisão.
 * Campos de lineage existentes e válidos são preservados (idempotente).
 */
function withLineage(report, artifactType, opts = {}) {
  const lineage = currentLineage(artifactType, opts);
  const merged = { ...report };
  for (const [key, value] of Object.entries(lineage)) {
    if (merged[key] === undefined || merged[key] === null) merged[key] = value;
  }
  return merged;
}

module.exports = {
  CURRENT_RUN_PATH,
  readCurrentRun,
  currentLineage,
  withLineage,
};
