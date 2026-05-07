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

const fs = require('fs');
const path = require('path');

const {
  evaluateWaveGovernance,
  listGovernanceReports,
} = require('../api/services/qaWavesIntelligenceService');

const { listLatestScenarios } = require('../api/services/qaWavesScenarioService');
const { getRpaReplayDir } = require('../lib/rpaPathResolver');

function safeReadJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function evaluateReplayIntegrity({ waveId, traceRequired = false }) {
  const replayDir = getRpaReplayDir();
  if (!fs.existsSync(replayDir)) {
    return {
      status: 'NO_GO',
      reasons: [`Diretório de replay não encontrado: ${replayDir}`],
      total: 0,
      valid: 0,
    };
  }

  const candidates = fs.readdirSync(replayDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => safeReadJson(path.join(replayDir, file), null))
    .filter(Boolean)
    .filter((item) => String(item.source || '').toLowerCase() === 'qa-waves' && String(item.waveId || '') === String(waveId));

  if (candidates.length === 0) {
    return {
      status: 'NO_GO',
      reasons: [`Nenhum replay QA Waves encontrado para waveId=${waveId}`],
      total: 0,
      valid: 0,
    };
  }

  const reasons = [];
  let valid = 0;

  for (const replay of candidates) {
    const replayId = replay.replayId || replay.id;
    const steps = Array.isArray(replay.steps) ? replay.steps : [];
    const hasTrace = Boolean(replay.tracePath);

    if (!replayId) {
      reasons.push('Replay sem replayId');
      continue;
    }

    if (steps.length === 0) {
      reasons.push(`Replay ${replayId} sem steps`);
      continue;
    }

    const missingScreenshotAfter = steps.find((step) => !step?.screenshotAfter);
    if (missingScreenshotAfter) {
      reasons.push(`Replay ${replayId} contém step sem screenshotAfter (step=${missingScreenshotAfter.id || missingScreenshotAfter.index || '?'})`);
      continue;
    }

    const errorWithoutEvidence = steps.find((step) => {
      if (!step?.error) return false;
      return !step?.screenshotAfter && !step?.domSnapshot && !hasTrace;
    });
    if (errorWithoutEvidence) {
      reasons.push(`Replay ${replayId} possui erro sem evidência suficiente (step=${errorWithoutEvidence.id || errorWithoutEvidence.index || '?'})`);
      continue;
    }

    if (traceRequired && !hasTrace) {
      reasons.push(`Replay ${replayId} sem tracePath obrigatório`);
      continue;
    }

    valid += 1;
  }

  return {
    status: reasons.length > 0 ? 'NO_GO' : 'GO',
    reasons,
    total: candidates.length,
    valid,
  };
}

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
  const traceRequired = String(args.traceRequired || '').toLowerCase() === 'true';

  console.log(`\n[QA Waves Governance] Avaliando wave: ${waveId}`);
  console.log(`  Cenários carregados: ${scenarios.length}`);

  const report = evaluateWaveGovernance({ waveId, scenarios, policy });
  const replayIntegrity = evaluateReplayIntegrity({ waveId, traceRequired });

  const finalStatus = report.status === 'GO' && replayIntegrity.status === 'GO' ? 'GO' : 'NO_GO';
  const finalReasons = [
    ...(report.reasons || []),
    ...(replayIntegrity.reasons || []),
  ];

  console.log(`\n  Status: ${finalStatus === 'GO' ? '✅ GO' : '❌ NO_GO'}`);
  console.log(`  Cobertura: ${Math.round(report.coverage * 100)}%`);
  console.log(`  Qualidade: ${Math.round(report.quality * 100)}%`);
  console.log(`  Falhas críticas: ${report.criticalFailures}`);
  console.log(`  Cenários: ${report.coveredScenarios}/${report.totalScenarios}`);
  console.log(`  Replays válidos: ${replayIntegrity.valid}/${replayIntegrity.total}`);
  if (traceRequired) {
    console.log('  Trace obrigatório: habilitado');
  }

  if (finalReasons.length > 0) {
    console.log('\n  Motivos:');
    for (const reason of finalReasons) {
      console.log(`    - ${reason}`);
    }
  }

  console.log('\n  Relatório salvo em qa/qa-waves/governance-report.json');

  if (finalStatus === 'NO_GO') {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[qa:waves:governance] Erro:', err.message);
  process.exit(1);
});
