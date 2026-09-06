/* @vitest-environment jsdom */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AnalyticsDecisionIntelligenceSection } from './AnalyticsDecisionIntelligenceSection';

const insightWithCauses = {
  id: 'ins-1',
  type: 'goal_off_track',
  title: 'Meta fora do esperado: Fechar 10 tickets',
  impact: 'high',
  confidence: 0.9,
  metadata: {
    probableCauses: [
      { metricKey: 'operations.abandonment_rate_pct', changeRatio: 0.4, direction: 'up' },
    ],
    projection: { projectedValue: 6, targetValue: 10, elapsedFraction: 0.5, projectedStatus: 'will_miss' },
  },
};

const openRecommendation = {
  id: 'reco-1',
  title: 'Revisar operacao para meta fora da faixa',
  description: 'Priorize uma revisao operacional. Projecao de fechamento: ~6 vs alvo 10 (nao atinge a meta).',
  priority: 'high',
  metadata: {},
};

describe('AnalyticsDecisionIntelligenceSection', () => {
  it('renderiza insights com causas prováveis/projeção e recomendações acionáveis', () => {
    render(<AnalyticsDecisionIntelligenceSection
      insights={[insightWithCauses]}
      recommendations={[openRecommendation]}
      onApplyRecommendation={() => {}}
    />);

    expect(screen.getByText('Inteligência decisória')).toBeInTheDocument();
    expect(screen.getByText('Meta fora do esperado: Fechar 10 tickets')).toBeInTheDocument();
    expect(screen.getByText(/Possíveis causas: operations\.abandonment_rate_pct \(\+40%\)/)).toBeInTheDocument();
    expect(screen.getByText(/Projeção de fechamento:/)).toBeInTheDocument();
    expect(screen.getByText(/não atinge a meta/)).toBeInTheDocument();
    expect(screen.getByText('Revisar operacao para meta fora da faixa')).toBeInTheDocument();
    expect(screen.getByText('prioridade: high')).toBeInTheDocument();
  });

  it('botão Aplicar dispara o handler e respeita estado applying', () => {
    const onApplyRecommendation = vi.fn();
    const { rerender } = render(<AnalyticsDecisionIntelligenceSection
      insights={[]}
      recommendations={[openRecommendation]}
      applyingId={null}
      onApplyRecommendation={onApplyRecommendation}
    />);

    fireEvent.click(screen.getByText('Aplicar recomendação'));
    expect(onApplyRecommendation).toHaveBeenCalledWith(openRecommendation);

    rerender(<AnalyticsDecisionIntelligenceSection
      insights={[]}
      recommendations={[openRecommendation]}
      applyingId="reco-1"
      onApplyRecommendation={onApplyRecommendation}
    />);
    const applyingButton = screen.getByText('Aplicando...');
    expect(applyingButton).toBeDisabled();
  });

  it('não renderiza nada sem insights nem recomendações (fail-soft)', () => {
    const { container } = render(<AnalyticsDecisionIntelligenceSection insights={[]} recommendations={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('limita a 3 itens por coluna', () => {
    const manyInsights = [1, 2, 3, 4, 5].map((n) => ({
      id: `ins-${n}`,
      title: `Insight ${n}`,
      impact: 'medium',
      confidence: 0.7,
      metadata: {},
    }));
    render(<AnalyticsDecisionIntelligenceSection insights={manyInsights} recommendations={[]} />);

    expect(screen.getByText('Insight 3')).toBeInTheDocument();
    expect(screen.queryByText('Insight 4')).toBeNull();
  });
});
