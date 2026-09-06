/* @vitest-environment jsdom */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceRightRail } from './WorkspaceRightRail';

const baseProps = {
  summary: { score: 100, healthLabel: 'Saudável', openTickets: 0, delayed: 0, qaFailures: 0, pendingPayments: 0, riskLevel: 'Estável', recentMessages: 0, pendingActions: 0 },
  insights: { items: [], persisted: [] },
  incidents: { items: [] },
  loadingInsights: false,
  loadingActions: false,
  loadingIncidents: false,
  classification: 'PRODUCTION',
};

const tenantRecommendation = {
  id: 'reco-1',
  title: 'Revisar operacao para meta fora da faixa',
  description: 'A meta esta off_track. Projecao de fechamento: ~6 vs alvo 10 (nao atinge a meta).',
  priority: 'high',
  probableCauses: [
    { metricKey: 'operations.abandonment_rate_pct', changeRatio: 0.4, direction: 'up' },
    { metricKey: 'operations.tickets_open', changeRatio: -0.24, direction: 'down' },
  ],
  projection: { projectedValue: 6, targetValue: 10, elapsedFraction: 0.5, projectedStatus: 'will_miss' },
  action: { kind: 'create_task', label: 'Criar tarefa de investigacao' },
};

describe('WorkspaceRightRail — Recomendação inteligente (tenant-intelligence)', () => {
  it('renderiza card com causas prováveis e projeção quando há recomendação aberta', () => {
    render(<WorkspaceRightRail {...baseProps} actions={{ items: [], suggestion: null, tenantRecommendation }} />);

    expect(screen.getByText('Recomendação inteligente')).toBeInTheDocument();
    expect(screen.getByText('Revisar operacao para meta fora da faixa')).toBeInTheDocument();
    expect(screen.getByText(/Possíveis causas: operations\.abandonment_rate_pct \(\+40%\), operations\.tickets_open \(-24%\)/)).toBeInTheDocument();
    expect(screen.getByText(/Projeção de fechamento:/)).toBeInTheDocument();
    expect(screen.getByText(/não atinge a meta/)).toBeInTheDocument();
  });

  it('botão "Aplicar recomendação" dispara o handler com a recomendação', () => {
    const onApplyTenantRecommendation = vi.fn();
    render(<WorkspaceRightRail
      {...baseProps}
      actions={{ items: [], suggestion: null, tenantRecommendation }}
      onApplyTenantRecommendation={onApplyTenantRecommendation}
    />);

    fireEvent.click(screen.getByText('Aplicar recomendação'));

    expect(onApplyTenantRecommendation).toHaveBeenCalledTimes(1);
    expect(onApplyTenantRecommendation).toHaveBeenCalledWith(tenantRecommendation);
  });

  it('sem recomendação aberta não renderiza o card', () => {
    render(<WorkspaceRightRail {...baseProps} actions={{ items: [], suggestion: null, tenantRecommendation: null }} />);

    expect(screen.queryByText('Recomendação inteligente')).toBeNull();
  });

  it('recomendação sem causes/projection renderiza só título e descrição', () => {
    const simple = { id: 'reco-2', title: 'Revisar insight', description: 'Descricao simples.', priority: 'low', probableCauses: [], projection: null, action: null };
    render(<WorkspaceRightRail {...baseProps} actions={{ items: [], suggestion: null, tenantRecommendation: simple }} />);

    expect(screen.getByText('Revisar insight')).toBeInTheDocument();
    expect(screen.queryByText(/Possíveis causas:/)).toBeNull();
    expect(screen.queryByText(/Projeção de fechamento:/)).toBeNull();
  });
});
