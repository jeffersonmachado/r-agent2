'use strict';

/**
 * Sweep de blobs órfãos do artifact store (trace ZIP e screenshots RPA).
 *
 * O `remove()` do artifact store apaga apenas a linha do Postgres; os bytes
 * em `artifacts/blobs/` ficavam órfãos no disco. Este script remove blobs que
 * não são referenciados por nenhuma linha `runtime_artifacts.storage_key`.
 *
 * Dry-run por padrão. Use `--execute` para remover de fato.
 *
 * Uso:
 *   node scripts/sweep-orphan-blobs.js            # dry-run (não remove nada)
 *   node scripts/sweep-orphan-blobs.js --execute  # remove blobs órfãos
 */

const { sweepOrphanedBlobs } = require('../api/services/rpaArtifactPersistence');

function fmtBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes || 0} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 'B';
  for (let i = 0; i < units.length; i += 1) {
    value /= 1024;
    unit = units[i];
    if (value < 1024) break;
  }
  return `${value.toFixed(1)} ${unit}`;
}

async function main() {
  const execute = process.argv.includes('--execute');
  const result = await sweepOrphanedBlobs({ dryRun: !execute });

  console.log('[sweep-orphan-blobs] Resultado:');
  console.log(`  backend: ${result.reason || 'postgres'}`);
  console.log(`  arquivos no blob store: ${result.totalFiles}`);
  console.log(`  referenciados (runtime_artifacts.storage_key): ${result.referenced}`);
  console.log(`  órfãos: ${result.orphaned}`);
  console.log(`  espaço liberável: ${fmtBytes(result.freedBytes)}`);
  if (execute) {
    console.log(`  removidos: ${result.removed} (${fmtBytes(result.freedBytes)} liberados)`);
  } else {
    console.log('  (dry-run — use --execute para remover)');
  }
}

main().catch((error) => {
  console.error('[sweep-orphan-blobs] Falha:', error);
  process.exit(1);
});
