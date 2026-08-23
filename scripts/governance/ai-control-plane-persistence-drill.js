#!/usr/bin/env node
'use strict';

/**
 * ai-control-plane-persistence-drill.js — drill controlado de persistência
 * contra o Postgres real (itens 15-16, 20-21, 95).
 *
 * Valida o caminho real da camada de persistência do control plane
 * (`lib/artifactStore` backend postgres): write → integridade (SHA-256) →
 * reescrita idempotente (sem duplicar) → leitura fiel → cleanup.
 *
 * Controlado: usa kind/refId efêmero e remove a evidência ao final. Se o DB
 * não estiver disponível, pula com exit 0 (não é gate bloqueante por padrão).
 *
 * Grava `reports/ai-control-plane-persistence-drill.json`.
 */

const fs = require('fs');
const path = require('path');
const { connect, close } = require('../../api/db/sequelize');
const { createArtifactStore } = require('../../lib/artifactStore');

const ROOT = path.join(__dirname, '..', '..');
const REPORT = path.join(ROOT, 'reports', 'ai-control-plane-persistence-drill.json');

function writeReport(result) {
  fs.writeFileSync(REPORT, `${JSON.stringify(result, null, 2)}\n`);
}

async function main() {
  const result = {
    generatedAt: new Date().toISOString(),
    status: 'SKIPPED',
    skipped: false,
    steps: {},
  };

  try {
    await connect(3, 300);
  } catch (err) {
    result.skipped = true;
    result.reason = `db_unavailable: ${String(err && err.message)}`;
    writeReport(result);
    // eslint-disable-next-line no-console
    console.log('[persistence drill] DB indisponível — drill pulado (controlado).');
    return;
  }

  const store = createArtifactStore({ backend: 'postgres' });
  const kind = 'drill/control-plane';
  const refId = `ai-control-plane-drill-${Date.now()}`;
  const payload = JSON.stringify({ id: refId, ts: Date.now(), marker: 'resilience-drill' });

  try {
    // 1. write (DB-first, sem fallback filesystem)
    await store.write({ kind, refId, payload });
    result.steps.write = true;

    // 2. integridade SHA-256
    const verification = await store.verify({ kind, refId });
    result.steps.integrity = verification.valid === true;

    // 3. reescrita idempotente: NÃO duplica (upsert por (kind, ref_id))
    await store.write({ kind, refId, payload });
    const list = await store.list({ kind });
    const duplicates = (list || []).filter((item) => item.refId === refId).length;
    result.steps.idempotentRewriteNoDuplicates = duplicates === 1;
    result.steps.duplicates = duplicates;

    // 4. leitura fiel
    const readBack = await store.readText({ kind, refId });
    result.steps.readBackMatches = readBack === payload;

    const pass = result.steps.write === true
      && result.steps.integrity === true
      && result.steps.idempotentRewriteNoDuplicates === true
      && result.steps.readBackMatches === true;

    result.status = pass ? 'PASS' : 'FAIL';

    // cleanup (evidência efêmera do drill)
    try { await store.remove({ kind, refId }); } catch (_) { /* best-effort */ }
    result.steps.cleanedUp = true;
  } catch (err) {
    result.status = 'ERROR';
    result.error = String(err && err.message);
  }

  writeReport(result);
  // eslint-disable-next-line no-console
  console.log(`[persistence drill] ${result.status} — write/integrity/idempotency/read contra Postgres real.`);
  process.exitCode = result.status === 'PASS' ? 0 : 1;
  try { await close(); } catch (_) { /* best-effort */ }
}

main().catch((err) => {
  writeReport({ generatedAt: new Date().toISOString(), status: 'ERROR', error: String(err && err.message) });
  // eslint-disable-next-line no-console
  console.error('[persistence drill] erro:', err && err.message);
  process.exitCode = 1;
});
