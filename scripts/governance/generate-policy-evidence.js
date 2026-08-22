#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { connect, close } = require('../../api/db/sequelize');
const getRun = require('../../api/db/models/GovernanceRun');
const { computeSourceFingerprint } = require('../../governance/proof-engine/fingerprint-chain');

function writeEvidence(file, run, command, result) {
  const status = result.status === 0 ? 'PASS' : 'FAIL';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ artifactType: path.basename(file, '.json'), artifactVersion: '1.0.0', generatedAt: new Date().toISOString(), runId: run.run_id, sourceFingerprint: run.source_fingerprint, status, command, exitCode: result.status, dimensions: { 'RAP-077': { status } } }, null, 2)}\n`);
  return status;
}

function assertSourceStable(run, sourceFingerprint, computeSourceFingerprint) {
  const current = computeSourceFingerprint(process.cwd());
  if (current !== sourceFingerprint || run.source_fingerprint !== sourceFingerprint) {
    throw new Error('RUN_SOURCE_DRIFT_DURING_EVIDENCE');
  }
}

async function main() {
  await connect();
  const run = await getRun().findOne({ order: [['created_at', 'DESC']] });
  if (!run) throw new Error('governance_run_missing');
  if (run.source_fingerprint !== computeSourceFingerprint(process.cwd())) throw new Error('RUN_SOURCE_DRIFT');
  const command = 'npx jest tests/unit/governance/agentPolicyBootstrap.test.js tests/unit/governance/masterScorecardPersistenceDefinition.test.js --runInBand';
  const result = spawnSync('npx', ['jest', 'tests/unit/governance/agentPolicyBootstrap.test.js', 'tests/unit/governance/masterScorecardPersistenceDefinition.test.js', '--runInBand'], { cwd: process.cwd(), stdio: 'inherit' });
  const initialSourceFingerprint = run.source_fingerprint;
  assertSourceStable(run, initialSourceFingerprint, computeSourceFingerprint);
  const status = writeEvidence(path.join(process.cwd(), 'reports', 'master-scorecard-test-report.json'), run, command, result);
  const regression = writeEvidence(path.join(process.cwd(), 'reports', 'master-scorecard-regression-report.json'), run, command, result);
  for (const file of ['master-scorecard-test-report.json', 'master-scorecard-regression-report.json']) {
    const reportPath = path.join(process.cwd(), 'reports', file);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    report.dimensions['RAP-076'] = { status };
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  const additional = [
    { dimensions: ['RAP-078'], files: ['tests/unit/governance/mutableJsonStateElimination.test.js'], args: ['tests/unit/governance/mutableJsonStateElimination.test.js'] },
    { dimensions: ['RAP-003'], files: ['tests/unit/cognitiveCoreToolRegistry.test.js', 'tests/unit/cognitivePrincipal.test.js'], args: ['tests/unit/cognitiveCoreToolRegistry.test.js', 'tests/unit/cognitivePrincipal.test.js'] },
    { dimensions: ['RAP-004'], files: ['tests/unit/cognitive/outcomeContracts.test.js'], args: ['tests/unit/cognitive/outcomeContracts.test.js'] },
    { dimensions: ['RAP-005'], files: ['tests/unit/agentSupervisor.test.js', 'tests/unit/corporateAgentLifecycle.test.js'], args: ['tests/unit/agentSupervisor.test.js', 'tests/unit/corporateAgentLifecycle.test.js'] },
    { dimensions: ['RAP-006'], files: ['tests/unit/agentFactoryGovernance.test.js', 'tests/unit/agentFactoryHardeningGates.test.js', 'tests/unit/agentFactoryPublishStatus.test.js'], args: ['tests/unit/agentFactoryGovernance.test.js', 'tests/unit/agentFactoryHardeningGates.test.js', 'tests/unit/agentFactoryPublishStatus.test.js'] },
    { dimensions: ['RAP-007', 'RAP-009'], files: ['tests/unit/cognitiveCoreToolRegistry.test.js', 'tests/unit/mcpServerAdapter.test.js'], args: ['tests/unit/cognitiveCoreToolRegistry.test.js', 'tests/unit/mcpServerAdapter.test.js'] },
    { dimensions: ['RAP-012'], files: ['tests/unit/tenantFailClosed.test.js'], args: ['tests/unit/tenantFailClosed.test.js'] },
    { dimensions: ['RAP-013'], files: ['tests/unit/ragTenantScopeGuard.test.js'], args: ['tests/unit/ragTenantScopeGuard.test.js'] },
    { dimensions: ['RAP-015'], files: ['tests/unit/rpaReliabilityContract.test.js'], args: ['tests/unit/rpaReliabilityContract.test.js'] },
    { dimensions: ['RAP-016', 'RAP-017'], files: ['tests/unit/replaySystemReliabilityFields.test.js'], args: ['tests/unit/replaySystemReliabilityFields.test.js'] },
    { dimensions: ['RAP-020'], files: ['tests/unit/inventory/inventoryIntegration.test.js'], args: ['tests/unit/inventory/inventoryIntegration.test.js'] },
    { dimensions: ['RAP-021'], files: ['tests/unit/governance/fingerprintChain.test.js'], args: ['tests/unit/governance/fingerprintChain.test.js'] },
    { dimensions: ['RAP-022', 'RAP-023', 'RAP-025'], files: ['tests/unit/coverage/coverageGate.test.js', 'tests/unit/coverage/coverageCalculator.test.js', 'tests/unit/coverage/traceabilityGraph.test.js'], args: ['tests/unit/coverage/coverageGate.test.js', 'tests/unit/coverage/coverageCalculator.test.js', 'tests/unit/coverage/traceabilityGraph.test.js'] },
    { dimensions: ['RAP-018'], files: ['tests/unit/coverage/evidenceStore.test.js', 'tests/unit/coverage/evidenceStorePostgres.test.js'], args: ['tests/unit/coverage/evidenceStore.test.js', 'tests/unit/coverage/evidenceStorePostgres.test.js'] },
    { dimensions: ['RAP-026'], files: ['qa-mesh/__tests__/meshRunner.test.js'], args: ['qa-mesh/__tests__/meshRunner.test.js'] },
    { dimensions: ['RAP-027'], files: ['tests/unit/qaWavesService.coverage.test.js'], args: ['tests/unit/qaWavesService.coverage.test.js'] },
    { dimensions: ['RAP-028', 'RAP-029', 'RAP-030', 'RAP-031', 'RAP-032', 'RAP-033', 'RAP-034', 'RAP-035', 'RAP-036'], files: ['tests/unit/modelDrivenQa.test.js', 'tests/unit/governance/modelDrivenE2e.test.js', 'tests/unit/governance/modelDrivenCandidateLifecycle.test.js', 'tests/unit/governance/relationalSeedProvisioning.test.js'], args: ['tests/unit/modelDrivenQa.test.js', 'tests/unit/governance/modelDrivenE2e.test.js', 'tests/unit/governance/modelDrivenCandidateLifecycle.test.js', 'tests/unit/governance/relationalSeedProvisioning.test.js'] },
    { dimensions: ['RAP-037'], files: ['tests/unit/learningCoreIngest.test.js'], args: ['tests/unit/learningCoreIngest.test.js'] },
    { dimensions: ['RAP-038'], files: ['tests/unit/processRuntime.test.js'], args: ['tests/unit/processRuntime.test.js'] },
    { dimensions: ['RAP-039'], files: ['tests/unit/cognitive/eventSemantics.test.js'], args: ['tests/unit/cognitive/eventSemantics.test.js'] },
    { dimensions: ['RAP-040'], files: ['tests/unit/enumContractValidation.test.js'], args: ['tests/unit/enumContractValidation.test.js'] },
    { dimensions: ['RAP-041', 'RAP-044'], files: ['tests/unit/governance/fingerprintChain.test.js'], args: ['tests/unit/governance/fingerprintChain.test.js'] },
    { dimensions: ['RAP-063'], files: ['tests/unit/rateLimitTenantPolicies.test.js'], args: ['tests/unit/rateLimitTenantPolicies.test.js'] },
    { dimensions: ['RAP-064', 'RAP-069'], files: ['tests/unit/bootstrapSecrets.test.js', 'tests/unit/metaWebhookSignatureEnforcement.test.js', 'tests/unit/whatsAppQrWebhookSecretEnforcement.test.js'], args: ['tests/unit/bootstrapSecrets.test.js', 'tests/unit/metaWebhookSignatureEnforcement.test.js', 'tests/unit/whatsAppQrWebhookSecretEnforcement.test.js'] },
    { dimensions: ['RAP-065', 'RAP-075'], files: ['tests/unit/processIdempotencyService.test.js', 'tests/unit/webhookService.idempotency.test.js', 'tests/integration/whatsappWebhookIdempotency.test.js'], args: ['tests/unit/processIdempotencyService.test.js', 'tests/unit/webhookService.idempotency.test.js', 'tests/integration/whatsappWebhookIdempotency.test.js'] },
    { dimensions: ['RAP-073'], files: ['tests/integration/billingWebhookReconciliationFlow.test.js', 'tests/integration/billingReconciliationRoutes.test.js'], args: ['tests/integration/billingWebhookReconciliationFlow.test.js', 'tests/integration/billingReconciliationRoutes.test.js'] },
    { dimensions: ['RAP-067'], files: ['tests/unit/transientNetworkRecovery.test.js', 'tests/unit/ragCircuitBreaker.test.js'], args: ['tests/unit/transientNetworkRecovery.test.js', 'tests/unit/ragCircuitBreaker.test.js'] },
    { dimensions: ['RAP-068'], files: ['tests/unit/selftestService.voiceRuntime.test.js', 'tests/unit/pbxCompositionCutoverWiring.test.js'], args: ['tests/unit/selftestService.voiceRuntime.test.js', 'tests/unit/pbxCompositionCutoverWiring.test.js'] },
    { dimensions: ['RAP-070', 'RAP-072'], files: ['tests/unit/backupImportExportEndpoints.test.js', 'tests/unit/auditService.coercion.test.js'], args: ['tests/unit/backupImportExportEndpoints.test.js', 'tests/unit/auditService.coercion.test.js'] },
    { dimensions: ['RAP-019'], files: ['tests/unit/governance/criticalCausalTraceValidation.test.js'], args: ['tests/unit/governance/criticalCausalTraceValidation.test.js'] },
    { dimensions: ['RAP-042'], files: ['tests/unit/replaySystemReliabilityFields.test.js'], args: ['tests/unit/replaySystemReliabilityFields.test.js'] },
    { dimensions: ['RAP-043', 'RAP-045', 'RAP-046', 'RAP-047', 'RAP-048', 'RAP-049', 'RAP-050', 'RAP-051', 'RAP-052', 'RAP-053', 'RAP-054', 'RAP-055', 'RAP-056', 'RAP-057'], files: ['tests/unit/finalGovernanceGates.test.js', 'tests/unit/governance/finalConsistencyAuthority.test.js', 'tests/unit/governance/proofEngineSemantic.test.js', 'tests/unit/governance/readinessDecisionProofGaps.test.js', 'tests/unit/governance/selfProvingReport.test.js', 'tests/unit/governance/certificationPathIntegrity.test.js', 'tests/unit/governance/verifyDeliveredRelease.test.js'], args: ['tests/unit/finalGovernanceGates.test.js', 'tests/unit/governance/finalConsistencyAuthority.test.js', 'tests/unit/governance/proofEngineSemantic.test.js', 'tests/unit/governance/readinessDecisionProofGaps.test.js', 'tests/unit/governance/selfProvingReport.test.js', 'tests/unit/governance/certificationPathIntegrity.test.js', 'tests/unit/governance/verifyDeliveredRelease.test.js'] },
    { dimensions: ['RAP-010', 'RAP-061'], files: ['tests/contracts/contractValidation.test.js', 'tests/tenant/saasSecurity.test.js'], args: ['tests/contracts/contractValidation.test.js', 'tests/tenant/saasSecurity.test.js'] },
    { dimensions: ['RAP-062', 'RAP-074'], files: ['tests/unit/coverage/dbIntegrityGateMapping.test.js', 'tests/unit/coverage/dbIntegrityWave.test.js'], args: ['tests/unit/coverage/dbIntegrityGateMapping.test.js', 'tests/unit/coverage/dbIntegrityWave.test.js'] },
    { dimensions: ['RAP-002', 'RAP-024'], files: ['tests/unit/governance/coverageCompletenessCanonicalDomains.test.js'], args: ['tests/unit/governance/coverageCompletenessCanonicalDomains.test.js'] },
    { dimensions: ['RAP-011'], files: ['tests/unit/cognitivePrincipal.test.js'], args: ['tests/unit/cognitivePrincipal.test.js'] },
    { dimensions: ['RAP-058'], files: ['tests/unit/tenantFailClosed.test.js', 'tests/tenant/saasSecurity.test.js'], args: ['tests/unit/tenantFailClosed.test.js', 'tests/tenant/saasSecurity.test.js'] },
    { dimensions: ['RAP-059'], files: ['tests/unit/voiceEventLedgerTenant.test.js'], args: ['tests/unit/voiceEventLedgerTenant.test.js'] },
    { dimensions: ['RAP-060'], files: ['tests/unit/finalGovernanceGates.test.js', 'tests/unit/governance/verifyDeliveredRelease.test.js'], args: ['tests/unit/finalGovernanceGates.test.js', 'tests/unit/governance/verifyDeliveredRelease.test.js'] },
    { dimensions: ['RAP-066'], files: ['tests/unit/billingService.createChargeIdempotency.test.js', 'tests/integration/billingWebhookReconciliationFlow.test.js'], args: ['tests/unit/billingService.createChargeIdempotency.test.js', 'tests/integration/billingWebhookReconciliationFlow.test.js'] },
    { dimensions: ['RAP-071'], files: ['tests/unit/release/artifactApproval.test.js'], args: ['tests/unit/release/artifactApproval.test.js'] },
    { dimensions: ['RAP-008', 'RAP-014'], files: ['tests/unit/securityNegative.test.js'], args: ['tests/unit/securityNegative.test.js'] },
    { dimensions: ['RAP-052', 'RAP-053', 'RAP-054'], files: ['tests/unit/governance/packageManifestBuilder.test.js'], args: ['tests/unit/governance/packageManifestBuilder.test.js'] },
  ];
  for (const item of additional) {
    assertSourceStable(run, initialSourceFingerprint, computeSourceFingerprint);
    const commandArgs = [...item.args, '--runInBand'];
    const execution = spawnSync('npx', ['jest', ...commandArgs], { cwd: process.cwd(), stdio: 'inherit' });
    assertSourceStable(run, initialSourceFingerprint, computeSourceFingerprint);
    const dimensionStatus = execution.status === 0 ? 'PASS' : 'FAIL';
    for (const file of ['master-scorecard-test-report.json', 'master-scorecard-regression-report.json']) {
      const reportPath = path.join(process.cwd(), 'reports', file);
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      for (const dimension of item.dimensions) report.dimensions[dimension] = { status: dimensionStatus, command: `npx jest ${commandArgs.join(' ')}`, exitCode: execution.status };
      fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    }
  }
  const cognitiveCommand = 'npx jest tests/unit/cognitiveCorePipeline.test.js tests/unit/cognitiveCoreIntentEngine.test.js --runInBand';
  const cognitiveResult = spawnSync('npx', ['jest', 'tests/unit/cognitiveCorePipeline.test.js', 'tests/unit/cognitiveCoreIntentEngine.test.js', '--runInBand'], { cwd: process.cwd(), stdio: 'inherit' });
  const cognitiveStatus = cognitiveResult.status === 0 ? 'PASS' : 'FAIL';
  for (const file of ['master-scorecard-test-report.json', 'master-scorecard-regression-report.json']) {
    const reportPath = path.join(process.cwd(), 'reports', file);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    report.dimensions['RAP-001'] = { status: cognitiveStatus, command: cognitiveCommand, exitCode: cognitiveResult.status };
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify({ runId: run.run_id, status, regression }));
  if (status !== 'PASS' || regression !== 'PASS') process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => close().catch(() => {}));