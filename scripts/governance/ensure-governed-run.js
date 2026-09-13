#!/usr/bin/env node
'use strict';

/**
 * ensure-governed-run.js — garante que existe um governance run CONGELADO para
 * o source fingerprint ATUAL, sem intervenção manual.
 *
 * MOTIVAÇÃO (deadlock real, 2026-09-13)
 * O caminho oficial de release exigia uma sequência manual de 5 passos
 * (commit → create-governed-run → converge → commit → zip:release). Se o source
 * mudasse e ninguém rodasse `create-governed-run`, o `zip:release` abortava em
 * PRE_PACKAGE com `platform-readiness = NO_GO` e gap
 * `gap-proof-stale-fingerprints` — "o proof está velho" — sem que o pipeline
 * tivesse autoridade para criar o run do source atual. Um comando oficial que
 * depende de um passo secreto anterior não é oficial.
 *
 * O que este script faz:
 *   1. calcula o source fingerprint corrente;
 *   2. lê `governance/.current-run.json`;
 *   3. se o run congelado é do MESMO fingerprint e existe na persistência
 *      (DB é a autoridade), reutiliza — nada é recriado;
 *   4. caso contrário, cria um run novo para o source atual (delega ao
 *      `create-governed-run.js`, que congela o fingerprint no run-context).
 *
 * Nunca fabrica fingerprint, nunca reaproveita run de outro source.
 *
 * Saída JSON: { decision, runId, sourceFingerprint, source }
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');

/** Decisão PURA (testável sem DB): reutilizar ou criar. */
function decideRunProvisioning({ currentFingerprint, runContext, runExists }) {
  if (!currentFingerprint) {
    return { decision: 'CREATE', reason: 'fingerprint corrente não resolvido' };
  }
  if (!runContext || !runContext.runId) {
    return { decision: 'CREATE', reason: 'sem governance/.current-run.json' };
  }
  if (runContext.sourceFingerprint !== currentFingerprint) {
    return {
      decision: 'CREATE',
      reason: `RUN_SOURCE_DRIFT: run congelado ${String(runContext.sourceFingerprint).slice(0, 16)}… != source atual ${String(currentFingerprint).slice(0, 16)}…`,
    };
  }
  if (!runExists) {
    return { decision: 'CREATE', reason: `run ${runContext.runId} não existe na persistência` };
  }
  return { decision: 'REUSE', reason: 'run congelado corresponde ao source atual e existe na persistência' };
}

function readRunContext() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'governance', '.current-run.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}

async function runExistsInDb(runId) {
  const { connect, close } = require(path.join(ROOT, 'api', 'db', 'sequelize'));
  const getRun = require(path.join(ROOT, 'api', 'db', 'models', 'GovernanceRun'));
  await connect();
  try {
    const row = await getRun().findOne({ where: { run_id: runId } });
    return Boolean(row);
  } finally {
    await close().catch(() => {});
  }
}

async function main() {
  const { computeSourceFingerprint } = require(path.join(ROOT, 'governance', 'proof-engine', 'fingerprint-chain'));
  const currentFingerprint = computeSourceFingerprint(ROOT);
  const runContext = readRunContext();

  let exists = false;
  if (runContext && runContext.runId && runContext.sourceFingerprint === currentFingerprint) {
    exists = await runExistsInDb(runContext.runId);
  }

  const decision = decideRunProvisioning({ currentFingerprint, runContext, runExists: exists });
  console.log(`[ensure-run] decisão=${decision.decision} motivo=${decision.reason}`);

  if (decision.decision === 'REUSE') {
    console.log(JSON.stringify({
      decision: 'REUSE',
      runId: runContext.runId,
      sourceFingerprint: currentFingerprint,
      source: 'existing',
    }));
    return;
  }

  const created = spawnSync(process.execPath, [
    '--env-file-if-exists=.env',
    path.join(ROOT, 'scripts', 'governance', 'create-governed-run.js'),
  ], { cwd: ROOT, encoding: 'utf8' });

  if (created.status !== 0) {
    console.error(created.stdout || '');
    console.error(created.stderr || '');
    throw new Error(`create_governed_run_failed: exit=${created.status}`);
  }
  const lastLine = String(created.stdout || '').trim().split('\n').pop();
  const parsed = JSON.parse(lastLine);
  console.log(JSON.stringify({
    decision: 'CREATE',
    runId: parsed.runId,
    sourceFingerprint: parsed.sourceFingerprint,
    source: 'created',
    reason: decision.reason,
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[ensure-run] FALHA: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { decideRunProvisioning };
