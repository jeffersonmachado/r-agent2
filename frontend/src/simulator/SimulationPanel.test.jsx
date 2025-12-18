import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../styles/themeContext';
import { SimulationPanel } from './SimulationPanel';

/**
 * Helper para renderizar componentes que precisam do ThemeProvider
 */
function renderWithTheme(component) {
  return render(<ThemeProvider>{component}</ThemeProvider>);
}

describe('simulator/SimulationPanel', () => {
  beforeEach(() => {
    // Limpar localStorage antes de cada teste
    localStorage.clear();
  });

  it('mostra mensagem quando não há simulação', () => {
    renderWithTheme(<SimulationPanel simulation={null} onSelectStep={vi.fn()} />);

    expect(
      screen.getByText(/Nenhuma simulação executada ainda/i),
    ).toBeInTheDocument();
  });

  it('lista passos e chama onSelectStep ao clicar', () => {
    const onSelectStep = vi.fn();
    const simulation = {
      compiledFlowInfo: { id: 'flow-1', version: 1, versionHash: 'abc' },
      steps: [
        {
          index: 0,
          stateAfter: { currentNodeId: 'node-1' },
          output: { type: 'message', text: 'Olá' },
        },
      ],
    };

    renderWithTheme(
      <SimulationPanel simulation={simulation} onSelectStep={onSelectStep} />,
    );

    const stepRow = screen.getByText(/Passo 0/);
    fireEvent.click(stepRow);

    expect(onSelectStep).toHaveBeenCalledTimes(1);
    expect(onSelectStep).toHaveBeenCalledWith(simulation.steps[0]);
  });

  it('mostra informações do fluxo compilado quando disponível', () => {
    const simulation = {
      compiledFlowInfo: { id: 'flow-test', version: 2, versionHash: 'hash123' },
      steps: [],
    };

    renderWithTheme(
      <SimulationPanel simulation={simulation} onSelectStep={vi.fn()} />,
    );

    expect(screen.getByText(/flow-test/)).toBeInTheDocument();
    expect(screen.getByText(/v2/)).toBeInTheDocument();
  });

  it('mostra mensagem quando não há passos na simulação', () => {
    const simulation = {
      compiledFlowInfo: { id: 'flow-1', version: 1 },
      steps: [],
    };

    renderWithTheme(
      <SimulationPanel simulation={simulation} onSelectStep={vi.fn()} />,
    );

    const messages = screen.getAllByText(/Nenhum passo executado/);
    expect(messages.length).toBeGreaterThan(0);
  });

  it('não chama onSelectStep quando não é fornecido', () => {
    const simulation = {
      compiledFlowInfo: { id: 'flow-1', version: 1 },
      steps: [
        {
          index: 0,
          stateAfter: { currentNodeId: 'node-1' },
          output: { type: 'message' },
        },
      ],
    };

    renderWithTheme(<SimulationPanel simulation={simulation} />);

    const stepRows = screen.getAllByText(/Passo 0/);
    expect(stepRows.length).toBeGreaterThan(0);
    
    // Clica no primeiro elemento encontrado
    fireEvent.click(stepRows[0]);

    // Não deve lançar erro mesmo sem onSelectStep
    expect(stepRows[0]).toBeInTheDocument();
  });

  it('renderiza múltiplos passos corretamente', () => {
    const simulation = {
      compiledFlowInfo: { id: 'flow-1', version: 1 },
      steps: [
        {
          index: 0,
          stateAfter: { currentNodeId: 'node-1' },
          output: { type: 'message', text: 'Primeiro' },
        },
        {
          index: 1,
          stateAfter: { currentNodeId: 'node-2' },
          output: { type: 'message', text: 'Segundo' },
        },
        {
          index: 2,
          stateAfter: { currentNodeId: null },
          output: { type: 'end' },
        },
      ],
    };

    renderWithTheme(
      <SimulationPanel simulation={simulation} onSelectStep={vi.fn()} />,
    );

    // Usa getAllByText para múltiplos elementos
    const passo0Elements = screen.getAllByText(/Passo 0/);
    expect(passo0Elements.length).toBeGreaterThan(0);
    
    const passo1Elements = screen.getAllByText(/Passo 1/);
    expect(passo1Elements.length).toBeGreaterThan(0);
    
    const passo2Elements = screen.getAllByText(/Passo 2/);
    expect(passo2Elements.length).toBeGreaterThan(0);
  });
});


