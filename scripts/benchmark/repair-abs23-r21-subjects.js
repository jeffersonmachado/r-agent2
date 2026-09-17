#!/usr/bin/env node
'use strict';

/**
 * ABS-23 — REPARO auditado dos 6 subjects do run r21
 * (brr-d523099c9c3fe675442e755920c0bf3b9d8f6a9daec5f5e8).
 *
 * Incidente (2026-09-17T10:33-10:37Z): `POST /api/benchmark-research/runs/fitness/execute`
 * foi chamado ANTES do handoff do r22 abrir o research run novo. O supervisor
 * resolveu o run r21 (RESEARCH_COMPLETE) e RE-ANALISOU os 6 seeds:
 * `analyzed_at` bumpado e `findings_inventory` sobrescrito (o fix de resume
 * ABS-23 no supervisor impede a recorrência).
 *
 * Este reparo restaura `analyzed_at` e `findings_inventory` dos 6 subjects a
 * partir do SAMPLE VERSIONADO (config/benchmarks/fitness.json) — a medição
 * honesta do r21, escrita pelo sample-patch governado. Os valores
 * sobrescritos pelo re-run acidental são preservados em
 * `metadata.abs23Repair` (audit trail). Findings/evidence do re-run
 * permanecem (append-only por contrato; IDs determinísticos).
 *
 * Uso: node --env-file-if-exists=.env scripts/benchmark/repair-abs23-r21-subjects.js
 */

const fs = require('fs');
const path = require('path');

const RUN_ID = 'brr-d523099c9c3fe675442e755920c0bf3b9d8f6a9daec5f5e8';
const SEEDS = ['bsport.io', 'gymdesk.com', 'momence.com', 'perfectgym.com', 'pushpress.com', 'trainingym.com'];

async function main() {
  const samplePath = path.join(__dirname, '..', '..', 'config', 'benchmarks', 'fitness.json');
  const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  const { connect, getSequelize, close } = require('../../api/db/sequelize');
  await connect(1, 500);
  const sequelize = getSequelize();
  if (!sequelize) throw new Error('persistence_required: Sequelize não inicializado');

  try {
    for (const id of SEEDS) {
      const entry = sample.benchmarks.find((benchmark) => benchmark.id === id);
      if (!entry || !entry.analyzedAt) {
        throw new Error(`sample sem análise versionada para ${id}: reparo recusado (nunca inventar analyzedAt)`);
      }
      const [rows] = await sequelize.query(
        'SELECT id, analyzed_at, findings_inventory, metadata FROM benchmark_research_subjects WHERE run_id = $1 AND benchmark_id = $2',
        { bind: [RUN_ID, id] },
      );
      const row = rows[0];
      if (!row) throw new Error(`subject ausente para ${id} no run ${RUN_ID}`);

      const metadata = typeof row.metadata === 'object' && row.metadata !== null ? { ...row.metadata } : {};
      metadata.abs23Repair = {
        repairedAt: new Date().toISOString(),
        reason: 'ABS-23: re-execução acidental do run r21 (execute antes do handoff do r22) sobrescreveu analyzed_at/findings_inventory; restaurado do sample versionado',
        overwrittenAnalyzedAt: row.analyzed_at ? new Date(row.analyzed_at).toISOString() : null,
        overwrittenInventoryLength: Array.isArray(row.findings_inventory) ? row.findings_inventory.length : null,
        restoredAnalyzedAt: entry.analyzedAt,
        restoredInventoryLength: Array.isArray(entry.findingsInventory) ? entry.findingsInventory.length : 0,
      };

      await sequelize.query(
        'UPDATE benchmark_research_subjects SET analyzed_at = $1, findings_inventory = $2::jsonb, metadata = $3::jsonb, updated_at = now() WHERE id = $4',
        {
          bind: [
            new Date(entry.analyzedAt),
            JSON.stringify(Array.isArray(entry.findingsInventory) ? entry.findingsInventory : []),
            JSON.stringify(metadata),
            row.id,
          ],
        },
      );
      const before = row.analyzed_at ? new Date(row.analyzed_at).toISOString() : 'null';
      process.stdout.write(`[abs23-repair] ${id}: analyzed_at ${before} -> ${entry.analyzedAt} | inv ${metadata.abs23Repair.overwrittenInventoryLength} -> ${metadata.abs23Repair.restoredInventoryLength}\n`);
    }
  } finally {
    if (typeof close === 'function') await close().catch(() => {});
  }
}

main().catch((error) => {
  process.stderr.write(`[abs23-repair] ${error.message}\n`);
  process.exit(1);
});
