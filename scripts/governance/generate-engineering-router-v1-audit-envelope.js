#!/usr/bin/env node
'use strict';

/**
 * generate-engineering-router-v1-audit-envelope.js — ER-V1-FINAL-010 (Self-Proving Audit
 * Envelope).
 *
 * PROBLEMA (missão): um ZIP de auditoria pode não carregar runtime report/candidate evidence/
 * pilot evidence/promotion hashes/run lineage, dependendo apenas da narrativa de um .md.
 *
 * Este script gera um artefato auditável AUTOCONTIDO e VERIFICÁVEL OFFLINE — um diretório com
 * vários JSONs content-addressed, nunca dependente de banco/rede para ser lido depois. Reaproveita
 * a evidência JÁ REAL produzida pelos gates existentes do Engineering Router V1 (nunca fabrica
 * prova nova nem reexecuta os 25 testes reais aqui — quem produz essa evidência de verdade é
 * `collect-engineering-router-runtime-evidence.js`, que deve ter rodado ANTES desta geração,
 * com árvore limpa, para o envelope refletir um sinal confiável):
 *   - reports/engineering-router-v1-runtime-evidence.json (RUNTIME_PASS, 25 itens granulares)
 *   - reports/engineering-router-v1-report.json (gate estrutural+runtime agregado)
 *   - git real (HEAD, HEAD^{tree}) + governance/proof-engine/fingerprint-chain.js
 *     (computeSourceFingerprint — mesma autoridade usada por todo o resto da governança)
 *
 * Nunca inclui secrets (só hashes/status/metadados estruturais — nenhum payload de
 * env/credencial/token entra em nenhum artifact deste envelope).
 *
 * Uso: node scripts/governance/generate-engineering-router-v1-audit-envelope.js [--out <dir>]
 * (chamado por `npm run engineering-router:audit-envelope:generate`)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { ROOT, readJson, sha256 } = require('./common');
const { computeSourceFingerprint } = require('../../governance/proof-engine/fingerprint-chain');
const { RUNTIME_ITEMS } = require('./collect-engineering-router-runtime-evidence');

function sha256Bytes(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// ER-V1-SEAL-004 adiciona 5 arquivos novos ao envelope (source-fingerprint, runtime-requirements,
// structural-certification, sandbox-evidence, resume-evidence) — bump minor (aditivo, nenhum
// arquivo/campo existente foi removido ou teve seu significado alterado).
// ER-V1-SEALFIX-001 adiciona seal-certification.json (autoridade única de decisão do seal) +
// sourceFingerprint em structural-certification/promotion-evidence/pilot-evidence/
// release-closure-evidence — bump minor (aditivo).
const SCHEMA_VERSION = '1.2.0';
const DEFAULT_OUT_DIR = path.join(ROOT, 'dist', 'engineering-router-v1-audit-envelope');

// Categorização dos 25 itens de runtime evidence por área — puramente organizacional (mesmos
// IDs/dados de `RUNTIME_ITEMS`, nunca uma segunda fonte de verdade sobre O QUE cada item prova).
// ER-V1-SEAL-004: `sandbox` e `resume` extraídas como categorias PRÓPRIAS (antes agrupadas em
// `security`/`routing`) — a nova spec pede sandbox-evidence.json e resume-evidence.json como
// artifacts dedicados, nunca só um item dentro de um arquivo mais genérico.
const CATEGORY_BY_ID = Object.freeze({
  SHELL_INJECTION_REJECTED: 'security',
  SAFE_ENVIRONMENT: 'security',
  SECRET_REDACTION_MULTILINE: 'security',
  PATCH_PATH_BOUNDARIES: 'security',
  FAIL_CLOSED_SCOPE: 'security',
  TENANT_CREDENTIAL_ISOLATION: 'security',
  EXECUTION_SANDBOX_ISOLATION: 'sandbox',
  ACTUAL_PATCH_APPLY: 'pilot',
  DETERMINISTIC_FAILING_TEST_RED: 'pilot',
  RED_TO_FIX: 'pilot',
  REVIEWER_REJECTION_RECODE: 'pilot',
  INDEPENDENT_REVIEW: 'routing',
  PROVIDER_MODEL_FAILURE_REROUTE: 'routing',
  MODEL_CATALOG_GOVERNANCE: 'routing',
  RESTART_RESUME: 'resume',
  CRASH_RESUME_MID_STAGE: 'resume',
  REGRESSION_EXECUTION: 'regression',
  GOVERNANCE_EXECUTION: 'governance',
  RELEASE_CLOSURE_SAME_RUN_INTEGRITY: 'governance',
  DEVELOPMENT_AUTHORIZATION: 'governance',
  PRODUCTION_DENIAL: 'governance',
  SUPPORT_DENIAL_DEFAULT: 'governance',
  CONTROLLED_PROMOTION: 'promotion',
  POST_PROMOTION_VERIFICATION: 'promotion',
  EXACT_PATCH_PROMOTION: 'promotion',
});

// Backlog congelado — os 10 blockers desta missão de fechamento (ER-V1-FINAL-001..010), com o
// commit real onde cada um foi fechado GREEN. Metadado de fechamento (não prova técnica em si —
// a prova técnica é a evidência de runtime/estrutural referenciada acima); versionado aqui junto
// do gerador para nunca depender do texto narrativo de ENGINEERING_ROUTER_V1_FINAL_CLOSURE.md em
// tempo de verificação.
const CLOSURE_BACKLOG = Object.freeze([
  { id: 'ER-V1-FINAL-001', title: 'Execution Sandbox', commit: '342faddd', status: 'GREEN' },
  { id: 'ER-V1-FINAL-002', title: 'Exact Promotion', commit: '4ee21088', status: 'GREEN' },
  { id: 'ER-V1-FINAL-003', title: 'Fail-Closed Scope', commit: '45faee49', status: 'GREEN' },
  { id: 'ER-V1-FINAL-004', title: 'Mandatory Runtime Gate', commit: '986129a1', status: 'GREEN' },
  { id: 'ER-V1-FINAL-005', title: 'Durable Resume', commit: '44df73f0', status: 'GREEN' },
  { id: 'ER-V1-FINAL-006', title: 'Real Regression', commit: 'b6f40f43', status: 'GREEN' },
  { id: 'ER-V1-FINAL-007', title: 'Evidence Precision', commit: '7a2247c1', status: 'GREEN' },
  { id: 'ER-V1-FINAL-008', title: 'Current Model Catalog', commit: 'd75ef6fb', status: 'GREEN' },
  { id: 'ER-V1-FINAL-009', title: 'Full-Suite Isolation', commit: 'bb03c37d', status: 'GREEN' },
  { id: 'ER-V1-FINAL-010', title: 'Self-Proving Audit Envelope', commit: null, status: 'GREEN' },
]);

// ER-V1-SEALFIX-001 (Artifact-to-Source Binding) — achado real da missão FINAL_RELEASE_CLOSURE:
// o envelope só rastreava CLOSURE_BACKLOG (ER-V1-FINAL-001..010), nunca o backlog da missão
// FINAL_SEAL (ER-V1-SEAL-001..005) nem o backlog desta missão (ER-V1-SEALFIX-001..004) — os três
// são backlogs DISTINTOS, cada um seu próprio ciclo de fechamento, e NUNCA podem ser conflados:
// "10/10 FINAL GREEN" não significa "5/5 SEAL GREEN" nem "4/4 SEALFIX GREEN". Preservados aqui
// separadamente, com lineage explícita.
const SEAL_BACKLOG = Object.freeze([
  { id: 'ER-V1-SEAL-001', title: 'Immutable Promotion Baseline', commit: '471c262e', status: 'GREEN' },
  { id: 'ER-V1-SEAL-002', title: 'Full Durable Resume', commit: '815d598b', status: 'GREEN' },
  { id: 'ER-V1-SEAL-003', title: 'Dedicated Execution Runner', commit: '8cd29620', status: 'GREEN' },
  { id: 'ER-V1-SEAL-004', title: 'Self-Proving Deliverable', commit: 'b6631f10', status: 'GREEN' },
  { id: 'ER-V1-SEAL-005', title: 'Current Model Policy', commit: 'aa52f6e2', status: 'GREEN' },
]);

// Backlog congelado desta missão (FINAL_RELEASE_CLOSURE). Status atualizado manualmente por
// commit à medida que cada SEALFIX fecha GREEN de verdade (nunca fabricado) — a ÚNICA
// autoridade de decisão de "ENGINEERING_ROUTER_V1_SEALED" deriva deste array, nunca de
// CLOSURE_BACKLOG/SEAL_BACKLOG (que já estão fechados e não são reabertos aqui).
const SEALFIX_BACKLOG = Object.freeze([
  { id: 'ER-V1-SEALFIX-001', title: 'Artifact-to-Source Binding', commit: null, status: 'PASS' },
  { id: 'ER-V1-SEALFIX-002', title: 'Real Container Deployment', commit: null, status: 'PENDING' },
  { id: 'ER-V1-SEALFIX-003', title: 'Runner Trust Boundary', commit: null, status: 'PASS' },
  { id: 'ER-V1-SEALFIX-004', title: 'Phase-Aware Durable Resume', commit: null, status: 'PASS' },
]);

function parseArgs(argv) {
  const out = { outDir: DEFAULT_OUT_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out' && argv[i + 1]) {
      out.outDir = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  return out;
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function requireFreshRuntimeEvidence() {
  const evidence = readJson('reports/engineering-router-v1-runtime-evidence.json');
  if (!evidence) {
    throw new Error('reports/engineering-router-v1-runtime-evidence.json ausente — rode `node scripts/governance/collect-engineering-router-runtime-evidence.js` antes de gerar o envelope (nunca gerar um envelope self-proving sem evidência de runtime real).');
  }
  const currentFingerprint = computeSourceFingerprint(ROOT);
  if (evidence.sourceFingerprint !== currentFingerprint) {
    throw new Error(`evidência de runtime obsoleta (sourceFingerprint da evidência: ${evidence.sourceFingerprint?.slice(0, 16)}…, atual: ${currentFingerprint.slice(0, 16)}…) — rode o coletor de novo com a árvore no estado que você quer certificar.`);
  }
  if (evidence.status !== 'RUNTIME_PASS') {
    throw new Error(`evidência de runtime não é RUNTIME_PASS (status atual: ${evidence.status}) — o envelope self-proving nunca certifica um estado RED/FAIL como se fosse prova de fechamento.`);
  }
  return evidence;
}

function requireStructuralReport() {
  const report = readJson('reports/engineering-router-v1-report.json');
  if (!report) {
    throw new Error('reports/engineering-router-v1-report.json ausente — rode `node scripts/governance/validate-engineering-router-v1.js --runtime` antes de gerar o envelope.');
  }
  if (report.status !== 'PASS') {
    throw new Error(`gate estrutural+runtime não é PASS (status atual: ${report.status}) — o envelope self-proving nunca certifica um estado FAIL como se fosse prova de fechamento.`);
  }
  return report;
}

function itemsByCategory(evidence, category) {
  return (evidence.items || []).filter((item) => CATEGORY_BY_ID[item.id] === category);
}

function writeJsonFile(outDir, name, payload) {
  const filePath = path.join(outDir, name);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return filePath;
}

function generate({ outDir }) {
  const runtimeEvidence = requireFreshRuntimeEvidence();
  const structuralReport = requireStructuralReport();

  const head = git(['rev-parse', 'HEAD']);
  const treeHash = git(['rev-parse', 'HEAD^{tree}']);
  const sourceFingerprint = computeSourceFingerprint(ROOT);
  const generatedAt = new Date().toISOString();
  const runId = runtimeEvidence.sourceCommit;

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const baseline = {
    artifactType: 'engineering-router-v1-audit-baseline',
    runId,
    head,
    treeHash,
    sourceFingerprint,
  };

  // ER-V1-SEAL-004 (Self-Proving Deliverable) — arquivos novos exigidos pela spec, além dos já
  // existentes desde ER-V1-FINAL-010. Cada um extrai dados já computados acima/abaixo para um
  // artifact PRÓPRIO e content-addressed — nunca uma segunda fonte de verdade paralela.
  const sourceFingerprintArtifact = {
    artifactType: 'engineering-router-v1-audit-source-fingerprint',
    runId,
    sourceFingerprint,
    algorithm: 'governance/proof-engine/fingerprint-chain.js::computeSourceFingerprint',
  };
  // ER-V1-SEALFIX-001 — a autoridade ÚNICA de decisão do seal. `engineeringRouterV1Sealed`
  // exige TODOS os 4 itens de SEALFIX_BACKLOG em PASS — nunca inferido de CLOSURE_BACKLOG ou
  // SEAL_BACKLOG (backlogs de missões JÁ fechadas, preservados aqui só como lineage).
  const sealCertification = {
    artifactType: 'engineering-router-v1-audit-seal-certification',
    runId,
    sourceFingerprint,
    finalClosureBacklog: { version: 'ER-V1-FINAL-1', items: CLOSURE_BACKLOG, allGreen: CLOSURE_BACKLOG.every((b) => b.status === 'GREEN') },
    sealBacklog: { version: 'ER-V1-SEAL-1', items: SEAL_BACKLOG, allGreen: SEAL_BACKLOG.every((b) => b.status === 'GREEN') },
    sealFixBacklog: { version: 'ER-V1-SEALFIX-1', items: SEALFIX_BACKLOG, allGreen: SEALFIX_BACKLOG.every((b) => b.status === 'PASS') },
    engineeringRouterV1Sealed: SEALFIX_BACKLOG.every((b) => b.status === 'PASS'),
  };

  const runtimeRequirements = {
    artifactType: 'engineering-router-v1-audit-runtime-requirements',
    runId,
    // Mesma lista/autoridade que `collect-engineering-router-runtime-evidence.js` exporta como
    // `RUNTIME_ITEMS` (reaproveitada, nunca uma cópia divergente) — os IDs que TODO release
    // precisa provar com evidência de runtime real antes de ser certificado.
    requiredIds: RUNTIME_ITEMS.map((item) => item.id),
  };

  const routingEvidence = {
    artifactType: 'engineering-router-v1-audit-routing-evidence',
    runId,
    items: itemsByCategory(runtimeEvidence, 'routing'),
  };
  const securityEvidence = {
    artifactType: 'engineering-router-v1-audit-security-evidence',
    runId,
    items: itemsByCategory(runtimeEvidence, 'security'),
  };
  const sandboxEvidence = {
    artifactType: 'engineering-router-v1-audit-sandbox-evidence',
    runId,
    items: itemsByCategory(runtimeEvidence, 'sandbox'),
  };
  const resumeEvidence = {
    artifactType: 'engineering-router-v1-audit-resume-evidence',
    runId,
    items: itemsByCategory(runtimeEvidence, 'resume'),
  };
  const regressionEvidence = {
    artifactType: 'engineering-router-v1-audit-regression-evidence',
    runId,
    items: itemsByCategory(runtimeEvidence, 'regression'),
  };
  const structuralCertification = {
    artifactType: 'engineering-router-v1-audit-structural-certification',
    runId,
    sourceFingerprint,
    status: structuralReport.status,
    decision: structuralReport.decision,
    structuralStatus: structuralReport.structuralStatus,
    runtimeStatus: structuralReport.runtimeStatus,
    totalChecks: structuralReport.totalChecks,
    failedChecks: structuralReport.failedChecks,
  };
  const governanceEvidence = {
    artifactType: 'engineering-router-v1-audit-governance-evidence',
    runId,
    items: itemsByCategory(runtimeEvidence, 'governance'),
    // Mantido por compatibilidade com consumidores existentes do envelope (ER-V1-FINAL-010) —
    // structural-certification.json (novo, ER-V1-SEAL-004) é a fonte primária a partir de agora.
    structuralGate: structuralCertification,
  };
  const promotionEvidence = {
    artifactType: 'engineering-router-v1-audit-promotion-evidence',
    runId,
    sourceFingerprint,
    items: itemsByCategory(runtimeEvidence, 'promotion'),
  };
  const pilotEvidence = {
    artifactType: 'engineering-router-v1-audit-pilot-evidence',
    runId,
    sourceFingerprint,
    // "pilotTaskId": o pilot real do Engineering Router V1 É o loop RED→FIX→REVIEW→GREEN
    // exercitado de ponta a ponta pelos próprios testes E2E reais que compõem estes itens
    // (nunca uma execução fabricada só para preencher este campo) — identificado pelo runId
    // (mesmo commit/fingerprint) em vez de um taskId artificial que não sobreviveria à limpeza
    // de fixtures dos testes reais (branches/tasks de teste são destruídas no teardown).
    pilotTaskId: `pilot-${runId}`,
    items: itemsByCategory(runtimeEvidence, 'pilot'),
  };
  const runtimeCertification = {
    artifactType: 'engineering-router-v1-audit-runtime-certification',
    runId,
    sourceFingerprint: runtimeEvidence.sourceFingerprint,
    status: runtimeEvidence.status,
    totalItems: runtimeEvidence.totalItems,
    failedItems: runtimeEvidence.failedItems,
    items: runtimeEvidence.items,
  };
  const releaseClosureEvidence = {
    artifactType: 'engineering-router-v1-audit-release-closure-evidence',
    runId,
    sourceFingerprint,
    backlogVersion: 'ER-V1-FINAL-1',
    blockers: CLOSURE_BACKLOG,
    allBlockersGreen: CLOSURE_BACKLOG.every((b) => b.status === 'GREEN'),
    releaseStatus: CLOSURE_BACKLOG.every((b) => b.status === 'GREEN') ? 'ENGINEERING_ROUTER_V1_10_OF_10_GREEN' : 'ENGINEERING_ROUTER_V1_INCOMPLETE',
  };

  const artifactFiles = {
    'baseline.json': baseline,
    'source-fingerprint.json': sourceFingerprintArtifact,
    'runtime-requirements.json': runtimeRequirements,
    'runtime-certification.json': runtimeCertification,
    'structural-certification.json': structuralCertification,
    'routing-evidence.json': routingEvidence,
    'security-evidence.json': securityEvidence,
    'sandbox-evidence.json': sandboxEvidence,
    'resume-evidence.json': resumeEvidence,
    'regression-evidence.json': regressionEvidence,
    'governance-evidence.json': governanceEvidence,
    'promotion-evidence.json': promotionEvidence,
    'pilot-evidence.json': pilotEvidence,
    'release-closure-evidence.json': releaseClosureEvidence,
    'seal-certification.json': sealCertification,
  };

  const writtenPaths = {};
  for (const [name, payload] of Object.entries(artifactFiles)) {
    writtenPaths[name] = writeJsonFile(outDir, name, payload);
  }

  // Content-addressing: hashes.json referencia o sha256 real dos BYTES de cada artifact já
  // escrito em disco — qualquer alteração posterior a qualquer arquivo do envelope quebra o
  // hash correspondente aqui, e o verifier detecta isso sem precisar de rede/banco.
  const hashes = {};
  for (const name of Object.keys(artifactFiles)) {
    hashes[name] = sha256Bytes(fs.readFileSync(writtenPaths[name]));
  }
  writeJsonFile(outDir, 'hashes.json', {
    artifactType: 'engineering-router-v1-audit-hashes',
    runId,
    algorithm: 'sha256',
    hashes,
  });

  // Hash agregado dos nomes/status de todos os testes reais que compõem a certificação de
  // runtime — permite ao verifier detectar se o CONJUNTO de testes provados mudou, sem precisar
  // reexecutar nada.
  const testSuiteHashInput = (runtimeEvidence.items || [])
    .map((item) => `${item.id}:${item.testSuite}:${item.testCaseId}:${item.pass}`)
    .sort()
    .join('\n');
  const testSuiteHash = sha256(testSuiteHashInput);

  const manifest = {
    artifactType: 'engineering-router-v1-audit-manifest',
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    head,
    sourceFingerprint,
    treeHash,
    runId,
    // ER-V1-SEAL-004: runtimeRunId/governanceRunId explícitos exigidos pela spec — hoje ambos
    // derivam do mesmo runId (evidência de runtime e de governança são coletadas na MESMA
    // execução do coletor, sobre a mesma árvore), mas nomeados separadamente porque o verifier
    // deve comparar cada um contra o artifact correspondente (runtime-certification.json /
    // governance-evidence.json), nunca assumir que são o mesmo campo por coincidência.
    runtimeRunId: runId,
    governanceRunId: runId,
    expectedArtifacts: Object.keys(artifactFiles).concat(['hashes.json']),
    artifactHashes: hashes,
    testSuiteHash,
    runtimeStatus: runtimeEvidence.status,
    structuralStatus: structuralCertification.status,
    promotionStatus: promotionEvidence.items.every((i) => i.pass) ? 'PROMOTION_VERIFIED' : 'PROMOTION_UNVERIFIED',
    pilotTaskId: pilotEvidence.pilotTaskId,
    releaseStatus: releaseClosureEvidence.releaseStatus,
    // ER-V1-SEALFIX-001 — nunca conflar com finalDecision/releaseStatus (que certificam
    // CLOSURE_BACKLOG, ER-V1-FINAL-001..010): este campo é a ÚNICA fonte para "o Router V1
    // está SELADO", derivada exclusivamente de SEALFIX_BACKLOG.
    engineeringRouterV1Sealed: sealCertification.engineeringRouterV1Sealed,
    finalDecision: (runtimeEvidence.status === 'RUNTIME_PASS' && structuralCertification.status === 'PASS' && releaseClosureEvidence.allBlockersGreen)
      ? 'GO'
      : 'NO_GO',
  };
  writeJsonFile(outDir, 'manifest.json', manifest);

  return { outDir, manifest };
}

function main() {
  const { outDir } = parseArgs(process.argv.slice(2));
  try {
    const { manifest } = generate({ outDir });
    process.stdout.write(`[audit-envelope] gerado em ${path.relative(ROOT, outDir)} — runId=${manifest.runId} runtimeStatus=${manifest.runtimeStatus} releaseStatus=${manifest.releaseStatus}\n`);
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[audit-envelope] FALHA: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  generate, CLOSURE_BACKLOG, SEAL_BACKLOG, SEALFIX_BACKLOG, CATEGORY_BY_ID, SCHEMA_VERSION,
};
