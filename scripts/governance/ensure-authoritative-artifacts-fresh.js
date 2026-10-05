#!/usr/bin/env node
'use strict';

/**
 * ensure-authoritative-artifacts-fresh.js — REEXECUTA o produtor de evidência autoritativa stale.
 *
 * POLÍTICA (missão 2026-10-05): um artefato autoritativo com `generatedAt < run.startedAt`
 * NÃO pode ser adotado pelo run por estampagem (isso fabrica autoridade). O comportamento
 * correto é REEXECUTAR O PRODUTOR — o artefato passa a existir DE FATO dentro do run, com
 * `generatedAt >= startedAt` e lineage legítimo.
 *
 * Sem produtor declarado, o passo é FAIL-CLOSED: nomeia o artefato e o comando que falta,
 * em vez de deixar o pipeline seguir com prova pré-run.
 *
 * NUNCA altera `generatedAt` de artefato existente: se não dá para reexecutar, é NO_GO.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { STATUS, getProducer } = require('./lib/runtime-evidence-artifacts');
const { evaluateRunTemporalIntegrity, resolveRun } = require('./validate-current-run-temporal-integrity');

const REPORT_RELATIVE = 'governance/authoritative-artifact-refresh-report.json';

/**
 * FASE do pipeline. Nem todo artefato autoritativo pode (ou deve) ser produzido
 * agora: os da cadeia final (certification-snapshot, final-governance,
 * package-*) só existem DEPOIS do empacotamento. O que a reexecução garante nesta
 * fase é TEMPORALIDADE: nada cujo produtor é aplicável agora pode continuar com
 * `generatedAt < run.startedAt`.
 */
const CURRENT_PHASE = String(process.env.ARTIFACT_REFRESH_PHASE || 'CONVERGE').toUpperCase();

function producerPhase(producer) {
  return String((producer && producer.phase) || 'ANY').toUpperCase();
}

function applicableNow(producer) {
  if (!producer || !producer.command) return false;
  const phase = producerPhase(producer);
  return phase === 'ANY' || phase === CURRENT_PHASE;
}

/** Freshness TEMPORAL pura: o stamp do passo seguinte é quem adiciona lineage. */
function temporallyFresh(entry, startedAtMs) {
  const ms = entry.generatedAt ? Date.parse(entry.generatedAt) : NaN;
  return Number.isFinite(ms) && Number.isFinite(startedAtMs) && ms >= startedAtMs;
}

function main() {
  const root = process.cwd();
  const run = resolveRun(root);
  const startedAtMs = run ? Date.parse(run.started_at) : NaN;
  const before = evaluateRunTemporalIntegrity({ root, run });

  const staleness = (entry) => (
    entry.status === STATUS.STALE_ARTIFACT
    || entry.status === STATUS.INVALID
    || entry.status === STATUS.WRONG_RUN
  );
  const requiringRefresh = before.entries.filter(staleness);

  const results = [];
  const deferred = [];
  for (const entry of requiringRefresh) {
    const producer = entry.producer || getProducer(entry.path);
    if (!applicableNow(producer)) {
      const reason = !producer
        ? 'producer_not_declared'
        : (!producer.command
          ? `producer_deferred_to_${producerPhase(producer)}`
          : `producer_phase_${producerPhase(producer)}_not_applicable`);
      deferred.push({
        path: entry.path,
        status: entry.status,
        reason,
        command: producer ? producer.command : null,
        producerPhase: producer ? producerPhase(producer) : null,
      });
      continue;
    }
    const startedAt = new Date().toISOString();
    const execution = spawnSync(producer.command, {
      shell: true,
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    results.push({
      path: entry.path,
      statusBefore: entry.status,
      reexecuted: true,
      command: producer.command,
      exitCode: execution.status,
      startedAt,
      completedAt: new Date().toISOString(),
    });
  }

  const after = evaluateRunTemporalIntegrity({ root, run });
  // FALHA FECHADA em dois casos — e SÓ neles:
  //   1. artefato que REEXECUTAMOS e continua com generatedAt < run.startedAt
  //      (o produtor rodou e não produziu evidência do run);
  //   2. artefato temporalmente stale SEM NENHUM produtor declarado na taxonomia
  //      (declarar é obrigatório: nunca "estampável por não conhecido").
  // Os demais (cadeia final do pipeline) ficam DEFERIDOS e sob o juízo do gate
  // CURRENT_RUN_TEMPORAL_INTEGRITY, que é fail-closed no fim do pipeline.
  const reexecutedPaths = new Set(results.filter((entry) => entry.reexecuted).map((entry) => entry.path));
  const unresolved = after.entries.filter((entry) => {
    if (temporallyFresh(entry, startedAtMs)) return false;
    const producer = entry.producer || getProducer(entry.path);
    if (!producer) return true;
    if (!producer.command) return false;
    return reexecutedPaths.has(entry.path);
  });

  const report = {
    artifactType: 'authoritative-artifact-refresh-report',
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    runId: run ? run.run_id : null,
    sourceFingerprint: run ? run.source_fingerprint : null,
    runStartedAt: run ? run.started_at : null,
    totals: {
      phase: CURRENT_PHASE,
      before: before.totals,
      refreshRequested: requiringRefresh.length,
      reexecuted: results.filter((entry) => entry.reexecuted).length,
      deferred: deferred.length,
      producerMissing: deferred.filter((entry) => entry.reason === 'producer_not_declared').length,
      unresolvedAfter: unresolved.length,
    },
    deferred,
    results,
    unresolved,
    status: (after.status === 'PASS') ? 'PASS' : 'FAIL',
  };

  fs.writeFileSync(path.join(root, REPORT_RELATIVE), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`[artifact-refresh] fase=${CURRENT_PHASE} reexecutados=${report.totals.reexecuted} deferidos=${report.totals.deferred} sem-produtor=${report.totals.producerMissing} nao-resolvidos=${unresolved.length} status=${report.status}`);
  for (const entry of deferred.slice(0, 8)) {
    console.log(`  · deferido (${entry.reason}) ${entry.path}`);
  }
  for (const entry of unresolved.slice(0, 10)) {
    console.log(`  - ${entry.status} ${entry.path}${entry.producer ? ` (produtor: ${entry.producer.command})` : ' (SEM PRODUTOR DECLARADO na taxonomia)'}`);
  }
  console.log(`[artifact-refresh] report=${path.join(root, REPORT_RELATIVE)}`);

  if (report.status !== 'PASS') process.exitCode = 1;
}

module.exports = { main };

if (require.main === module) {
  main();
}
