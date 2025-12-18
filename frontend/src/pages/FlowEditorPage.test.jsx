import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../styles/themeContext';
import { FlowEditorPage } from './FlowEditorPage';

const saveFlow = vi.fn();
const validateCurrentFlow = vi.fn();
const simulateCurrentFlow = vi.fn();
const loadFlow = vi.fn();
const updateEditorJson = vi.fn();
const setSelectedNode = vi.fn();

vi.mock('../state/editorStore', () => ({
  useEditor: () => ({
    currentFlow: { id: 'flow-1', name: 'Flow 1' },
    editorJson: null,
    selectedNode: null,
    validation: null,
    simulation: null,
    loading: false,
    error: null,
    setSelectedNode,
    updateEditorJson,
    validateCurrentFlow,
    saveFlow,
    simulateCurrentFlow,
    loadFlow,
  }),
}));

vi.mock('../FlowEditor', () => ({
  FlowEditor: () => <div data-testid="flow-editor-mock" />,
}));

vi.mock('../SidebarProperties', () => ({
  SidebarProperties: () => <div data-testid="sidebar-properties-mock" />,
}));

vi.mock('../simulator/SimulationPanel', () => ({
  SimulationPanel: () => <div data-testid="simulation-panel-mock" />,
}));

vi.mock('../Toolbar', () => ({
  Toolbar: ({ onSave, onValidate, onSimulate, onLoadFlow, children }) => (
    <div>
      <button type="button" onClick={onLoadFlow}>
        Carregar fluxo
      </button>
      <button type="button" onClick={onSave}>
        Salvar
      </button>
      <button type="button" onClick={onValidate}>
        Validar
      </button>
      <button type="button" onClick={onSimulate}>
        Simular fluxo
      </button>
      {children}
    </div>
  ),
}));

describe('pages/FlowEditorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('chama ações do editor ao clicar nos botões da Toolbar', async () => {
    render(
      <ThemeProvider>
        <FlowEditorPage />
      </ThemeProvider>,
    );

    // A página usa FlowSelector, não um input direto
    // Vamos testar os botões que estão disponíveis na Toolbar mockada
    await userEvent.click(screen.getByText('Salvar'));
    expect(saveFlow).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByText('Validar'));
    expect(validateCurrentFlow).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByText('Simular fluxo'));
    expect(simulateCurrentFlow).toHaveBeenCalledTimes(1);
  });
});


