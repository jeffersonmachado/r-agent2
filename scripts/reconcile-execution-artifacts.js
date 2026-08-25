'use strict';

// Carrega variáveis do .env (ENCRYPTION_KEY/REPLAY_SIGNING_KEY são necessárias
// para validar e re-assinar os manifestos).
try {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
} catch (e) {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0 && !process.env[key]) {
          process.env[key] = valueParts.join('=').replace(/^["']|["']$/g, '');
        }
      }
    });
  }
}

/**
 * Reconcilia os manifestos de execução RPA (`rpa/execution`) com a realidade
 * dos binários persistidos (trace ZIP + screenshots PNG) no artifact store.
 *
 * Após um sweep de metadados órfãos remover linhas `rpa/trace`/`rpa/screenshot`
 * (blobs perdidos), o manifesto pode continuar declarando `trace: true` ou
 * `screenshots: N`, fazendo a UI de Replays RPA oferecer downloads que retornam
 * 404. Este script corrige o manifesto para refletir o que existe de fato e o
 * re-assina.
 *
 * Dry-run por padrão. Use `--execute` para aplicar.
 *
 * Uso:
 *   node scripts/reconcile-execution-artifacts.js             # dry-run
 *   node scripts/reconcile-execution-artifacts.js --execute   # aplica
 */

const { reconcileExecutionManifests } = require('../api/services/rpaArtifactPersistence');

async function main() {
  const execute = process.argv.includes('--execute');
  const result = await reconcileExecutionManifests({ dryRun: !execute });

  console.log('[reconcile-execution-artifacts] Resultado:');
  console.log(`  backend: ${result.reason || 'postgres'}`);
  console.log(`  manifestos verificados: ${result.checked}`);
  console.log(`  manifestos a corrigir: ${result.reconciled}`);
  console.log(`  trace fixado (true→false): ${result.traceFixed}`);
  console.log(`  screenshots corrigidos: ${result.screenshotsFixed}`);
  if (!execute) {
    console.log('  (dry-run — use --execute para aplicar)');
  } else {
    console.log('  (aplicado)');
  }
}

main().catch((error) => {
  console.error('[reconcile-execution-artifacts] Falha:', error);
  process.exit(1);
});
