import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FlowCurrentDisplay } from './FlowCurrentDisplay';

describe('components/FlowCurrentDisplay', () => {
  it('renderiza badge IA com score e tentativas', () => {
    const displayedFlow = {
      id: 'flow-1',
      name: 'Flow 1',
      metadata: {
        aiGeneration: {
          usedFallback: false,
          qualityScore: 100,
          attempts: [{ attempt: 1, ok: false }, { attempt: 2, ok: true }],
        },
      },
    };

    const onRegenerate = vi.fn();

    render(<FlowCurrentDisplay displayedFlow={displayedFlow} onRegenerate={onRegenerate} />);

    expect(screen.getByText(/Gerar novamente/i)).toBeInTheDocument();
    expect(
      screen.getByText(/IA\s*·\s*Score:\s*100\s*·\s*Tentativas:\s*2/i),
    ).toBeInTheDocument();
  });

  it('mostra tipo BPMN bloqueado quando o diagrama é BPMN', () => {
    const displayedFlow = {
      id: 'flow-bpmn-1',
      name: 'Flow BPMN',
      metadata: {
        diagramType: 'bpmn',
      },
    };

    render(
      <FlowCurrentDisplay
        displayedFlow={displayedFlow}
        diagramType="bpmn"
        onRegenerate={vi.fn()}
      />,
    );

    const select = screen.getByRole('combobox');
    expect(select).toBeDisabled();
    expect(screen.getByText('BPMN')).toBeInTheDocument();
  });
});

