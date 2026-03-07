'use strict';

jest.mock('../../db/models', () => ({
  UraDecisionAudit: jest.fn(),
}));

const models = require('../../db/models');
const uraDecisionAuditService = require('../uraDecisionAuditService');

describe('uraDecisionAuditService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('recordDecision persiste auditoria resumida da URA', async () => {
    const create = jest.fn().mockResolvedValue({
      toJSON: () => ({
        id: 'audit-1',
        tenant_key: 'tenant-1',
        ticket_id: 'ticket-1',
        message_id: 'msg-1',
        intent: 'agendamento',
        secondary_intent: 'pilates',
        confidence: 0.91,
        fallback_used: false,
        department_id: 'dept-fit',
        queue_name: 'fitness',
        rag_used: true,
        provider_status: 'used',
        latency_ms: 120,
        context_used_summary_json: { ragUsed: true },
      }),
    });
    models.UraDecisionAudit.mockReturnValue({
      create,
      findAll: jest.fn().mockResolvedValue([]),
      destroy: jest.fn().mockResolvedValue(0),
    });

    const out = await uraDecisionAuditService.recordDecision({
      tenantId: 'tenant-1',
      ticketId: 'ticket-1',
      messageId: 'msg-1',
      aiResult: { intent: 'agendamento', secondaryIntent: 'pilates', confidence: 0.91, ragUsed: true, providerStatus: 'used', latencyMs: 120, contextUsed: { ragUsed: true } },
      routingResult: { modeUsed: 'ai', departmentId: 'dept-fit', queueName: 'fitness' },
    });

    expect(out.ok).toBe(true);
    expect(create).toHaveBeenCalled();
    expect(out.item).toEqual(expect.objectContaining({
      intent: 'agendamento',
      queueName: 'fitness',
      providerStatus: 'used',
    }));
  });
});
