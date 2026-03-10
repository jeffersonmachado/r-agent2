import { describe, expect, test, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useQuickActions } from '../useQuickActions';

const listQuickActionsForSignalMock = vi.fn();
const executeQuickActionForSignalMock = vi.fn();
const listQuickActionsForRecommendationMock = vi.fn();
const executeQuickActionForRecommendationMock = vi.fn();

const listContactQuickActionsForSignalMock = vi.fn();
const executeContactQuickActionForSignalMock = vi.fn();
const listContactQuickActionsForRecommendationMock = vi.fn();
const executeContactQuickActionForRecommendationMock = vi.fn();

vi.mock('../../../../api/superAdmin', () => ({
  listQuickActionsForSignal: (...args) => listQuickActionsForSignalMock(...args),
  executeQuickActionForSignal: (...args) => executeQuickActionForSignalMock(...args),
  listQuickActionsForRecommendation: (...args) => listQuickActionsForRecommendationMock(...args),
  executeQuickActionForRecommendation: (...args) => executeQuickActionForRecommendationMock(...args),
}));

vi.mock('../../../../api/crm', () => ({
  listContactQuickActionsForSignal: (...args) => listContactQuickActionsForSignalMock(...args),
  executeContactQuickActionForSignal: (...args) => executeContactQuickActionForSignalMock(...args),
  listContactQuickActionsForRecommendation: (...args) => listContactQuickActionsForRecommendationMock(...args),
  executeContactQuickActionForRecommendation: (...args) => executeContactQuickActionForRecommendationMock(...args),
}));

describe('useQuickActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('uses admin endpoint in OCC context', async () => {
    listQuickActionsForSignalMock.mockResolvedValue({
      ok: true,
      items: [{ id: 'open_followup' }],
    });

    const { result } = renderHook(() => useQuickActions({
      scope: 'admin',
      tenantId: 'tenant-1',
      sourceType: 'signal',
      sourceId: 'sig-1',
      enabled: true,
    }));

    await act(async () => {
      await result.current.loadActions();
    });

    expect(listQuickActionsForSignalMock).toHaveBeenCalledWith({ tenantId: 'tenant-1', signalId: 'sig-1' });
    expect(listContactQuickActionsForSignalMock).not.toHaveBeenCalled();
    expect(result.current.actions).toHaveLength(1);
  });

  test('uses contact endpoint in support context', async () => {
    listContactQuickActionsForRecommendationMock.mockResolvedValue({
      ok: true,
      items: [{ id: 'notify_operator' }],
    });

    const { result } = renderHook(() => useQuickActions({
      scope: 'contact',
      contactId: 'contact-1',
      sourceType: 'recommendation',
      sourceId: 'rec-1',
      enabled: true,
    }));

    await act(async () => {
      await result.current.loadActions();
    });

    expect(listContactQuickActionsForRecommendationMock).toHaveBeenCalledWith({
      contactId: 'contact-1',
      recommendationId: 'rec-1',
    });
    expect(listQuickActionsForRecommendationMock).not.toHaveBeenCalled();
    expect(result.current.actions).toHaveLength(1);
  });

  test('does not require tenantId in contact scope', async () => {
    listContactQuickActionsForSignalMock.mockResolvedValue({ ok: true, items: [{ id: 'open_followup' }] });

    const { result } = renderHook(() => useQuickActions({
      scope: 'contact',
      contactId: 'contact-1',
      tenantId: '',
      sourceType: 'signal',
      sourceId: 'sig-1',
    }));

    await act(async () => {
      await result.current.loadActions();
    });

    expect(result.current.actions).toHaveLength(1);
    expect(result.current.error).toBe('');
  });

  test('handles 403/404/422-style API failures gracefully', async () => {
    executeQuickActionForSignalMock.mockResolvedValue({
      ok: false,
      error: { code: 'action_not_valid_for_source', message: 'Quick action inválida para este sinal/recomendação' },
    });

    const { result } = renderHook(() => useQuickActions({
      scope: 'admin',
      tenantId: 'tenant-1',
      sourceType: 'signal',
      sourceId: 'sig-1',
    }));

    const out = await act(async () => result.current.executeAction('notify_supervisor', {}));

    expect(out.ok).toBe(false);
    expect(String(out.error || '')).toContain('Quick action inválida');
  });

  test('executes on contact scoped signal endpoint', async () => {
    executeContactQuickActionForSignalMock.mockResolvedValue({
      ok: true,
      result: { id: 'x' },
    });

    const { result } = renderHook(() => useQuickActions({
      scope: 'contact',
      contactId: 'contact-1',
      sourceType: 'signal',
      sourceId: 'sig-1',
    }));

    const out = await act(async () => result.current.executeAction('open_followup', { note: 'ok' }));

    expect(out.ok).toBe(true);
    expect(executeContactQuickActionForSignalMock).toHaveBeenCalledWith({
      contactId: 'contact-1',
      signalId: 'sig-1',
      actionId: 'open_followup',
      input: { note: 'ok' },
    });
  });

  test('propaga supportContext para endpoints contact-scoped', async () => {
    listContactQuickActionsForSignalMock.mockResolvedValue({ ok: true, items: [{ id: 'open_followup' }] });
    executeContactQuickActionForSignalMock.mockResolvedValue({ ok: true, result: { id: 'ok' } });

    const supportContext = { ticketId: 'ticket-1', queueId: 'support-l2' };
    const { result } = renderHook(() => useQuickActions({
      scope: 'contact',
      contactId: 'contact-1',
      sourceType: 'signal',
      sourceId: 'sig-1',
      supportContext,
      enabled: true,
    }));

    await act(async () => {
      await result.current.loadActions();
    });

    await act(async () => {
      await result.current.executeAction('open_followup', { note: 'ok' });
    });

    expect(listContactQuickActionsForSignalMock).toHaveBeenCalledWith({
      contactId: 'contact-1',
      signalId: 'sig-1',
      supportContext,
    });
    expect(executeContactQuickActionForSignalMock).toHaveBeenCalledWith({
      contactId: 'contact-1',
      signalId: 'sig-1',
      actionId: 'open_followup',
      input: { note: 'ok' },
      supportContext,
    });
  });

  test('keeps backend as source of truth for action availability', async () => {
    listQuickActionsForRecommendationMock.mockResolvedValue({
      ok: true,
      items: [
        { id: 'assign_team', allowedSources: ['different_type'] },
      ],
    });

    const { result } = renderHook(() => useQuickActions({
      scope: 'admin',
      tenantId: 'tenant-1',
      sourceType: 'recommendation',
      sourceId: 'rec-1',
    }));

    await act(async () => {
      await result.current.loadActions();
    });

    expect(result.current.actions.map((item) => item.id)).toEqual(['assign_team']);
  });

  test('resets actions when scope requirements are missing', async () => {
    const { result, rerender } = renderHook((props) => useQuickActions(props), {
      initialProps: {
        scope: 'admin',
        tenantId: 'tenant-1',
        sourceType: 'signal',
        sourceId: 'sig-1',
      },
    });

    listQuickActionsForSignalMock.mockResolvedValue({ ok: true, items: [{ id: 'open_followup' }] });
    await act(async () => {
      await result.current.loadActions();
    });

    expect(result.current.actions).toHaveLength(1);

    rerender({
      scope: 'contact',
      contactId: '',
      sourceType: 'signal',
      sourceId: 'sig-1',
    });

    await act(async () => {
      await result.current.loadActions();
    });

    await waitFor(() => {
      expect(result.current.actions).toEqual([]);
    });
  });
});
