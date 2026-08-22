#!/usr/bin/env node
'use strict';

/**
 * generate-domain-evidence.js — gera os reports de evidência de runtime por
 * domínio a partir de execução REAL das suítes Jest correspondentes.
 *
 * Cada report recebe status derivado do exit code do Jest (PASS/FAIL) e a
 * lineage do run atual (runId/sourceFingerprint/generatedAt). Nenhum status
 * é hardcoded: se a suíte falhar, o report é FAIL e o gate falha.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { connect, close } = require('../../api/db/sequelize');
const getRun = require('../../api/db/models/GovernanceRun');
const { computeSourceFingerprint } = require('../../governance/proof-engine/fingerprint-chain');

const DOMAINS = [
  {
    report: 'reports/rate-limit-validation-report.json',
    artifactType: 'rate-limit-validation-report',
    suites: ['tests/unit/rateLimitTenantPolicies.test.js', 'tests/rate-limit/rateLimit.test.js'],
  },
  {
    report: 'reports/security-validation-report.json',
    artifactType: 'security-validation-report',
    suites: ['tests/unit/metaWebhookSignatureEnforcement.test.js', 'tests/unit/bootstrapSecrets.test.js'],
  },
  {
    report: 'reports/idempotency-validation-report.json',
    artifactType: 'idempotency-validation-report',
    suites: ['tests/unit/processIdempotencyService.test.js', 'tests/unit/webhookService.idempotency.test.js', 'tests/integration/whatsappWebhookIdempotency.test.js'],
  },
  {
    report: 'reports/concurrency-validation-report.json',
    artifactType: 'concurrency-validation-report',
    suites: ['tests/integration/billingWebhookReconciliationFlow.test.js'],
  },
  {
    report: 'reports/external-resilience-report.json',
    artifactType: 'external-resilience-report',
    suites: ['tests/unit/transientNetworkRecovery.test.js', 'tests/unit/ragCircuitBreaker.test.js'],
  },
  {
    report: 'reports/channel-security-report.json',
    artifactType: 'channel-security-report',
    suites: ['tests/unit/metaWebhookSignatureEnforcement.test.js', 'tests/unit/whatsAppQrWebhookSecretEnforcement.test.js'],
  },
  {
    report: 'reports/disaster-recovery-report.json',
    artifactType: 'disaster-recovery-report',
    suites: ['tests/unit/backupImportExportEndpoints.test.js'],
  },
  {
    report: 'reports/deploy-validation-report.json',
    artifactType: 'deploy-validation-report',
    suites: ['tests/unit/release/artifactApproval.test.js'],
  },
  {
    report: 'reports/privacy-retention-report.json',
    artifactType: 'privacy-retention-report',
    suites: ['tests/unit/auditService.coercion.test.js'],
  },
  {
    report: 'reports/billing-entitlement-report.json',
    artifactType: 'billing-entitlement-report',
    suites: ['tests/integration/billingReconciliationRoutes.test.js', 'tests/integration/billingWebhookReconciliationFlow.test.js'],
  },
  {
    report: 'reports/webhook-replay-protection-report.json',
    artifactType: 'webhook-replay-protection-report',
    suites: ['tests/integration/whatsappWebhookIdempotency.test.js', 'tests/unit/webhookService.idempotency.test.js'],
  },
];

function writeReport(domain, run, result, command) {
  const status = result.status === 0 ? 'PASS' : 'FAIL';
  const target = path.join(process.cwd(), domain.report);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    status,
    artifactType: domain.artifactType,
    artifactVersion: '1.0.0',
    runId: run.run_id,
    sourceFingerprint: run.source_fingerprint,
    command,
    exitCode: result.status,
  };
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  return status;
}

async function main() {
  await connect();
  const run = await getRun().findOne({ order: [['created_at', 'DESC']] });
  if (!run) throw new Error('governance_run_missing');
  if (run.source_fingerprint !== computeSourceFingerprint(process.cwd())) throw new Error('RUN_SOURCE_DRIFT');

  const results = [];
  for (const domain of DOMAINS) {
    const args = [...domain.suites, '--runInBand'];
    const command = `npx jest ${args.join(' ')}`;
    const result = spawnSync('npx', ['jest', ...args], { cwd: process.cwd(), stdio: 'inherit' });
    const status = writeReport(domain, run, result, command);
    results.push({ report: domain.report, status });
  }
  console.log(JSON.stringify({ runId: run.run_id, results }));
  if (results.some((r) => r.status !== 'PASS')) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => close().catch(() => {}));
