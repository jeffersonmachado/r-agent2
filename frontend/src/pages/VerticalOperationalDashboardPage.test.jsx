import React from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VerticalOperationalDashboardPage } from './VerticalOperationalDashboardPage';
import { getFitnessDashboard, getBeautyDashboard, getClinicDashboard, getFoodDashboard, getServicesDashboard, getMarketDashboard, getBakeryDashboard, getFitnessIntelligence, getBeautyIntelligence, getClinicRecall } from '../api/verticalOperations';

vi.mock('../api/verticalOperations', () => ({
  getFitnessDashboard: vi.fn(),
  getBeautyDashboard: vi.fn(),
  getClinicDashboard: vi.fn(),
  getFoodDashboard: vi.fn(),
  getServicesDashboard: vi.fn(),
  getMarketDashboard: vi.fn(),
  getBakeryDashboard: vi.fn(),
  getFitnessIntelligence: vi.fn(),
  getBeautyIntelligence: vi.fn(),
  getClinicRecall: vi.fn(),
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
  // resetMocks: true no vitest.config — rearmar implementações a cada teste
  beforeEach(() => {
    getFitnessDashboard.mockResolvedValue({ kpis: {} });
    getBeautyDashboard.mockResolvedValue({ kpis: {} });
    getClinicDashboard.mockResolvedValue({ kpis: { consultationsToday: 3, noShowRiskPatients: 1, recallsSent: 2, revenue: 450 } });
    getFoodDashboard.mockResolvedValue({ kpis: { ordersInFlight: 4, ordersDeliveredToday: 9, ordersCancelledToday: 1, slaDeliverBreached: 0, reviewsRequested: 7, reorderCampaignsSent: 2, revenue: 1230.5 } });
    getServicesDashboard.mockResolvedValue({ kpis: { quotesPending: 3, quotesApproved: 2, approvalRate: 0.4, avgDecisionDays: 2.5, approvedAmount: 1800, revenue: 2350 } });
    getMarketDashboard.mockResolvedValue({ kpis: { ordersDeliveredToday: 5, ordersInFlight: 2, customersWithPurchases: 18, repeatCustomers: 6, repeatRate: 0.333, restockRemindersSent: 4, loyaltyCampaignsSent: 2, revenue: 4120.75 } });
    getBakeryDashboard.mockResolvedValue({ kpis: { productsWithForecast: 4, producedQty: 120, soldQty: 108, leftoverQty: 12, stockouts: 1, forecastMape: 0.12 } });
    getFitnessIntelligence.mockResolvedValue(null);
    getBeautyIntelligence.mockResolvedValue(null);
    getClinicRecall.mockResolvedValue({ suggestion: 'send_recall' });
  });

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
    expect(screen.queryByRole('heading', { name: 'Clínica' })).not.toBeInTheDocument();
  });

  it('exibe o card de Clínica com KPIs para a vertical saude', async () => {
    render(
      <VerticalOperationalDashboardPage
        workspaceKeys={['saude']}
        isSuperAdmin={false}
      />,
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Clínica' })).toBeInTheDocument());
    expect(screen.getByText('Consultas hoje:')).toBeInTheDocument();
    expect(screen.getByText('Risco de falta:')).toBeInTheDocument();
    expect(screen.getByText('Recalls enviados:')).toBeInTheDocument();
    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Beauty' })).not.toBeInTheDocument();
  });

  it('exibe o card de Alimentação com KPIs de pedidos para a vertical food', async () => {
    render(
      <VerticalOperationalDashboardPage
        workspaceKeys={['food']}
        isSuperAdmin={false}
      />,
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Alimentação' })).toBeInTheDocument());
    expect(screen.getByText('Pedidos em andamento:')).toBeInTheDocument();
    expect(screen.getByText('Entregues hoje:')).toBeInTheDocument();
    expect(screen.getByText('Avaliações solicitadas:')).toBeInTheDocument();
    expect(screen.getByText('Campanhas de recompra:')).toBeInTheDocument();
    expect(await screen.findByText('9')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Beauty' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Fitness' })).not.toBeInTheDocument();
  });

  it('infere workspace food para tenant com vertical restaurante', async () => {
    const { inferWorkspaceKeyFromTenantProfile } = await import('../navigation/menu');
    const key = inferWorkspaceKeyFromTenantProfile({ tenant: { settings: { vertical: 'restaurante' } } });
    expect(key).toBe('food');
  });

  it('exibe o card de Varejo com KPIs de compra, reposição e fidelização', async () => {
    render(
      <VerticalOperationalDashboardPage
        workspaceKeys={['varejo']}
        isSuperAdmin={false}
      />,
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Varejo' })).toBeInTheDocument());
    expect(screen.getByText('Pedidos entregues hoje:')).toBeInTheDocument();
    expect(screen.getByText('Clientes com compras:')).toBeInTheDocument();
    expect(screen.getByText('Taxa de recompra:')).toBeInTheDocument();
    expect(screen.getByText('Lembretes de reposição:')).toBeInTheDocument();
    expect(screen.getByText('Campanhas de fidelização:')).toBeInTheDocument();
    expect(await screen.findByText('18')).toBeInTheDocument();
    expect(await screen.findByText('33%')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Serviços' })).not.toBeInTheDocument();
  });

  it('exibe o card de Varejo também para workspace ecommerce', async () => {
    render(
      <VerticalOperationalDashboardPage
        workspaceKeys={['ecommerce']}
        isSuperAdmin={false}
      />,
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Varejo' })).toBeInTheDocument());
  });

  it('exibe o card de Padaria com KPIs do loop previsão→produção', async () => {
    render(
      <VerticalOperationalDashboardPage
        workspaceKeys={['padaria']}
        isSuperAdmin={false}
      />,
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Padaria' })).toBeInTheDocument());
    expect(screen.getByText('Produtos com previsão:')).toBeInTheDocument();
    expect(screen.getByText('Produzido hoje:')).toBeInTheDocument();
    expect(screen.getByText('Vendido hoje:')).toBeInTheDocument();
    expect(screen.getByText('Sobra:')).toBeInTheDocument();
    expect(screen.getByText('Rupturas:')).toBeInTheDocument();
    expect(screen.getByText('Acurácia da previsão:')).toBeInTheDocument();
    expect(await screen.findByText('120')).toBeInTheDocument();
    expect(await screen.findByText('88%')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Varejo' })).not.toBeInTheDocument();
  });

  it('exibe o card de Serviços com KPIs do pipeline de orçamentos', async () => {
    render(
      <VerticalOperationalDashboardPage
        workspaceKeys={['servicos']}
        isSuperAdmin={false}
      />,
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Serviços' })).toBeInTheDocument());
    expect(screen.getByText('Orçamentos pendentes:')).toBeInTheDocument();
    expect(screen.getByText('Orçamentos aprovados:')).toBeInTheDocument();
    expect(screen.getByText('Taxa de aprovação:')).toBeInTheDocument();
    expect(screen.getByText('Tempo médio de decisão:')).toBeInTheDocument();
    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(await screen.findByText('40%')).toBeInTheDocument();
    expect(await screen.findByText('2.5d')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Alimentação' })).not.toBeInTheDocument();
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