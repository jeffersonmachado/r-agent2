'use strict';

/**
 * Cadeia append-only de histórico de execuções do QA Mesh/Waves.
 *
 * O Map em memória de qa-mesh/executionQueue.js é o estado vivo do runtime
 * (single-flight, EventEmitter, progresso); os arquivos meshHistory/<id>.json
 * são o retrato persistido de cada execução — mas são JSON mutável e sem
 * garantia de integridade. Este módulo anexa, a cada execução concluída, um
 * registro imutável em execution-history/index.jsonl usando o Evidence Store
 * (redaction obrigatória + hash chain SHA-256 com prevHash):
 *
 * - qualquer edição/reencontro de um registro quebra verifyChain();
 * - o SHA-256 do arquivo de histórico referenciado fica vinculado ao registro,
 *   permitindo detectar adulteração do meshHistory/<id>.json correspondente;
 * - correções nunca editam registros: novos fatos geram novos registros.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createEvidenceStore } = require('../qa/coverage/evidenceStore');

const ROOT_DIR = path.join(__dirname, '..');
// Fora de meshHistory/ de propósito: o endpoint DELETE /api/qa-waves/executions
// limpa meshHistory/*; a cadeia é imutável e não pode ser apagada por ele.
const CHAIN_PATH = process.env.QA_MESH_HISTORY_CHAIN_PATH
  || path.join(__dirname, 'execution-history', 'index.jsonl');

let cachedStore = null;

function getStore() {
  if (!cachedStore) {
    cachedStore = createEvidenceStore({ filePath: CHAIN_PATH });
  }
  return cachedStore;
}

function sha256File(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch (_) {
    return null;
  }
}

function resolveCommit() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT_DIR, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch (_) {
    return null;
  }
}

/**
 * Anexa o registro imutável de uma execução concluída do mesh.
 * @param {object} execution registro normalizado da execução (normalizeExecutionRecord)
 * @returns o registro persistido na cadeia (com prevHash/hash)
 */
function appendExecutionRecord(execution) {
  if (!execution || !execution.executionId) {
    throw new Error('execution_history_record_requires_executionId');
  }
  const summary = execution.summary || {};
  const record = {
    type: 'wave-execution',
    executionId: execution.executionId,
    tenantId: execution.tenantId || summary.tenantId || 'system',
    executionKind: execution.executionKind || null,
    executionOrigin: execution.executionOrigin || summary.executionOrigin || null,
    isCanonicalExecution: execution.isCanonicalExecution === true,
    status: execution.status || null,
    goNoGo: summary.goNoGo || null,
    metrics: {
      total: summary.total ?? null,
      executed: summary.executed ?? null,
      passed: summary.passed ?? null,
      failed: summary.failed ?? null,
      flaky: summary.flaky ?? null,
      skipped: summary.skipped ?? null,
    },
    commit: resolveCommit(),
    historyPath: execution.historyPath || null,
    historyFileSha256: execution.historyPath ? sha256File(execution.historyPath) : null,
    startedAt: execution.startedAt || null,
    finishedAt: execution.finishedAt || null,
    timestamp: execution.finishedAt || new Date().toISOString(),
  };
  return getStore().appendRaw(record);
}

/** Lê a cadeia do mais recente para o mais antigo. */
function readChain(limit = 50) {
  const records = getStore().readAll()
    .filter((record) => record.type === 'wave-execution')
    .reverse();
  return Number.isFinite(limit) ? records.slice(0, limit) : records;
}

/** Valida a integridade completa da cadeia (hashes + linkage). */
function verifyChain() {
  return getStore().verify();
}

/**
 * Verifica se o arquivo meshHistory referenciado por um registro ainda
 * corresponde ao SHA-256 registrado na cadeia (tamper detection do arquivo).
 * Retorna valid:'missing' quando o arquivo foi podado pela retenção
 * (QA_MESH_MAX_HISTORY) — ausência por retenção não é adulteração.
 */
function verifyHistoryFile(executionId) {
  const record = getStore().readAll()
    .filter((item) => item.type === 'wave-execution')
    .find((item) => item.executionId === executionId);
  if (!record) return { found: false, valid: false };
  if (!record.historyPath || !record.historyFileSha256) {
    return { found: true, valid: null, reason: 'registro sem hash de arquivo' };
  }
  if (!fs.existsSync(record.historyPath)) {
    return { found: true, valid: 'missing', reason: 'arquivo ausente (retenção ou limpeza)', historyPath: record.historyPath };
  }
  return {
    found: true,
    valid: sha256File(record.historyPath) === record.historyFileSha256,
    historyPath: record.historyPath,
  };
}

module.exports = {
  CHAIN_PATH,
  appendExecutionRecord,
  readChain,
  verifyChain,
  verifyHistoryFile,
};
