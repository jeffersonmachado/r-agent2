#!/usr/bin/env node
'use strict';

/**
 * qa:waves:governance
 *
 * Avalia se uma wave pode ir para produção (GO / NO_GO) com base nos cenários
 * e replays disponíveis.
 *
 * Uso:
 *   node scripts/qa-waves-governance.js --waveId=fitness-cliente-novo [--minCoverage=0.7] [--minQuality=0.8]
 */

process.env.RUNTIME_ROOT = process.env.RUNTIME_ROOT || '/tmp/ragent2-runtime';

const {
  evaluateWaveGovernance,
  listGovernanceReports,
} = require('../api/services/qaWavesIntelligenceService');

const { listLatestScenarios } = require('../api/services/qaWavesScenarioService');

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2)
      .filter((a) => a.startsWith('--'))
      .map((a) => a.replace('--', '').split('='))
  );

  // Listar relatórios existentes
  if (Object.keys(args).includes('list')) {
    const reports = listGovernanceReports();
    if (reports.length === 0) {
      console.log('[QA Waves Governance] Nenhum relatório disponível.');
      return;
    }
    for (const r of reports) {
      const icon = r.status === 'GO' ? '✅' : '❌';
      console.log(`${icon} ${r.waveId}: ${r.status} | cobertura=${Math.round(r.coverage * 100)}% qualidade=${Math.round(r.quality * 100)}% falhasCriticas=${r.criticalFailures}`);
    }
    return;
  }

  const waveId = args.waveId;
  if (!waveId) {
    console.error('[qa:waves:governance] --waveId é obrigatório. Use --list para listar relatórios.');
    process.exit(1);
  }

  let scenarios = [];
  try {
    const result = listLatestScenarios({ waveId });
    scenarios = Array.isArray(result?.items) ? result.items : (Array.isArray(result) ? result : []);
  } catch (_) {}

  const policy = {};
  if (args.minCoverage) policy.minCoverage = parseFloat(args.minCoverage);
  if (args.minQuality) policy.minQuality = parseFloat(args.minQuality);

  console.log(`\n[QA Waves Governance] Avaliando wave: ${waveId}`);
  console.log(`  Cenários carregados: ${scenarios.length}`);

  const report = evaluateWaveGovernance({ waveId, scenarios, policy });

  console.log(`\n  Status: ${report.status === 'GO' ? '✅ GO' : '❌ NO_GO'}`);
  console.log(`  Cobertura: ${Math.round(report.coverage * 100)}%`);
  console.log(`  Qualidade: ${Math.round(report.quality * 100)}%`);
  console.log(`  Falhas críticas: ${report.criticalFailures}`);
  console.log(`  Cenários: ${report.coveredScenarios}/${report.totalScenarios}`);

  if (report.reasons.length > 0) {
    console.log('\n  Motivos:');
    for (const reason of report.reasons) {
      console.log(`    - ${reason}`);
    }
  }

  console.log('\n  Relatório salvo em qa/qa-waves/governance-report.json');

  if (report.status === 'NO_GO') {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[qa:waves:governance] Erro:', err.message);
  process.exit(1);
});
