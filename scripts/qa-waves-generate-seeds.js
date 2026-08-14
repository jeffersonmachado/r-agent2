#!/usr/bin/env node
'use strict';

/**
 * qa:waves:generate-seeds
 *
 * Gera seeds diversificadas por IA para um cenário específico.
 *
 * Uso:
 *   node scripts/qa-waves-generate-seeds.js --scenarioId=fitness_booking_experimental_class [--quantity=5]
 */

require('../api/utils/runtimePaths').configureRuntimeRoot('/tmp/ragent2-runtime');

const { generateSeedsForScenario } = require('../api/services/qaWavesIntelligenceService');
const { listLatestScenarios } = require('../api/services/qaWavesScenarioService');

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2)
      .filter((a) => a.startsWith('--'))
      .map((a) => a.replace('--', '').split('='))
  );

  const scenarioId = args.scenarioId;
  if (!scenarioId) {
    console.error('[qa:waves:generate-seeds] --scenarioId é obrigatório');
    process.exit(1);
  }

  const quantity = Number(args.quantity) || 5;

  // Tenta obter contexto do cenário para melhorar geração
  let scenarioContext = {};
  try {
    const result = listLatestScenarios({});
    const all = Array.isArray(result?.items) ? result.items : (Array.isArray(result) ? result : []);
    const found = all.find((s) => s.id === scenarioId);
    if (found) {
      scenarioContext = {
        title: found.name || found.title,
        vertical: found.waveId,
        channels: found.channels,
        steps: (found.steps || []).map((s) => s.type),
      };
    }
  } catch (_) {}

  console.log(`[QA Waves] Gerando ${quantity} seeds para: ${scenarioId}`);

  const seeds = await generateSeedsForScenario({ scenarioId, quantity, scenarioContext });

  console.log(JSON.stringify(seeds, null, 2));
  console.log(`\n✓ ${seeds.length} seeds geradas (status: draft_ai). Adicione ao cenário via /dev/qa-waves.`);
}

main().catch((err) => {
  console.error('[qa:waves:generate-seeds] Erro:', err.message);
  process.exit(1);
});
