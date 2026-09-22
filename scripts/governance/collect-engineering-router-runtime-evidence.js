#!/usr/bin/env node
'use strict';

/**
 * collect-engineering-router-runtime-evidence.js — ERV1-CLOSE-010 (Runtime certification).
 *
 * O gate `validate-engineering-router-v1.js` provava até aqui apenas STRUCTURAL_PASS: que o
 * código-fonte CONTÉM os padrões esperados (regex sobre arquivo). Isso nunca prova que o
 * comportamento realmente acontece em runtime — código morto, testes quebrados silenciosamente,
 * ou uma regressão introduzida depois do commit em que o check foi escrito passariam
 * despercebidos. Este script fecha essa lacuna: executa de verdade, via Jest, o teste que prova
 * cada um dos 20 itens de evidência de runtime exigidos pela missão de fechamento, captura o
 * exitCode REAL de cada execução, e persiste tudo em
 * `reports/engineering-router-v1-runtime-evidence.json` amarrado ao commit atual (`sourceCommit`)
 * e a um timestamp — para que o gate possa detectar evidência ausente, velha (de outro commit) ou
 * com exitCode diferente de 0, e reprovar explicitamente nesses casos (nunca aceitar
 * silenciosamente "já rodou algum dia").
 *
 * Uso: node scripts/governance/collect-engineering-router-runtime-evidence.js
 * (chamado por `npm run validate:engineering-router-v1:runtime`, e como parte do pipeline de
 * fechamento antes do gate agregado).
 */

const { execFileSync } = require('child_process');
const { ROOT, writeReport } = require('./common');
const { computeSourceFingerprint } = require('../../governance/proof-engine/fingerprint-chain');

function currentCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
}

// Cada item mapeia para um teste REAL já existente no repositório que exercita o comportamento
// de ponta a ponta (nunca um teste novo criado só para "passar o gate"). Vários itens
// legitimamente compartilham a mesma suíte quando o mesmo teste prova os dois comportamentos
// juntos (ex.: promoção controlada + verificação pós-promoção, no mesmo teste real de git).
const RUNTIME_ITEMS = [
  { id: 'SHELL_INJECTION_REJECTED', testPath: 'tests/unit/engineeringRouterCommandExecutionSecurity.test.js' },
  { id: 'SAFE_ENVIRONMENT', testPath: 'tests/unit/engineeringRouterSafeEnvironment.test.js' },
  { id: 'SECRET_REDACTION_MULTILINE', testPath: 'tests/unit/engineeringRouterSecretRedactionMultiline.test.js' },
  { id: 'PATCH_PATH_BOUNDARIES', testPath: 'tests/unit/engineeringRouterPathBoundary.test.js' },
  { id: 'ACTUAL_PATCH_APPLY', testPath: 'tests/integration/engineeringPatchApplyAndTestRunner.test.js' },
  { id: 'DETERMINISTIC_FAILING_TEST_RED', testPath: 'tests/integration/engineeringRouterFullLoopE2E.test.js' },
  { id: 'RED_TO_FIX', testPath: 'tests/integration/engineeringRouterFullLoopE2E.test.js' },
  { id: 'INDEPENDENT_REVIEW', testPath: 'tests/unit/engineeringRouterModelSelector.test.js' },
  { id: 'REVIEWER_REJECTION_RECODE', testPath: 'tests/integration/engineeringRouterReviewerRejectionRecodeE2E.test.js' },
  { id: 'REGRESSION_EXECUTION', testPath: 'tests/integration/engineeringRegressionGovernanceService.test.js' },
  { id: 'GOVERNANCE_EXECUTION', testPath: 'tests/integration/engineeringRouterRegressionGovernanceGate.test.js' },
  { id: 'PROVIDER_MODEL_FAILURE_REROUTE', testPath: 'tests/integration/engineeringRouterModelRerouteE2E.test.js' },
  { id: 'RESTART_RESUME', testPath: 'tests/integration/engineeringTaskConcurrencyAndRestart.test.js' },
  { id: 'CONTROLLED_PROMOTION', testPath: 'tests/integration/engineeringPromotionService.test.js' },
  { id: 'POST_PROMOTION_VERIFICATION', testPath: 'tests/integration/engineeringPromotionService.test.js' },
  { id: 'EXACT_PATCH_PROMOTION', testPath: 'tests/integration/engineeringPromotionService.test.js' },
  { id: 'FAIL_CLOSED_SCOPE', testPath: 'tests/unit/engineeringRouterFailClosedScope.test.js' },
  { id: 'DEVELOPMENT_AUTHORIZATION', testPath: 'tests/unit/engineeringRouterRoutes.test.js' },
  { id: 'PRODUCTION_DENIAL', testPath: 'tests/unit/engineeringRouterRoutes.test.js' },
  { id: 'SUPPORT_DENIAL_DEFAULT', testPath: 'tests/unit/engineeringRouterRoutes.test.js' },
  { id: 'TENANT_CREDENTIAL_ISOLATION', testPath: 'tests/unit/engineeringRouterRoutes.test.js' },
  { id: 'RELEASE_CLOSURE_SAME_RUN_INTEGRITY', testPath: 'tests/integration/engineeringReleaseClosureAuthority.test.js' },
  { id: 'EXECUTION_SANDBOX_ISOLATION', testPath: 'tests/unit/engineeringRouterExecutionSandboxSecurity.test.js' },
];

