import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnalyticsDecisionMetricsSection } from './AnalyticsDecisionMetricsSection';

const baseStats = {
  period: 'month',
  total: 6,
  byStatus: { open: 1, applied: 1, dismissed: 1, completed: 3 },
  acceptance: { decided: 5, accepted: 4, dismissed: 1, rate: 0.8 },
  outcome: { evaluated: 3, improved: 2, regressed: 1, unchanged: 0, pendingEvaluation: 1, successRate: 2 / 3 },
  automation: { applied: 4, manual: 2, auto: 1, batch: 1, automationRate: 0.5, humanInterventionRate: 0.5 },
};

describe('AnalyticsDecisionMetricsSection', () => {
  it('renderiza as 4 métricas de decisão com taxas formatadas', () => {
    render(<AnalyticsDecisionMetricsSection stats={baseStats} />);

    expect(screen.getByText('Resultado das recomendações')).toBeTruthy();
    expect(screen.getByText('Taxa de aceite das recomendações')).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy(); // aceite
    expect(screen.getByText('67%')).toBeTruthy(); // outcome success
    expect(screen.getAllByText('50%').length).toBe(2); // automação + intervenção humana
    expect(screen.getByText(/4 aplicadas de 5 decididas/)).toBeTruthy();
    expect(screen.getByText(/2 melhoraram de 3 avaliadas/)).toBeTruthy();
  });

  it('exibe aviso quando há outcomes regressed', () => {
    render(<AnalyticsDecisionMetricsSection stats={baseStats} />);

    expect(screen.getByText(/1 recomendação\(ões\) tiveram resultado medido como piora/)).toBeTruthy();
  });

  it('sem outcomes regressed não exibe aviso', () => {
    render(<AnalyticsDecisionMetricsSection stats={{
      ...baseStats,
      outcome: { ...baseStats.outcome, regressed: 0 },
    }} />);

    expect(screen.queryByText(/resultado medido como piora/)).toBeNull();
  });

  it('taxas null (sem denominador) renderizam como traço', () => {
    render(<AnalyticsDecisionMetricsSection stats={{
      ...baseStats,
      total: 2,
      acceptance: { decided: 0, accepted: 0, dismissed: 0, rate: null },
      outcome: { evaluated: 0, improved: 0, regressed: 0, unchanged: 0, pendingEvaluation: 2, successRate: null },
      automation: { applied: 0, manual: 0, auto: 0, batch: 0, automationRate: null, humanInterventionRate: null },
    }} />);

    expect(screen.getAllByText('—').length).toBe(4);
    expect(screen.getByText(/2 aguardando novos dados/)).toBeTruthy();
  });

  it('fail-soft: stats null ou total zero não renderiza a seção', () => {
    const { container: empty } = render(<AnalyticsDecisionMetricsSection stats={null} />);
    expect(empty.innerHTML).toBe('');

    const { container: zero } = render(<AnalyticsDecisionMetricsSection stats={{ ...baseStats, total: 0 }} />);
    expect(zero.innerHTML).toBe('');
  });
});
