'use strict';

const mockEventLedgerFindAll = jest.fn();

jest.mock('../../api/db/models', () => ({
  EventLedger: () => ({
    findAll: (...args) => mockEventLedgerFindAll(...args),
  }),
}));

const mockRecompute = jest.fn();
const mockRunAdaptiveCycle = jest.fn();

jest.mock('../../api/modules/learning-core/competencyService', () => ({
  recomputeCompetencies: (...args) => mockRecompute(...args),
}));

jest.mock('../../api/modules/learning-core/adaptiveService', () => ({
  runAdaptiveCycle: (...args) => mockRunAdaptiveCycle(...args),
}));

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  runScheduledCycle,
  listRecentlyActiveAgents,
} = require('../../api/modules/learning-core/adaptiveCycleService');

describe('learning adaptiveCycleService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lista usuários ativos recentes sem duplicatas', async () => {
    mockEventLedgerFindAll.mockResolvedValue([{ actor_id: 'a1' }, { actor_id: 'a2' }]);
    const agents = await listRecentlyActiveAgents({ tenantId: 't1' });
    expect(agents).toEqual(['a1', 'a2']);
  });

  it('ciclo completo: adaptive + recompute de todos os ativos', async () => {
    mockRunAdaptiveCycle.mockResolvedValue({
      summary: { certificationDrift: 1, unclassifiedRoutes: 0, weakSkills: 0 },
      signals: [],
      actions: [],
    });
    mockEventLedgerFindAll.mockResolvedValue([{ actor_id: 'a1' }, { actor_id: 'a2' }]);
    mockRecompute.mockResolvedValue({});

    const result = await runScheduledCycle({ tenantId: 't1' });

    expect(mockRunAdaptiveCycle).toHaveBeenCalledWith({ tenantId: 't1' });
    expect(mockRecompute).toHaveBeenCalledTimes(2);
    expect(result.recomputed).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(result.adaptive.certificationDrift).toBe(1);
  });

  it('falha de recompute de um usuário não derruba o ciclo', async () => {
    mockRunAdaptiveCycle.mockResolvedValue({ summary: {}, signals: [], actions: [] });
    mockEventLedgerFindAll.mockResolvedValue([{ actor_id: 'a1' }, { actor_id: 'a2' }]);
    mockRecompute
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({});

    const result = await runScheduledCycle({ tenantId: 't1' });

    expect(result.recomputed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].agentId).toBe('a1');
  });

  it('sem usuários ativos ainda roda o adaptive', async () => {
    mockRunAdaptiveCycle.mockResolvedValue({ summary: {}, signals: [], actions: [] });
    mockEventLedgerFindAll.mockResolvedValue([]);

    const result = await runScheduledCycle({ tenantId: 't1' });

    expect(mockRunAdaptiveCycle).toHaveBeenCalledTimes(1);
    expect(mockRecompute).not.toHaveBeenCalled();
    expect(result.recomputed).toBe(0);
  });
});
