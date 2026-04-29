#!/usr/bin/env node
'use strict';

/**
 * qa:waves:generate-gaps
 *
 * Detecta gaps de cobertura e gera rascunhos de cenários por IA para os gaps encontrados.
 * Os cenários gerados ficam em status `draft_ai` e precisam de aprovação manual antes de executar.
 *
 * Uso:
 *   node scripts/qa-waves-generate-gaps.js --vertical=fitness [--journey=fitness_new_customer] [--dry-run]
 */

process.env.RUNTIME_ROOT = process.env.RUNTIME_ROOT || '/tmp/ragent2-runtime';

const {
  analyzeCoverageGaps,
  generateScenarioDraft,
} = require('../api/services/qaWavesIntelligenceService');

const { listLatestScenarios } = require('../api/services/qaWavesScenarioService');

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2)
      .filter((a) => a.startsWith('--'))
      .map((a) => a.replace('--', '').split('='))
  );

  const vertical = args.vertical;
  if (!vertical) {
    console.error('[qa:waves:generate-gaps] --vertical é obrigatório');
    process.exit(1);
  }

  const isDryRun = Object.keys(args).includes('dry-run');

  let scenarios = [];
  try {
    const result = listLatestScenarios({});
    scenarios = Array.isArray(result?.items) ? result.items : (Array.isArray(result) ? result : []);
  } catch (_) {}

  const gap = analyzeCoverageGaps({ vertical, journey: args.journey || null }, scenarios);

  console.log(`\n[QA Waves] Análise de gaps para: ${vertical}`);
  console.log(`  Cobertura: ${Math.round(gap.coverage * 100)}% (${gap.totalCovered}/${gap.totalRequired})`);
  console.log(`  Faltando: ${gap.missingScenarios.length}`);
  console.log(`  Frágeis: ${gap.weakScenarios.length}`);

  if (gap.missingScenarios.length === 0) {
    console.log('\n✓ Nenhum gap crítico detectado.');
    return;
  }

  if (isDryRun) {
    console.log('\n[dry-run] Cenários que seriam gerados:');
    for (const id of gap.missingScenarios) {
      console.log(`  - ${id}`);
    }
    return;
  }

  console.log('\nGerando rascunhos por IA (status: draft_ai)...');
  const generated = [];

  for (const stage of gap.stageBreakdown) {
    for (const missingId of stage.missing || []) {
      try {
        const draft = await generateScenarioDraft({
          vertical,
          journey: stage.journeyId,
          stage: stage.stageId,
          gap: missingId,
        });
        generated.push(draft);
        console.log(`  ✓ ${draft.id} (${draft.status})`);
      } catch (err) {
        console.warn(`  ✗ Falha ao gerar para ${missingId}: ${err.message}`);
      }
    }
  }

  console.log(`\n[QA Waves] ${generated.length} rascunho(s) gerado(s). Revise e aprove via /dev/qa-waves ou API.`);
}

main().catch((err) => {
  console.error('[qa:waves:generate-gaps] Erro:', err.message);
  process.exit(1);
});
