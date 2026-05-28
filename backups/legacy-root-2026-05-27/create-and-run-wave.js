'use strict';

const qaWavesScenarioService = require('./api/services/qaWavesScenarioService');
const qaWavesExecutionService = require('./api/services/qaWavesExecutionService');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('=== CRIANDO E EXECUTANDO NOVA QA WAVE ===');
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  // ── 1. Inferir cenário ───────────────────────────────────────────────────
  console.log('[1/5] Inferindo cenário...');
  const inferred = qaWavesScenarioService.inferScenario({
    vertical: 'fitness',
    journey: 'matricula',
    goal: 'aluno efetua matrícula e realiza check-in na primeira aula',
    channels: ['whatsapp'],
    constraints: { generateSeeds: true, maxSeeds: 3 },
  });

  if (!inferred.validation.valid) {
    console.error('❌ Inferência falhou:', inferred.validation.errors);
    process.exit(1);
  }

  const scenario = inferred.scenario;
  console.log(`   ✅ Cenário inferido: ${scenario.id}`);
  console.log(`   📋 Wave: ${scenario.waveId}`);
  console.log(`   🎯 Journey: ${scenario.journeyId || scenario.journey}`);
  console.log(`   🔧 platformScenarioIds: ${JSON.stringify(scenario.platformScenarioIds)}`);
  console.log(`   🌱 Seeds: ${scenario.seeds?.length || 0}`);

  // ── 2. Salvar cenário ───────────────────────────────────────────────────
  console.log('\n[2/5] Salvando cenário...');
  const saved = qaWavesScenarioService.saveScenario({
    scenario,
    changedBy: 'qa-agent-test',
  });
  console.log(`   ✅ Salvo com versão: ${saved.version || 1}`);
  console.log(`   📅 updatedAt: ${saved.updatedAt}`);

  // ── 3. Executar wave ────────────────────────────────────────────────────
  console.log('\n[3/5] Executando wave...');
  const executionResult = qaWavesScenarioService.runScenarioExecution({
    waveId: scenario.waveId,
    scenarioIds: [scenario.id],
  });

  console.log(`   ✅ Execução enfileirada`);
  console.log(`   🆔 executionId: ${executionResult.executionId}`);
  console.log(`   📼 replayIds: ${JSON.stringify(executionResult.replayIds)}`);
  console.log(`   🔧 platformScenarioIds: ${JSON.stringify(executionResult.platformScenarioIds)}`);
  console.log(`   📊 governance findings: ${executionResult.governance?.length || 0}`);

  // ── 4. Monitorar execução ───────────────────────────────────────────────
  console.log('\n[4/5] Monitorando execução...');

  const qaMeshService = require('./api/services/qaMeshService');
  let statusFinal = null;
  let polls = 0;
  const MAX_POLLS = 30;

  while (polls < MAX_POLLS) {
    const execution = qaMeshService.getQueuedExecutionStatus(executionResult.executionId);
    if (!execution) {
      process.stdout.write(`   ⏳ [${polls + 1}/${MAX_POLLS}] Aguardando na fila...\r`);
      await sleep(300);
      polls++;
      continue;
    }

    statusFinal = execution.status;
    const rawStatus = String(statusFinal || '').toLowerCase();
    process.stdout.write(`   ⏳ [${polls + 1}/${MAX_POLLS}] Status: ${statusFinal}     \r`);

    if (rawStatus !== 'queued' && rawStatus !== 'running' && rawStatus !== 'processing') {
      console.log(`\n   ✅ Status final: ${statusFinal}`);
      if (execution.results) {
        console.log(`   📊 Resultados da execução:`);
        (execution.results || []).forEach((r, i) => {
          console.log(`     [${i+1}] id=${r?.id}, status=${r?.status}`);
        });
      }
      break;
    }

    await sleep(300);
    polls++;
  }

  if (polls >= MAX_POLLS) {
    console.log(`\n   ⚠️  Timeout (${MAX_POLLS} polls)`);
  }

  // ── 5. Analisar artefatos ──────────────────────────────────────────────
  console.log('\n[5/5] Analisando artefatos...');
  await sleep(1500);

  const fs = require('fs');
  const path = require('path');
  const { getRpaReplayDir } = require('./lib/rpaPathResolver');
  const replayDir = getRpaReplayDir();

  if (fs.existsSync(replayDir)) {
    const files = fs.readdirSync(replayDir).filter(f => f.endsWith('.json'));
    console.log(`   📁 Replay dir: ${replayDir}`);
    console.log(`   📄 Arquivos de replay: ${files.length}`);

    files.sort().forEach(file => {
      const data = JSON.parse(fs.readFileSync(path.join(replayDir, file), 'utf8'));
      if (data.executionId === executionResult.executionId) {
        console.log(`\n   📋 Replay: ${file}`);
        console.log(`     status: ${data.status}`);
        console.log(`     executionStatus: ${data.executionStatus}`);
        console.log(`     platformAdapter: ${data.platformAdapter}`);
        console.log(`     platformScenarioIds: ${JSON.stringify(data.platformScenarioIds)}`);
        console.log(`     scenarioId: ${data.scenarioId}`);
        console.log(`     waveId: ${data.waveId}`);
        console.log(`     seedId: ${data.seedId}`);
        console.log(`     durationMs: ${data.durationMs}`);
        console.log(`     errors: ${data.errors?.length || 0}`);
        if (data.errors?.length > 0) {
          data.errors.forEach(e => console.log(`       ⚠️  ${e.message}`));
        }
      }
    });
  } else {
    console.log(`   ⚠️  Replay dir não existe: ${replayDir}`);
  }

  // Verificar evidências
  const evidenceRoot = path.join(__dirname, 'qa-mesh', 'meshEvidence');
  if (fs.existsSync(evidenceRoot)) {
    const evidenceDirs = fs.readdirSync(evidenceRoot);
    if (evidenceDirs.length > 0) {
      console.log(`\n   📂 Evidências geradas: ${evidenceDirs.length} waves`);
      evidenceDirs.forEach(dir => {
        const files = fs.readdirSync(path.join(evidenceRoot, dir));
        console.log(`     ${dir}: ${files.length} arquivos`);
      });
    }
  }

  console.log('\n════════════════════════════════════');
  console.log('RESUMO FINAL DA EXECUÇÃO');
  console.log('════════════════════════════════════');
  console.log(`Cenário ID:            ${scenario.id}`);
  console.log(`Wave ID:               ${scenario.waveId}`);
  console.log(`Execution ID:          ${executionResult.executionId}`);
  console.log(`platformScenarioIds:   ${JSON.stringify(executionResult.platformScenarioIds)}`);
  console.log(`Status:                ${statusFinal || 'desconhecido'}`);
  console.log(`Seeds geradas:         ${scenario.seeds?.length || 0}`);
  console.log(`Replays criados:       ${executionResult.replayIds?.length || 0}`);
  console.log(`Governance findings:   ${executionResult.governance?.length || 0}`);
  console.log('════════════════════════════════════');
}

main().catch(err => {
  console.error('\n❌ ERRO FATAL:', err.message);
  console.error('Código:', err.code);
  if (err.details) console.error('Detalhes:', JSON.stringify(err.details, null, 2));
  console.error(err.stack?.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
});
