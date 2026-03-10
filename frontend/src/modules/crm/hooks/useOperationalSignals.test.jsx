import React from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useOperationalSignals } from './useOperationalSignals';

const getCrmContactOperationalSignalsMock = vi.fn();
const getOccTenantOperationalSignalsMock = vi.fn();
const generateOccTenantOperationalSignalsMock = vi.fn();
const updateOccTenantOperationalSignalStatusMock = vi.fn();

vi.mock('../../../api/crm', () => ({
  getCrmContactOperationalSignals: (...args) => getCrmContactOperationalSignalsMock(...args),
}));

vi.mock('../../../api/superAdmin', () => ({
  getOccTenantOperationalSignals: (...args) => getOccTenantOperationalSignalsMock(...args),
  generateOccTenantOperationalSignals: (...args) => generateOccTenantOperationalSignalsMock(...args),
  updateOccTenantOperationalSignalStatus: (...args) => updateOccTenantOperationalSignalStatusMock(...args),
}));

function Probe({
  tenantId = '',
  contactId = '',
  scope = 'contact',
  enabled = true,
}) {
  const state = useOperationalSignals({ tenantId, contactId, scope, enabled, limit: 10, activeOnly: true });
  return (
    <div>
      <span data-testid="loading">{state.loading ? 'true' : 'false'}</span>
      <span data-testid="count">{state.items.length}</span>
      <span data-testid="error">{state.error || ''}</span>
      <button type="button" onClick={() => state.generate()}>generate</button>
      <button type="button" onClick={() => state.updateStatus('sig-1', 'acknowledged')}>status</button>
    </div>
  );
}

describe('useOperationalSignals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('não consulta API quando desabilitado', async () => {
    render(<Probe contactId="contact-1" enabled={false} />);

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
    expect(getCrmContactOperationalSignalsMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  test('consulta sinais por contato', async () => {
    getCrmContactOperationalSignalsMock.mockResolvedValueOnce({
      ok: true,
      items: [{ id: 'sig-1', type: 'followup_overdue', status: 'open' }],
    });

    render(<Probe contactId="contact-1" scope="contact" enabled />);

    await waitFor(() => {
      expect(getCrmContactOperationalSignalsMock).toHaveBeenCalledWith('contact-1', { activeOnly: true, limit: 10 });
      expect(screen.getByTestId('count').textContent).toBe('1');
    });
  });

  test('executa generate/update no escopo tenant', async () => {
    getOccTenantOperationalSignalsMock.mockResolvedValue({ ok: true, items: [{ id: 'sig-1', status: 'open' }] });
    generateOccTenantOperationalSignalsMock.mockResolvedValue({ ok: true });
    updateOccTenantOperationalSignalStatusMock.mockResolvedValue({ ok: true });

    render(<Probe tenantId="tenant-1" scope="tenant" enabled />);

    await waitFor(() => {
      expect(getOccTenantOperationalSignalsMock).toHaveBeenCalledWith('tenant-1', { activeOnly: true, limit: 10 });
    });

    fireEvent.click(screen.getByText('generate'));
    await waitFor(() => {
      expect(generateOccTenantOperationalSignalsMock).toHaveBeenCalledWith('tenant-1', { contactId: null });
    });

    fireEvent.click(screen.getByText('status'));
    await waitFor(() => {
      expect(updateOccTenantOperationalSignalStatusMock).toHaveBeenCalledWith('tenant-1', 'sig-1', 'acknowledged');
    });
  });
});
