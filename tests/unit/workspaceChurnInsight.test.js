'use strict';

/**
 * Vertical Fitness → Workspace: insight de churn com score de ML no
 * Customer 360 e Next Best Action de reativação.
 */

const latestFitnessSignalByPhone = jest.fn();

function loadModules({ entityPhone = '5511977776655', signal = null } = {}) {
  jest.resetModules();
  latestFitnessSignalByPhone.mockReset().mockResolvedValue(signal);

  const insightRows = [];
  jest.doMock('../../api/db/models', () => ({
    WorkspaceInsight: () => ({
      findOne: jest.fn(async () => null),
      findAll: jest.fn(async () => insightRows),
      create: jest.fn(async (data) => ({ id: `ins-${insightRows.length}`, ...data, toJSON() { return this; } })),
    }),
    WorkspaceEntity: () => ({
      findOne: jest.fn(async () => (entityPhone ? { phone: entityPhone } : null)),
    }),
    WorkspaceAction: () => ({
      findAll: jest.fn(async () => []),
      create: jest.fn(async (data) => data),
    }),
    WorkspaceEntityLink: () => ({
      findOne: jest.fn(async () => ({ source_id: 'conv-9', toJSON() { return this; } })),
    }),
  }));
  jest.doMock('../../api/services/nlpService', () => ({ analyzeText: jest.fn(async () => null) }));
  jest.doMock('../../api/services/vertical/noShowSignalService', () => ({ recentNoShowsByPhone: jest.fn(async () => []) }));
  jest.doMock('../../api/services/vertical/fitnessChurnSignalService', () => ({ latestFitnessSignalByPhone }));

  // eslint-disable-next-line global-require
  const WorkspaceInsightService = require('../../api/services/workspace/WorkspaceInsightService');
  // eslint-disable-next-line global-require
  const WorkspaceActionService = require('../../api/services/workspace/WorkspaceActionService');

  const timelineService = { getEntityTimeline: jest.fn(async () => ({ items: [], total: 0 })) };
  const insightService = new WorkspaceInsightService({ timelineService });
  const actionService = new WorkspaceActionService({ insightService });
  return { insightService, actionService };
}

const churnSignal = {
  signalId: 'ves-1',
  signalType: 'churn_risk',
  score: 0.81,
  daysSinceLastVisit: 32,
  frequency30d: 1,
  computedAt: new Date().toISOString(),
  computedBy: 'ml_logreg:v3',
};

describe('Workspace — insight de churn fitness (score ML)', () => {
  test('churn_risk vira insight com score do modelo e contexto de treino', async () => {
    const { insightService } = loadModules({ signal: churnSignal });
    const result = await insightService.generateInsights('entity-1', { tenantId: 'tenant-a' });

    const churn = result.items.find((item) => item.type === 'churn');
    expect(churn).toBeDefined();
    expect(churn.description).toMatch(/risco de desistencia detectado pelo modelo \(score do modelo: 81%\)/);
    expect(churn.description).toMatch(/32 dias sem treinar/);
    expect(churn.description).toMatch(/1 treino\(s\) nos ultimos 30 dias/);
    expect(churn.severity).toBe('high');
    expect(churn.confidence).toBeCloseTo(0.81, 2);
    expect(churn.evidence).toEqual(['ves-1']);
    expect(latestFitnessSignalByPhone).toHaveBeenCalledWith({ tenantId: 'tenant-a', phone: '5511977776655' });
  });

  test('low_frequency vira insight médio de queda de frequência', async () => {
    const { insightService } = loadModules({
      signal: { ...churnSignal, signalType: 'low_frequency', score: 0.34, daysSinceLastVisit: 10, frequency30d: 1 },
    });
    const result = await insightService.generateInsights('entity-1', { tenantId: 'tenant-a' });
    const churn = result.items.find((item) => item.type === 'churn');
    expect(churn.description).toMatch(/Frequencia de treinos em queda/);
    expect(churn.severity).toBe('medium');
  });

  test('NBA de churn: follow-up de reativação com deep-link para a conversa', async () => {
    const { actionService } = loadModules({ signal: churnSignal });
    const suggestion = await actionService.suggestNextBestAction({ tenantId: 'tenant-a', entityId: 'entity-1' });

    expect(suggestion.label).toBe('Criar follow-up de reativacao');
    expect(suggestion.reason).toBeTruthy();
    expect(suggestion.expectedOutcome).toBe('Recuperar o relacionamento e evitar churn');
    expect(suggestion.confidence).toBeCloseTo(0.81, 2);
    expect(suggestion.risk).toBe('low');
    expect(suggestion.action.kind).toBe('send_message');
    expect(suggestion.action.conversationId).toBe('conv-9');
  });

  test('fail-soft: sem telefone, sem sinal ou erro não quebram o Workspace', async () => {
    const semTelefone = loadModules({ entityPhone: null, signal: churnSignal });
    const r1 = await semTelefone.insightService.generateInsights('entity-1', { tenantId: 'tenant-a' });
    expect(r1.items.filter((i) => i.type === 'churn')).toHaveLength(0);

    const semSinal = loadModules({ signal: null });
    const r2 = await semSinal.insightService.generateInsights('entity-1', { tenantId: 'tenant-a' });
    expect(r2.items.filter((i) => i.type === 'churn')).toHaveLength(0);

    latestFitnessSignalByPhone.mockRejectedValueOnce(new Error('db down'));
    const comErro = loadModules({ signal: churnSignal });
    latestFitnessSignalByPhone.mockRejectedValueOnce(new Error('db down'));
    const r3 = await comErro.insightService.generateInsights('entity-1', { tenantId: 'tenant-a' });
    expect(r3.items.filter((i) => i.type === 'churn')).toHaveLength(0);
  });
});
