'use strict';

const {
  inferJourneys,
  buildEntityGraph,
  resolveEligibleJourneys,
  evaluateCandidateJourneyLifecycle,
  generateScenarios,
  generateSeeds,
  generateModelDrivenWaves,
} = require('../../../api/modules/agent-os/services/model-driven-pipeline');

function model(modelName, tableName, foreignKeys = {}, attributes = {}) {
  return {
    modelName,
    tableName,
    foreignKeys,
    attributes: {
      id: { type: 'UUID', allowNull: false, primaryKey: true, defaultValue: null },
      ...attributes,
    },
    primaryKeys: ['id'],
    totalAttributes: Object.keys(attributes).length + 1,
    totalRequired: 1,
    statusFields: {},
    jsonbFields: {},
  };
}

function candidateFixture() {
  const introspection = {
    models: [
      model('AuditChild', 'audit_children', {
        ownerId: {
          referencedModel: 'AuditParent',
          referencedTable: 'audit_parents',
          referencedKey: 'id',
          allowNull: false,
          source: 'sequelize_references',
        },
      }, {
        ownerId: {
          type: 'UUID',
          allowNull: false,
          primaryKey: false,
          defaultValue: null,
          references: { model: 'AuditParent', key: 'id' },
        },
      }),
      model('AuditParent', 'audit_parents'),
    ],
  };
  const domainMap = { domains: [{ domain: 'Audit', models: introspection.models }] };
  const graph = buildEntityGraph(introspection, domainMap);
  const report = inferJourneys(introspection, domainMap, graph);
  return { introspection, report, candidate: report.candidateJourneys[0] };
}

function artifact(stage, journeyId, extra = {}) {
  return {
    stage,
    journeyId,
    producer: `model-driven.${stage.toLowerCase()}`,
    producedAt: `2026-08-21T12:00:${String(extra.second || 0).padStart(2, '0')}.000Z`,
    runId: 'run-model-1',
    sourceFingerprint: 'c'.repeat(64),
    ...extra,
  };
}

