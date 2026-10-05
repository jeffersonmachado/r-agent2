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

/**
 * RUNTIME_EVIDENCE não pode receber lineage retroativo.
 *
 * DEFEITO CORRIGIDO (2026-09-19): este script estampava
 * `qa-mesh/go-no-go-report.json`, PRESERVANDO o `generatedAt` original e
 * anexando `runId`/`sourceFingerprint` do run mais recente. Um relatório
 * produzido às 10:46 passou a reivindicar o run criado às 20:18 — o engine de
 * certificação aceitava como prova daquele run algo que ele NUNCA executou.
 * É pior que não ter lineage, porque elimina a dúvida sem criar a prova.
 *
 * A lista canônica vive em `config/runtime-evidence-artifacts.json`, via o
 * módulo puro `scripts/governance/lib/runtime-evidence-artifacts.js` — a MESMA
 * fonte usada pelo validador `validate-qa-evidence-same-run.js`.
 */
const {
  REASONS,
  classifyArtifact,
  isRuntimeEvidenceArtifact,
  isAuthoritativeArtifact,
  listAuthoritativeArtifacts,
  getProducer,
  runStartMs,
} = require('./lib/runtime-evidence-artifacts');

function stamp(relativePath, run) {
  // Fail-closed: artefato de execução exige lineage NA ORIGEM (o produtor
  // recebe runId/sourceFingerprint ANTES de executar). Estampar aqui seria
  // adotar retroativamente a prova de um run no qual nada foi executado.
  if (isRuntimeEvidenceArtifact(relativePath)) {
    return {
      path: relativePath,
      stamped: false,
      reason: REASONS.RUNTIME_EVIDENCE_REQUIRES_ORIGIN_LINEAGE,
    };
  }

  const classification = classifyArtifact(relativePath);
  // Artefato histórico/transicional NÃO sustenta decisão: lineage nele é ruído
  // que sugere autoridade que ele não tem. Desconhecido nunca é "estampável
  // por não conhecido" — é NO_GO (classifique na taxonomia).
  if (!classification || !isAuthoritativeArtifact(relativePath)) {
    return {
      path: relativePath,
      stamped: false,
      classification,
      reason: REASONS.UNCLASSIFIED_AUTHORITATIVE_ARTIFACT,
    };
  }

  const abs = path.join(process.cwd(), relativePath);
  if (!fs.existsSync(abs)) return { path: relativePath, stamped: false, reason: 'missing' };
  let report;
  try {
    report = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (_) {
    return { path: relativePath, stamped: false, reason: 'invalid_json' };
  }
  if (!report || typeof report !== 'object') return { path: relativePath, stamped: false, reason: 'invalid_object' };

  // REGRA TEMPORAL (missão 2026-10-05): generatedAt >= run.startedAt.
  //
  // O defeito real: `governance/mutable-json-state-validation-report.json` e
  // `governance/json-persistence-audit.json` foram gerados às 01:20 (ANTES do
  // run criado às 02:30) e, ainda assim, receberam o runId/sourceFingerprint do
  // run. Todas as outras checagens passavam (runId certo, fingerprint certo,
  // artifactType presente), então a única barreira capaz de barrar é o tempo.
  //
  // Sem esta guarda o stamp FABRICA autoridade: o artefato passava a parecer
  // produzido pelo run sem que nada tivesse rodado nele. Reexecute o produtor —
  // o caminho está em `producers` na taxonomia. NUNCA ajuste generatedAt.
  const generatedAtMs = report.generatedAt ? Date.parse(report.generatedAt) : NaN;
  const startedAtMs = runStartMs(run);
  if (!Number.isFinite(generatedAtMs)) {
    return {
      path: relativePath,
      stamped: false,
      classification,
      reason: REASONS.REJECTED_STALE_ARTIFACT,
      detail: 'sem generatedAt válido: não há prova temporal, então não há lineage',
    };
  }
  if (startedAtMs !== null && generatedAtMs < startedAtMs) {
    return {
      path: relativePath,
      stamped: false,
      classification,
      reason: REASONS.REJECTED_STALE_ARTIFACT,
      artifactGeneratedAt: report.generatedAt,
      runStartedAt: run.started_at,
      producer: getProducer(relativePath),
      detail: 'artefato produzido ANTES do início do run: reexecute o produtor (nunca estampe)',
    };
  }

  const artifactType = report.artifactType || path.basename(relativePath, '.json');
  const artifactVersion = report.artifactVersion || '1.0.0';
  const next = {
    ...report,
    runId: run.run_id,
    sourceFingerprint: run.source_fingerprint,
    generatedAt: report.generatedAt,
    artifactType,
    artifactVersion,
  };
  fs.writeFileSync(abs, `${JSON.stringify(next, null, 2)}\n`);
  return { path: relativePath, stamped: true, classification };
}

async function main() {
  await connect();
  const run = await getRun().findOne({ order: [['created_at', 'DESC']] });
  if (!run) throw new Error('governance_run_missing');

  // FONTE ÚNICA da lista: a taxonomia (config/runtime-evidence-artifacts.json).
  // Manter a lista aqui criava um segundo registry, que divergia do classificado —
  // e foi justamente por isso que artefatos fora da taxonomia podiam ser estampados.
  const reports = process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : listAuthoritativeArtifacts();

  const results = reports.map((relPath) => stamp(relPath, run));
  const stamped = results.filter((entry) => entry.stamped);
  const rejected = results.filter((entry) => entry.reason === REASONS.REJECTED_STALE_ARTIFACT);
  const unclassified = results.filter((entry) => entry.reason === REASONS.UNCLASSIFIED_AUTHORITATIVE_ARTIFACT);

  const report = {
    artifactType: 'lineage-stamp-report',
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    runId: run.run_id,
    sourceFingerprint: run.source_fingerprint,
    runStartedAt: run.started_at,
    totals: {
      considered: results.length,
      stamped: stamped.length,
      rejectedStale: rejected.length,
      unclassified: unclassified.length,
    },
    rejected,
    unclassified,
    results,
  };
  fs.writeFileSync(
    path.join(process.cwd(), 'governance', 'lineage-stamp-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify({
    runId: run.run_id,
    stamped: stamped.length,
    rejectedStale: rejected.length,
    unclassified: unclassified.length,
  }));

  // FAIL-CLOSED: rejeição = existe evidência autoritativa produzida FORA do run
  // (ou sem classificação). O pipeline NÃO segue: reexecute o produtor (mapa
  // `producers` na taxonomia) — estampar aqui fabricaria a prova.
  if (rejected.length > 0 || unclassified.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => close().catch(() => {}));
}

module.exports = { stamp };
