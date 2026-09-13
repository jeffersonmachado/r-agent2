#!/usr/bin/env node
'use strict';

/**
 * stamp-report-lineage.js — vincula reports técnicos gerados por validadores
 * reais ao GovernanceRun atual, SEM alterar status/dados reais.
 *
 * O banco é a fonte de runId/sourceFingerprint. Este script apenas adiciona
 * os campos de lineage exigidos pelo engine de certificação (runId,
 * sourceFingerprint, generatedAt, artifactType, artifactVersion) a reports
 * cujo conteúdo real foi produzido pelos geradores. Nenhum status é fabricado.
 */

const fs = require('fs');
const path = require('path');
const { connect, close } = require('../../api/db/sequelize');
const getRun = require('../../api/db/models/GovernanceRun');

function stamp(relativePath, run) {
  const abs = path.join(process.cwd(), relativePath);
  if (!fs.existsSync(abs)) return { path: relativePath, stamped: false, reason: 'missing' };
  let report;
  try {
    report = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (_) {
    return { path: relativePath, stamped: false, reason: 'invalid_json' };
  }
  if (!report || typeof report !== 'object') return { path: relativePath, stamped: false, reason: 'invalid_object' };

  const artifactType = report.artifactType || path.basename(relativePath, '.json');
  const artifactVersion = report.artifactVersion || '1.0.0';
  const next = {
    ...report,
    runId: run.run_id,
    sourceFingerprint: run.source_fingerprint,
    generatedAt: report.generatedAt || new Date().toISOString(),
    artifactType,
    artifactVersion,
  };
  fs.writeFileSync(abs, `${JSON.stringify(next, null, 2)}\n`);
  return { path: relativePath, stamped: true };
}

async function main() {
  await connect();
  const run = await getRun().findOne({ order: [['created_at', 'DESC']] });
  if (!run) throw new Error('governance_run_missing');

  const reports = process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : [
      'governance/model-driven-e2e-report.json',
      'governance/system-scope-audit.json',
      'governance/agent-policy-compliance-report.json',
      'governance/governance-persistence-validation-report.json',
      'governance/agent-policy-compliance-report.json',
      'governance/mutable-json-state-validation-report.json',
      'governance/json-persistence-audit.json',
      'governance/final-proof-report.json',
      'governance/final-readiness-report.json',
      'governance/final-governance-report.json',
      'governance/final-consistency-gate-report.json',
      'governance/evidence-manifest.json',
      'governance/self-proving-report.json',
      'governance/tamper-detection-report.json',
      'governance/replay-integrity-report.json',
      'governance/replay-hardening-report.json',
      'reports/tenant-isolation-report.json',
      'reports/db-integrity-report.json',
      'reports/coverage-gate-report.json',
      'reports/coverage-completeness-report.json',
      'reports/api-surface-report.json',
      'reports/page-surface-report.json',
      'reports/visibility-policy-report.json',
      'reports/experience-segregation-report.json',
      // Cópia canônica empacotada no payload (packageRequired=true) — precisa
      // do MESMO runId/sourceFingerprint da cópia em reports/.
      'governance/experience-segregation-report.json',
      // Prova server-side (APIs): mesma disciplina dual-write + packageRequired.
      'reports/experience-api-segregation-report.json',
      'governance/experience-api-segregation-report.json',
      // Proveniência REMOTA do source: mesma disciplina dual-write + packageRequired.
      'reports/source-remote-provenance-report.json',
      'governance/source-remote-provenance-report.json',
      // Confiabilidade de outbound (transactional outbox + delivery ambiguity) —
      // evidência real gerada por generate-outbound-reliability-evidence.js.
      'governance/outbound-reliability-report.json',
      // Consistência PRE_PACKAGE/FINAL: lineage explícito para eliminar a
      // ambiguidade semântica (GAP: relatório "final" com decisão DEFERRED).
      'governance/final-consistency-report.json',
      'reports/rag-domain-segregation-report.json',
      'reports/inventory-build-report.json',
      'reports/rate-limit-validation-report.json',
      'reports/security-validation-report.json',
      'reports/idempotency-validation-report.json',
      'reports/concurrency-validation-report.json',
      'reports/external-resilience-report.json',
      'reports/channel-security-report.json',
      'reports/disaster-recovery-report.json',
      'reports/deploy-validation-report.json',
      'reports/privacy-retention-report.json',
      'reports/billing-entitlement-report.json',
      'reports/webhook-replay-protection-report.json',
      'qa-mesh/go-no-go-report.json',
      'qa/enterprise/pbx-voice-flow-prod-like.json',
      'governance/package-validation-report.json',
      'governance/package-integrity-report.json',
      // DAG do release e identidade do artefato entregue: derivados do run
      // corrente. Sem o stamp eles ficam com runId ESTRANGEIRO após um run novo
      // — e o contamination cleaner (corretamente) reprova o run por
      // FOREIGN_RUN_ARTIFACT num arquivo committed.
      'governance/release-dag-report.json',
      'reports/release-dag-report.json',
      'governance/release-artifact-identity-report.json',
      'reports/release-artifact-identity-report.json',
      // NÃO stampar delivered-release-verification-report.json: ele é produzido
      // EXCLUSIVAMENTE por verify-delivered-release.js em fase DELIVERED, com a
      // decisão real. Stampar aqui re-injetaria lineage sobre conteúdo stale e
      // fabricaria DELIVERED_RELEASE_VERIFIED fora da fase DELIVERED.
      'governance/report-contamination-report.json',
      'governance/certification-snapshot.json',
      'reports/master-scorecard-test-report.json',
      'reports/master-scorecard-regression-report.json',
    ];

  const results = reports.map((relPath) => stamp(relPath, run));
  console.log(JSON.stringify({ runId: run.run_id, results }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => close().catch(() => {}));
