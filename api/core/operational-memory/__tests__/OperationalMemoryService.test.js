'use strict';

jest.mock('../../../services/conversationMemoryService', () => ({
  indexMemoryEntry: jest.fn().mockResolvedValue({ id: 'mem-1' }),
  searchRelevantMemories: jest.fn().mockResolvedValue([{ id: 'mem-1', content: 'memory' }]),
}));

const { OperationalMemoryService } = require('..');

describe('OperationalMemoryService', () => {
  test('registra feedback operacional em memória compatível', async () => {
    const service = new OperationalMemoryService();
    const out = await service.recordRecommendationFeedback({
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      recommendationId: 'rec-1',
      status: 'accepted',
    });

    expect(out.ok).toBe(true);
  });

  test('agrega estatísticas de outcomes', async () => {
    const service = new OperationalMemoryService({
      outcomeModel: {
        findAll: jest.fn().mockResolvedValue([
          {
            toJSON: () => ({
              outcome_type: 'operational_action_executed',
              status: 'success',
              outcome_score: 0.9,
            }),
          },
          {
            toJSON: () => ({
              outcome_type: 'operational_action_failed',
              status: 'failed',
              outcome_score: 0.1,
            }),
          },
        ]),
      },
    });
    const out = await service.getOutcomeStats({ tenantId: 'tenant-1' });

    expect(out.ok).toBe(true);
    expect(out.summary.total).toBe(2);
    expect(out.summary.success).toBe(1);
    expect(out.summary.failed).toBe(1);
  });
});
