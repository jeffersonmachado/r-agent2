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

/** Produtores que só podem rodar em fase específica (nunca no meio do ciclo). */
const PHASE_RESTRICTED = new Set(['DELIVERED']);

function main() {
  const root = process.cwd();
  const run = resolveRun(root);
  const before = evaluateRunTemporalIntegrity({ root, run });

  const requiringRefresh = before.entries.filter((entry) => (
    entry.status === STATUS.STALE_ARTIFACT
    || entry.status === STATUS.INVALID
    || entry.status === STATUS.WRONG_RUN
  ));

  const results = [];
  for (const entry of requiringRefresh) {
    const producer = entry.producer || getProducer(entry.path);
    if (!producer) {
      results.push({ path: entry.path, status: entry.status, reexecuted: false, reason: 'producer_not_declared' });
      continue;
    }
    if (producer.phase && PHASE_RESTRICTED.has(producer.phase)) {
      results.push({ path: entry.path, status: entry.status, reexecuted: false, reason: `producer_phase_${producer.phase}_not_applicable`, command: producer.command });
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
  const unresolved = after.entries.filter((entry) => (
    entry.status === STATUS.STALE_ARTIFACT
    || entry.status === STATUS.INVALID
    || entry.status === STATUS.WRONG_RUN
  ));

  const report = {
    artifactType: 'authoritative-artifact-refresh-report',
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    runId: run ? run.run_id : null,
    sourceFingerprint: run ? run.source_fingerprint : null,
    runStartedAt: run ? run.started_at : null,
    totals: {
      before: before.totals,
      refreshRequested: requiringRefresh.length,
      reexecuted: results.filter((entry) => entry.reexecuted).length,
      producerMissing: results.filter((entry) => entry.reason === 'producer_not_declared').length,
      unresolvedAfter: unresolved.length,
    },
    results,
    unresolved,
    status: (after.status === 'PASS') ? 'PASS' : 'FAIL',
  };

  fs.writeFileSync(path.join(root, REPORT_RELATIVE), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`[artifact-refresh] reexecutados=${report.totals.reexecuted} sem-produtor=${report.totals.producerMissing} nao-resolvidos=${unresolved.length} status=${report.status}`);
  for (const entry of unresolved) {
    console.log(`  - ${entry.status} ${entry.path}${entry.producer ? ` (produtor: ${entry.producer.command})` : ' (SEM PRODUTOR DECLARADO na taxonomia)'}`);
  }
  console.log(`[artifact-refresh] report=${path.join(root, REPORT_RELATIVE)}`);

  if (report.status !== 'PASS') process.exitCode = 1;
}

module.exports = { main };

if (require.main === module) {
  main();
}
