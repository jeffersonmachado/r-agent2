'use strict';

const mockGetContactProfile = jest.fn();

jest.mock('../../crm', () => ({
  CRMEventService: {
    getContactProfile: (...args) => mockGetContactProfile(...args),
  },
}));

const { PlaybookRegistry } = require('../PlaybookRegistry');
const { OperationalPlaybookEngine } = require('../OperationalPlaybookEngine');

describe('OperationalPlaybookEngine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('lista playbooks sugeridos por contato', async () => {
    const registry = new PlaybookRegistry({
      playbooks: [{ id: 'pb-1', triggerSignal: 'followup_overdue', name: 'PB 1', steps: [] }],
    });
    const operationalAgentService = {
      generateContactRecommendations: jest.fn(async () => ({ ok: true })),
      listContactSignals: jest.fn(async () => ({
        ok: true,
        items: [{ id: 'sig-1', type: 'followup_overdue' }],
      })),
      listContactRecommendations: jest.fn(async () => ({
        ok: true,
        items: [{ id: 'rec-1', source_signal_id: 'sig-1' }],
      })),
    };

    const engine = new OperationalPlaybookEngine({
      registry,
      runner: {},
      operationalAgentService,
    });

    const out = await engine.listSuggestedPlaybooksForContact({
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      limit: 10,
    });

    expect(out.ok).toBe(true);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].playbook.id).toBe('pb-1');
    expect(out.items[0].signal.id).toBe('sig-1');
  });

  test('inicia execução validando contato e contexto normalizado', async () => {
    const registry = {
      getPlaybook: jest.fn(() => ({ id: 'pb-1', name: 'PB 1', steps: [] })),
    };
    const runner = {
      run: jest.fn(async () => ({ ok: true, execution: { id: 'exec-1' } })),
    };

    mockGetContactProfile.mockResolvedValueOnce({
      ok: true,
      profile: {
        contact: {
          id: 'contact-1',
          account_id: 'account-1',
          phone: '5511999999999',
        },
      },
    });

    const engine = new OperationalPlaybookEngine({
      registry,
      runner,
      operationalAgentService: {},
    });

    const out = await engine.startPlaybookExecution('pb-1', {
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      operatorId: 'agent-1',
    });

    expect(out.ok).toBe(true);
    expect(mockGetContactProfile).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      timelineLimit: 1,
    });
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({ id: 'pb-1' }), expect.objectContaining({
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      operatorId: 'agent-1',
      accountId: 'account-1',
      phoneNumber: '5511999999999',
    }));
  });

  test('executa passo específico ou próximo passo conforme ação', async () => {
    const registry = {
      getPlaybook: jest.fn(() => ({ id: 'pb-1', name: 'PB 1', steps: [] })),
    };
    const runner = {
      executeStep: jest.fn(async () => ({ ok: true })),
      nextStep: jest.fn(async () => ({ ok: true })),
    };

    const engine = new OperationalPlaybookEngine({
      registry,
      runner,
      operationalAgentService: {},
    });

    await engine.executePlaybookStep('pb-1', {
      tenantId: 'tenant-1',
      executionId: 'exec-1',
      action: 'step',
      stepId: 'step-1',
      context: { foo: 'bar' },
    });

    expect(runner.executeStep).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pb-1' }),
      'exec-1',
      'step-1',
      expect.objectContaining({ tenantId: 'tenant-1', foo: 'bar' }),
    );

    await engine.executePlaybookStep('pb-1', {
      tenantId: 'tenant-1',
      executionId: 'exec-1',
      action: 'next',
      context: { foo: 'bar' },
    });

    expect(runner.nextStep).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pb-1' }),
      'exec-1',
      expect.objectContaining({ tenantId: 'tenant-1', foo: 'bar' }),
    );
  });
});
