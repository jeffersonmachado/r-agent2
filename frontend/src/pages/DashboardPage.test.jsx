import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardPage } from './DashboardPage';

const navigateMock = vi.hoisted(() => vi.fn());
const fetchJsonMock = vi.hoisted(() => vi.fn());
const getGeneralMetricsMock = vi.hoisted(() => vi.fn());
const getQueueMetricsMock = vi.hoisted(() => vi.fn());
const getMarketingGoogleAdsAttributionExceptionsMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useRouter', () => ({
  useRouter: () => ({ navigate: navigateMock }),
}));

vi.mock('../context/authContext', () => ({
  useAuth: () => ({
    agent: { name: 'Operador', username: 'operador', role: 'admin' },
  }),
}));

vi.mock('../api/analytics', () => ({
  getGeneralMetrics: getGeneralMetricsMock,
  getQueueMetrics: getQueueMetricsMock,
}));

vi.mock('../api/marketing', () => ({
  getMarketingGoogleAdsAttributionExceptions: getMarketingGoogleAdsAttributionExceptionsMock,
}));

vi.mock('../api/client', () => ({
  fetchJson: fetchJsonMock,
}));

vi.mock('../utils/logger', () => ({
  default: {
    error: vi.fn(),
  },
}));

vi.mock('../components/NavigationLink', () => ({
  NavigationLink: ({ children, to, className }) => <a href={to} className={className}>{children}</a>,
}));

describe('pages/DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getGeneralMetricsMock.mockResolvedValue({
      openTickets: 10,
      inProgressTickets: 4,
      avgFirstResponseTimeSeconds: 30,
      avgHandlingTimeSeconds: 120,
      botContainmentRate: 0.42,
    });
    getQueueMetricsMock.mockResolvedValue({ queues: [] });
    fetchJsonMock.mockResolvedValue({ serverVersion: '1.0.0', packageVersion: '1.0.0', versionMismatch: false });
    getMarketingGoogleAdsAttributionExceptionsMock.mockResolvedValue({
      ok: true,
      alert: {
        triggered: true,
        severity: 'warning',
        currentCount: 5,
        growthFactor: 2.5,
      },
    });
  });

  it('renderiza KPI de atribuição e alerta navegável para Marketing', async () => {
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Ads atribuição')).toBeInTheDocument();
      expect(screen.getByText('Alerta')).toBeInTheDocument();
      expect(screen.getByText(/5 evento\(s\) \/ 1 dia/i)).toBeInTheDocument();
      expect(screen.getByText(/Alerta de atribuição ausente/i)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /Google Ads/i }));
    expect(navigateMock).toHaveBeenCalledWith('/marketing');
  });
});
