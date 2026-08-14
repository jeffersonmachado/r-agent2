'use strict';

const { configureRuntimeRoot } = require('../../utils/runtimePaths');

const fs = require('fs');
const path = require('path');
const os = require('os');

// Store temporário ISOLADO por processo: este suite apaga/regrava o store a
// cada teste; usar o store real (qa/qa-waves/scenario-store.json) corrompe
// suites paralelas do Jest que o leem (ex.: meshRunner.blockingEvidence).
// A env precisa ser definida ANTES do require do service (STORE_PATH é
// resolvido no carregamento do módulo).
const STORE_PATH = path.join(os.tmpdir(), `qa-waves-scenario-store-test-${process.pid}.json`);
process.env.QA_WAVES_SCENARIO_STORE_PATH = STORE_PATH;

jest.mock('../qaMeshService', () => ({
  queueMeshRun: jest.fn(() => ({ executionId: 'mesh-test-1' })),
}));

// computeMisalignment é IA-first: o provider é mockado para o teste ficar
// hermético (sem chamada real a LLM).
jest.mock('../aiProviderService', () => ({
  generateAiResponse: jest.fn().mockResolvedValue({
    text: '[{"type":"aligned","severity":"info","message":"Cenário alinhado com a proposta da IA."}]',
  }),
}));

const qaMeshService = require('../qaMeshService');
const qaWavesScenarioService = require('../qaWavesScenarioService');
const journeyReviewService = require('../journeyReviewService');
const { getRpaReplayDir } = require('../../../lib/rpaPathResolver');

