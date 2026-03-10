import React from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QuickActionsBar } from '../QuickActionsBar';

const useQuickActionsMock = vi.fn();

vi.mock('../../hooks/useQuickActions', () => ({
  useQuickActions: (...args) => useQuickActionsMock(...args),
}));

vi.mock('../QuickActionButton', () => ({
  QuickActionButton: ({ action, onExecute, disabled }) => (
    <button type="button" onClick={onExecute} disabled={disabled}>{action.label}</button>
  ),
}));

vi.mock('../QuickActionDialog', () => ({
  QuickActionDialog: ({ isOpen }) => (isOpen ? <div data-testid="quick-action-dialog" /> : null),
}));

describe('QuickActionsBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQuickActionsMock.mockReturnValue({
      actions: [{ id: 'open_followup', label: 'Abrir follow-up', confirmationRequired: false }],
      loading: false,
      executing: null,
      error: '',
      loadActions: vi.fn(),
      executeAction: vi.fn().mockResolvedValue({ ok: true, result: { id: 'r1' } }),
    });
  });

  test('passes scope and contact context to hook', () => {
    render(
      <QuickActionsBar
        scope="contact"
        tenantId="tenant-1"
        contactId="contact-1"
        sourceType="signal"
        sourceId="sig-1"
      />
    );

    expect(useQuickActionsMock).toHaveBeenCalledWith({
      scope: 'contact',
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      sourceType: 'signal',
      sourceId: 'sig-1',
      enabled: true,
    });
  });

  test('passes supportContext when provided', () => {
    render(
      <QuickActionsBar
        scope="contact"
        tenantId="tenant-1"
        contactId="contact-1"
        sourceType="signal"
        sourceId="sig-1"
        supportContext={{ ticketId: 'ticket-1', queueId: 'support-l2' }}
      />
    );

    expect(useQuickActionsMock).toHaveBeenCalledWith({
      scope: 'contact',
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      supportContext: { ticketId: 'ticket-1', queueId: 'support-l2' },
      sourceType: 'signal',
      sourceId: 'sig-1',
      enabled: true,
    });
  });

  test('does not frontend-filter action availability', () => {
    useQuickActionsMock.mockReturnValue({
      actions: [
        { id: 'assign_team', label: 'Atribuir ao time', allowedSources: ['another_type'], confirmationRequired: false },
      ],
      loading: false,
      executing: null,
      error: '',
      loadActions: vi.fn(),
      executeAction: vi.fn().mockResolvedValue({ ok: true, result: {} }),
    });

    render(
      <QuickActionsBar
        scope="admin"
        tenantId="tenant-1"
        sourceType="signal"
        sourceId="sig-1"
        sourceObject={{ id: 'sig-1', type: 'customer_reactivation' }}
      />
    );

    expect(screen.getByText('Atribuir ao time')).toBeTruthy();
  });

  test('executes selected quick action', async () => {
    const executeAction = vi.fn().mockResolvedValue({ ok: true, result: { id: 'ok' } });
    useQuickActionsMock.mockReturnValue({
      actions: [{ id: 'open_followup', label: 'Abrir follow-up', confirmationRequired: false }],
      loading: false,
      executing: null,
      error: '',
      loadActions: vi.fn(),
      executeAction,
    });

    render(
      <QuickActionsBar
        scope="admin"
        tenantId="tenant-1"
        sourceType="signal"
        sourceId="sig-1"
      />
    );

    fireEvent.click(screen.getByText('Abrir follow-up'));

    await waitFor(() => {
      expect(executeAction).toHaveBeenCalledWith('open_followup', {});
    });
  });

  test('returns null when scope is incomplete', () => {
    const { container } = render(
      <QuickActionsBar
        scope="contact"
        contactId=""
        sourceType="signal"
        sourceId="sig-1"
      />
    );

    expect(container.innerHTML).toBe('');
  });
});
