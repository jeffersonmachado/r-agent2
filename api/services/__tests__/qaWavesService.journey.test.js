'use strict';

jest.mock('../qaMeshService', () => ({
  getRegistry: jest.fn(),
  getMeshHistory: jest.fn(),
  queueMeshRun: jest.fn(() => ({ executionId: 'exec-1' })),
  queueScenarioReplay: jest.fn(() => ({ executionId: 'replay-1' })),
}));

const qaMeshService = require('../qaMeshService');
const qaWavesService = require('../qaWavesService');

describe('qaWavesService journey model compatibility', () => {
  beforeEach(() => {
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
});
