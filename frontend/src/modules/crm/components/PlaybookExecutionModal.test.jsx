import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PlaybookExecutionModal } from './PlaybookExecutionModal';

describe('PlaybookExecutionModal', () => {
  test('não renderiza quando fechado', () => {
    const { container } = render(
      <PlaybookExecutionModal
        open={false}
        playbook={{ id: 'pb-1', name: 'PB 1' }}
        execution={{ id: 'exec-1', status: 'in_progress', steps: [] }}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  test('renderiza progresso e executa callbacks', () => {
    const onClose = vi.fn();
    const onExecuteStep = vi.fn();
    const onExecuteNext = vi.fn();

    render(
      <PlaybookExecutionModal
        open
        playbook={{ id: 'pb-1', name: 'Playbook teste' }}
        execution={{
          id: 'exec-1',
          status: 'in_progress',
          steps: [
            { id: 'step-1', title: 'Passo 1', status: 'completed' },
            { id: 'step-2', title: 'Passo 2', status: 'pending' },
          ],
        }}
        onClose={onClose}
        onExecuteStep={onExecuteStep}
        onExecuteNext={onExecuteNext}
      />,
    );

    expect(screen.getByText(/Playbook teste/i)).toBeInTheDocument();
    expect(screen.getByText(/Progresso: 1\/2/i)).toBeInTheDocument();
    expect(screen.getByText(/Status da execução:/i)).toBeInTheDocument();
    expect(screen.getByText('in_progress')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Fechar'));
    expect(onClose).toHaveBeenCalledTimes(1);

    const stepButtons = screen.getAllByRole('button', { name: 'Executar passo' });
    const enabledStepButton = stepButtons.find((button) => !button.disabled);
    expect(enabledStepButton).toBeTruthy();
    fireEvent.click(enabledStepButton);
    expect(onExecuteStep).toHaveBeenCalledTimes(1);
    expect(onExecuteStep).toHaveBeenCalledWith(expect.objectContaining({ id: 'step-2' }));

    fireEvent.click(screen.getByText('Executar próximo'));
    expect(onExecuteNext).toHaveBeenCalledTimes(1);
  });

  test('desabilita execução quando status não está em progresso', () => {
    render(
      <PlaybookExecutionModal
        open
        loading={false}
        playbook={{ id: 'pb-1', name: 'Playbook teste' }}
        execution={{
          id: 'exec-1',
          status: 'completed',
          steps: [{ id: 'step-1', title: 'Passo 1', status: 'pending' }],
        }}
        onExecuteStep={vi.fn()}
        onExecuteNext={vi.fn()}
      />,
    );

    expect(screen.getByText('Executar próximo')).toBeDisabled();
    expect(screen.getByText('Executar passo')).toBeDisabled();
  });
});
