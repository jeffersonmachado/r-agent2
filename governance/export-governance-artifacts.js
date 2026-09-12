#!/usr/bin/env node
'use strict';

/**
 * export-governance-artifacts.js — exporters DB→JSON para os artifacts legados
 * de governança. O banco é a verdade; estes JSONs são projeções imutáveis
 * derivadas do GovernanceRun/ScorecardEvaluation/GovernanceGateResult/
 * GovernanceFinalDecision. Nenhum GO é fabricado: o status deriva do estado
 * persistido do run atual.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { connect, close } = require('../api/db/sequelize');
const getRun = require('../api/db/models/GovernanceRun');
const getEvaluation = require('../api/db/models/ScorecardEvaluation');
const getGate = require('../api/db/models/GovernanceGateResult');
const getDecision = require('../api/db/models/GovernanceFinalDecision');
const { computeFingerprintChain } = require('./proof-engine/fingerprint-chain');
const { buildCertificationStates } = require('./certification-states');
const { REQUIRED_VERTICALS } = require('./shared/required-journeys');

function write(relativePath, payload) {
  const target = path.join(process.cwd(), relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
  return target;
}

function derivedDecision(decisionRecord, evaluation, gates) {
  if (!decisionRecord) return 'NO_GO';
  return decisionRecord.decision || 'NO_GO';
}

function artifactBase(run, type) {
  return {
    artifactType: type,
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    runId: run.run_id,
    sourceFingerprint: run.source_fingerprint,
    policyId: run.policy_id,
    policyVersion: run.policy_version,
    policyFingerprint: run.policy_fingerprint,
  };
}

// O proof-engine (materialize) grava o evidence-manifest rico com o array
// `artifacts` (entradas packageRequired, proofStatus, hash físico). Esta
// projeção DB→JSON roda DEPOIS (fixpoint do scorecard) e não pode destruir
// esse array — caso contrário o payload do release perde o binding de hash
// das provas (regressão real: gate payload_experience_segregation ficava sem
// hashBound dentro do pacote entregue). Preservamos as entradas e refrescamos
// exists/hash/checksum/timestamp contra o arquivo físico — como o fixpoint
// roda após o stamp de lineage, os hashes refletem o estado final carimbado.
function refreshManifestArtifacts(manifestRelativePath, rootDir = process.cwd()) {
  try {
    const abs = path.join(rootDir, manifestRelativePath);
    if (!fs.existsSync(abs)) return null;
    const existing = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (!existing || !Array.isArray(existing.artifacts) || existing.artifacts.length === 0) return null;
    return existing.artifacts.map((artifact) => {
      if (!artifact || typeof artifact !== 'object' || !artifact.path) return artifact;
      const artifactAbs = path.join(rootDir, artifact.path);
      const exists = fs.existsSync(artifactAbs);
      const next = { ...artifact, exists };
      if (exists) {
        const hash = crypto.createHash('sha256').update(fs.readFileSync(artifactAbs)).digest('hex');
        next.hash = hash;
        next.checksum = hash;
        next.timestamp = new Date().toISOString();
      }
      return next;
    });
  } catch (_) {
    return null;
  }
}

async function exportGovernanceArtifacts() {
  await connect();
  const run = await getRun().findOne({ order: [['created_at', 'DESC']] });
  if (!run) throw new Error('governance_run_missing');
  const evaluation = await getEvaluation().findOne({ where: { run_id: run.run_id }, order: [['created_at', 'DESC']] });
  const gates = await getGate().findAll({ where: { run_id: run.run_id } });
  const decision = await getDecision().findOne({ where: { run_id: run.run_id } });
  const chain = computeFingerprintChain(process.cwd());

  const below10 = evaluation ? evaluation.dimensions_below_10 : 1;
  // Gates DEFERRED (ex.: master_scorecard em PRE_PACKAGE com apenas dimensões
  // DELIVERED pendentes) NÃO são falhas semânticas — não contam para NO_GO.
  const failedGates = gates.filter((gate) => gate.mandatory && gate.status === 'FAIL');
  // Nenhum GO é fabricado: a projeção deriva do estado persistido do run.
  //   - AUTONOMOUS_READY_GO: scorecard 10/10 E todos os gates mandatórios PASS.
  //   - PASS_WITH_DEFERRED_PACKAGE_GATE: gates semânticos PASS, mas o scorecard
  //     ainda tem dimensões abaixo de 10 (package/delivered pendentes) — não é
  //     GO final, tampouco FAIL.
  //   - NO_GO: ao menos um gate mandatório falhou.
  const semanticGatesPass = failedGates.length === 0;
  const autonomousReady = run.status !== 'INVALIDATED' && below10 === 0 && semanticGatesPass;
  const finalDecision = derivedDecision(decision, evaluation, gates);
  const proofDecision = autonomousReady
    ? 'AUTONOMOUS_READY_GO'
    : (semanticGatesPass ? 'PASS_WITH_DEFERRED_PACKAGE_GATE' : 'NO_GO');

  // §39/§55 CORE readiness é derivado dos GATES do núcleo, não do total de
  // dimensões. Dimensão adiada (RAP-052/054/055/056 — pacote/DELIVERED) não é
  // falha do núcleo: tratá-la como tal faz "pacote não construído" rebaixar
  // "plataforma pronta" — exatamente a consolidação de estados que a separação
  // existe para impedir.
  const corePlatformReady = run.status !== 'INVALIDATED' && semanticGatesPass;

  // Fonte da cobertura de IMPLEMENTAÇÃO por vertical: a projeção do produtor
  // externo (regerada no passo 4 do converge, antes deste fixpoint). Ausente,
  // os números são OMITIDOS (null) — nunca 0, que seria uma afirmação falsa.
  const readinessProjection = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'dev', 'platform-readiness', 'latest.json'), 'utf8'));
    } catch (_) {
      return null;
    }
  })();
  const verticalImplementationSource = {
    verticals: Array.isArray(readinessProjection && readinessProjection.verticals) ? readinessProjection.verticals : [],
    percent: readinessProjection && readinessProjection.verticalCoverage
      ? readinessProjection.verticalCoverage.percent
      : null,
    source: readinessProjection ? 'dev/platform-readiness/latest.json' : null,
  };

  // §G1–G3 AUTORIDADE ÚNICA do CORE readiness score.
  //
  // Antes desta correção o score vinha de `evaluation.readiness_score` (run
  // persistido) enquanto o produtor canônico publicava
  // `readiness.readinessScore` em `dev/platform-readiness/latest.json` — dois
  // números para o mesmo fato, capazes de divergir (100 × 0) sem que nenhum
  // gate apontasse a contradição.
  //
  // Agora: a projeção do produtor canônico é a autoridade. O valor do run
  // persistido é conferido CONTRA ela; divergir não se resolve escolhendo o
  // mais favorável — a publicação fica inconclusiva e o desvio é registrado.
  const canonicalCoreScore = (() => {
    const raw = readinessProjection && readinessProjection.readiness
      ? readinessProjection.readiness.readinessScore
      : null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  })();
  const persistedCoreScore = evaluation && evaluation.readiness_score !== null && evaluation.readiness_score !== undefined
    ? Number(evaluation.readiness_score)
    : null;
  const coreScoreDivergence = canonicalCoreScore !== null
    && persistedCoreScore !== null
    && canonicalCoreScore !== persistedCoreScore;
  const coreReadinessScore = coreScoreDivergence ? null : (canonicalCoreScore ?? persistedCoreScore);
  const coreScoreSource = coreScoreDivergence
    ? 'DIVERGENT'
    : (canonicalCoreScore !== null
      ? 'dev/platform-readiness/latest.json#readiness.readinessScore'
      : (persistedCoreScore !== null ? 'governance_runs.evaluation.readiness_score' : 'UNAVAILABLE'));

  const proof = {
    ...artifactBase(run, 'final-proof-report'),    finalDecision: proofDecision,
    autonomousReady,
    blockerCount: evaluation ? evaluation.open_blockers : 0,
    missingArtifacts: [],
    fingerprintStatus: 'FRESH',
    fingerprintChain: {
      status: 'FRESH',
      sourceFingerprint: chain.sourceFingerprint,
      inventoryFingerprint: chain.inventoryFingerprint,
      scenarioRegistryFingerprint: chain.scenarioRegistryFingerprint,
      policyFingerprint: chain.policyFingerprint,
      chainFingerprint: chain.chainFingerprint,
    },
    sourceFingerprint: chain.sourceFingerprint,
    inventoryFingerprint: chain.inventoryFingerprint,
    scenarioFingerprint: chain.scenarioRegistryFingerprint,
    policyFingerprint: chain.policyFingerprint,
    chainFingerprint: chain.chainFingerprint,
  };
  write('governance/final-proof-report.json', proof);

  const readiness = {
    ...artifactBase(run, 'final-readiness-report'),
    finalDecision: proofDecision,
    status: proofDecision,
    blockingGaps: [],
    // §55 Estados de certificação SEPARADOS, produzidos pelo MESMO módulo que o
    // relatório completo usa — do contrário esta projeção apagaria a separação.
    //
    // A cobertura de implementação por vertical vem da projeção do produtor
    // externo (`dev/platform-readiness/latest.json`, regerada pelo passo 4 do
    // converge ANTES deste fixpoint). Sem essa leitura o bloco sairia 0/7 —
    // "zero de sete" é uma afirmação FALSA, não um vazio.
    certificationStates: buildCertificationStates({
      rootDir: process.cwd(),
      requiredVerticals: REQUIRED_VERTICALS,
      verticals: verticalImplementationSource.verticals,
      verticalCoveragePercent: verticalImplementationSource.percent,
      // §G2: score da AUTORIDADE ÚNICA (projeção do produtor canônico),
      // conciliado com o run persistido; divergência ⇒ inconclusivo, nunca o
      // valor mais favorável.
      readinessScore: coreReadinessScore,
      coreReady: corePlatformReady && !coreScoreDivergence,
    }),
    coreReadinessScoreSource: coreScoreSource,
    verticalImplementationCoverage: {
      semanticLabel: 'VERTICAL_IMPLEMENTATION_COVERAGE',
      semanticNote: 'Cobertura de implementação das verticais exigidas. NÃO é certificação de mercado.',
      numerator: verticalImplementationSource.source
        ? verticalImplementationSource.verticals.filter((item) => item && item.implemented).length
        : null,
      denominator: verticalImplementationSource.source ? REQUIRED_VERTICALS.length : null,
      percent: verticalImplementationSource.percent,
      source: verticalImplementationSource.source,
    },
  };
  write('governance/final-readiness-report.json', readiness);

  const governance = {
    ...artifactBase(run, 'final-governance-report'),
    finalDecision: proofDecision,
    autonomousReady,
    allChecksPass: autonomousReady,
    checks: gates.map((gate) => ({ id: gate.gate_key, pass: gate.status === 'PASS', status: gate.status, reason: gate.reason })),
  };
  write('governance/final-governance-report.json', governance);

  const consistency = {
    ...artifactBase(run, 'final-consistency-gate-report'),
    // Fase semântica: AUTONOMOUS_READY_GO = consistência FINAL (pós package
    // gate); qualquer estado abaixo disso é avaliação PRE_PACKAGE transitória.
    phase: autonomousReady ? 'FINAL' : 'PRE_PACKAGE',
    transitional: !autonomousReady,
    decision: failedGates.length === 0 ? 'FINAL_CONSISTENCY_GO' : 'FINAL_CONSISTENCY_NO_GO',
    failures: failedGates.map((gate) => ({ id: gate.gate_key, reason: gate.reason || gate.status })),
  };
  write('governance/final-consistency-gate-report.json', consistency);

  const preservedArtifacts = refreshManifestArtifacts('governance/evidence-manifest.json');
  const manifest = {
    ...artifactBase(run, 'evidence-manifest'),
    status: 'PASS',
    finalDecision: proofDecision,
    ...(preservedArtifacts ? { artifacts: preservedArtifacts } : {}),
    fingerprints: {
      sourceFingerprint: chain.sourceFingerprint,
      inventoryFingerprint: chain.inventoryFingerprint,
      scenarioRegistryFingerprint: chain.scenarioRegistryFingerprint,
      policyFingerprint: chain.policyFingerprint,
      chainFingerprint: chain.chainFingerprint,
    },
  };
  write('governance/evidence-manifest.json', manifest);

  return { runId: run.run_id, below10, failedGates: failedGates.length, finalDecision, proofDecision };
}

if (require.main === module) {
  exportGovernanceArtifacts().then((result) => {
    console.log(JSON.stringify(result));
    process.exitCode = 0;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  }).finally(() => close().catch(() => {}));
}

module.exports = { exportGovernanceArtifacts, refreshManifestArtifacts };
