#!/usr/bin/env node
'use strict';

/**
 * tenant-isolation-report.js
 *
 * Executa a suíte de isolamento de tenant (Jest) e grava
 * `reports/tenant-isolation-report.json` com o resultado consolidado.
 * É a fonte real de `tenantIsolationViolations` do Coverage Gate
 * (scripts/governance/validate-coverage-gate.js).
 *
 * Suítes executadas:
 * - tests/tenant/ (isolamento, saasSecurity, tenantContextRag etc.)
 * - api/middleware/__tests__/tenantValidation.test.js
 * - tests/unit/exportServiceTenantIsolation.test.js
 * - tests/unit/departmentsServiceTenantIsolation.test.js
 *
 * Nota: partes de tests/tenant/ são de integração e se auto-pulam quando
 * o PostgreSQL não está acessível (shouldSkip) — nesse caso constam como
 * `testsPending`, nunca como falha.
 *
 * Flags:
 *   --skip-run   não executa o Jest; apenas relê o último relatório
 *                (útil em ambientes sem jest/DB) e aplica o mesmo exit code.
 *
 * Saída: reports/tenant-isolation-report.json
 *   { generatedAt, suites: {total,passed,failed}, testsTotal, testsPassed,
 *     testsFailed, testsPending, violations, failingSuites: [...] }
 * `violations` = número de testes falhos. Exit 1 se violations > 0 ou se a
 * execução do Jest não puder ser avaliada.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'tenant-isolation-report.json');

const TENANT_TEST_TARGETS = [
  'tests/tenant',
  'api/middleware/__tests__/tenantValidation.test.js',
  'tests/unit/exportServiceTenantIsolation.test.js',
  'tests/unit/departmentsServiceTenantIsolation.test.js',
];

function loadReport() {
  try {
    return JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function summarize(report) {
  console.log(`[tenant-isolation] generatedAt=${report.generatedAt}`);
  console.log(`[tenant-isolation] suites=${report.suites.passed}/${report.suites.total} passed `
    + `tests=${report.testsPassed}/${report.testsTotal} passed pending=${report.testsPending}`);
  console.log(`[tenant-isolation] violations=${report.violations}`);
  for (const suite of report.failingSuites) {
    console.log(`[tenant-isolation] FAILING ${suite}`);
  }
  console.log(`[tenant-isolation] relatório: ${path.relative(ROOT_DIR, REPORT_PATH)}`);
}

function runJest() {
  const jestBin = path.join(ROOT_DIR, 'node_modules', 'jest-cli', 'bin', 'jest.js');
  const command = fs.existsSync(jestBin) ? process.execPath : 'npx';
  const commandArgs = fs.existsSync(jestBin)
    ? [jestBin, ...TENANT_TEST_TARGETS, '--ci', '--json']
    : ['jest', ...TENANT_TEST_TARGETS, '--ci', '--json'];
  const result = spawnSync(
    command,
    commandArgs,
    {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  if (result.error) {
    throw new Error(`tenant_isolation_jest_spawn_failed: ${result.error.message}`);
  }

  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed.numTotalTests !== 'number') {
    const tail = `${result.stdout || ''}\n${result.stderr || ''}`.split('\n').slice(-20).join('\n');
    throw new Error(`tenant_isolation_jest_output_unparseable (exit=${result.status}):\n${tail}`);
  }
  return parsed;
}

function buildReport(jestResult) {
  const failingSuites = (jestResult.testResults || [])
    .filter((suite) => suite.status === 'failed')
    .map((suite) => path.relative(ROOT_DIR, suite.name));

  return {
    generatedAt: new Date().toISOString(),
    command: `jest ${TENANT_TEST_TARGETS.join(' ')} --ci --json`,
    suites: {
      total: jestResult.numTotalTestSuites,
      passed: jestResult.numPassedTestSuites,
      failed: jestResult.numFailedTestSuites,
    },
    testsTotal: jestResult.numTotalTests,
    testsPassed: jestResult.numPassedTests,
    testsFailed: jestResult.numFailedTests,
    testsPending: jestResult.numPendingTests || 0,
    violations: jestResult.numFailedTests,
    failingSuites,
  };
}

function main() {
  const skipRun = process.argv.slice(2).includes('--skip-run');

  if (skipRun) {
    const report = loadReport();
    if (!report) {
      console.error('[tenant-isolation] --skip-run: nenhum relatório existente em '
        + `${path.relative(ROOT_DIR, REPORT_PATH)}`);
      process.exit(1);
    }
    summarize(report);
    process.exit(report.violations > 0 ? 1 : 0);
  }

  let report;
  try {
    report = buildReport(runJest());
  } catch (err) {
    console.error(`[tenant-isolation] ${err.message}`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  summarize(report);
  process.exit(report.violations > 0 ? 1 : 0);
}

main();
