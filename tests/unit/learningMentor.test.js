'use strict';

const mockGenerateAiResponse = jest.fn();

jest.mock('../../api/services/aiProviderService', () => ({
  generateAiResponse: (...args) => mockGenerateAiResponse(...args),
}));

const mockPlanFindOne = jest.fn();
const mockPlanCreate = jest.fn();

jest.mock('../../api/db/models/LearningMentorPlan', () => () => ({
  findOne: (...args) => mockPlanFindOne(...args),
  create: (...args) => mockPlanCreate(...args),
}));

const mockGetCompetencies = jest.fn();
const mockLoadLedgerEvents = jest.fn();

jest.mock('../../api/modules/learning-core/competencyService', () => ({
  getCompetencies: (...args) => mockGetCompetencies(...args),
  loadLedgerEvents: (...args) => mockLoadLedgerEvents(...args),
}));

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  buildMentorAggregates,
  generateMentorPlan,
  getLatestMentorPlan,
} = require('../../api/modules/learning-core/mentorService');

describe('learning mentorService — buildMentorAggregates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('agrega janelas de 7/30/90 dias com contagens e taxa de erro', async () => {
    const now = Date.now();
    mockLoadLedgerEvents.mockResolvedValue([
      { type: 'learning.interaction.navigation', occurredAt: new Date(now - 2 * 86400000), payload: { route: '/inbox' } },
      { type: 'learning.interaction.api_call', occurredAt: new Date(now - 2 * 86400000), payload: { route: '/inbox', status: 500 } },
      { type: 'learning.interaction.navigation', occurredAt: new Date(now - 20 * 86400000), payload: { route: '/crm' } },
      { type: 'learning.interaction.flow_completed', occurredAt: new Date(now - 60 * 86400000), payload: { route: '/crm', flowId: 'f1' } },
    ]);
    mockGetCompetencies.mockResolvedValue({
      competencies: [{ skillKey: 'tickets', score: 0.8, eventCount: 30 }],
      profile: { dominantSkills: [], weakSkills: [{ skillKey: 'crm', score: 0.3, eventCount: 8 }] },
    });

    const aggregates = await buildMentorAggregates({ tenantId: 't1', agentId: 'a1' });

    expect(aggregates.windows).toHaveLength(3);
    const [w7, w30, w90] = aggregates.windows;
    expect(w7.events).toBe(2);
    expect(w7.errors).toBe(1);
    expect(w30.events).toBe(3);
    expect(w90.events).toBe(4);
    expect(w90.flowsCompleted).toBe(1);
    expect(aggregates.weakSkills).toHaveLength(1);
  });
});

describe('learning mentorService — generateMentorPlan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadLedgerEvents.mockResolvedValue([]);
    mockGetCompetencies.mockResolvedValue({ competencies: [], profile: null });
  });

  it('gera e persiste plano quando a IA responde JSON válido', async () => {
    mockGenerateAiResponse.mockResolvedValue({
      text: '{"resumo":"Bom progresso.","competenciasSugeridas":[{"skill":"crm","motivo":"fraco"}],"objetivos":[{"descricao":"Reduzir erros","prazoDias":14}],"indicadores":[{"nome":"taxa de erro","meta":"<5%"}]}',
    });
    mockPlanCreate.mockImplementation(async (values) => ({ id: 'plan-1', ...values }));

    const result = await generateMentorPlan({ tenantId: 't1', agentId: 'a1' });

    expect(mockPlanCreate).toHaveBeenCalledTimes(1);
    expect(result.plan.resumo).toBe('Bom progresso.');
    expect(result.aggregates.windows).toHaveLength(3);
  });

  it('IA indisponível lança AI_UNAVAILABLE (sem fallback heurístico)', async () => {
    mockGenerateAiResponse.mockRejectedValue(new Error('provider down'));

    await expect(generateMentorPlan({ tenantId: 't1', agentId: 'a1' }))
      .rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(mockPlanCreate).not.toHaveBeenCalled();
  });

  it('resposta sem JSON válido lança AI_UNAVAILABLE', async () => {
    mockGenerateAiResponse.mockResolvedValue({ text: 'nao sei responder' });

    await expect(generateMentorPlan({ tenantId: 't1', agentId: 'a1' }))
      .rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
  });
});

describe('learning mentorService — getLatestMentorPlan', () => {
  it('retorna null quando não há plano', async () => {
    mockPlanFindOne.mockResolvedValue(null);
    const result = await getLatestMentorPlan({ tenantId: 't1', agentId: 'a1' });
    expect(result).toBeNull();
  });

  it('serializa o plano mais recente', async () => {
    mockPlanFindOne.mockResolvedValue({
      id: 'p1', aggregates: { windows: [] }, plan: { resumo: 'x' }, status: 'active', generatedAt: '2026-07-23T12:00:00Z',
    });
    const result = await getLatestMentorPlan({ tenantId: 't1', agentId: 'a1' });
    expect(result.id).toBe('p1');
    expect(result.plan.resumo).toBe('x');
  });
});
