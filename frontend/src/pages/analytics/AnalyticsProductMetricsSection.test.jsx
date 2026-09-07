import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnalyticsProductMetricsSection } from './AnalyticsProductMetricsSection';

const fullMetrics = {
  ok: true,
  tenantId: 't1',
  windowDays: 30,
  timeToFirstResponse: {
    avgSeconds: 360,
    medianSeconds: 240,
    p90Seconds: 900,
    conversations: 12,
  },
  timeToFirstValue: {
    available: true,
    seconds: 4 * 3600,
    basis: 'onboarding_start_to_first_outbound_message',
    onboarding: { startedAt: '2026-09-01T08:00:00Z', completedAt: '2026-09-01T09:00:00Z', timeToCompleteSeconds: 3600 },
  },
  navigation: {
    sessions: 20,
    avgRoutesPerSession: 3.2,
    avgEventsPerSession: 41.5,
    topRoutes: [{ route: '/inbox', sessions: 18 }],
  },
  clicksPerCoreSurface: [
    {
      surface: 'Inbox',
      sessions: 18,
      clicks: 150,
      avgClicksPerSession: 8.3,
      taskCompletions: 30,
      avgClicksPerCompletedTask: 5,
    },
  ],
};

describe('analytics/AnalyticsProductMetricsSection', () => {
  it('renderiza TTFR, TTFV, profundidade de navegação e esforço por tarefa', () => {
    render(<AnalyticsProductMetricsSection productMetrics={fullMetrics} />);

    expect(screen.getByTestId('analytics-product-metrics')).toBeInTheDocument();
    expect(screen.getByTestId('pm-ttfr')).toHaveTextContent('6min');
    expect(screen.getByTestId('pm-ttfr')).toHaveTextContent('mediana 4min em 12 conversa(s)');
    expect(screen.getByTestId('pm-ttfv')).toHaveTextContent('4,0h');
    expect(screen.getByTestId('pm-nav-depth')).toHaveTextContent('3,2');
    expect(screen.getByTestId('pm-clicks')).toHaveTextContent('5 cliques');
  });

  it('tabela de superfícies mostra cliques/sessão e cliques/tarefa', () => {
    render(<AnalyticsProductMetricsSection productMetrics={fullMetrics} />);

    const table = screen.getByTestId('pm-surfaces-table');
    expect(table).toHaveTextContent('Inbox');
    expect(table).toHaveTextContent('8,3');
    expect(table).toHaveTextContent('30');
  });

  it('sem dados de resposta: explica o que falta em vez de inventar número', () => {
    render(<AnalyticsProductMetricsSection productMetrics={{
      ...fullMetrics,
      timeToFirstResponse: { avgSeconds: null, medianSeconds: null, p90Seconds: null, conversations: 0 },
      timeToFirstValue: { available: false, seconds: null },
      navigation: { sessions: 0, avgRoutesPerSession: null, topRoutes: [] },
      clicksPerCoreSurface: [],
    }} />);

    expect(screen.getByTestId('pm-ttfr')).toHaveTextContent('ainda sem conversas respondidas');
    expect(screen.getByTestId('pm-ttfv')).toHaveTextContent('a primeira resposta a um cliente ainda não aconteceu');
    expect(screen.getByTestId('pm-nav-depth')).toHaveTextContent('telemetria de navegação ainda não coletada');
    expect(screen.queryByTestId('pm-surfaces-table')).not.toBeInTheDocument();
  });

  it('fail-soft: sem payload não renderiza nada', () => {
    const { container } = render(<AnalyticsProductMetricsSection productMetrics={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('fail-soft: payload com ok=false não renderiza nada', () => {
    const { container } = render(<AnalyticsProductMetricsSection productMetrics={{ ok: false }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
