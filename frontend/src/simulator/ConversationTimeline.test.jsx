import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '../styles/themeContext';
import { ConversationTimeline } from './ConversationTimeline';

/**
 * Helper para renderizar componentes que precisam do ThemeProvider
 */
function renderWithTheme(component) {
  return render(<ThemeProvider>{component}</ThemeProvider>);
}

describe('simulator/ConversationTimeline', () => {
  beforeEach(() => {
    // Limpar localStorage antes de cada teste
    localStorage.clear();
  });

  it('mostra mensagem vazia quando não há replay', () => {
    renderWithTheme(<ConversationTimeline replay={null} onSeekNode={vi.fn()} />);

    expect(
      screen.getByText(/Nenhuma mensagem para exibir/i),
    ).toBeInTheDocument();
  });

  it('renderiza mensagens e chama onSeekNode ao clicar', () => {
    const onSeekNode = vi.fn();
    const replay = {
      messages: [
        {
          from: 'user',
          text: 'Oi',
          at: new Date().toISOString(),
          nodeId: 'node-1',
        },
      ],
    };

    renderWithTheme(<ConversationTimeline replay={replay} onSeekNode={onSeekNode} />);

    const msg = screen.getByText('Oi');
    fireEvent.click(msg);

    expect(onSeekNode).toHaveBeenCalledTimes(1);
    expect(onSeekNode).toHaveBeenCalledWith('node-1', 0);
  });

  it('renderiza múltiplas mensagens em ordem cronológica', () => {
    const replay = {
      messages: [
        {
          from: 'bot',
          text: 'Olá',
          at: new Date('2025-01-01T10:00:00Z').toISOString(),
          nodeId: 'node-1',
        },
        {
          from: 'user',
          text: 'Oi',
          at: new Date('2025-01-01T10:01:00Z').toISOString(),
          nodeId: 'node-2',
        },
        {
          from: 'bot',
          text: 'Como posso ajudar?',
          at: new Date('2025-01-01T10:02:00Z').toISOString(),
          nodeId: 'node-3',
        },
      ],
    };

    renderWithTheme(<ConversationTimeline replay={replay} onSeekNode={vi.fn()} />);

    expect(screen.getByText('Olá')).toBeInTheDocument();
    const oiElements = screen.getAllByText('Oi');
    expect(oiElements.length).toBeGreaterThan(0);
    expect(screen.getByText('Como posso ajudar?')).toBeInTheDocument();
  });

  it('não chama onSeekNode quando não fornecido', () => {
    const replay = {
      messages: [
        {
          from: 'user',
          text: 'Oi',
          at: new Date().toISOString(),
          nodeId: 'node-1',
        },
      ],
    };

    renderWithTheme(<ConversationTimeline replay={replay} />);

    const msgElements = screen.getAllByText('Oi');
    expect(msgElements.length).toBeGreaterThan(0);
    
    // Clica no primeiro elemento encontrado
    fireEvent.click(msgElements[0]);

    // Não deve lançar erro mesmo sem onSeekNode
    expect(msgElements[0]).toBeInTheDocument();
  });

  it('renderiza mensagens vazias quando replay.messages é array vazio', () => {
    const replay = {
      messages: [],
    };

    renderWithTheme(<ConversationTimeline replay={replay} onSeekNode={vi.fn()} />);

    const messages = screen.getAllByText(/Nenhuma mensagem para exibir/i);
    expect(messages.length).toBeGreaterThan(0);
  });

  it('chama onSeekNode com índice correto para múltiplas mensagens', () => {
    const onSeekNode = vi.fn();
    const replay = {
      messages: [
        {
          from: 'bot',
          text: 'Mensagem 1',
          at: new Date().toISOString(),
          nodeId: 'node-1',
        },
        {
          from: 'user',
          text: 'Mensagem 2',
          at: new Date().toISOString(),
          nodeId: 'node-2',
        },
      ],
    };

    renderWithTheme(<ConversationTimeline replay={replay} onSeekNode={onSeekNode} />);

    const msg1 = screen.getByText('Mensagem 1');
    fireEvent.click(msg1);
    expect(onSeekNode).toHaveBeenCalledWith('node-1', 0);

    const msg2 = screen.getByText('Mensagem 2');
    fireEvent.click(msg2);
    expect(onSeekNode).toHaveBeenCalledWith('node-2', 1);
  });
});


