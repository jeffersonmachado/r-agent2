import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VerticalOperationalDashboardPage } from './VerticalOperationalDashboardPage';

vi.mock('../api/verticalOperations', () => ({
  getFitnessDashboard: vi.fn().mockResolvedValue({ kpis: {} }),
  getBeautyDashboard: vi.fn().mockResolvedValue({ kpis: {} }),
  getFitnessIntelligence: vi.fn().mockResolvedValue(null),
  getBeautyIntelligence: vi.fn().mockResolvedValue(null),
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
});