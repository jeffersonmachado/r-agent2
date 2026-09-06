import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AnalyticsAttentionSection } from './AnalyticsAttentionSection';

const routerMock = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('../../hooks/useRouter', () => ({
  useRouter: () => ({ navigate: routerMock.navigate }),
}));

const exceptionItem = {
  kind: 'recommendation_exception',
  severity: 'high',
  id: 'reco-1',
  title: 'Redistribuir fila comercial',
  reason: 'Tempo de primeira resposta aumentou.',
  action: { type: 'apply_recommendation', recommendationId: 'reco-1' },
  createdAt: '2026-09-06T00:00:00.000Z',
};

const detailItem = {
  kind: 'goal_off_track',
  severity: 'medium',
  id: 'goal-1',
  title: 'Receita do mês',
  reason: 'Progresso em 41% da meta no período.',
  action: { type: 'view_details', target: '/tenant-intelligence' },
  createdAt: '2026-09-06T00:00:00.000Z',
};

describe('AnalyticsAttentionSection', () => {
  it('fail-soft: attention null não renderiza nada', () => {
    const { container } = render(<AnalyticsAttentionSection attention={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('status clear renderiza o estado calmo "Tudo sob controle"', () => {
    render(<AnalyticsAttentionSection attention={{ status: 'clear', totalItems: 0, items: [] }} />);

    expect(screen.getByTestId('attention-clear')).toBeTruthy();
    expect(screen.getByText(/Tudo sob controle/)).toBeTruthy();
    expect(screen.getByText(/Nenhuma exceção precisa de decisão agora/)).toBeTruthy();
  });

  it('status critical renderiza exceções com severidade e motivo', () => {
    render(<AnalyticsAttentionSection
      attention={{ status: 'critical', totalItems: 1, items: [exceptionItem] }}
    />);

    expect(screen.getByText('Exceções que precisam de decisão')).toBeTruthy();
    expect(screen.getByTestId('attention-item-recommendation_exception')).toBeTruthy();
    expect(screen.getByText('Redistribuir fila comercial')).toBeTruthy();
    expect(screen.getByText('Tempo de primeira resposta aumentou.')).toBeTruthy();
    expect(screen.getByText('Alta')).toBeTruthy();
    expect(screen.getByText('Decisão pendente')).toBeTruthy();
  });

  it('status attention usa heading de pontos de atenção', () => {
    render(<AnalyticsAttentionSection
      attention={{ status: 'attention', totalItems: 1, items: [detailItem] }}
    />);

    expect(screen.getByText('Pontos de atenção')).toBeTruthy();
    expect(screen.getByText(/1 item requer atenção/)).toBeTruthy();
  });

  it('item apply_recommendation aciona onApply e onDismiss', () => {
    const onApply = vi.fn();
    const onDismiss = vi.fn();
    render(<AnalyticsAttentionSection
      attention={{ status: 'critical', totalItems: 1, items: [exceptionItem] }}
      onApply={onApply}
      onDismiss={onDismiss}
    />);

    fireEvent.click(screen.getByText('Aplicar'));
    expect(onApply).toHaveBeenCalledWith(exceptionItem);

    fireEvent.click(screen.getByText('Dispensar'));
    expect(onDismiss).toHaveBeenCalledWith(exceptionItem);
  });

  it('item view_details navega para o target', () => {
    render(<AnalyticsAttentionSection
      attention={{ status: 'attention', totalItems: 1, items: [detailItem] }}
    />);

    fireEvent.click(screen.getByText('Ver detalhes'));
    expect(routerMock.navigate).toHaveBeenCalledWith('/tenant-intelligence');
  });

  it('botão Aplicar fica desabilitado enquanto applyingId é o item', () => {
    render(<AnalyticsAttentionSection
      attention={{ status: 'critical', totalItems: 1, items: [exceptionItem] }}
      applyingId="reco-1"
      onApply={vi.fn()}
      onDismiss={vi.fn()}
    />);

    expect(screen.getByText('Aplicando...').disabled).toBe(true);
  });
});
