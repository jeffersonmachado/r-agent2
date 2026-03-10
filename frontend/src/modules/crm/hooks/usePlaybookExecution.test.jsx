import React from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { usePlaybookExecution } from './usePlaybookExecution';

const executeOperationalPlaybookAdminMock = vi.fn();
const stepOperationalPlaybookAdminMock = vi.fn();

vi.mock('../../../api/superAdmin', () => ({
  executeOperationalPlaybookAdmin: (...args) => executeOperationalPlaybookAdminMock(...args),
  stepOperationalPlaybookAdmin: (...args) => stepOperationalPlaybookAdminMock(...args),
}));

function Probe() {
  const state = usePlaybookExecution();

  return (
    <div>
      <span data-testid="loading">{state.loading ? 'true' : 'false'}</span>
      <span data-testid="error">{state.error || ''}</span>
      <span data-testid="execution-id">{state.execution?.id || ''}</span>
      <button
        type="button"
        onClick={() => state.startExecution({
          playbookId: 'pb-1',
          tenantId: 'tenant-1',
          contactId: 'contact-1',
        })}
      >
        start
      </button>
      <button
        type="button"
        onClick={() => state.runNextStep({
          playbookId: 'pb-1',
          tenantId: 'tenant-1',
          executionId: state.execution?.id || 'exec-1',
        })}
      >
        next
      </button>
      <button
        type="button"
        onClick={() => state.runStep({
          playbookId: 'pb-1',
          tenantId: 'tenant-1',
          executionId: state.execution?.id || 'exec-1',
          stepId: 'step-1',
        })}
      >
        step
      </button>
      <button type="button" onClick={() => state.reset()}>reset</button>
    </div>
  );
}

describe('usePlaybookExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('inicia execução e atualiza estado', async () => {
    executeOperationalPlaybookAdminMock.mockResolvedValueOnce({
      ok: true,
      execution: {
        id: 'exec-1',
        status: 'in_progress',
        steps: [],
      },
    });

    render(<Probe />);
    fireEvent.click(screen.getByText('start'));

    await waitFor(() => {
      expect(executeOperationalPlaybookAdminMock).toHaveBeenCalledWith('pb-1', expect.objectContaining({
        tenantId: 'tenant-1',
        contactId: 'contact-1',
      }));
      expect(screen.getByTestId('execution-id').textContent).toBe('exec-1');
      expect(screen.getByTestId('error').textContent).toBe('');
    });
  });

  test('executa próximo passo e passo específico', async () => {
    executeOperationalPlaybookAdminMock.mockResolvedValueOnce({
      ok: true,
      execution: { id: 'exec-1', status: 'in_progress', steps: [] },
    });
    stepOperationalPlaybookAdminMock
      .mockResolvedValueOnce({ ok: true, execution: { id: 'exec-1', status: 'in_progress', steps: [] } })
      .mockResolvedValueOnce({ ok: true, execution: { id: 'exec-1', status: 'completed', steps: [] } });

    render(<Probe />);
    fireEvent.click(screen.getByText('start'));

    await waitFor(() => {
      expect(screen.getByTestId('execution-id').textContent).toBe('exec-1');
    });

    fireEvent.click(screen.getByText('next'));
    await waitFor(() => {
      expect(stepOperationalPlaybookAdminMock).toHaveBeenCalledWith('pb-1', expect.objectContaining({
        action: 'next',
        executionId: 'exec-1',
      }));
    });

    fireEvent.click(screen.getByText('step'));
    await waitFor(() => {
      expect(stepOperationalPlaybookAdminMock).toHaveBeenCalledWith('pb-1', expect.objectContaining({
        action: 'step',
        stepId: 'step-1',
      }));
    });
  });

  test('expõe erro quando execução falha', async () => {
    executeOperationalPlaybookAdminMock.mockResolvedValueOnce({ ok: false, error: 'playbook_execution_failed' });

    render(<Probe />);
    fireEvent.click(screen.getByText('start'));

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('playbook_execution_failed');
    });

    fireEvent.click(screen.getByText('reset'));
    expect(screen.getByTestId('error').textContent).toBe('');
  });
});
