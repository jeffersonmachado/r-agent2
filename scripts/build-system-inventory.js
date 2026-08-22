#!/usr/bin/env node
'use strict';

/**
 * build-system-inventory — gera `config/system-inventory.json` a partir dos
 * scanners estáticos (API, frontend, models) e compara com o inventário
 * anterior (quando existe), imprimindo o resumo do diff.
 */

const fs = require('fs');
const path = require('path');
const { buildInventory, diffInventories } = require('../api/services/qa/inventory/inventoryEngine');

const ROOT_DIR = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT_DIR, 'config', 'system-inventory.json');

function loadPrevious() {
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  const previous = loadPrevious();
  const next = buildInventory({ rootDir: ROOT_DIR });

  console.log(`Inventário gerado: ${next.counts.total} itens`);
  console.log(`  por tipo:           ${JSON.stringify(next.counts.byKind)}`);
  console.log(`  por classification: ${JSON.stringify(next.counts.byClassification)}`);
  console.log(`  orphaned:           ${next.counts.orphaned}`);

  if (previous) {
    const diff = diffInventories(previous, next);
    console.log('Diff contra inventário anterior:');
    console.log(`  added:   ${diff.added.length}`);
    console.log(`  removed: ${diff.removed.length}`);
    console.log(`  changed: ${diff.changed.length}`);
    for (const line of diff.added.slice(0, 10)) console.log(`    + ${line}`);
    for (const line of diff.removed.slice(0, 10)) console.log(`    - ${line}`);
    for (const entry of diff.changed.slice(0, 10)) console.log(`    ~ ${entry.id}`);
  } else {
    console.log('Nenhum inventário anterior encontrado — geração inicial.');
  }

  const orphanedItems = next.items.filter((item) => item.linkStatus === 'ORPHANED');
  if (orphanedItems.length > 0) {
    console.log(`Itens ORPHANED (primeiros 20 de ${orphanedItems.length}):`);
    for (const item of orphanedItems.slice(0, 20)) console.log(`    ? ${item.id}`);
  }

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Gravado em ${path.relative(ROOT_DIR, OUTPUT_PATH)}`);

  const buildReport = {
    generatedAt: new Date().toISOString(),
    status: 'PASS',
    artifactType: 'inventory-build-report',
    artifactVersion: '1.0.0',
    totalItems: next.counts.total,
    byKind: next.counts.byKind,
    byClassification: next.counts.byClassification,
    orphaned: next.counts.orphaned,
  };
  const reportPath = path.join(ROOT_DIR, 'reports', 'inventory-build-report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(buildReport, null, 2)}\n`);
  console.log(`Gravado em ${path.relative(ROOT_DIR, reportPath)}`);
}

main();
