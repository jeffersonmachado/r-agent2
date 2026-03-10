'use strict';

const { OperationalDecisionEngine } = require('../OperationalDecisionEngine');

describe('OperationalDecisionEngine', () => {
  let occStateRepository;
  let engine;

  beforeEach(() => {
    occStateRepository = {
      getSignals: jest.fn(),
      getRecommendations: jest.fn(),
      getActivePlaybooks: jest.fn(),
    };

    engine = new OperationalDecisionEngine({ occStateRepository });
  });

  test('evaluateSignalDecision calcula score e metadados de decisão', () => {
    const out = engine.evaluateSignalDecision({
      id: 'sig-1',
      type: 'support_backlog_risk',
      status: 'open',
      severity: 'critical',
      confidence: 0.91,
      detected_at: '2026-03-10T00:00:00.000Z',
      contact_id: 'contact-1',
    }, {
      activePlaybookCount: 0,
      hasActiveAction: false,
    });

    expect(out.priorityScore).toBeGreaterThanOrEqual(0);
    expect(out.priorityScore).toBeLessThanOrEqual(100);
    expect(out).toHaveProperty('decisionType', 'playbook');
    expect(out).toHaveProperty('actionMode', 'human_confirm_required');
    expect(out).toHaveProperty('expectedOutcome', 'reduce_backlog');
    expect(out).toHaveProperty('reason');
    expect(out.scoreBreakdown).toEqual(expect.objectContaining({
      severity: expect.any(Number),
      urgency: expect.any(Number),
      impact: expect.any(Number),
      revenueRisk: expect.any(Number),
      existingActionPenalty: expect.any(Number),
    }));
  });

  test('evaluateSignalDecision aplica política de revisão manual para channel_attention com baixa confiança', () => {
    const out = engine.evaluateSignalDecision({
      id: 'sig-2',
      type: 'channel_attention',
      status: 'open',
      severity: 'low',
      confidence: 0.30,
      detected_at: '2026-03-10T00:00:00.000Z',
    }, {
      activePlaybookCount: 0,
      hasActiveAction: false,
    });

    expect(out.decisionType).toBe('manual_review');
    expect(out.actionMode).toBe('assisted_execution_only');
    expect(out.expectedOutcome).toBe('stabilize_channel');
  });

  test('listSignalDecisions ordena por prioridade e cobre tipos operacionais obrigatórios', async () => {
    const signalTypes = [
      'low_occupancy',
      'support_backlog_risk',
      'customer_reactivation',
      'missed_revenue',
      'high_cancel_rate',
      'channel_attention',
    ];

    occStateRepository.getSignals.mockResolvedValueOnce({
      ok: true,
      items: [
        {
          id: 'sig-low-occupancy',
          type: 'low_occupancy',
          severity: 'medium',
          status: 'open',
          confidence: 0.8,
          detected_at: '2026-03-10T10:00:00.000Z',
        },
        {
          id: 'sig-support-backlog',
          type: 'support_backlog_risk',
          severity: 'critical',
          status: 'open',
          confidence: 0.9,
          detected_at: '2026-03-09T10:00:00.000Z',
        },
        {
          id: 'sig-reactivation',
          type: 'customer_reactivation',
          severity: 'medium',
          status: 'open',
          confidence: 0.7,
          detected_at: '2026-03-10T08:00:00.000Z',
        },
        {
          id: 'sig-missed-revenue',
          type: 'missed_revenue',
          severity: 'high',
          status: 'open',
          confidence: 0.9,
          detected_at: '2026-03-10T09:00:00.000Z',
        },
        {
          id: 'sig-high-cancel',
          type: 'high_cancel_rate',
          severity: 'high',
          status: 'open',
          confidence: 0.85,
          detected_at: '2026-03-10T07:00:00.000Z',
        },
        {
          id: 'sig-channel-attention',
          type: 'channel_attention',
          severity: 'low',
          status: 'open',
          confidence: 0.4,
          detected_at: '2026-03-10T06:00:00.000Z',
        },
      ],
    });

    occStateRepository.getActivePlaybooks.mockResolvedValueOnce({ ok: true, items: [] });

    const out = await engine.listSignalDecisions({
      tenantId: 'tenant-1',
      activeOnly: true,
      limit: 20,
    });

    expect(out.ok).toBe(true);
    expect(out.total).toBe(6);
    expect(occStateRepository.getSignals).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      activeOnly: true,
      limit: 20,
      contactId: null,
      status: null,
      severity: null,
      type: null,
      from: null,
      to: null,
    });

    const returnedTypes = out.items.map((item) => item.type);
    expect(returnedTypes).toEqual(expect.arrayContaining(signalTypes));

    for (let index = 0; index < out.items.length - 1; index += 1) {
      expect(out.items[index].priorityScore).toBeGreaterThanOrEqual(out.items[index + 1].priorityScore);
    }

    expect(out.items[0]).toHaveProperty('priorityScore');
    expect(out.items[0]).toHaveProperty('decisionType');
    expect(out.items[0]).toHaveProperty('actionMode');
    expect(out.items[0]).toHaveProperty('expectedOutcome');
    expect(out.items[0]).toHaveProperty('reason');
    expect(out.items[0]).toHaveProperty('scoreBreakdown');
  });

  test('listRecommendationDecisions retorna decisões ordenadas para recomendações', async () => {
    occStateRepository.getRecommendations.mockResolvedValueOnce({
      ok: true,
      items: [
        {
          id: 'rec-1',
          type: 'missed_revenue_recovery',
          status: 'open',
          priority: 95,
          confidence: 0.9,
          impact_level: 'critical',
          created_at: '2026-03-10T10:00:00.000Z',
        },
        {
          id: 'rec-2',
          type: 'schedule_contact',
          status: 'open',
          priority: 60,
          confidence: 0.85,
          impact_level: 'medium',
          created_at: '2026-03-10T09:00:00.000Z',
        },
      ],
    });

    occStateRepository.getActivePlaybooks.mockResolvedValueOnce({
      ok: true,
      items: [{ id: 'run-1', recommendation_id: 'rec-2' }],
    });

    const out = await engine.listRecommendationDecisions({
      tenantId: 'tenant-1',
      limit: 10,
      status: 'open',
    });

    expect(out.ok).toBe(true);
    expect(out.total).toBe(2);
    expect(out.items[0].priorityScore).toBeGreaterThanOrEqual(out.items[1].priorityScore);
    expect(out.items[0]).toHaveProperty('sourceType', 'recommendation');
    expect(out.items[0]).toHaveProperty('decisionType');
    expect(out.items[0]).toHaveProperty('actionMode');
    expect(out.items[0]).toHaveProperty('expectedOutcome');
    expect(out.items[0]).toHaveProperty('scoreBreakdown');
  });
});
