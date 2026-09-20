#!/usr/bin/env node
'use strict';

/**
 * verify-mcp-research-docker-e2e-pass.js — verificação do SEAL sobre o gate
 * MCP_RESEARCH_DOCKER_E2E.
 *
 * POR QUE EXISTE: no agregado `validate:governance-enforcement` o gate sai 0
 * com status REQUIRES_DOCKER_RUNTIME quando não há docker — decisão correta
 * para CI/dev sem daemon, mas que NÃO pode valer como prova de release. O
 * release final exige o relatório com status PASS de verdade:
 *
 *   1. reports/mcp-research-docker-e2e-report.json AUSENTE        -> FAIL
 *   2. status !== 'PASS' (FAIL ou REQUIRES_DOCKER_RUNTIME)        -> FAIL
 *   3. generatedAt ausente ou mais velho que o teto de frescor    -> FAIL (stale)
 *
 * Teto de frescor: MCP_E2E_REPORT_MAX_AGE_MS (default 24h). O agregado roda o
 * gate na fase consolidate do seal, então um relatório PASS fresco é a prova
 * de que a medição de runtime aconteceu NESTE ciclo.
 *
 * Uso: node scripts/governance/verify-mcp-research-docker-e2e-pass.js
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'mcp-research-docker-e2e-report.json');
const MAX_AGE_MS = Number(process.env.MCP_E2E_REPORT_MAX_AGE_MS || 24 * 60 * 60 * 1000);

/** Decisão pura: dado o relatório (ou null) e o relógio, PASS ou lista de razões. */
function evaluateReportForSeal(report, { nowMs = Date.now(), maxAgeMs = MAX_AGE_MS } = {}) {
  const reasons = [];
  if (!report) {
    reasons.push('reports/mcp-research-docker-e2e-report.json ausente — o gate nunca rodou neste ambiente');
    return { ok: false, reasons };
  }
  if (report.status !== 'PASS') {
    reasons.push(`status=${report.status} (exigido PASS; REQUIRES_DOCKER_RUNTIME não é prova de release)`);
  }
  const generatedMs = Date.parse(report.generatedAt || '');
  if (!Number.isFinite(generatedMs)) {
    reasons.push('generatedAt ausente/inválido — frescor não verificável');
  } else if (nowMs - generatedMs > maxAgeMs) {
    reasons.push(`relatório STALE: generatedAt=${report.generatedAt} excede o teto de ${maxAgeMs}ms`);
  }
  return { ok: reasons.length === 0, reasons };
}

function main() {
  let report = null;
  try {
    report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  } catch (_) {
    report = null;
  }
  const verdict = evaluateReportForSeal(report);
  if (verdict.ok) {
    console.log(`[mcp-e2e-seal-check] PASS — ${path.relative(ROOT_DIR, REPORT_PATH)} status=PASS generatedAt=${report.generatedAt}`);
    return;
  }
  console.error('[mcp-e2e-seal-check] FAIL — MCP_RESEARCH_DOCKER_E2E não verde:');
  for (const reason of verdict.reasons) console.error(`  - ${reason}`);
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = { evaluateReportForSeal, REPORT_PATH, MAX_AGE_MS };