describe('qaWavesScenarioService', () => {
  let runtimeRoot;

  beforeEach(() => {
    runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-waves-runtime-'));
    configureRuntimeRoot(runtimeRoot);

    if (fs.existsSync(STORE_PATH)) {
      fs.unlinkSync(STORE_PATH);
    }
    qaMeshService.queueMeshRun.mockReset();
    qaMeshService.queueMeshRun.mockReturnValue({ executionId: 'mesh-test-1' });
  });

  afterAll(() => {
    configureRuntimeRoot(null);
    if (fs.existsSync(STORE_PATH)) fs.unlinkSync(STORE_PATH);
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

  test('listLatestScenarios deve ignorar registros invalidos do store', () => {
    const inferred = qaWavesScenarioService.inferScenario({
      vertical: 'fitness',
      journey: 'cliente_novo',
      goal: 'aula experimental',
      channels: ['whatsapp'],
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, `${JSON.stringify({
      version: 1,
      scenarios: [
        { id: 'broken-without-wave-id' },
        inferred.scenario,
      ],
      history: {},
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8');

    const listed = qaWavesScenarioService.listLatestScenarios();

    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({ id: inferred.scenario.id, waveId: inferred.scenario.waveId });
    expect(warnSpy).toHaveBeenCalledWith(
      '[qaWavesScenarioService] Ignorando cenarios invalidos no store durante deduplicacao',
      expect.arrayContaining([
        expect.objectContaining({ id: 'broken-without-wave-id' }),
      ])
    );

    warnSpy.mockRestore();
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

    const replayPath = path.join(getRpaReplayDir('system'), `${run.replayId}.json`);
    expect(fs.existsSync(replayPath)).toBe(true);

    const payload = JSON.parse(fs.readFileSync(replayPath, 'utf8'));
    expect(payload.type).toBe('qa_wave_rpa_replay');
    expect(payload.executionId).toBe('mesh-test-1');
    expect(payload.scenarioId).toBe('fitness_trial_class');
    expect(payload.platformScenarioIds).toEqual(['rpa-example-test']);
  });

  test('status executável exige platformScenarioIds explícitos', () => {
    const inferred = qaWavesScenarioService.inferScenario({
      vertical: 'fitness',
      journey: 'cliente_novo',
      goal: 'aula experimental',
      channels: ['whatsapp'],
    });
    const validation = qaWavesScenarioService.validateScenarioPayload({
      scenario: {
        ...inferred.scenario,
        status: 'approved',
        platformScenarioIds: [],
        platform: { platformScenarioIds: [] },
      },
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing_platform_scenario_ids' }),
    ]));
  });

  test('revisão usa o baseScenario ajustado e apply persiste status approved', async () => {
    const inferred = qaWavesScenarioService.inferScenario({
      vertical: 'fitness',
      journey: 'cliente_novo',
      goal: 'aula experimental',
      channels: ['whatsapp'],
    });
    const baseScenario = {
      ...inferred.scenario,
      description: 'Descrição ajustada pelo revisor humano',
      platformScenarioIds: ['rpa-example-test'],
      platform: { platformScenarioIds: ['rpa-example-test'] },
    };

    const review = await journeyReviewService.inferJourneyReview({
      vertical: 'fitness',
      journeyId: 'cliente_novo',
      baseScenario,
      tenantId: 'system',
      reviewedBy: 'agent-reviewer',
    });
    expect(review.inferredScenario.description).toBe('Descrição ajustada pelo revisor humano');
    expect(review.inferredScenario.status).toBe('reviewed');
    expect(review.inferredScenario.journeyId).toBe('cliente_novo');

    const applied = journeyReviewService.applyJourneyReview({
      scenario: review.inferredScenario,
      reviewToken: review.reviewToken,
      approved: true,
      tenantId: 'system',
      changedBy: 'agent-reviewer',
    });
    expect(applied.scenario.status).toBe('approved');
    expect(applied.scenario.platformScenarioIds.length).toBeGreaterThan(0);
  });

  test('apply de revisão rejeita ausência, adulteração e troca de tenant do token', async () => {
    const inferred = qaWavesScenarioService.inferScenario({
      vertical: 'fitness',
      journey: 'cliente_novo',
      goal: 'aula experimental',
      channels: ['whatsapp'],
      tenantId: 'tenant-a',
    });
    const review = await journeyReviewService.inferJourneyReview({
      vertical: 'fitness',
      journeyId: 'cliente_novo',
      baseScenario: inferred.scenario,
      tenantId: 'tenant-a',
      reviewedBy: 'agent-a',
    });
    const baseApply = {
      scenario: review.inferredScenario,
      approved: true,
      tenantId: 'tenant-a',
      changedBy: 'agent-a',
    };

    expect(() => journeyReviewService.applyJourneyReview(baseApply)).toThrow('reviewToken inválido');
    expect(() => journeyReviewService.applyJourneyReview({
      ...baseApply,
      reviewToken: `${review.reviewToken}tampered`,
    })).toThrow('reviewToken inválido');
    expect(() => journeyReviewService.applyJourneyReview({
      ...baseApply,
      tenantId: 'tenant-b',
      reviewToken: review.reviewToken,
    })).toThrow('não pertence ao tenant');
    expect(() => journeyReviewService.applyJourneyReview({
      ...baseApply,
      changedBy: 'agent-b',
      reviewToken: review.reviewToken,
    })).toThrow('não pertence ao revisor');
    expect(() => journeyReviewService.applyJourneyReview({
      ...baseApply,
      scenario: { ...review.inferredScenario, description: 'alterado depois da inferência' },
      reviewToken: review.reviewToken,
    })).toThrow('foi alterado após a inferência');
  });

  test('cenários com o mesmo id permanecem isolados por tenant', () => {
    const base = qaWavesScenarioService.inferScenario({
      vertical: 'fitness',
      journey: 'cliente_novo',
      goal: 'aula experimental',
      channels: ['whatsapp'],
      tenantId: 'tenant-a',
    }).scenario;

    qaWavesScenarioService.saveScenario({
      scenario: { ...base, tenantId: 'tenant-a', description: 'somente A' },
      tenantId: 'tenant-a',
    });
    qaWavesScenarioService.saveScenario({
      scenario: { ...base, tenantId: 'tenant-b', description: 'somente B' },
      tenantId: 'tenant-b',
    });

    const tenantA = qaWavesScenarioService.listLatestScenarios({ tenantId: 'tenant-a' }).items;
    const tenantB = qaWavesScenarioService.listLatestScenarios({ tenantId: 'tenant-b' }).items;
    expect(tenantA).toHaveLength(1);
    expect(tenantB).toHaveLength(1);
    expect(tenantA[0].description).toBe('somente A');
    expect(tenantB[0].description).toBe('somente B');
  });
});
