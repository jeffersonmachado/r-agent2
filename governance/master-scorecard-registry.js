'use strict';

/**
 * Registry canônico do RAP Master Scorecard.
 *
 * Este arquivo é fonte versionada (e participa do sourceFingerprint porque
 * governance/*.js integra a superfície de prova). O JSON em
 * governance/rap-master-scorecard.json é sempre saída derivada.
 */

const REQUIRED_CATEGORIES = Object.freeze([
  'IMPLEMENTED', 'INTEGRATED', 'TESTED', 'RUNTIME_VALIDATED', 'GOVERNED',
  'REGRESSION_PROTECTED', 'NO_KNOWN_GAP', 'NO_OPEN_BLOCKER', 'CURRENT_RUN', 'CURRENT_SOURCE', 'CURRENT_POLICY',
]);

function artifact(path, acceptedValues, statusPaths = ['status', 'decision', 'finalDecision', 'pass', 'ok']) {
  // Projeções circulares finais (proof/readiness/governance) são DERIVADAS do
  // scorecard. Em fase PRE_PACKAGE elas carregam honestamente
  // `PASS_WITH_DEFERRED_PACKAGE_GATE` (gates semânticos ok, decisão final
  // pendente de package/delivered) — não é GO final, tampouco FAIL. Aceitá-las
  // como governadas é o que quebra o ciclo sem fabricar GO (sem
  // forceAutonomousReady). `NO_GO` permanece rejeitado.
  const values = DEFERRED_CIRCULAR_PATHS.has(path)
    ? [...new Set([...acceptedValues, 'PASS_WITH_DEFERRED_PACKAGE_GATE'])]
    : acceptedValues;
  return { type: 'current_artifact', path, statusPaths, acceptedValues: values, requireLineage: true, maxAgeMs: 7 * 24 * 60 * 60 * 1000 };
}

// Projeções finais que derivam do estado do próprio scorecard (não são inputs
// independentes). Só estas carregam o estado transitório DEFERRED em PRE_PACKAGE.
const DEFERRED_CIRCULAR_PATHS = new Set([
  'governance/final-proof-report.json',
  'governance/final-readiness-report.json',
  'governance/final-governance-report.json',
]);

function commonTestEvidence(id) {
  return artifact('reports/master-scorecard-test-report.json', ['PASS'], [`dimensions.${id}.status`]);
}

function commonRegressionEvidence(id) {
  return artifact('reports/master-scorecard-regression-report.json', ['PASS'], [`dimensions.${id}.status`]);
}

function requirement(id, category, description, evidence = []) {
  return { id, category, mandatory: true, description, evidence };
}

function dimension(number, name, definition) {
  const id = `RAP-${String(number).padStart(3, '0')}`;
  const sources = definition.sources || [];
  const integrations = definition.integrations || [];
  const tests = definition.tests || [];
  const runtime = definition.runtime || [];
  const governance = definition.governance || [];
  return {
    id,
    name,
    description: definition.description || name,
    ownerArea: definition.ownerArea,
    applicable: definition.applicable !== false,
    applicabilityRationale: definition.applicabilityRationale || 'A dimensão cobre uma superfície ativa ou uma obrigação de release do RAP.',
    traceability: {
      sources,
      integrations,
      tests,
      runtimeArtifacts: runtime.map((item) => item.path),
      governanceArtifacts: governance.map((item) => item.path),
    },
    requirements: [
      requirement('implemented', 'IMPLEMENTED', 'Implementação fonte aplicável existe e é não vazia.', [{ type: 'all_paths_exist', paths: sources }]),
      requirement('integrated', 'INTEGRATED', 'Entradas de integração canônicas existem e são não vazias.', [{ type: 'all_paths_exist', paths: integrations }]),
      requirement('tested', 'TESTED', 'Testes declarados existem e um resultado do run atual comprova execução.', [{ type: 'all_paths_exist', paths: tests }, commonTestEvidence(id)]),
      requirement('runtime-validated', 'RUNTIME_VALIDATED', 'Evidência de runtime atual, válida e vinculada ao run comprova a dimensão.', runtime),
      requirement('governed', 'GOVERNED', 'Gate canônico atual, válido e vinculado ao run aprova a dimensão.', governance),
      requirement('regression-protected', 'REGRESSION_PROTECTED', 'Regressão adversarial do run atual protege a dimensão.', [{ type: 'all_paths_exist', paths: tests }, commonRegressionEvidence(id)]),
      requirement('no-known-gap', 'NO_KNOWN_GAP', 'Nenhum requisito obrigatório da dimensão possui gap aberto.', [{ type: 'derived_no_gap' }]),
      requirement('no-open-blocker', 'NO_OPEN_BLOCKER', 'Nenhum blocker high/critical permanece aberto.', [{ type: 'derived_no_blocker' }]),
      requirement('current-run', 'CURRENT_RUN', 'RunContext imutável está presente e em estado certificável.', [{ type: 'current_run' }]),
      requirement('current-source', 'CURRENT_SOURCE', 'Fingerprint da fonte atual coincide com o source freeze do run.', [{ type: 'current_source' }]),
      requirement('current-policy', 'CURRENT_POLICY', 'Constituição e fingerprint de policy estão congelados no run atual.', [{ type: 'current_policy' }]),
    ],
  };
}

