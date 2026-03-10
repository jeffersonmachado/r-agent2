import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PlaybookSuggestionCard } from './PlaybookSuggestionCard';

describe('PlaybookSuggestionCard', () => {
  test('exibe estado desabilitado', () => {
    render(
      <PlaybookSuggestionCard
        enabled={false}
        suggestions={[]}
        loading={false}
      />,
    );

    expect(screen.getByText(/Recurso desabilitado para este contexto/i)).toBeInTheDocument();
  });

  test('exibe estado vazio quando não há sugestões', () => {
    render(
      <PlaybookSuggestionCard
        enabled
        suggestions={[]}
        loading={false}
      />,
    );

    expect(screen.getByText(/Nenhum playbook sugerido para o contexto atual/i)).toBeInTheDocument();
  });

  test('renderiza sugestão e dispara callback de execução', () => {
    const onExecute = vi.fn();

    render(
      <PlaybookSuggestionCard
        enabled
        loading={false}
        onExecute={onExecute}
        suggestions={[
          {
            id: 'sug-1',
            playbook: {
              id: 'followup_recovery',
              name: 'Regularizar follow-up atrasado',
              description: 'Fluxo guiado para follow-up vencido.',
            },
            recommendation: {
              source_signal_type: 'followup_overdue',
            },
          },
        ]}
      />,
    );

    expect(screen.getByText(/Regularizar follow-up atrasado/i)).toBeInTheDocument();
    expect(screen.getByText(/Sinal: followup_overdue/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Executar Playbook'));
    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(onExecute).toHaveBeenCalledWith(expect.objectContaining({ id: 'sug-1' }));
  });
});
