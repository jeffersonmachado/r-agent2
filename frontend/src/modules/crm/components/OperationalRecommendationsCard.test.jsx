import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OperationalRecommendationsCard } from './OperationalRecommendationsCard';

describe('OperationalRecommendationsCard', () => {
  test('exibe estado vazio', () => {
    render(
      <OperationalRecommendationsCard
        enabled
        recommendations={[]}
        loading={false}
      />,
    );

    expect(screen.getByText(/Nenhuma recomendação operacional disponível/i)).toBeInTheDocument();
  });

  test('renderiza item e dispara ação de status', async () => {
    const onStatusChange = vi.fn().mockResolvedValue({ ok: true });

    render(
      <OperationalRecommendationsCard
        enabled
        recommendations={[
          {
            id: 'rec-1',
            type: 'operational_followup_overdue',
            status: 'open',
            description: 'Agendar callback',
            impact_level: 'medium',
            priority: 70,
            confidence: 0.75,
            suggested_actions: [{ action: 'schedule_callback' }],
          },
        ]}
        loading={false}
        onStatusChange={onStatusChange}
      />,
    );

    fireEvent.click(screen.getByText('Aceitar'));
    await waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledWith('rec-1', 'accepted');
    });
  });
});