const D = dimension;
const A = artifact;
const MASTER_SCORECARD_REGISTRY = Object.freeze([
  D(1, 'Arquitetura RAP / Autonomous Loop', { ownerArea: 'cognitive-core', sources: ['src/core/cognitive/cognitive-orchestrator/index.js'], integrations: ['src/core/cognitive/index.js'], tests: ['tests/unit/cognitiveCorePipeline.test.js'], runtime: [A('governance/critical-journey-evidence.json', ['CRITICAL_JOURNEY_VALIDATED'])], governance: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(2, 'Workspace / UX Operacional', { ownerArea: 'frontend', sources: ['frontend/src/pages/WorkspacePage.jsx'], integrations: ['frontend/src/main.jsx', 'frontend/src/navigation/menu.js'], tests: ['tests/unit/governance/coverageCompletenessCanonicalDomains.test.js'], runtime: [A('reports/page-surface-report.json', ['PASS'])], governance: [A('reports/coverage-gate-report.json', ['PASS', 'GO'])] }),
  D(3, 'Cognitive Core', { ownerArea: 'cognitive-core', sources: ['src/core/cognitive'], integrations: ['src/core/cognitive/cognitive-orchestrator/index.js'], tests: ['tests/unit/cognitiveCorePipeline.test.js', 'tests/unit/cognitiveCoreIntentEngine.test.js'], runtime: [A('governance/critical-journey-evidence.json', ['CRITICAL_JOURNEY_VALIDATED'])], governance: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(4, 'Business Outcome Architecture', { ownerArea: 'cognitive-core', sources: ['src/core/cognitive/outcome'], integrations: ['src/core/cognitive/validation-engine/index.js'], tests: ['tests/unit/cognitive/outcomeContracts.test.js'], runtime: [A('governance/critical-journey-evidence.json', ['CRITICAL_JOURNEY_VALIDATED'])], governance: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(5, 'Agent OS / Agent Supervisor', { ownerArea: 'agent-os', sources: ['src/core/cognitive/agent-supervisor'], integrations: ['src/core/cognitive/cognitive-orchestrator/index.js'], tests: ['tests/unit/agentSupervisor.test.js'], runtime: [A('governance/critical-journey-evidence.json', ['CRITICAL_JOURNEY_VALIDATED'])], governance: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(6, 'Agent Factory Governance', { ownerArea: 'agent-os', sources: ['api/modules/agent-os'], integrations: ['api/composition/extended'], tests: ['tests/unit/corporateAgentLifecycleMigration.test.js'], runtime: [A('governance/final-readiness-report.json', ['AUTONOMOUS_READY_GO'])], governance: [A('governance/final-governance-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(7, 'Tool Registry / Authorization', { ownerArea: 'cognitive-core', sources: ['src/core/cognitive/tool-registry/index.js'], integrations: ['src/core/cognitive/execution-engine/index.js'], tests: ['tests/unit/cognitiveCoreToolRegistry.test.js'], runtime: [A('governance/critical-journey-evidence.json', ['CRITICAL_JOURNEY_VALIDATED'])], governance: [A('governance/system-scope-audit.json', ['PASS'])] }),
  D(8, 'Business Capabilities × Technical Tools', { ownerArea: 'agent-os', sources: ['src/core/cognitive/capability-registry'], integrations: ['api/modules/agent-os/experience-segregation.js'], tests: ['tests/unit/securityNegative.test.js'], runtime: [A('reports/api-surface-report.json', ['PASS'])], governance: [A('reports/visibility-policy-report.json', ['PASS'])] }),
  D(9, 'MCP Architecture', { ownerArea: 'mcp', sources: ['src/core/mcp'], integrations: ['src/core/cognitive/execution-router'], tests: ['tests/unit/mcpServerAdapter.test.js'], runtime: [A('governance/final-readiness-report.json', ['AUTONOMOUS_READY_GO'])], governance: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(10, 'Multi-Tenant Isolation', { ownerArea: 'security', sources: ['api/middleware/tenantValidation.js'], integrations: ['api/composition/shared/requireTenant.js'], tests: ['tests/tenant/tenantIsolation.test.js', 'tests/integration/tenantRequired.test.js'], runtime: [A('reports/tenant-isolation-report.json', ['PASS'])], governance: [A('governance/system-scope-audit.json', ['PASS'])] }),
  D(11, 'Principal / Identity Architecture', { ownerArea: 'security', sources: ['src/core/cognitive/principal.js'], integrations: ['src/core/cognitive/cognitive-orchestrator/index.js'], tests: ['tests/unit/cognitivePrincipal.test.js'], runtime: [A('governance/system-scope-audit.json', ['PASS'])], governance: [A('governance/system-scope-audit.json', ['PASS'])] }),
  D(12, 'Explicit Platform System', { ownerArea: 'security', sources: ['src/core/cognitive/principal.js'], integrations: ['scripts/governance/generate-system-scope-audit.js'], tests: ['tests/unit/tenantFailClosed.test.js'], runtime: [A('governance/system-scope-audit.json', ['PASS'])], governance: [A('governance/system-scope-audit.json', ['PASS'])] }),
  D(13, 'RAG / Knowledge Plane', { ownerArea: 'rag', sources: ['rag-service/main.py', 'api/services/rag/domainRouter.js'], integrations: ['api/modules/rag-documents'], tests: ['tests/unit/ragTenantScopeGuard.test.js'], runtime: [A('reports/rag-domain-segregation-report.json', ['PASS'])], governance: [A('reports/rag-domain-segregation-report.json', ['PASS'])] }),
  D(14, 'Production / Support / Development Segregation', { ownerArea: 'security', description: 'Segregação ponta a ponta: UI (visibility-policy + experience-segregation) E APIs server-side (experience-api-segregation). PASS do relatório de API segregation implica contadores zero (productionTechnicalLeaks=0, supportEngineeringLeaks=0, directUrlBypasses=0); a prova é packageRequired no payload e verificada offline pelo gate payload_experience_api_segregation.', sources: ['api/middleware/requireClassification.js'], integrations: ['api/modules/agent-os/experience-segregation.js', 'api/modules/workspace/workspace.route-classifications.js'], tests: ['tests/unit/securityNegative.test.js', 'tests/governance/experienceApiSegregation.test.js'], runtime: [A('reports/visibility-policy-report.json', ['PASS'])], governance: [A('reports/visibility-policy-report.json', ['PASS']), A('reports/experience-segregation-report.json', ['PASS']), A('reports/experience-api-segregation-report.json', ['PASS'])] }),
  D(15, 'Replay × RPA Segregation', { ownerArea: 'rpa', sources: ['api/modules/rpa-tests/rpaRouteUtils.js'], integrations: ['api/modules/agent-os/experience-segregation.js'], tests: ['tests/unit/rpaTenantIsolation.test.js'], runtime: [A('governance/replay-integrity-report.json', ['REPLAY_INTEGRITY_GO', 'PASS'])], governance: [A('governance/replay-hardening-report.json', ['REPLAY_HARDENING_GO']), A('reports/experience-segregation-report.json', ['PASS'])] }),
  D(16, 'RPA Runtime', { ownerArea: 'rpa', sources: ['core/rpa/player/rpaPlayer.js'], integrations: ['core/rpa/replaySystem.js'], tests: ['tests/unit/rpaReliabilityContract.test.js'], runtime: [A('governance/replay-integrity-report.json', ['REPLAY_INTEGRITY_GO', 'PASS'])], governance: [A('governance/replay-hardening-report.json', ['REPLAY_HARDENING_GO'])] }),
  D(17, 'Replay Architecture', { ownerArea: 'replay', sources: ['lib/replaySystem.js'], integrations: ['governance/replay-integrity.js'], tests: ['tests/unit/replaySystemReliabilityFields.test.js'], runtime: [A('governance/replay-integrity-report.json', ['REPLAY_INTEGRITY_GO', 'PASS'])], governance: [A('governance/replay-hardening-report.json', ['REPLAY_HARDENING_GO'])] }),
  D(18, 'Evidence Engine', { ownerArea: 'qa', sources: ['qa/coverage/evidenceStore.js'], integrations: ['api/core/tenant-intelligence/EvidenceEngine.js'], tests: ['tests/unit/coverage/evidenceStore.test.js'], runtime: [A('governance/evidence-manifest.json', ['PASS', 'GO'])], governance: [A('reports/coverage-gate-report.json', ['PASS', 'GO'])] }),
  D(19, 'Critical Causal Journey', { ownerArea: 'governance', sources: ['scripts/governance/generate-critical-journey-evidence.js'], integrations: ['api/services/qa/causChainValidator.js'], tests: ['tests/unit/governance/criticalJourneyEvidence.test.js'], runtime: [A('governance/critical-journey-evidence.json', ['CRITICAL_JOURNEY_VALIDATED'])], governance: [A('governance/critical-journey-evidence.json', ['CRITICAL_JOURNEY_VALIDATED'])] }),
  D(20, 'System Inventory', { ownerArea: 'qa', sources: ['api/services/qa/inventory'], integrations: ['scripts/build-system-inventory.js'], tests: ['tests/unit/inventory/inventoryIntegration.test.js'], runtime: [A('reports/inventory-build-report.json', ['PASS'])], governance: [A('reports/coverage-gate-report.json', ['PASS', 'GO'])] }),
  D(21, 'Inventory Freshness', { ownerArea: 'qa', sources: ['config/system-inventory.json'], integrations: ['governance/proof-engine/fingerprint-chain.js'], tests: ['tests/unit/governance/fingerprintChain.test.js'], runtime: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])], governance: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(22, 'Coverage Architecture', { ownerArea: 'qa', sources: ['qa/coverage'], integrations: ['scripts/governance/validate-coverage-gate.js'], tests: ['tests/unit/coverage/coverageGate.test.js'], runtime: [A('reports/coverage-gate-report.json', ['PASS', 'GO'])], governance: [A('reports/coverage-gate-report.json', ['PASS', 'GO'])] }),
  D(23, 'Coverage Mathematics', { ownerArea: 'qa', sources: ['qa/coverage/coverageCalculator.js'], integrations: ['scripts/governance/validate-coverage-gate.js'], tests: ['tests/unit/coverage/coverageCalculator.test.js'], runtime: [A('reports/coverage-gate-report.json', ['PASS', 'GO'])], governance: [A('reports/coverage-gate-report.json', ['PASS', 'GO'])] }),
  D(24, 'Behavioral Coverage', { ownerArea: 'qa', sources: ['qa-mesh/meshRunner.js'], integrations: ['qa-mesh/governance.js'], tests: ['tests/unit/governance/coverageCompletenessCanonicalDomains.test.js'], runtime: [A('qa-mesh/go-no-go-report.json', ['GO'])], governance: [A('reports/coverage-completeness-report.json', ['PASS'])] }),
  D(25, 'Coverage Evidence Traceability', { ownerArea: 'qa', sources: ['qa/coverage/traceabilityGraph.js'], integrations: ['qa/coverage/evidenceStore.js'], tests: ['tests/unit/coverage/traceabilityGraph.test.js'], runtime: [A('reports/coverage-gate-report.json', ['PASS', 'GO'])], governance: [A('reports/coverage-gate-report.json', ['PASS', 'GO'])] }),
  D(26, 'QA Mesh', { ownerArea: 'qa-mesh', sources: ['qa-mesh/meshRunner.js'], integrations: ['qa-mesh/governance.js'], tests: ['qa-mesh/__tests__/meshRunner.test.js'], runtime: [A('qa-mesh/go-no-go-report.json', ['GO'])], governance: [A('qa-mesh/go-no-go-report.json', ['GO'])] }),
  D(27, 'QA Waves', { ownerArea: 'qa-waves', sources: ['qa/qa-waves'], integrations: ['tools/system/qa-waves-enterprise-governance-bridge.js'], tests: ['tests/unit/qaWavesService.coverage.test.js'], runtime: [A('qa/qa-waves-enterprise-governance.json', ['GO', 'PASS'])], governance: [A('qa/qa-waves-enterprise-governance.json', ['GO', 'PASS'])] }),
  D(28, 'Model Introspection', { ownerArea: 'qa', sources: ['api/modules/agent-os/services/model-driven-pipeline.js'], integrations: ['scripts/governance/validate-model-driven-e2e.js'], tests: ['tests/unit/modelDrivenQa.test.js'], runtime: [A('governance/model-driven-e2e-report.json', ['MODEL_DRIVEN_E2E_VALIDATED'])], governance: [A('governance/model-driven-e2e-report.json', ['MODEL_DRIVEN_E2E_VALIDATED'])] }),
  D(29, 'Entity Graph', { ownerArea: 'qa', sources: ['api/modules/agent-os/services/model-driven-pipeline.js'], integrations: ['scripts/governance/validate-model-driven-e2e.js'], tests: ['tests/unit/modelDrivenQa.test.js'], runtime: [A('governance/model-driven-e2e-report.json', ['MODEL_DRIVEN_E2E_VALIDATED'])], governance: [A('governance/model-driven-e2e-report.json', ['MODEL_DRIVEN_E2E_VALIDATED'])] }),
  D(30, 'Model-Driven Journey Discovery', { ownerArea: 'qa', sources: ['api/modules/agent-os/services/model-driven-pipeline.js'], integrations: ['scripts/governance/validate-model-driven-e2e.js'], tests: ['tests/unit/governance/modelDrivenE2e.test.js'], runtime: [A('governance/model-driven-e2e-report.json', ['MODEL_DRIVEN_E2E_VALIDATED'])], governance: [A('governance/model-driven-e2e-report.json', ['MODEL_DRIVEN_E2E_VALIDATED'])] }),
  D(31, 'Model-Driven E2E', { ownerArea: 'qa', sources: ['api/modules/agent-os/services/model-driven-pipeline.js'], integrations: ['scripts/governance/validate-model-driven-e2e.js'], tests: ['tests/unit/governance/modelDrivenE2e.test.js'], runtime: [A('governance/model-driven-e2e-report.json', ['MODEL_DRIVEN_E2E_VALIDATED'])], governance: [A('governance/model-driven-e2e-report.json', ['MODEL_DRIVEN_E2E_VALIDATED'])] }),
  D(32, 'Scenario Generation', { ownerArea: 'qa', sources: ['api/modules/agent-os/services/model-driven-pipeline.js'], integrations: ['qa/qa-waves/services'], tests: ['tests/unit/modelDrivenQa.test.js'], runtime: [A('governance/model-driven-e2e-report.json', ['MODEL_DRIVEN_E2E_VALIDATED'])], governance: [A('governance/model-driven-e2e-report.json', ['MODEL_DRIVEN_E2E_VALIDATED'])] }),
  D(33, 'Relational Synthetic Data', { ownerArea: 'qa', sources: ['api/services/qa/seeds'], integrations: ['api/modules/agent-os/services/model-driven-pipeline.js'], tests: ['tests/unit/modelDrivenQa.test.js'], runtime: [A('governance/model-driven-e2e-report.json', ['MODEL_DRIVEN_E2E_VALIDATED'])], governance: [A('governance/model-driven-e2e-report.json', ['MODEL_DRIVEN_E2E_VALIDATED'])] }),
  D(34, 'Relational Dependency Planner', { ownerArea: 'qa', sources: ['api/services/qa/seeds'], integrations: ['api/modules/agent-os/services/model-driven-pipeline.js'], tests: ['tests/unit/modelDrivenQa.test.js'], runtime: [A('governance/model-driven-e2e-report.json', ['MODEL_DRIVEN_E2E_VALIDATED'])], governance: [A('governance/model-driven-e2e-report.json', ['MODEL_DRIVEN_E2E_VALIDATED'])] }),
  D(35, 'Seed Provisioning', { ownerArea: 'qa', sources: ['api/services/qa/seeds'], integrations: ['qa/qa-waves/services'], tests: ['tests/unit/modelDrivenQa.test.js'], runtime: [A('governance/model-driven-e2e-report.json', ['MODEL_DRIVEN_E2E_VALIDATED'])], governance: [A('governance/model-driven-e2e-report.json', ['MODEL_DRIVEN_E2E_VALIDATED'])] }),
  D(36, 'Seed Integrity', { ownerArea: 'qa', sources: ['api/services/qa/seeds'], integrations: ['scripts/governance/validate-model-driven-e2e.js'], tests: ['tests/unit/modelDrivenQa.test.js'], runtime: [A('governance/model-driven-e2e-report.json', ['MODEL_DRIVEN_E2E_VALIDATED'])], governance: [A('governance/model-driven-e2e-report.json', ['MODEL_DRIVEN_E2E_VALIDATED'])] }),
  D(37, 'Learning Core', { ownerArea: 'learning-core', sources: ['src/core/learning'], integrations: ['api/runtime/startWorkers.js'], tests: ['tests/unit/learningCoreIngest.test.js'], runtime: [A('governance/final-readiness-report.json', ['AUTONOMOUS_READY_GO'])], governance: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(38, 'Durable Process Runtime', { ownerArea: 'process-runtime', sources: ['api/core/process-runtime'], integrations: ['src/core/cognitive/execution-router'], tests: ['tests/unit/processRuntime.test.js'], runtime: [A('governance/final-readiness-report.json', ['AUTONOMOUS_READY_GO'])], governance: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(39, 'Event Semantics', { ownerArea: 'cognitive-core', sources: ['api/services/eventLedgerService.js'], integrations: ['src/core/cognitive/cognitive-orchestrator/index.js'], tests: ['tests/unit/cognitive/eventSemantics.test.js'], runtime: [A('governance/critical-journey-evidence.json', ['CRITICAL_JOURNEY_VALIDATED'])], governance: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(40, 'Canonical Taxonomy / Registries', { ownerArea: 'architecture', sources: ['config/journey-contracts.json', 'contracts/versions.json'], integrations: ['qa/contracts/journeyCriticality.js'], tests: ['tests/unit/enumContractValidation.test.js'], runtime: [A('reports/coverage-gate-report.json', ['PASS', 'GO'])], governance: [A('reports/coverage-gate-report.json', ['PASS', 'GO'])] }),
  D(41, 'Run Immutability', { ownerArea: 'governance', sources: ['governance/shared/run-id.js'], integrations: ['governance/proof-engine/fingerprint-chain.js'], tests: ['tests/unit/governance/fingerprintChain.test.js'], runtime: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])], governance: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(42, 'Artifact Lineage', { ownerArea: 'governance', sources: ['governance/proof-engine/index.js'], integrations: ['governance/proof-engine/index.js'], tests: ['tests/unit/governance/fingerprintChain.test.js'], runtime: [A('governance/evidence-manifest.json', ['PASS', 'GO'])], governance: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(43, 'Artifact Run Isolation', { ownerArea: 'governance', sources: ['governance/shared/run-id.js'], integrations: ['governance/proof-engine/index.js'], tests: ['tests/unit/governance/verifyDeliveredRelease.test.js'], runtime: [A('governance/evidence-manifest.json', ['PASS', 'GO'])], governance: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(44, 'Fingerprint Chain', { ownerArea: 'governance', sources: ['governance/proof-engine/fingerprint-chain.js'], integrations: ['governance/proof-engine/index.js'], tests: ['tests/unit/governance/fingerprintChain.test.js'], runtime: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])], governance: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(45, 'Proof Freshness', { ownerArea: 'governance', sources: ['governance/proof-engine/fingerprint-chain.js'], integrations: ['governance/proof-engine/index.js'], tests: ['tests/unit/governance/fingerprintChain.test.js'], runtime: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])], governance: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(46, 'Proof Engine Semantics', { ownerArea: 'governance', sources: ['governance/proof-engine/index.js'], integrations: ['tools/system/platform-readiness.js'], tests: ['tests/unit/governance/proofEngineSemantic.test.js'], runtime: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])], governance: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(47, 'No Synthetic Proof', { ownerArea: 'governance', sources: ['governance/proof-engine/index.js'], integrations: ['scripts/governance/generate-critical-journey-evidence.js'], tests: ['tests/unit/governance/criticalJourneyEvidence.test.js'], runtime: [A('governance/critical-journey-evidence.json', ['CRITICAL_JOURNEY_VALIDATED'])], governance: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(48, 'Final Governance', { ownerArea: 'governance', sources: ['governance/final-governance-engine.js'], integrations: ['tools/system/platform-readiness.js'], tests: ['tests/unit/finalGovernanceGates.test.js'], runtime: [A('governance/final-governance-report.json', ['AUTONOMOUS_READY_GO'])], governance: [A('governance/final-governance-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(49, 'Readiness Engine', { ownerArea: 'governance', sources: ['governance/shared/readiness-decision-engine.js'], integrations: ['tools/system/platform-readiness.js'], tests: ['tests/unit/governance/readinessDecisionProofGaps.test.js'], runtime: [A('governance/final-readiness-report.json', ['AUTONOMOUS_READY_GO'])], governance: [A('governance/final-readiness-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(50, 'Canonical Final Decision', { ownerArea: 'governance', sources: ['governance/shared/readiness-decision-engine.js'], integrations: ['tools/system/platform-readiness.js'], tests: ['tests/unit/finalGovernanceGates.test.js'], runtime: [A('governance/final-readiness-report.json', ['AUTONOMOUS_READY_GO'])], governance: [A('governance/final-governance-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(51, 'Cross-Engine Consistency', { ownerArea: 'governance', sources: ['governance/governance-consistency-engine.js'], integrations: ['governance/final-consistency-gate.js'], tests: ['tests/unit/finalGovernanceGates.test.js'], runtime: [A('governance/final-consistency-gate-report.json', ['FINAL_CONSISTENCY_GO'])], governance: [A('governance/final-consistency-gate-report.json', ['FINAL_CONSISTENCY_GO'])] }),
  D(52, 'Package Manifest', { ownerArea: 'release', sources: ['scripts/two-pass-release.sh'], integrations: ['governance/package-validator.js'], tests: ['tests/unit/governance/packageManifestBuilder.test.js'], runtime: [A('governance/package-validation-report.json', ['PASS', true])], governance: [A('governance/package-integrity-report.json', ['PACKAGE_INTEGRITY_GO'])] }),
  D(53, 'Package Integrity', { ownerArea: 'release', sources: ['governance/package-integrity-engine.js'], integrations: ['governance/package-validator.js'], tests: ['tests/unit/governance/packageManifestBuilder.test.js'], runtime: [A('governance/package-integrity-report.json', ['PACKAGE_INTEGRITY_GO'])], governance: [A('governance/package-integrity-report.json', ['PACKAGE_INTEGRITY_GO'])] }),
  D(54, 'Semantic Certification × Package Integrity', { ownerArea: 'release', sources: ['governance/package-validator.js'], integrations: ['scripts/two-pass-release.sh'], tests: ['tests/unit/governance/packageManifestBuilder.test.js'], runtime: [A('governance/package-validation-report.json', ['PASS', true])], governance: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(55, 'Delivered Release Self-Verification', { ownerArea: 'release', sources: ['governance/verify-delivered-release.js'], integrations: ['scripts/two-pass-release.sh'], tests: ['tests/unit/governance/verifyDeliveredRelease.test.js'], runtime: [A('governance/delivered-release-verification-report.json', ['DELIVERED_RELEASE_VERIFIED'])], governance: [A('governance/delivered-release-verification-report.json', ['DELIVERED_RELEASE_VERIFIED'])] }),
  D(56, 'Source/Proof/Manifest Equality', { ownerArea: 'release', sources: ['governance/verify-delivered-release.js'], integrations: ['governance/proof-engine/fingerprint-chain.js'], tests: ['tests/unit/governance/verifyDeliveredRelease.test.js'], runtime: [A('governance/delivered-release-verification-report.json', ['DELIVERED_RELEASE_VERIFIED'])], governance: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(57, 'Final Consistency Gate', { ownerArea: 'governance', sources: ['governance/final-consistency-gate.js'], integrations: ['tools/system/platform-readiness.js'], tests: ['tests/unit/finalGovernanceGates.test.js'], runtime: [A('governance/final-consistency-gate-report.json', ['FINAL_CONSISTENCY_GO'])], governance: [A('governance/final-consistency-gate-report.json', ['FINAL_CONSISTENCY_GO'])] }),
  D(58, 'Security Fail-Closed', { ownerArea: 'security', sources: ['api/middleware/tenantValidation.js', 'api/middleware/requireClassification.js'], integrations: ['api/app/registerRoutes.js'], tests: ['tests/unit/tenantFailClosed.test.js', 'tests/tenant/saasSecurity.test.js'], runtime: [A('governance/system-scope-audit.json', ['PASS'])], governance: [A('reports/tenant-isolation-report.json', ['PASS'])] }),
  D(59, 'Observability', { ownerArea: 'platform', sources: ['api/utils/logger.js', 'api/services/eventLedgerService.js'], integrations: ['api/server.js'], tests: ['tests/unit/voiceEventLedgerTenant.test.js'], runtime: [A('governance/critical-journey-evidence.json', ['CRITICAL_JOURNEY_VALIDATED'])], governance: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(60, 'Regression Safety', { ownerArea: 'qa', sources: ['jest.config.cjs', 'frontend/vitest.config.mjs'], integrations: ['package.json'], tests: ['tests/unit/finalGovernanceGates.test.js', 'tests/unit/governance/verifyDeliveredRelease.test.js'], runtime: [A('reports/master-scorecard-regression-report.json', ['PASS'])], governance: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(61, 'API Contract Consistency', { ownerArea: 'api', applicabilityRationale: 'O RAP expõe uma ampla superfície HTTP e contratos versionados; drift de rota/schema é risco de produção.', sources: ['api/utils/contractValidator.js', 'contracts'], integrations: ['api/app/registerRoutes.js', 'scripts/validate-contracts.js'], tests: ['tests/contracts/contractValidation.test.js'], runtime: [A('reports/api-surface-report.json', ['PASS'])], governance: [A('reports/api-surface-report.json', ['PASS'])] }),
  D(62, 'Database / Migration Integrity', { ownerArea: 'database', applicabilityRationale: 'O runtime persiste estado em PostgreSQL e depende de migrations Sequelize/Umzug e SQL.', sources: ['api/db/migrate.js', 'api/db/migrations', 'migrations'], integrations: ['api/db/index.js'], tests: ['tests/unit/agentOsCoreMigration.test.js'], runtime: [A('reports/db-integrity-report.json', ['PASS'])], governance: [A('reports/db-integrity-report.json', ['PASS'])] }),
  D(63, 'Rate Limiting & Abuse Protection', { ownerArea: 'security', applicabilityRationale: 'APIs públicas e por tenant usam rate limiting Redis e exigem proteção contra abuso.', sources: ['infra/rate-limit/index.js', 'api/middleware/createTenantRateLimitMiddleware.js'], integrations: ['infra/redis/rateLimitClient.js'], tests: ['tests/rate-limit/integration.test.js', 'tests/unit/rateLimitTenantPolicies.test.js'], runtime: [A('reports/rate-limit-validation-report.json', ['PASS'])], governance: [A('reports/rate-limit-validation-report.json', ['PASS'])] }),
  D(64, 'Secrets / Credentials / Webhook Security', { ownerArea: 'security', applicabilityRationale: 'O RAP processa credenciais de IA, segredos de webhook e chaves criptográficas por tenant.', sources: ['api/modules/access-control/credentials/credentialService.js', 'api/utils/metaWebhookSignature.js'], integrations: ['api/modules/channel-webhook'], tests: ['tests/unit/bootstrapSecrets.test.js', 'tests/unit/metaWebhookSignatureEnforcement.test.js'], runtime: [A('reports/security-validation-report.json', ['PASS'])], governance: [A('governance/report-contamination-report.json', ['NO_CONTAMINATION', 'PASS'])] }),
  D(65, 'Idempotency / Duplicate Execution Safety', { ownerArea: 'runtime', applicabilityRationale: 'Processos duráveis, webhooks e billing recebem retries e precisam impedir efeitos duplicados.', sources: ['api/core/process-runtime/processIdempotencyService.js'], integrations: ['api/core/process-runtime/processRuntimeIdempotency.js'], tests: ['tests/unit/processIdempotencyService.test.js', 'tests/integration/whatsappWebhookIdempotency.test.js'], runtime: [A('reports/idempotency-validation-report.json', ['PASS'])], governance: [A('reports/idempotency-validation-report.json', ['PASS'])] }),
  D(66, 'Transactions / Concurrency Safety', { ownerArea: 'database', applicabilityRationale: 'Filas, billing, tickets e processos concorrentes realizam mutações multi-etapa em PostgreSQL.', sources: ['api/services/billingService.js', 'api/core/process-runtime'], integrations: ['api/db'], tests: ['tests/integration/billingWebhookReconciliationFlow.test.js'], runtime: [A('reports/concurrency-validation-report.json', ['PASS'])], governance: [A('reports/db-integrity-report.json', ['PASS'])] }),
  D(67, 'Retry / Circuit Breaker / External Resilience', { ownerArea: 'platform', applicabilityRationale: 'RAG, canais e integrações externas têm falhas transitórias e retries governados.', sources: ['api/utils/transientNetworkRecovery.js', 'qa-mesh/transientEnvRetry.js'], integrations: ['core/rpa/bugResolution/retryGovernor.js'], tests: ['tests/unit/transientNetworkRecovery.test.js', 'tests/unit/ragCircuitBreaker.test.js'], runtime: [A('reports/external-resilience-report.json', ['PASS'])], governance: [A('governance/final-proof-report.json', ['AUTONOMOUS_READY_GO'])] }),
  D(68, 'PBX / Voice Runtime Reliability', { ownerArea: 'pbx', applicabilityRationale: 'PBX/voz é pilar de produção e possui runtime Asterisk, eventos e mídia.', sources: ['api/services/voiceRuntimeService.js', 'api/services/pbx'], integrations: ['api/composition/pbx/index.js', 'api/composition/voice/index.js'], tests: ['tests/unit/selftestService.voiceRuntime.test.js', 'tests/unit/pbxCompositionCutoverWiring.test.js'], runtime: [A('qa/enterprise/pbx-voice-flow-prod-like.json', ['GO', 'PASS'])], governance: [A('qa/qa-waves-enterprise-governance.json', ['GO', 'PASS'])] }),
  D(69, 'Channel Security / Signature Validation', { ownerArea: 'channels', applicabilityRationale: 'Webhooks WhatsApp/Meta e outros canais são entradas públicas que exigem autenticação criptográfica.', sources: ['api/utils/metaWebhookSignature.js', 'api/modules/channel-webhook'], integrations: ['api/composition/channel-webhook/index.js'], tests: ['tests/unit/metaWebhookSignatureEnforcement.test.js', 'tests/unit/whatsAppQrWebhookSecretEnforcement.test.js'], runtime: [A('reports/channel-security-report.json', ['PASS'])], governance: [A('reports/api-surface-report.json', ['PASS'])] }),
  D(70, 'Backup / Recovery / Disaster Recovery', { ownerArea: 'operations', applicabilityRationale: 'Estado operacional durável exige backup verificável, restore e objetivos de recuperação.', sources: ['scripts/backup-postgres.sh'], integrations: ['api/modules/platform-admin/handleExportRoutes.js'], tests: ['tests/unit/backupImportExportEndpoints.test.js'], runtime: [A('reports/disaster-recovery-report.json', ['PASS'])], governance: [A('reports/disaster-recovery-report.json', ['PASS'])] }),
  D(71, 'Deployment / Reproducibility', { ownerArea: 'release', applicabilityRationale: 'Deploy Docker deve ser reproduzível exclusivamente a partir de artefato aprovado.', sources: ['docker-compose.prod.yml', 'tools/system/deploy.js'], integrations: ['scripts/two-pass-release.sh'], tests: ['tests/unit/release/artifactApproval.test.js'], runtime: [A('reports/deploy-validation-report.json', ['PASS'])], governance: [A('governance/package-integrity-report.json', ['PACKAGE_INTEGRITY_GO'])] }),
  D(72, 'Data Privacy / Retention / Audit', { ownerArea: 'security', applicabilityRationale: 'Conversas, gravações, RAG e learning contêm dados pessoais com retenção e trilha de auditoria.', sources: ['api/services/auditService.js', 'api/services/queue/queueTicketRetention.js'], integrations: ['api/modules/domain-identity/handleAuditRoutes.js'], tests: ['tests/unit/auditService.coercion.test.js'], runtime: [A('reports/privacy-retention-report.json', ['PASS'])], governance: [A('reports/privacy-retention-report.json', ['PASS'])] }),
  D(73, 'Billing / Entitlement / Tenant Isolation', { ownerArea: 'billing', applicabilityRationale: 'Billing é multi-tenant e controla transações, assinaturas e acesso a capacidades pagas.', sources: ['api/services/billingService.js', 'api/db/models/BillingSubscription.js'], integrations: ['api/composition/billing/index.js'], tests: ['tests/integration/billingReconciliationRoutes.test.js', 'tests/unit/billingService.webhookReconciliation.test.js'], runtime: [A('reports/billing-entitlement-report.json', ['PASS'])], governance: [A('reports/tenant-isolation-report.json', ['PASS'])] }),
  D(74, 'Database Constraint Enforcement', { ownerArea: 'database', applicabilityRationale: 'Constraints FK, unique, not-null e enum sustentam isolamento e integridade de domínio.', sources: ['api/db/migrations', 'api/db/models'], integrations: ['api/db/migrate.js'], tests: ['tests/unit/enumContractValidation.test.js', 'tests/unit/corporateAgentLifecycleMigration.test.js'], runtime: [A('reports/db-integrity-report.json', ['PASS'])], governance: [A('reports/db-integrity-report.json', ['PASS'])] }),
  D(75, 'API/Webhook Replay Protection', { ownerArea: 'security', applicabilityRationale: 'Entradas públicas repetidas podem duplicar mensagens, cobranças e mutações sem replay protection.', sources: ['api/services/webhookService.js', 'api/core/process-runtime/processIdempotencyService.js'], integrations: ['api/modules/webhooks', 'api/modules/channel-webhook'], tests: ['tests/integration/whatsappWebhookIdempotencyGate.test.js', 'tests/unit/webhookService.idempotency.test.js'], runtime: [A('reports/webhook-replay-protection-report.json', ['PASS'])], governance: [A('reports/webhook-replay-protection-report.json', ['PASS'])] }),
  D(76, 'Governance Persistence & Certification Data Model', {
    ownerArea: 'governance',
    applicabilityRationale: 'O estado, lineage, histórico e decisão da certificação RAP precisam de uma única autoridade persistente, transacional e reconstruível.',
    sources: [
      'api/db/models/GovernanceRun.js',
      'api/services/governance/certificationService.js',
    ],
    integrations: [
      'api/services/governance/scorecardService.js',
      'api/services/governance/executionTraceService.js',
      'governance/revalidate-master-scorecard.js',
    ],
    tests: [
      'tests/unit/governance/governancePersistenceControlPlane.test.js',
      'tests/unit/governance/masterScorecardPersistenceDefinition.test.js',
    ],
    runtime: [A('governance/governance-persistence-validation-report.json', ['PASS'])],
    governance: [A('governance/governance-persistence-validation-report.json', ['PASS'])],
  }),
  D(77, 'Universal Agent Policy & Constitutional Enforcement', {
    ownerArea: 'governance',
    applicabilityRationale: 'Todo agente governado precisa carregar, atestar e obedecer a Constituição RAP por enforcement executável.',
    sources: ['governance/RAP_AGENT_CONSTITUTION.md', 'governance/policy-as-code.js', 'api/services/governance/agentPolicyBootstrap.js'],
    integrations: ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md', 'governance/verify-agent-policy-compliance.js'],
    tests: ['tests/unit/governance/agentPolicyBootstrap.test.js'],
    runtime: [A('governance/agent-policy-compliance-report.json', ['PASS'])],
    governance: [A('governance/agent-policy-compliance-report.json', ['PASS'])],
  }),
  D(78, 'Runtime State Persistence & Filesystem State Elimination', {
    ownerArea: 'governance',
    applicabilityRationale: 'Nenhum componente crítico pode usar JSON local como banco de estado mutável quando o estado exige concorrência, versionamento, histórico, lineage, consulta, multi-node, recovery, tenant isolation ou consistência transacional. O banco é a fonte canônica; JSON é export derivado.',
    sources: [
      'governance/verify-no-mutable-json-state.js',
      'governance/json-persistence-audit.js',
      'qa/state/dbStateStore.js',
    ],
    integrations: [
      'api/utils/atomicJsonFile.js',
      'qa/checkpoints/checkpointManager.js',
      'qa-mesh/meshRunner.js',
      'qa-mesh/meshScheduler.js',
      'core/rpa/bugResolution/bugMemoryStore.js',
      'api/services/nodeMarketplaceService.js',
    ],
    tests: ['tests/unit/governance/mutableJsonStateElimination.test.js'],
    runtime: [A('governance/mutable-json-state-validation-report.json', ['PASS', 'MUTABLE_FILESYSTEM_STATE_OK'])],
    governance: [A('governance/mutable-json-state-validation-report.json', ['PASS', 'MUTABLE_FILESYSTEM_STATE_OK'])],
  }),
]);

module.exports = { MASTER_SCORECARD_REGISTRY, REQUIRED_CATEGORIES, artifact, dimension };
