#!/usr/bin/env node
'use strict';

require('../api/utils/runtimePaths').configureRuntimeRoot('/tmp/ragent2-runtime');

const { listLatestScenarios, runScenarioExecution, isSeedExecutableForEvidence } = require('../api/services/qaWavesScenarioService');
const { getQueuedExecutionStatus } = require('../api/services/qaMeshService');
const { EXECUTABLE_SCENARIO_STATUS } = require('../api/modules/qa-waves/waveScenario.constants');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExecution(executionId, timeoutMs = 180000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const execution = getQueuedExecutionStatus(executionId);
    if (execution) {
      const status = String(execution.status || '').toLowerCase();
      if (status === 'completed' || status === 'failed') {
        return execution;
      }
    }
    await sleep(1000);
  }

  const error = new Error(`Timeout aguardando execução ${executionId}`);
  error.code = 'TIMEOUT';
  throw error;
}

async function main() {
  const waveId = String(process.argv[2] || '').trim();
  if (!waveId) {
    console.error('Uso: node scripts/qa-waves-execute.js <waveId>');
    process.exit(1);
  }

  const listed = listLatestScenarios({ waveId });
  const allScenarios = listed.items || [];
  const draftAiScenarios = allScenarios.filter(
    (scenario) => String(scenario.status || '').toLowerCase() === 'draft_ai',
  );
  const scenarios = allScenarios.filter((scenario) => EXECUTABLE_SCENARIO_STATUS.includes(scenario.status));

  // FASE 15 — rascunhos de IA (draft_ai) nunca executam como evidência:
  // exigem aprovação explícita. Se a wave só tem rascunhos, falha explícita.
  if (scenarios.length === 0) {
    if (draftAiScenarios.length > 0) {
      console.error(
        `Nenhum cenário executável: ${draftAiScenarios.length} cenário(s) em draft_ai aguardando aprovação `
        + `(status exigido: ${EXECUTABLE_SCENARIO_STATUS.join(', ')}).`,
      );
    } else {
      console.error(`Nenhum cenário executável encontrado para a wave: ${waveId}`);
    }
    process.exit(1);
  }
  if (draftAiScenarios.length > 0) {
    console.log(`  Ignorados (draft_ai aguardando aprovação): ${draftAiScenarios.length}`);
  }

  const plannedRuns = [];
  for (const scenario of scenarios) {
    const enabledSeeds = Array.isArray(scenario.seeds) && scenario.seeds.length > 0
      ? scenario.seeds.filter((seed) => isSeedExecutableForEvidence(seed))
      : [null];

    for (const seed of enabledSeeds) {
      plannedRuns.push({ scenario, seed });
    }
  }

  console.log(`[QA Waves] Executando wave: ${waveId}`);
  console.log(`  Cenários: ${scenarios.length}`);
  console.log(`  Execuções planejadas: ${plannedRuns.length}`);

  const summary = {
    waveId,
    total: plannedRuns.length,
    completed: 0,
    failed: 0,
    executions: [],
  };

  for (const [index, run] of plannedRuns.entries()) {
    const label = `${index + 1}/${plannedRuns.length}`;
    console.log(`\n[${label}] ${run.scenario.id}${run.seed?.id ? ` :: ${run.seed.id}` : ''}`);

    try {
      const queued = runScenarioExecution({
        waveId,
        scenarioIds: [run.scenario.id],
        seedIds: run.seed?.id ? [run.seed.id] : [],
        mode: 'real',
        replay: true,
      });

      console.log(`  executionId=${queued.executionId}`);
      console.log(`  replayId=${queued.replayId}`);

      const execution = await waitForExecution(queued.executionId);
      const status = String(execution.status || '').toLowerCase();
      const terminalStatus = status === 'completed' ? 'completed' : 'failed';

      summary.executions.push({
        executionId: queued.executionId,
        replayId: queued.replayId,
        scenarioId: run.scenario.id,
        seedId: run.seed?.id || null,
        status: terminalStatus,
      });

      if (terminalStatus === 'completed') summary.completed += 1;
      else summary.failed += 1;

      console.log(`  status=${terminalStatus}`);
    } catch (error) {
      summary.failed += 1;
      summary.executions.push({
        executionId: null,
        replayId: null,
        scenarioId: run.scenario.id,
        seedId: run.seed?.id || null,
        status: 'failed',
        error: error.message,
      });
      console.log(`  status=failed error=${error.message}`);
    }
  }

  console.log('\n[QA Waves] Resumo final');
  console.log(JSON.stringify(summary, null, 2));

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[qa:waves:execute] Erro:', error.message);
  process.exit(1);
});