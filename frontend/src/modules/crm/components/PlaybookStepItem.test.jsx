import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PlaybookStepItem } from './PlaybookStepItem';

describe('PlaybookStepItem', () => {
  test('renderiza conteúdo básico do passo', () => {
    render(
      <PlaybookStepItem
        step={{
          id: 'step-1',
          title: 'Enviar mensagem',
          description: 'Envia mensagem inicial para o contato.',
          status: 'pending',
        }}
      />,
    );

    expect(screen.getByText(/Enviar mensagem/i)).toBeInTheDocument();
    expect(screen.getByText(/Envia mensagem inicial para o contato/i)).toBeInTheDocument();
    expect(screen.getByText('Pendente')).toBeInTheDocument();
  });

  test('exibe erro e dispara execução quando habilitado', () => {
    const onExecute = vi.fn();

    render(
      <PlaybookStepItem
        step={{
          id: 'step-2',
          title: 'Criar tarefa',
          status: 'failed',
          error: 'task_create_failed',
        }}
        onExecute={onExecute}
        disabled={false}
      />,
    );

    expect(screen.getByText('Falhou')).toBeInTheDocument();
    expect(screen.getByText('task_create_failed')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Executar passo'));
    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  test('desabilita botão para passos bloqueados', () => {
    const { rerender } = render(
      <PlaybookStepItem
        step={{ id: 'step-3', title: 'Passo concluído', status: 'completed' }}
        onExecute={vi.fn()}
        disabled={false}
      />,
    );

    expect(screen.getByText('Executar passo')).toBeDisabled();

    rerender(
      <PlaybookStepItem
        step={{ id: 'step-4', title: 'Passo em execução', status: 'running' }}
        onExecute={vi.fn()}
        disabled={false}
      />,
    );

    expect(screen.getByText('Executando')).toBeInTheDocument();
    expect(screen.getByText('Executar passo')).toBeDisabled();

    rerender(
      <PlaybookStepItem
        step={{ id: 'step-5', title: 'Passo pendente', status: 'pending' }}
        onExecute={vi.fn()}
        disabled
      />,
    );

    expect(screen.getByText('Executar passo')).toBeDisabled();
  });
});
