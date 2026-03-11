import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { SelectableConnection } from './SelectableConnection';

const mockUseConnection = vi.fn();

vi.mock('rete-react-plugin', () => ({
  Presets: {
    classic: {
      useConnection: () => mockUseConnection(),
    },
  },
}));

vi.mock('../utils/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('SelectableConnection BPMN visual classes', () => {
  beforeEach(() => {
    cleanup();
    mockUseConnection.mockReset();
    mockUseConnection.mockReturnValue({
      path: 'M 10 20 C 50 20 50 100 90 100',
    });
  });

  it.each([
    ['supported'],
    ['degraded'],
    ['extension'],
    ['unmapped'],
  ])('aplica classe de categoria %s quando modo visual BPMN esta ativo', (category) => {
    render(
      <SelectableConnection
        data={{
          id: 'conn-1',
          selected: false,
          bpmnVisualMode: true,
          bpmnVisualCategory: category,
        }}
      />,
    );

    const path = document.querySelector('path.rete-connection-path');
    expect(path).toBeInTheDocument();
    expect(path).toHaveClass(`rete-connection-path--${category}`);
  });

  it('nao aplica classe de categoria quando modo visual BPMN esta desligado', () => {
    render(
      <SelectableConnection
        data={{
          id: 'conn-1',
          selected: false,
          bpmnVisualMode: false,
          bpmnVisualCategory: 'supported',
        }}
      />,
    );

    const path = document.querySelector('path.rete-connection-path');
    expect(path).toBeInTheDocument();
    expect(path).not.toHaveClass('rete-connection-path--supported');
  });

  it('prioriza estilo de conexao selecionada sem classe BPMN de categoria', () => {
    render(
      <SelectableConnection
        data={{
          id: 'conn-1',
          selected: true,
          bpmnVisualMode: true,
          bpmnVisualCategory: 'degraded',
        }}
      />,
    );

    const selectedPath = document.querySelector('path.rete-connection-path-selected');
    expect(selectedPath).toBeInTheDocument();
    expect(selectedPath).not.toHaveClass('rete-connection-path--degraded');
  });

  it('renderiza svg da conexao com classe base esperada', () => {
    const { container } = render(
      <SelectableConnection
        data={{
          id: 'conn-1',
          selected: false,
          bpmnVisualMode: true,
          bpmnVisualCategory: 'supported',
        }}
      />,
    );

    const svg = container.querySelector('svg.rete-connection-svg');
    expect(svg).toBeInTheDocument();
  });
});
