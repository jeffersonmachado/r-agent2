import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VerticalOperationalDashboardPage } from './VerticalOperationalDashboardPage';
import { getFitnessDashboard, getBeautyDashboard } from '../api/verticalOperations';

vi.mock('../api/verticalOperations', () => ({
  getFitnessDashboard: vi.fn().mockResolvedValue({ kpis: {} }),
  getBeautyDashboard: vi.fn().mockResolvedValue({ kpis: {} }),
  getFitnessIntelligence: vi.fn().mockResolvedValue(null),
  getBeautyIntelligence: vi.fn().mockResolvedValue(null),
}));

const wsRegistrations = [];
vi.mock('../context/WebSocketContext', () => ({
  useWebSocketContext: (options) => {
    wsRegistrations.push(options);
    return {
      connected: true,
      authenticated: true,
      authFailed: false,
      send: vi.fn(),
      reconnect: vi.fn(),
    };
  },
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({
    showToast: vi.fn(),
    ToastContainer: () => null,
  }),
}));

describe('VerticalOperationalDashboardPage', () => {
  it('renderiza badges das verticais resolvidas para super-admin', () => {
    render(
      <VerticalOperationalDashboardPage
        workspaceKeys={['beauty', 'fitness', 'ecommerce']}
        isSuperAdmin={true}
      />,
    );

    expect(screen.getByText('Modo Super Admin')).toBeInTheDocument();
    const badgesContainer = screen.getByText('Modo Super Admin').nextElementSibling;
    expect(badgesContainer).not.toBeNull();
    expect(within(badgesContainer).getByText('Beleza')).toBeInTheDocument();
    expect(within(badgesContainer).getByText('Fitness')).toBeInTheDocument();
    expect(within(badgesContainer).getByText('Comércio Eletrônico')).toBeInTheDocument();
  });

  it('esconde cards nao relevantes para a vertical efetiva', () => {
    render(
      <VerticalOperationalDashboardPage
        workspaceKeys={['ecommerce']}
        isSuperAdmin={false}
      />,
    );

    expect(screen.getByText('Vertical efetiva')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Beauty' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Fitness' })).not.toBeInTheDocument();
  });

  it('subscreve os 4 eventos verticais e refaz o fetch quando um evento chega', async () => {
    wsRegistrations.length = 0;
    getFitnessDashboard.mockClear();
    getBeautyDashboard.mockClear();

    render(<VerticalOperationalDashboardPage workspaceKeys={[]} isSuperAdmin={true} />);

    await waitFor(() => expect(getFitnessDashboard).toHaveBeenCalledTimes(1));
    expect(getBeautyDashboard).toHaveBeenCalledTimes(1);

    const registration = wsRegistrations[wsRegistrations.length - 1];
    expect(registration.subscribeEvents).toEqual([
      'vertical.attendance.updated',
      'vertical.schedule.updated',
      'vertical.bundles.updated',
      'vertical.memberships.updated',
    ]);

    act(() => registration.onEvent('vertical.attendance.updated'));
    await waitFor(() => expect(getFitnessDashboard).toHaveBeenCalledTimes(2));

    // Evento fora da lista não dispara refetch
    act(() => registration.onEvent('ticket.updated'));
    expect(getFitnessDashboard).toHaveBeenCalledTimes(2);
  });
});