describe('model-driven candidate lifecycle — sem proxy global', () => {
  test('candidate IDs são determinísticos para o mesmo entity graph', () => {
    const first = candidateFixture().candidate;
    const second = candidateFixture().candidate;

    expect(first.id).toBe(second.id);
    expect(first.slug).toBe(second.slug);
  });

  test('resolveEligibleJourneys inclui registered journeys e somente candidates explicitamente registrados', () => {
    const registered = {
      id: 'journey-registered',
      slug: 'registered',
      status: 'complete',
      availableModels: [],
      sourceModels: [],
      successCriteria: [],
      failureCriteria: [],
    };
    const discovered = { ...candidateFixture().candidate };
    const approved = {
      ...discovered,
      id: `${discovered.id}-approved`,
      pipelineState: 'REGISTERED',
      status: 'REGISTERED',
      registrationEvidence: artifact('REGISTERED', `${discovered.id}-approved`, {
        registrationId: 'registration-1',
        approvedBy: 'principal-admin-1',
      }),
    };

    const eligible = resolveEligibleJourneys({
      journeys: [registered],
      candidateJourneys: [discovered, approved],
    }, { runId: 'run-model-1', sourceFingerprint: 'c'.repeat(64) });

    expect(eligible.journeys.map((journey) => journey.id)).toEqual([
      'journey-registered',
      approved.id,
    ]);
    expect(eligible.rejectedCandidates).toEqual([
      expect.objectContaining({ id: discovered.id, reason: 'candidate_not_registered' }),
    ]);
  });

  test('candidate registrada entra em scenarios, seeds e waves; FK unresolved nunca vira SEED_READY', () => {
    const { introspection, candidate } = candidateFixture();
    const registered = {
      ...candidate,
      status: 'REGISTERED',
      pipelineState: 'REGISTERED',
      registrationEvidence: artifact('REGISTERED', candidate.id, {
        registrationId: 'registration-1',
        approvedBy: 'principal-admin-1',
      }),
    };
    const eligible = { journeys: [registered] };

    const scenarios = generateScenarios(introspection, eligible);
    const seeds = generateSeeds(introspection, eligible);
    const waves = generateModelDrivenWaves(eligible, scenarios);

    expect(scenarios.totalScenarios).toBeGreaterThan(0);
    expect(scenarios.journeyScenarios[0].journeyId).toBe(candidate.id);
    expect(seeds.totalSeeds).toBeGreaterThan(0);
    expect(seeds.journeySeeds[0].seeds.some((seed) => seed.seedStatus === 'FK_UNRESOLVED')).toBe(true);
    expect(seeds.journeySeeds[0].seeds.some((seed) => seed.compatible === false)).toBe(true);
    expect(waves.waves).toEqual([
      expect.objectContaining({ journeyId: candidate.id, scenarioCount: expect.any(Number) }),
    ]);
  });

  test('lifecycle VALIDATED exige artifacts candidate-specific completos e preserva timestamps dos produtores', () => {
    const journeyId = 'candidate-1';
    const artifacts = [
      artifact('REGISTERED', journeyId, { second: 1, registrationId: 'reg-1', approvedBy: 'principal-1' }),
      artifact('SCENARIO_GENERATED', journeyId, { second: 2, scenarioIds: ['scenario-1'] }),
      artifact('SEED_PLANNED', journeyId, { second: 3, seedPlanId: 'plan-1' }),
      artifact('SEED_READY', journeyId, { second: 4, seedIds: ['seed-1'], fkIntegrity: { valid: true }, provisioned: true }),
      artifact('WAVE_CREATED', journeyId, { second: 5, waveId: 'wave-1', scenarioIds: ['scenario-1'] }),
      artifact('EXECUTED', journeyId, { second: 6, executionId: 'execution-1', waveId: 'wave-1', status: 'GO' }),
      artifact('EVIDENCE_GENERATED', journeyId, { second: 7, executionId: 'execution-1', evidenceId: 'evidence-1' }),
      artifact('VALIDATED', journeyId, { second: 8, executionId: 'execution-1', evidenceId: 'evidence-1', replayId: 'replay-1', decision: 'GO' }),
    ];

    const result = evaluateCandidateJourneyLifecycle({ id: journeyId, pipelineState: 'DISCOVERED' }, artifacts, {
      runId: 'run-model-1',
      sourceFingerprint: 'c'.repeat(64),
    });

    expect(result.pipelineState).toBe('VALIDATED');
    expect(result.valid).toBe(true);
    expect(result.transitions.map((transition) => transition.producedAt)).toEqual(
      artifacts.map((entry) => entry.producedAt),
    );
    expect(result.transitions.every((transition) => transition.producer.startsWith('model-driven.'))).toBe(true);
  });

  test.each([
    ['NO_GO substring', (artifacts) => { artifacts.at(-1).decision = 'NO_GO'; }],
    ['foreign journey execution', (artifacts) => { artifacts[5].journeyId = 'other-candidate'; }],
    ['foreign run', (artifacts) => { artifacts[6].runId = 'other-run'; }],
    ['invalid FK seed', (artifacts) => { artifacts[3].fkIntegrity.valid = false; }],
    ['missing evidence linkage', (artifacts) => { artifacts.at(-1).evidenceId = 'other-evidence'; }],
  ])('não valida com %s', (_label, mutate) => {
    const journeyId = 'candidate-1';
    const artifacts = [
      artifact('REGISTERED', journeyId, { registrationId: 'reg-1', approvedBy: 'principal-1' }),
      artifact('SCENARIO_GENERATED', journeyId, { scenarioIds: ['scenario-1'] }),
      artifact('SEED_PLANNED', journeyId, { seedPlanId: 'plan-1' }),
      artifact('SEED_READY', journeyId, { seedIds: ['seed-1'], fkIntegrity: { valid: true }, provisioned: true }),
      artifact('WAVE_CREATED', journeyId, { waveId: 'wave-1', scenarioIds: ['scenario-1'] }),
      artifact('EXECUTED', journeyId, { executionId: 'execution-1', waveId: 'wave-1', status: 'GO' }),
      artifact('EVIDENCE_GENERATED', journeyId, { executionId: 'execution-1', evidenceId: 'evidence-1' }),
      artifact('VALIDATED', journeyId, { executionId: 'execution-1', evidenceId: 'evidence-1', replayId: 'replay-1', decision: 'GO' }),
    ];
    mutate(artifacts);

    const result = evaluateCandidateJourneyLifecycle({ id: journeyId, pipelineState: 'DISCOVERED' }, artifacts, {
      runId: 'run-model-1',
      sourceFingerprint: 'c'.repeat(64),
    });

    expect(result.valid).toBe(false);
    expect(result.pipelineState).not.toBe('VALIDATED');
    expect(result.violations.length).toBeGreaterThan(0);
  });
});
