'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('../qaMeshService', () => ({
  queueMeshRun: jest.fn(() => ({ executionId: 'mesh-test-1' })),
}));

const qaMeshService = require('../qaMeshService');
const qaWavesScenarioService = require('../qaWavesScenarioService');
const { getRpaReplayDir } = require('../../../lib/rpaPathResolver');

const STORE_PATH = path.join(__dirname, '..', '..', '..', 'qa', 'qa-waves', 'scenario-store.json');

function safeRead(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
}

describe('qaWavesScenarioService', () => {
  let storeBackup;
  let runtimeRoot;

  beforeAll(() => {
    storeBackup = safeRead(STORE_PATH);
  });

  beforeEach(() => {
    runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-waves-runtime-'));
    process.env.RUNTIME_ROOT = runtimeRoot;

    if (fs.existsSync(STORE_PATH)) {
      fs.unlinkSync(STORE_PATH);
    }
    qaMeshService.queueMeshRun.mockReset();
    qaMeshService.queueMeshRun.mockReturnValue({ executionId: 'mesh-test-1' });
  });

  afterAll(() => {
    delete process.env.RUNTIME_ROOT;

    if (storeBackup == null) {
      if (fs.existsSync(STORE_PATH)) fs.unlinkSync(STORE_PATH);
      return;
    }

    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, storeBackup, 'utf8');
  });

  test('inferScenario deve retornar scenario validado no formato semantico', () => {
    const result = qaWavesScenarioService.inferScenario({
      vertical: 'fitness',
      journey: 'cliente_novo',
      goal: 'aula experimental',
      channels: ['whatsapp', 'chat'],
      constraints: { semanticStepsOnly: true, platformCompatibleOnly: true, generateSeeds: true },
    });

    expect(result.validation.valid).toBe(true);
    expect(result.scenario).toHaveProperty('id', 'fitness_trial_class');
    expect(Array.isArray(result.scenario.steps)).toBe(true);
    expect(result.scenario.steps.length).toBeGreaterThan(0);
    expect(result.scenario.steps.every((step) => !['click', 'xpath', 'fill_input'].includes(step.type))).toBe(true);
  });

  test('saveScenario deve versionar alteracoes sucessivas', () => {
    const inferred = qaWavesScenarioService.inferScenario({
      vertical: 'fitness',
      journey: 'cliente_novo',
      goal: 'aula experimental',
      channels: ['whatsapp'],
    });

    const first = qaWavesScenarioService.saveScenario({ scenario: inferred.scenario, changedBy: 'manual' });
    const second = qaWavesScenarioService.saveScenario({
      scenario: { ...inferred.scenario, description: 'descricao alterada manualmente' },
      changedBy: 'manual',
    });

    expect(first.scenario.version).toBe('v2');
    expect(second.scenario.version).toBe('v3');
    expect(Array.isArray(second.history)).toBe(true);
    expect(second.history.length).toBeGreaterThanOrEqual(2);
  });

  test('generateSeeds deve gerar quantidade solicitada para scenario existente', () => {
    const inferred = qaWavesScenarioService.inferScenario({
      vertical: 'fitness',
      journey: 'cliente_novo',
      goal: 'aula experimental',
      channels: ['whatsapp'],
    });
    qaWavesScenarioService.saveScenario({ scenario: inferred.scenario, changedBy: 'manual' });

    const generated = qaWavesScenarioService.generateSeeds({
      scenarioId: 'fitness_trial_class',
      count: 3,
      variationTypes: ['persona', 'behavior'],
    });

    expect(Array.isArray(generated.seeds)).toBe(true);
    expect(generated.seeds).toHaveLength(3);
    expect(generated.seeds.every((seed) => seed.scenarioId === 'fitness_trial_class')).toBe(true);
  });

  test('runScenarioExecution deve usar QA Mesh real (queueMeshRun) e gerar replay unificado', async () => {
    const inferred = qaWavesScenarioService.inferScenario({
      vertical: 'fitness',
      journey: 'cliente_novo',
      goal: 'aula experimental',
      channels: ['whatsapp'],
    });
    qaWavesScenarioService.saveScenario({
      scenario: {
        ...inferred.scenario,
        platformScenarioIds: ['rpa-example-test'],
        platform: { platformScenarioIds: ['rpa-example-test'] },
      },
      changedBy: 'manual',
    });

    const run = await qaWavesScenarioService.runScenarioExecution({
      waveId: 'fitness-cliente-novo',
      scenarioIds: ['fitness_trial_class'],
      seedIds: ['seed_001'],
      mode: 'real',
      replay: true,
    });

    // Fora do pipeline, business-f1 é substituído por rpa-example-test (smoke local RPA executável)
    expect(qaMeshService.queueMeshRun).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioIds: ['rpa-example-test'], executionOrigin: 'qa_waves_real' })
    );
    expect(run.executionId).toBe('mesh-test-1');
    expect(typeof run.replayId).toBe('string');

    const replayPath = path.join(getRpaReplayDir(), `${run.replayId}.json`);
    expect(fs.existsSync(replayPath)).toBe(true);

    const payload = JSON.parse(fs.readFileSync(replayPath, 'utf8'));
    expect(payload.type).toBe('qa_wave_rpa_replay');
    expect(payload.executionId).toBe('mesh-test-1');
    expect(payload.scenarioId).toBe('fitness_trial_class');
    expect(payload.platformScenarioIds).toEqual(['rpa-example-test']);
  });
});