function runSuite(testPath) {
  const startedAt = new Date().toISOString();
  let exitCode = 0;
  let output = '';
  try {
    output = execFileSync('npx', ['jest', '--config', 'jest.config.cjs', testPath, '--silent'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    exitCode = typeof err.status === 'number' ? err.status : 1;
    output = `${err.stdout || ''}${err.stderr || ''}`;
  }
  return { exitCode, startedAt, finishedAt: new Date().toISOString(), outputTail: output.split('\n').slice(-15).join('\n') };
}

function main() {
  const sourceCommit = currentCommit();
  // Reutiliza a MESMA autoridade de fingerprint já usada pelo resto da governança do RAP
  // (governance/proof-engine/fingerprint-chain.js), em vez de um hash paralelo — amarra a
  // evidência de runtime ao conteúdo REAL da working tree no momento da execução (inclusive
  // alterações ainda não commitadas), não só ao HEAD do git.
  const sourceFingerprint = computeSourceFingerprint(ROOT);
  const suiteCache = new Map();
  const items = [];

  for (const item of RUNTIME_ITEMS) {
    if (!suiteCache.has(item.testPath)) {
      process.stdout.write(`[runtime-evidence] rodando ${item.testPath}...\n`);
      suiteCache.set(item.testPath, runSuite(item.testPath));
    }
    const suiteResult = suiteCache.get(item.testPath);
    items.push({
      id: item.id,
      testPath: item.testPath,
      exitCode: suiteResult.exitCode,
      pass: suiteResult.exitCode === 0,
      startedAt: suiteResult.startedAt,
      finishedAt: suiteResult.finishedAt,
      outputTail: suiteResult.outputTail,
    });
  }

  const failed = items.filter((i) => !i.pass);
  const report = {
    artifactType: 'engineering-router-v1-runtime-evidence',
    artifactVersion: '1.0.0',
    sourceCommit,
    sourceFingerprint,
    status: failed.length === 0 ? 'RUNTIME_PASS' : 'RUNTIME_FAIL',
    totalItems: items.length,
    failedItems: failed.length,
    items,
  };

  writeReport('engineering-router-v1-runtime-evidence.json', report);
  process.stdout.write(`[runtime-evidence] status=${report.status} items=${items.length} falhas=${failed.length} commit=${sourceCommit} fingerprint=${sourceFingerprint.slice(0, 16)}…\n`);
  if (failed.length > 0) {
    for (const f of failed) process.stdout.write(` - ${f.id} (${f.testPath}): exitCode=${f.exitCode}\n`);
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
