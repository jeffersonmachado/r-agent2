'use strict';

const { configureRuntimeRoot } = require('../../utils/runtimePaths');

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
    configureRuntimeRoot(runtimeRoot);

    // IDs devem corresponder aos cenários reais do scenario-store.json para que
    // collectScenarioLatestStats() correlacione corretamente os resultados
    qaMeshService.getRegistry.mockReturnValue([
      {
        id: 'fitness_cliente_novo_aula_experimental',
        domain: 'fitness',
        flow: 'Aula Experimental',
        criticality: 'blocking',
        adapter: 'rpa',
        journeyId: 'fitness_new_customer',
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
            id: 'fitness_cliente_novo_aula_experimental',
            domain: 'fitness',
            flow: 'Aula Experimental',
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
    configureRuntimeRoot(null);
    if (runtimeRoot && fs.existsSync(runtimeRoot)) {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  describe('mergeJourneyStores — jornada salva não pode esconder as derivadas', () => {
    // DEFEITO MEDIDO 2026-10-29: a árvore usava `storedJourneys.length > 0 ? storedJourneys : derivadas`.
    // Um `journey-store.json` com 2 jornadas `beauty` fazia a API devolver só elas, e a UI de QA Waves
    // deixava de listar as 253 jornadas derivadas dos cenários — inclusive "Support Ticket Flow" (dona do
    // cenário `support-inbox-nota-ui`), o que quebrava o E2E `qa-waves-replay` com timeout de 420 s.
    test('com jornada salva, as DERIVADAS continuam presentes', () => {
      const derivadas = [
        { id: 'support_ticket_flow', vertical: 'core', title: 'Support Ticket Flow' },
        { id: 'beauty_new_customer', vertical: 'beauty', title: 'Beauty New Customer' },
      ];
      const salvas = [{ id: 'beauty_new_customer', vertical: 'beauty', title: 'Beauty New Customer' }];

      const merged = qaWavesService.mergeJourneyStores(derivadas, salvas);
      const ids = merged.map((j) => `${j.vertical}::${j.id}`);

      expect(ids).toContain('core::support_ticket_flow');
      expect(ids).toContain('beauty::beauty_new_customer');
      expect(merged).toHaveLength(2);
    });

    test('a jornada SALVA sobrepõe a derivada de mesmo id+vertical (edição do usuário ganha)', () => {
      const derivadas = [{ id: 'support_ticket_flow', vertical: 'core', title: 'Derivado', script: { steps: [] } }];
      const salvas = [{ id: 'support_ticket_flow', vertical: 'core', title: 'Editado pelo tenant', script: { steps: [{ id: 's1', name: 'S1' }] } }];

      const merged = qaWavesService.mergeJourneyStores(derivadas, salvas);
      expect(merged).toHaveLength(1);
      expect(merged[0].title).toBe('Editado pelo tenant');
      expect(merged[0].script.steps).toHaveLength(1);
    });

    test('sem jornada salva o resultado é exatamente o derivado (sem mudança de comportamento)', () => {
      const derivadas = [{ id: 'a', vertical: 'core', title: 'A' }, { id: 'b', vertical: 'food', title: 'B' }];
      expect(qaWavesService.mergeJourneyStores(derivadas, [])).toEqual(derivadas);
      expect(qaWavesService.mergeJourneyStores(derivadas, null)).toEqual(derivadas);
    });
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
    expect(fitnessJourney.steps.length).toBeGreaterThanOrEqual(1);
    expect(fitnessJourney.status).toBe('failure');
  });

  test('retorna status por jornada e por passo', () => {
    const journeyStatus = qaWavesService.listJourneyStatus();
    const stepStatus = qaWavesService.listStepStatus({ journeyId: 'fitness_new_customer' });

    const fitnessJourney = journeyStatus.items.find((item) => item.journeyId === 'fitness_new_customer');

    expect(Array.isArray(journeyStatus.items)).toBe(true);
    expect(fitnessJourney.status).toBe('failure');
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
    expect(details.source).not.toHaveProperty('historyFile');
  });

  test('resolve replay com mesmo id somente dentro do tenant autenticado', () => {
    const replayId = 'qa_wave_replay_same_id';
    for (const tenantId of ['tenant-a', 'tenant-b']) {
      const replayDir = getRpaReplayDir(tenantId);
      fs.mkdirSync(replayDir, { recursive: true });
      fs.writeFileSync(path.join(replayDir, `${replayId}.json`), JSON.stringify({
        id: replayId,
        replayId,
        tenantId,
        type: 'qa_wave_rpa_replay',
        executionId: `exec-${tenantId}`,
        scenarioId: 'shared-scenario',
        scenarioName: `Replay ${tenantId}`,
        status: 'queued',
      }), 'utf8');
    }

    const tenantA = qaWavesService.getReplayById(replayId, 'tenant-a');
    const tenantB = qaWavesService.getReplayById(replayId, 'tenant-b');

    expect(tenantA.executionId).toBe('exec-tenant-a');
    expect(tenantA.itemName).toBe('Replay tenant-a');
    expect(tenantB.executionId).toBe('exec-tenant-b');
    expect(tenantB.itemName).toBe('Replay tenant-b');
  });
});
