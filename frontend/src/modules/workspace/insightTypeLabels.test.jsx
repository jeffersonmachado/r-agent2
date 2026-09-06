import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { formatInsightType } from './insightTypeLabels';
import { WorkspaceInsights } from './WorkspaceInsights';

describe('modules/workspace/insightTypeLabels', () => {
  it('mapeia tipos para labels operacionais outcome-first', () => {
    expect(formatInsightType('no_show')).toBe('Falta em agendamento');
    expect(formatInsightType('churn')).toBe('Risco de perda');
    expect(formatInsightType('delay')).toBe('Atraso de resposta');
    expect(formatInsightType('upsell')).toBe('Oportunidade');
  });

  it('tipo desconhecido cai no bruto (nunca esconde informação)', () => {
    expect(formatInsightType('custom_x')).toBe('custom_x');
  });
});

describe('modules/workspace/WorkspaceInsights — no_show', () => {
  it('insight de no_show exibe label operacional e descrição, nunca o tipo cru', () => {
    render(
      <WorkspaceInsights
        loading={false}
        insights={{
          items: [{
            type: 'no_show',
            description: 'Cliente faltou ao agendamento de 04/09/2026 e ainda nao reagendou.',
            confidence: 0.9,
            source: 'system',
            severity: 'high',
          }],
          persisted: [],
        }}
      />,
    );

    expect(screen.getByText('Falta em agendamento')).toBeInTheDocument();
    expect(screen.getByText(/Cliente faltou ao agendamento/)).toBeInTheDocument();
    expect(screen.queryByText('no_show')).not.toBeInTheDocument();
  });
});
