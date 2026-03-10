'use strict';

const mockWriteOperationalEventBestEffort = jest.fn();
const mockUpsertExecution = jest.fn();
const mockGetExecution = jest.fn();

jest.mock('../../crm/OperationalEventWriter', () => ({
  writeOperationalEventBestEffort: (...args) => mockWriteOperationalEventBestEffort(...args),
}));

const { PlaybookRunner } = require('../PlaybookRunner');

describe('PlaybookRunner', () => {
  let storeByTenant;
  let executionStore;

  beforeEach(() => {
    jest.clearAllMocks();
    storeByTenant = new Map();
    executionStore = {
      upsertExecution: (...args) => mockUpsertExecution(...args),
      getExecution: (...args) => mockGetExecution(...args),
    };

    mockUpsertExecution.mockImplementation(async ({ tenantId, execution }) => {
      const tenantKey = String(tenantId);
      const current = storeByTenant.get(tenantKey) || new Map();
      current.set(String(execution.id), execution);
      storeByTenant.set(tenantKey, current);
      return { ok: true, execution };
    });

    mockGetExecution.mockImplementation(async ({ tenantId, executionId }) => {
      const tenantKey = String(tenantId);
      const current = storeByTenant.get(tenantKey) || new Map();
      const execution = current.get(String(executionId));
      if (!execution) return { ok: false, error: 'execution_not_found' };
      return { ok: true, execution };
    });
  });

  test('inicia e executa passos até completar', async () => {
    const stepExecutor = {
      executeStep: jest.fn(async () => ({ ok: true })),
    };
    const runner = new PlaybookRunner({ stepExecutor, executionStore });
    const playbook = {
      id: 'pb-1',
      name: 'PB 1',
      steps: [
        { id: 'step-1', type: 'notify_operator', title: 'Step 1' },
        { id: 'step-2', type: 'notify_team', title: 'Step 2' },
      ],
    };

    const started = await runner.run(playbook, {
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      operatorId: 'agent-1',
    });

    expect(started.ok).toBe(true);
    expect(started.execution.status).toBe('in_progress');

    const first = await runner.nextStep(playbook, started.execution.id, { tenantId: 'tenant-1' });
    expect(first.ok).toBe(true);
    expect(first.step.id).toBe('step-1');

    const second = await runner.nextStep(playbook, started.execution.id, { tenantId: 'tenant-1' });
    expect(second.ok).toBe(true);
    expect(second.execution.status).toBe('completed');
    expect(stepExecutor.executeStep).toHaveBeenCalledTimes(2);

    const eventTypes = mockWriteOperationalEventBestEffort.mock.calls.map((call) => call[0]?.type);
    expect(eventTypes).toContain('operational_playbook_started');
    expect(eventTypes).toContain('operational_playbook_step_executed');
    expect(eventTypes).toContain('operational_playbook_completed');
  });

  test('aborta execução quando passo falha', async () => {
    const stepExecutor = {
      executeStep: jest.fn(async () => {
        throw new Error('step_failed');
      }),
    };
    const runner = new PlaybookRunner({ stepExecutor, executionStore });
    const playbook = {
      id: 'pb-err',
      name: 'PB Error',
      steps: [{ id: 'step-1', type: 'create_task', title: 'Step 1' }],
    };

    const started = await runner.run(playbook, {
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      operatorId: 'agent-1',
    });

    const out = await runner.nextStep(playbook, started.execution.id, { tenantId: 'tenant-1' });

    expect(out.ok).toBe(false);
    expect(out.execution.status).toBe('aborted');
    expect(out.error).toBe('step_failed');

    const eventTypes = mockWriteOperationalEventBestEffort.mock.calls.map((call) => call[0]?.type);
    expect(eventTypes).toContain('operational_playbook_aborted');
  });

  test('reexecuta passo com retry até sucesso', async () => {
    const stepExecutor = {
      executeStep: jest
        .fn()
        .mockRejectedValueOnce(new Error('temporary_error'))
        .mockResolvedValueOnce({ ok: true, retried: true }),
    };

    const runner = new PlaybookRunner({ stepExecutor, executionStore });
    const playbook = {
      id: 'pb-retry',
      name: 'PB Retry',
      steps: [{ id: 'step-1', type: 'create_task', title: 'Step Retry', maxAttempts: 2 }],
    };

    const started = await runner.run(playbook, {
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      operatorId: 'agent-1',
    });

    const out = await runner.nextStep(playbook, started.execution.id, { tenantId: 'tenant-1' });
    expect(out.ok).toBe(true);
    expect(out.execution.status).toBe('completed');
    expect(out.step.attempts).toBe(2);
    expect(stepExecutor.executeStep).toHaveBeenCalledTimes(2);
  });

  test('aplica branching simples em falha com nextOnFailure', async () => {
    const stepExecutor = {
      executeStep: jest.fn(async (step) => {
        if (step.id === 'step-1') throw new Error('branch_me');
        return { ok: true };
      }),
    };

    const runner = new PlaybookRunner({ stepExecutor, executionStore });
    const playbook = {
      id: 'pb-branch',
      name: 'PB Branch',
      steps: [
        { id: 'step-1', type: 'create_task', title: 'Step 1', nextOnFailure: 'step-2' },
        { id: 'step-2', type: 'notify_operator', title: 'Secondary Step' },
      ],
    };

    const started = await runner.run(playbook, {
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      operatorId: 'agent-1',
    });

    const first = await runner.nextStep(playbook, started.execution.id, { tenantId: 'tenant-1' });
    expect(first.ok).toBe(true);
    expect(first.branchedOnFailure).toBe(true);
    expect(first.execution.status).toBe('in_progress');

    const second = await runner.nextStep(playbook, started.execution.id, { tenantId: 'tenant-1' });
    expect(second.ok).toBe(true);
    expect(second.execution.status).toBe('completed');
  });

  test('aborta passo quando timeout é excedido', async () => {
    const stepExecutor = {
      executeStep: jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return { ok: true };
      }),
    };

    const runner = new PlaybookRunner({ stepExecutor, executionStore });
    const playbook = {
      id: 'pb-timeout',
      name: 'PB Timeout',
      steps: [{ id: 'step-1', type: 'notify_operator', timeoutMs: 10 }],
    };

    const started = await runner.run(playbook, {
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      operatorId: 'agent-1',
    });

    const out = await runner.nextStep(playbook, started.execution.id, { tenantId: 'tenant-1' });
    expect(out.ok).toBe(false);
    expect(out.error).toBe('step_timeout');
    expect(out.execution.status).toBe('aborted');
  });

  test('emite referência canônica de run em eventos operacionais', async () => {
    const stepExecutor = {
      executeStep: jest.fn(async () => ({ ok: true })),
    };

    const runner = new PlaybookRunner({ stepExecutor, executionStore });
    const playbook = {
      id: 'pb-canonical-run',
      name: 'PB Canonical Run',
      steps: [{ id: 'step-1', type: 'notify_operator', title: 'Step 1' }],
    };

    const started = await runner.run(playbook, {
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      operatorId: 'agent-1',
    });

    expect(started.ok).toBe(true);

    const startedEvent = mockWriteOperationalEventBestEffort.mock.calls
      .map((call) => call[0])
      .find((event) => event?.type === 'operational_playbook_started');

    expect(startedEvent).toEqual(expect.objectContaining({
      referenceType: 'operational_playbook_run',
      referenceId: started.execution.id,
      payload: expect.objectContaining({
        playbookRunId: started.execution.id,
        playbookExecutionId: started.execution.id,
      }),
    }));
  });
});
