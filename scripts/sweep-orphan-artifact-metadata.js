'use strict';

/**
 * Sweep de metadados órfãos do artifact store — linhas `runtime_artifacts`
 * cujo `storage_key` aponta para um blob que não existe mais em disco.
 *
 * Complementa `scripts/sweep-orphan-blobs.js` (que remove blobs sem referência
 * no banco). Este remove o metadado quando o payload binário foi perdido,
 * mantendo o inventário consistente com o blob store.
 *
 * Dry-run por padrão. Use `--execute` para remover de fato.
 *
 * Uso:
 *   node scripts/sweep-orphan-artifact-metadata.js            # dry-run
 *   node scripts/sweep-orphan-artifact-metadata.js --execute  # remove
 */

const { sweepOrphanedArtifactMetadata } = require('../api/services/rpaArtifactPersistence');

async function main() {
  const execute = process.argv.includes('--execute');
  const result = await sweepOrphanedArtifactMetadata({ dryRun: !execute });

  console.log('[sweep-orphan-artifact-metadata] Resultado:');
  console.log(`  backend: ${result.reason || 'postgres'}`);
  console.log(`  linhas com storage_key: ${result.totalRows}`);
  console.log(`  metadados órfãos (blob inexistente): ${result.dangling}`);
  if (execute) {
    console.log(`  removidos: ${result.removed}`);
  } else {
    console.log('  (dry-run — use --execute para remover)');
  }
}

main().catch((error) => {
  console.error('[sweep-orphan-artifact-metadata] Falha:', error);
  process.exit(1);
});
