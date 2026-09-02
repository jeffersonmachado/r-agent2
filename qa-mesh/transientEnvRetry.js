'use strict';

/**
 * Detecção e espera para falhas transientes de AMBIENTE no QA Mesh.
 *
 * Motivação (corridas canônicas 2026-07-27): cenários funcionalmente corretos
 * falhavam com assinaturas de ambiente — "API temporariamente indisponível",
 * "Failed to fetch", UND_ERR_SOCKET — em janelas de restart do servidor dev
 * (TENANT-CONFIG grava api/data/config.json sob nodemon) ou de contenção de
 * máquina. O mesh não tinha retry: uma única queda transitória derrubava o
 * GO canônico. A política aqui NÃO enfraquece assertivas: o cenário é
 * reexecutado UMA vez, após a API estabilizar, e a reexecução precisa passar
 * integralmente. A evidência registra a primeira falha (transparência).
 */

const TRANSIENT_ENV_PATTERNS = [
  /API temporariamente indispon[íi]vel/i,
  /API n[ãa]o acess[íi]vel/i,
  /Failed to fetch/i,
  /fetch failed/i,
  /ECONNREFUSED/,
  /UND_ERR_SOCKET/,
  /ECONNRESET/,
  /ETIMEDOUT/,
  /ERR_CONNECTION/,
  /socket hang up/i,
];

/**
 * Extrai dicas de falha do relatório business-qa-*.json referenciado nos logs
 * stdout do adapter de negócio (subprocesso). Espelha a extração que o
 * meshRunner faz em collectScenarioDiagnostics — sem ela, falhas como
 * "fetch failed (UND_ERR_SOCKET)" do business-b1 não eram vistas pelo retry.
 * Com batching (QA_MESH_BUSINESS_BATCH), o relatório cobre N cenários:
 * `scenarioCode` restringe os hints à entrada do próprio cenário, para que a
 * falha de um código não dispare retry indevido nos demais.
 */
function extractBusinessQaReportHints(logs, scenarioCode = null) {
  const fs = require('fs');
  const hints = [];
  let reportPath = null;
  for (const entry of logs) {
    const line = String((entry && entry.message) || entry || '');
    const match = line.match(/- json:\s*(\/\S+business-qa-[^\s]+\.json)/i);
    if (match && match[1]) {
      reportPath = match[1];
      break;
    }
  }
  if (!reportPath) return hints;
  let report = null;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (_) {
    return hints;
  }
  if (!report || !Array.isArray(report.scenarios)) return hints;
  for (const scenario of report.scenarios) {
    if (!scenario || scenario.status !== 'FAIL') continue;
    if (scenarioCode && String(scenario.code) !== String(scenarioCode)) continue;
    const rootCause = String(scenario?.resumo?.causaRaiz || '').trim();
    if (rootCause) hints.push(rootCause);
    const failedStep = Array.isArray(scenario.etapas)
      ? scenario.etapas.find((step) => step && step.status === 'FAIL' && step.detalhe)
      : null;
    const stepDetail = String(failedStep?.detalhe || '').trim();
    if (stepDetail) hints.push(stepDetail);
  }
  return hints;
}

/**
 * @param {object} adapterResult Resultado do adapter (status, errors, logs).
 * @returns {boolean} true quando TODA a evidência de falha é de ambiente
 *   transitório (não há erro funcional misturado).
 */
function isTransientEnvFailure(adapterResult) {
  if (!adapterResult || adapterResult.status === 'passed') return false;
  const haystacks = [];
  for (const err of adapterResult.errors || []) {
    haystacks.push(typeof err === 'string' ? err : JSON.stringify(err));
  }
  // Logs de QUALQUER nível: o adapter de negócio roda como subprocesso e a
  // evidência de falha chega em stdout, não em logs de nível error. Os
  // padrões são estritos (rede/socket), então não casam com sucesso.
  for (const log of adapterResult.logs || []) {
    if (log) haystacks.push(String(log.message || ''));
  }
  for (const hint of extractBusinessQaReportHints(
    adapterResult.logs || [],
    adapterResult.businessBatch?.code || null,
  )) {
    haystacks.push(hint);
  }
  if (adapterResult.errorMessage) haystacks.push(String(adapterResult.errorMessage));
  if (haystacks.length === 0) return false;
  const blob = haystacks.join('\n');
  return TRANSIENT_ENV_PATTERNS.some((pattern) => pattern.test(blob));
}

/**
 * Aguarda a API responder /health com estabilidade contínua (settle), para
 * atravessar janelas de restart antes da reexecução.
 */
async function waitForApiStable({ apiUrl = 'http://localhost:3001', timeoutMs = 120000, intervalMs = 1000, settleMs = 5000, fetchImpl } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  const deadline = Date.now() + timeoutMs;
  let stableSince = null;
  for (;;) {
    let ok = false;
    try {
      const res = await doFetch(`${apiUrl}/health`);
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (!ok) {
      stableSince = null;
    } else if (stableSince === null) {
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= settleMs) {
      return true;
    }
    if (Date.now() > deadline) {
      throw new Error('API não estabilizou dentro do timeout para retry de falha transitória');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

module.exports = {
  TRANSIENT_ENV_PATTERNS,
  isTransientEnvFailure,
  waitForApiStable,
};
