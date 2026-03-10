import React from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useOperationalRecommendations } from './useOperationalRecommendations';

const getCrmContactOperationalRecommendationsMock = vi.fn();
const getOccTenantOperationalRecommendationsMock = vi.fn();
const generateOccTenantOperationalRecommendationsMock = vi.fn();
const updateOccTenantOperationalRecommendationStatusMock = vi.fn();

vi.mock('../../../api/crm', () => ({
  getCrmContactOperationalRecommendations: (...args) => getCrmContactOperationalRecommendationsMock(...args),
}));

vi.mock('../../../api/superAdmin', () => ({
  getOccTenantOperationalRecommendations: (...args) => getOccTenantOperationalRecommendationsMock(...args),
  generateOccTenantOperationalRecommendations: (...args) => generateOccTenantOperationalRecommendationsMock(...args),
  updateOccTenantOperationalRecommendationStatus: (...args) => updateOccTenantOperationalRecommendationStatusMock(...args),
}));

function Probe({
  tenantId = '',
  contactId = '',
  scope = 'contact',
  enabled = true,
}) {
  const state = useOperationalRecommendations({ tenantId, contactId, scope, enabled, limit: 10 });
  return (
    <div>
      <span data-testid="loading">{state.loading ? 'true' : 'false'}</span>
      <span data-testid="count">{state.items.length}</span>
      <span data-testid="error">{state.error || ''}</span>
      <button type="button" onClick={() => state.generate()}>generate</button>
      <button type="button" onClick={() => state.updateStatus('rec-1', 'accepted')}>status</button>
    </div>
  );
}

describe('useOperationalRecommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('não consulta API quando desabilitado', async () => {
    render(<Probe contactId="contact-1" enabled={false} />);

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
    expect(getCrmContactOperationalRecommendationsMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  test('consulta recomendações por contato', async () => {
    getCrmContactOperationalRecommendationsMock.mockResolvedValueOnce({
      ok: true,
      items: [{ id: 'rec-1', type: 'operational_followup_overdue', status: 'open' }],
    });

    render(<Probe contactId="contact-1" scope="contact" enabled />);

    await waitFor(() => {
      expect(getCrmContactOperationalRecommendationsMock).toHaveBeenCalledWith('contact-1', { limit: 10 });
      expect(screen.getByTestId('count').textContent).toBe('1');
    });
  });

  test('executa generate/update no escopo tenant', async () => {
    getOccTenantOperationalRecommendationsMock.mockResolvedValue({ ok: true, items: [{ id: 'rec-1', status: 'open' }] });
    generateOccTenantOperationalRecommendationsMock.mockResolvedValue({ ok: true });
    updateOccTenantOperationalRecommendationStatusMock.mockResolvedValue({ ok: true });

    render(<Probe tenantId="tenant-1" scope="tenant" enabled />);

    await waitFor(() => {
      expect(getOccTenantOperationalRecommendationsMock).toHaveBeenCalledWith('tenant-1', { limit: 10 });
    });

    fireEvent.click(screen.getByText('generate'));
    await waitFor(() => {
      expect(generateOccTenantOperationalRecommendationsMock).toHaveBeenCalledWith('tenant-1', { contactId: null });
    });

    fireEvent.click(screen.getByText('status'));
    await waitFor(() => {
      expect(updateOccTenantOperationalRecommendationStatusMock).toHaveBeenCalledWith('tenant-1', 'rec-1', 'accepted');
    });
  });
});
