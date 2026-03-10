import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OperationalSignalsCard } from './OperationalSignalsCard';

describe('OperationalSignalsCard', () => {
  test('exibe estado vazio', () => {
    render(
      <OperationalSignalsCard
        enabled
        signals={[]}
        loading={false}
      />,
    );

    expect(screen.getByText(/Nenhum sinal operacional detectado/i)).toBeInTheDocument();
  });

  test('renderiza item e dispara ação de status', async () => {
    const onStatusChange = vi.fn().mockResolvedValue({ ok: true });

    render(
      <OperationalSignalsCard
        enabled
        signals={[
          { id: 'sig-1', type: 'followup_overdue', status: 'open', severity: 'high', confidence: 0.8 },
        ]}
        loading={false}
        onStatusChange={onStatusChange}
      />,
    );

    fireEvent.click(screen.getByText('Reconhecer'));
    await waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledWith('sig-1', 'acknowledged');
    });
  });
});
