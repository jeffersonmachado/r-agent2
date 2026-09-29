#!/usr/bin/env node
'use strict';

/**
 * validate-engineering-router-v2-required-tests.js — TESTES OBRIGATÓRIOS V2 (V2-01..V2-42).
 *
 * A missão (seção "38. TESTES OBRIGATÓRIOS V2") exige provar individualmente cada um dos 42 itens.
 * Este gate lê `config/engineering-router-v2-required-tests.json` e resolve o estado REAL de cada
 * item a partir de:
 *   - `reports/release-suite-execution.json` (execução autoritativa das suítes do manifesto);
 *   - o relatório de governança declarado no item (com TTL: evidência vencida não conta).
 *
 * A classificação é derivada pelo núcleo puro `governance/required-tests-derivation.js`. Nenhum
 * status é escrito à mão. Item sem prova declarada é GAP — nunca silenciado.
 *
 * Saída: `reports/engineering-router-v2-required-tests-report.json`
 * Uso: node scripts/governance/validate-engineering-router-v2-required-tests.js [--json]
 */

const fs = require('fs');
const path = require('path');

const { deriveRequiredTests } = require('../../governance/required-tests-derivation');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'engineering-router-v2-required-tests.json');
const SUITE_REPORT_PATH = path.join(ROOT, 'reports', 'release-suite-execution.json');
const REPORT_PATH = path.join(ROOT, 'reports', 'engineering-router-v2-required-tests-report.json');

function readJsonAbs(absPath) {
  try {
    if (!fs.existsSync(absPath)) return null;
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/** Estado real de uma suíte na execução autoritativa. `null` = nunca executada. */
function makeSuiteStateReader() {
  const execution = readJsonAbs(SUITE_REPORT_PATH);
  const bySuite = new Map();
  for (const row of (execution && execution.results) || []) {
    if (row && row.suite) bySuite.set(row.suite, row.state || null);
  }
  return {
    reader: (suite) => (bySuite.has(suite) ? { state: bySuite.get(suite) } : null),
    executionGeneratedAt: (execution && execution.generatedAt) || null,
    executionManifestVersion: (execution && execution.manifestVersion) || null,
    suitesExecuted: bySuite.size,
  };
}

/** Valor de aprovação + carimbo de tempo de um relatório de governança declarado. */
function reportStateReader(reportRelPath) {
  const rel = String(reportRelPath || '').replace(/^reports\//, '');
  const abs = path.join(ROOT, 'reports', rel);
  const json = readJsonAbs(abs);
  if (!json) return { exists: false, value: null, generatedAt: null };
  const value =
    json.status ||
    json.decision ||
    json.finalDecision ||
    json.overallStatus ||
    (json.summary && (json.summary.status || json.summary.decision)) ||
    (json.verdicts && (json.verdicts.TIMEOUT_ARCHITECTURE || json.verdicts.ENGINEERING_ROUTER_V2_SEAL)) ||
    null;
  const generatedAt = json.generatedAt || json.timestamp || json.updatedAt || null;
  return { exists: true, value, generatedAt };
}

/**
 * Desfecho MEDIDO de uma evidência de probe live (`item.evidence.path`).
 *
 * Diferente de `reportStateReader`, que extrai um veredito de aprovação, aqui interessa o ESTADO
 * observado do desfecho — porque um probe live pode legitimamente terminar em falha do PROVEDOR
 * (`FAIL_AUTH`) sem que isso seja defeito de código. O estado e o motivo real do provider viajam
 * junto, para a classificação ser derivada da medição e não de texto escrito à mão.
 */
function evidenceStateReader(relPath) {
  const abs = path.join(ROOT, String(relPath || ''));
  const json = readJsonAbs(abs);
  if (!json) return { exists: false, state: null, generatedAt: null };
  return {
    exists: true,
    state: json.state || json.status || json.decision || null,
    generatedAt: json.generatedAt || null,
    httpStatus: json.httpStatus || null,
    providerError: json.providerError || null,
  };
}

function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`[required-tests] configuração ausente: ${path.relative(ROOT, CONFIG_PATH)}`);
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const suiteReader = makeSuiteStateReader();

  const derived = deriveRequiredTests({
    items: config.requiredTests || [],
    suiteState: suiteReader.reader,
    reportState: reportStateReader,
    evidenceState: evidenceStateReader,
    nowMs: Date.now(),
  });

  const report = {
    report: 'ENGINEERING_ROUTER_V2_REQUIRED_TESTS',
    generatedAt: new Date().toISOString(),
    source: config.source,
    config: path.relative(ROOT, CONFIG_PATH),
    suiteExecution: {
      report: path.relative(ROOT, SUITE_REPORT_PATH),
      generatedAt: suiteReader.executionGeneratedAt,
      manifestVersion: suiteReader.executionManifestVersion,
      suitesExecuted: suiteReader.suitesExecuted,
    },
    status: derived.status,
    total: derived.total,
    counts: derived.counts,
    unresolvedIds: derived.unresolvedIds,
    items: derived.items,
    note:
      'Status DERIVADO do valor real (suíte na execução autoritativa + relatório declarado). ' +
      'GAP = requisito sem prova; NOT_EXECUTED = suíte não executada; STALE = evidência vencida; ' +
      'UNPROVEN = relatório ausente ou sem valor de aprovação. Nada disso vira PASS.',
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const entry of derived.items) {
      process.stdout.write(`  [${entry.classification}] ${entry.id} — ${entry.detail}\n`);
    }
    process.stdout.write(
      `[required-tests] status=${derived.status} itens=${derived.total} ${JSON.stringify(derived.counts)}\n`
    );
    if (derived.unresolvedIds.length > 0) {
      process.stdout.write(`[required-tests] NÃO provados: ${derived.unresolvedIds.join(', ')}\n`);
    }
    process.stdout.write(`[required-tests] relatório: ${path.relative(ROOT, REPORT_PATH)}\n`);
  }

  process.exit(derived.status === 'PASS' ? 0 : 1);
}

main();
