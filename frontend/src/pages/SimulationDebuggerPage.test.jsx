import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../styles/themeContext';
import { SimulationDebuggerPage } from './SimulationDebuggerPage';

vi.mock('../state/editorStore', () => ({
  useEditor: () => ({
    editorJson: null,
    updateEditorJson: vi.fn(),
  }),
}));

vi.mock('../FlowEditor', () => ({
  FlowEditor: () => <div data-testid="flow-editor-mock" />,
}));

vi.mock('../simulator/ConversationTimeline', () => ({
  ConversationTimeline: () => <div data-testid="conversation-timeline-mock" />,
}));

vi.mock('../simulator/SimulationPanel', () => ({
  SimulationPanel: () => <div data-testid="simulation-panel-mock" />,
}));

const getReplayMock = vi.fn();

vi.mock('../api/flows', () => ({
  getReplay: (...args) => getReplayMock(...args),
}));

describe('pages/SimulationDebuggerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('chama getReplay ao clicar em Carregar replay', async () => {
    getReplayMock.mockResolvedValue({ messages: [] });

    render(
      <ThemeProvider>
        <SimulationDebuggerPage />
      </ThemeProvider>,
    );

    const input = screen.getByPlaceholderText('ex.: sess-123');
    await userEvent.type(input, 'sess-1');

    await userEvent.click(screen.getByText('Carregar replay'));

    expect(getReplayMock).toHaveBeenCalledWith('sess-1');
  });
});


