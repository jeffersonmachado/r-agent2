#!/usr/bin/env node
'use strict';

/**
 * analyze-impact.js
 *
 * Análise de impacto de mudanças de inventário: roda
 * `inventoryEngine.buildInventory` + `diffInventories` contra uma base
 * (default: `config/system-inventory.json`) e propaga os itens alterados no
 * grafo de rastreabilidade, listando jornadas/ondas/evidências afetadas e as
 * waves mínimas necessárias para revalidação.
 *
 * Uso:
 *   node scripts/analyze-impact.js [--base <arquivo>] [--next <arquivo>]
 *
 *   --base  inventário base (default config/system-inventory.json)
 *   --next  inventário candidato em JSON; sem --next, o inventário é
 *           reconstruído via scanners (buildInventory)
 *
 * Saída: reports/impact-analysis.json + resumo no stdout. Exit sempre 0
 * (ferramenta de análise, não gate).
 */

const fs = require('fs');
const path = require('path');
const { buildInventory, diffInventories } = require('../api/services/qa/inventory/inventoryEngine');
const { buildInventoryGraph, computeImpact } = require('../qa/coverage/impactAnalysis');

const ROOT_DIR = path.join(__dirname, '..');
const DEFAULT_BASE_PATH = path.join(ROOT_DIR, 'config', 'system-inventory.json');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'impact-analysis.json');

function parseArgs(argv) {
  const args = { base: DEFAULT_BASE_PATH, next: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base') {
      args.base = path.resolve(argv[index + 1]);
      index += 1;
    } else if (argv[index] === '--next') {
      args.next = path.resolve(argv[index + 1]);
      index += 1;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const base = JSON.parse(fs.readFileSync(args.base, 'utf8'));

  let next;
  if (args.next) {
    next = JSON.parse(fs.readFileSync(args.next, 'utf8'));
    console.log(`[impact] inventário candidato: ${path.relative(ROOT_DIR, args.next)}`);
  } else {
    console.log('[impact] reconstruindo inventário via scanners...');
    next = buildInventory({ rootDir: ROOT_DIR });
  }

  const diff = diffInventories(base, next);
  console.log(`[impact] diff: added=${diff.added.length} removed=${diff.removed.length} changed=${diff.changed.length}`);

  const graph = buildInventoryGraph({ inventoryItems: next.items });
  const impact = computeImpact({ graph, diff, inventoryItems: next.items });

  const report = {
    generatedAt: new Date().toISOString(),
    base: path.relative(ROOT_DIR, args.base),
    next: args.next ? path.relative(ROOT_DIR, args.next) : 'buildInventory(scanners)',
    diff: {
      added: diff.added,
      removed: diff.removed,
      changed: diff.changed,
    },
    impact,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`[impact] nós afetados: ${impact.affected.total}`);
  console.log(`[impact] itens com REVALIDATION_REQUIRED: ${impact.revalidationRequired.length}`);
  console.log(`[impact] jornadas afetadas (${impact.affected.journeys.length}): ${impact.affected.journeys.join(', ') || '(nenhuma)'}`);
  console.log(`[impact] ondas técnicas afetadas (${impact.affected.technicalWaves.length}): ${impact.affected.technicalWaves.join(', ') || '(nenhuma)'}`);
  console.log('[impact] waves mínimas necessárias:');
  for (const journey of impact.minimumWaves.businessJourneys) {
    console.log(`  - business-journey: ${journey}`);
  }
  for (const wave of impact.minimumWaves.technicalWaves) {
    console.log(`  - technical-wave: ${wave}`);
  }
  console.log(`[impact] relatório: ${path.relative(ROOT_DIR, REPORT_PATH)}`);

  process.exit(0);
}

main();
