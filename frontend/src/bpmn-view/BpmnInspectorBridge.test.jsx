import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BpmnInspectorBridge } from './BpmnInspectorBridge';

describe('BpmnInspectorBridge', () => {
  it('mostra estado vazio sem seleção', () => {
    render(<BpmnInspectorBridge selection={null} viewModel={null} onSwitchToEngine={vi.fn()} />);

    expect(screen.getByText('Nenhum elemento BPMN selecionado')).toBeInTheDocument();
  });

  it('expõe ações de navegação para nó e nó vinculado', async () => {
    const user = userEvent.setup();
    const onSwitchToEngine = vi.fn();

    render(
      <BpmnInspectorBridge
        selection={{ kind: 'node', id: 'Task_A' }}
        viewModel={{
          nodes: [
            {
              id: 'Task_A',
              name: 'Atividade A',
              bpmnType: 'task',
              attachedToRef: 'Task_B',
            },
          ],
          participants: [],
          lanes: [],
          sequenceFlows: [],
          messageFlows: [],
        }}
        onSwitchToEngine={onSwitchToEngine}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Editar este nó no modo engine' }));
    await user.click(screen.getByRole('button', { name: 'Abrir nó vinculado no engine' }));

    expect(onSwitchToEngine).toHaveBeenNthCalledWith(1, 'Task_A');
    expect(onSwitchToEngine).toHaveBeenNthCalledWith(2, 'Task_B');
  });

  it('expõe ações de origem e destino para sequenceFlow', async () => {
    const user = userEvent.setup();
    const onSwitchToEngine = vi.fn();

    render(
      <BpmnInspectorBridge
        selection={{ kind: 'sequenceFlow', id: 'Flow_1' }}
        viewModel={{
          nodes: [],
          participants: [],
          lanes: [],
          sequenceFlows: [
            {
              id: 'Flow_1',
              name: 'Fluxo principal',
              sourceRef: 'Task_Source',
              targetRef: 'Task_Target',
            },
          ],
          messageFlows: [],
        }}
        onSwitchToEngine={onSwitchToEngine}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Abrir nó de origem no engine' }));
    await user.click(screen.getByRole('button', { name: 'Abrir nó de destino no engine' }));

    expect(onSwitchToEngine).toHaveBeenNthCalledWith(1, 'Task_Source');
    expect(onSwitchToEngine).toHaveBeenNthCalledWith(2, 'Task_Target');
  });
});
