import React from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { usePlaybooks } from './usePlaybooks';

const getCrmContactPlaybooksMock = vi.fn();
const listOperationalPlaybooksAdminMock = vi.fn();

vi.mock('../../../api/crm', () => ({
  getCrmContactPlaybooks: (...args) => getCrmContactPlaybooksMock(...args),
}));

vi.mock('../../../api/superAdmin', () => ({
  listOperationalPlaybooksAdmin: (...args) => listOperationalPlaybooksAdminMock(...args),
}));

function Probe({ tenantId = '', contactId = '', scope = 'contact', enabled = true }) {
  const state = usePlaybooks({ tenantId, contactId, scope, enabled, limit: 10 });

  return (
    <div>
      <span data-testid="loading">{state.loading ? 'true' : 'false'}</span>
      <span data-testid="count">{state.items.length}</span>
      <span data-testid="error">{state.error || ''}</span>
      <button type="button" onClick={() => state.reload()}>reload</button>
    </div>
  );
}

describe('usePlaybooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('não consulta API quando desabilitado', async () => {
    render(<Probe contactId="contact-1" enabled={false} />);

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(getCrmContactPlaybooksMock).not.toHaveBeenCalled();
    expect(listOperationalPlaybooksAdminMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  test('consulta sugestões por contato no escopo contact', async () => {
    getCrmContactPlaybooksMock.mockResolvedValueOnce({
      ok: true,
      items: [{ playbook: { id: 'pb-1', name: 'Playbook 1' }, signal: { type: 'followup_overdue' } }],
    });

    render(<Probe contactId="contact-1" scope="contact" enabled />);

    await waitFor(() => {
      expect(getCrmContactPlaybooksMock).toHaveBeenCalledWith('contact-1', { limit: 10 });
      expect(screen.getByTestId('count').textContent).toBe('1');
    });
  });

  test('consulta catálogo no escopo tenant e permite reload', async () => {
    listOperationalPlaybooksAdminMock.mockResolvedValue({
      ok: true,
      items: [{ id: 'pb-tenant-1', name: 'Tenant Playbook', triggerSignal: 'support_backlog_risk', steps: [] }],
    });

    render(<Probe tenantId="tenant-1" scope="tenant" enabled />);

    await waitFor(() => {
      expect(listOperationalPlaybooksAdminMock).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        contactId: undefined,
        signalType: undefined,
        limit: 10,
      });
      expect(screen.getByTestId('count').textContent).toBe('1');
    });

    fireEvent.click(screen.getByText('reload'));
    await waitFor(() => {
      expect(listOperationalPlaybooksAdminMock).toHaveBeenCalledTimes(2);
    });
  });
});
