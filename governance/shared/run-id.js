'use strict';

/**
 * Run ID — identificador canônico de execução governada.
 *
 * Formato: rap-release-YYYYMMDD-HHMMSS-<8 chars sourceHash>
 * Exemplo: rap-release-20260820-153012-f9159bb0
 *
 * Regra: um run ID é criado UMA VEZ por pipeline de release e propagado
 * para todos os artifacts. Engines que lêem artifacts de um runId diferente
 * devem rejeitar com FOREIGN_RUN_ARTIFACT.
 */

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT           = path.resolve(__dirname, '..', '..');
const CURRENT_RUN_FILE = path.join(ROOT, 'governance', '.current-run.json');

/**
 * Gera um novo runId a partir da data atual e do sourceHash fornecido.
 */
function generateRunId(sourceHash) {
  const now = new Date();
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const hash = sourceHash ? String(sourceHash).slice(0, 8) : crypto.randomBytes(4).toString('hex');
  return `rap-release-${date}-${time}-${hash}`;
}

/**
 * Persiste o runId atual no arquivo canônico.
 */
function saveCurrentRun(runId, meta = {}) {
  const record = {
    runId,
    createdAt: new Date().toISOString(),
    ...meta,
  };
  fs.mkdirSync(path.dirname(CURRENT_RUN_FILE), { recursive: true });
  fs.writeFileSync(CURRENT_RUN_FILE, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

/**
 * Lê o runId canônico atual. Retorna null se não existir.
 */
function readCurrentRun() {
  if (!fs.existsSync(CURRENT_RUN_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(CURRENT_RUN_FILE, 'utf8')); } catch (_) { return null; }
}

/**
 * Lê somente o runId string. Retorna null se não existir.
 */
function getCurrentRunId() {
  const run = readCurrentRun();
  return run ? run.runId : null;
}

/**
 * Inicia um novo run: gera ID, persiste e retorna o record.
 */
function startNewRun(sourceHash, meta = {}) {
  const runId = generateRunId(sourceHash);
  return saveCurrentRun(runId, meta);
}

/**
 * Verifica se um artifact pertence ao run atual.
 * Retorna 'CURRENT' | 'FOREIGN_RUN' | 'NO_RUN_ID' | 'NO_CURRENT_RUN'
 */
function checkArtifactRun(artifact) {
  const currentRunId = getCurrentRunId();
  if (!currentRunId) return 'NO_CURRENT_RUN';

  const artifactRunId = artifact && (artifact.runId || artifact.run_id);
  if (!artifactRunId) return 'NO_RUN_ID';
  if (artifactRunId !== currentRunId) return 'FOREIGN_RUN';
  return 'CURRENT';
}

/**
 * Filtra artifacts pelo runId atual.
 * Artifacts sem runId ou com runId diferente são marcados como inválidos.
 */
function validateArtifactRun(artifact, { allowMissing = false } = {}) {
  const status = checkArtifactRun(artifact);
  if (status === 'CURRENT') return { valid: true, status };
  if (status === 'NO_RUN_ID' && allowMissing) return { valid: true, status };
  return { valid: false, status };
}

module.exports = {
  generateRunId,
  saveCurrentRun,
  readCurrentRun,
  getCurrentRunId,
  startNewRun,
  checkArtifactRun,
  validateArtifactRun,
  CURRENT_RUN_FILE,
};
