'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../qaMeshService', () => ({
  getRegistry: jest.fn(),
  getMeshHistory: jest.fn(),
  queueMeshRun: jest.fn(() => ({ executionId: 'exec-1' })),
  queueScenarioReplay: jest.fn(() => ({ executionId: 'replay-1' })),
}));

const qaMeshService = require('../qaMeshService');
const qaWavesService = require('../qaWavesService');
const { getRpaReplayDir } = require('../../../lib/rpaPathResolver');

describe('qaWavesService journey model compatibility', () => {
  let runtimeRoot;

  beforeEach(() => {
    runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-waves-service-'));
    process.env.RUNTIME_ROOT = runtimeRoot;

    qaMeshService.getRegistry.mockReturnValue([
      {
        id: 'fitness::payment_success',
        domain: 'fitness',
        flow: 'Pagamento aprovado',
        criticality: 'blocking',
        adapter: 'api',
      },
      {
        id: 'fitness::lead_capture',
        domain: 'fitness',
        flow: 'Captura de lead',
        criticality: 'high',
        adapter: 'rpa',
      },
      {
        id: 'beauty::campaign_launch',
        domain: 'beauty',
        flow: 'Campanha beauty',
        criticality: 'high',
        adapter: 'api',
      },
    ]);

    qaMeshService.getMeshHistory.mockReturnValue([
      {
        executionId: 'exec-1',
        startedAt: '2026-04-24T10:00:00.000Z',
        results: [
          {
            id: 'fitness::payment_success',
            domain: 'fitness',
            flow: 'Pagamento aprovado',
            criticality: 'blocking',
            status: 'failed',
            startedAt: '2026-04-24T10:00:00.000Z',
            finishedAt: '2026-04-24T10:00:05.000Z',
          },
          {
            id: 'fitness::lead_capture',
            domain: 'fitness',
            flow: 'Captura de lead',
            criticality: 'high',
            status: 'success',
            startedAt: '2026-04-24T10:00:10.000Z',
            finishedAt: '2026-04-24T10:00:14.000Z',
          },
          {
            id: 'beauty::campaign_launch',
            domain: 'beauty',
            flow: 'Campanha beauty',
            criticality: 'high',
            status: 'success',
            startedAt: '2026-04-24T10:00:20.000Z',
            finishedAt: '2026-04-24T10:00:30.000Z',
          },
        ],
      },
    ]);
  });

  afterEach(() => {
    delete process.env.RUNTIME_ROOT;
    if (runtimeRoot && fs.existsSync(runtimeRoot)) {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  test('mantem listagem de waves legada', () => {
    const waves = qaWavesService.listWaves();
    const fitnessWave = waves.find((wave) => wave.domain === 'fitness');

    expect(Array.isArray(waves)).toBe(true);
    expect(fitnessWave).toBeTruthy();
    expect(fitnessWave.items.length).toBe(2);
  });

  test('gera arvore de jornadas com passos e status agregado', () => {
    const tree = qaWavesService.listJourneys();
    const fitnessDomain = tree.domains.find((domain) => domain.id === 'fitness');
    const fitnessJourney = fitnessDomain.journeys.find((journey) => journey.journeyId === 'fitness_new_customer');

    expect(tree).toHaveProperty('generatedAt');
    expect(fitnessDomain).toBeTruthy();
    expect(fitnessJourney).toBeTruthy();
    expect(Array.isArray(fitnessJourney.steps)).toBe(true);
    expect(fitnessJourney.steps.length).toBeGreaterThanOrEqual(15);
    expect(fitnessJourney.status).toBe('NO_GO');
  });

  test('retorna status por jornada e por passo', () => {
    const journeyStatus = qaWavesService.listJourneyStatus();
    const stepStatus = qaWavesService.listStepStatus({ journeyId: 'fitness_new_customer' });

    const fitnessJourney = journeyStatus.items.find((item) => item.journeyId === 'fitness_new_customer');

    expect(Array.isArray(journeyStatus.items)).toBe(true);
    expect(fitnessJourney.status).toBe('NO_GO');
    expect(Array.isArray(stepStatus.items)).toBe(true);
    expect(stepStatus.items.length).toBeGreaterThan(0);
  });

  test('permite filtrar replay por jornada e passo sem quebrar retorno legado', () => {
    const replaysByJourney = qaWavesService.listReplays({ journeyId: 'fitness_new_customer' });
    const replaysByStep = qaWavesService.listReplays({ stepId: 'step_10_payment' });

    expect(replaysByJourney.items.length).toBeGreaterThan(0);
    expect(replaysByJourney.items[0]).toHaveProperty('waveName');
    expect(replaysByJourney.items[0]).toHaveProperty('journeyName');
    expect(replaysByJourney.items[0]).toHaveProperty('stepName');
    expect(replaysByStep.items.every((item) => item.stepId === 'step_10_payment')).toBe(true);
  });

  test('aceita replayId qa_wave_replay_* e resolve para replay real por executionId', () => {
    const replayId = 'qa_wave_replay_test_resolve';
    const replayDir = getRpaReplayDir();
    fs.mkdirSync(replayDir, { recursive: true });
    fs.writeFileSync(path.join(replayDir, `${replayId}.json`), JSON.stringify({
      id: replayId,
      replayId,
      type: 'qa_wave_rpa_replay',
      executionId: 'exec-1',
      scenarioId: 'fitness_trial_class',
      journeyId: 'cliente_novo',
      status: 'queued',
      startTime: '2026-04-25T23:27:14.826Z',
    }), 'utf8');

    const details = qaWavesService.getReplayById(replayId);

    expect(details).toBeTruthy();
    expect(details.executionId).toBe('exec-1');
    expect(String(details.id)).toContain('exec-1::');
  });

  test('retorna payload queued quando replay real ainda não existe', () => {
    const replayId = 'qa_wave_replay_test_pending';
    const replayDir = getRpaReplayDir();
    fs.mkdirSync(replayDir, { recursive: true });
    fs.writeFileSync(path.join(replayDir, `${replayId}.json`), JSON.stringify({
      id: replayId,
      replayId,
      type: 'qa_wave_rpa_replay',
      executionId: 'exec-unknown',
      scenarioId: 'fitness_trial_class',
      status: 'queued',
      assertions: [
        { id: 'assert-1', type: 'validate_intent', status: 'pending' },
      ],
    }), 'utf8');

    const details = qaWavesService.getReplayById(replayId);

    expect(details).toBeTruthy();
    expect(details.id).toBe(replayId);
    expect(details.status).toBe('queued');
    expect(Array.isArray(details.steps)).toBe(true);
    expect(details.steps.length).toBe(1);
  });
});
