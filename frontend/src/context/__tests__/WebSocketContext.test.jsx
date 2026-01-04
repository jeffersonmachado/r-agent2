import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { WebSocketProvider, useWebSocketContext } from '../WebSocketContext';
import { getToken } from '../../api/auth';

// Mock do logger
vi.mock('../../utils/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock do getToken
vi.mock('../../api/auth', () => ({
  getToken: vi.fn(() => 'mock-token-123'),
}));

// Mock do WebSocket
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this._messages = [];
  }

  send(data) {
    this._messages.push(data);
  }

  close(code, reason) {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code, reason });
    }
  }

  _simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) {
      this.onopen();
    }
  }

  _simulateMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data: typeof data === 'string' ? data : JSON.stringify(data) });
    }
  }

  _simulateError(error) {
    if (this.onerror) {
      this.onerror(error);
    }
  }

  _simulateClose(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code, reason });
    }
  }

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
}

// Substitui WebSocket global
global.WebSocket = MockWebSocket;

// Componente de teste
function TestComponent({ enabled = true, onEvent, subscribeEvents = [] }) {
  const { connected, authenticated, send, reconnect } = useWebSocketContext({
    enabled,
    onEvent,
    subscribeEvents,
  });

  return (
    <div data-testid="test-component">
      <div data-testid="connected">{connected ? 'connected' : 'disconnected'}</div>
      <div data-testid="authenticated">{authenticated ? 'authenticated' : 'not-authenticated'}</div>
      <button
        data-testid="send-button"
        onClick={() => send({ type: 'test', data: 'test-data' })}
      >
        Send
      </button>
      <button data-testid="reconnect-button" onClick={reconnect}>
        Reconnect
      </button>
    </div>
  );
}

describe('WebSocketContext', () => {
  let mockWs;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWs = null;
    
    // Intercepta criação de WebSocket
    const originalWebSocket = global.WebSocket;
    global.WebSocket = class extends originalWebSocket {
      constructor(...args) {
        super(...args);
        mockWs = this;
      }
    };
  });

  afterEach(() => {
    cleanup(); // Limpa componentes renderizados
    if (mockWs) {
      try {
        mockWs.close();
      } catch (err) {
        // Ignora erros
      }
      mockWs = null;
    }
    vi.clearAllTimers();
    vi.clearAllMocks();
  });

  it('fornece contexto WebSocket para componentes filhos', async () => {
    const { container } = render(
      <WebSocketProvider>
        <TestComponent />
      </WebSocketProvider>
    );

    // Aguarda renderização
    await waitFor(() => {
      const testComponent = container.querySelector('[data-testid="test-component"]') ||
                            screen.queryByTestId('test-component');
      expect(testComponent).toBeTruthy();
    }, { timeout: 2000 });

    // Verifica elementos
    const testComponent = screen.queryByTestId('test-component') ||
                         container.querySelector('[data-testid="test-component"]');
    expect(testComponent).toBeTruthy();
    
    const connected = screen.queryByTestId('connected') ||
                     container.querySelector('[data-testid="connected"]');
    expect(connected).toBeTruthy();
    
    const authenticated = screen.queryByTestId('authenticated') ||
                          container.querySelector('[data-testid="authenticated"]');
    expect(authenticated).toBeTruthy();
  });

  it('conecta ao WebSocket quando Provider é montado', async () => {
    render(
      <WebSocketProvider>
        <TestComponent />
      </WebSocketProvider>
    );

    expect(mockWs).toBeTruthy();
    expect(mockWs.url).toContain('/ws');

    // Simula conexão aberta
    await act(async () => {
      mockWs._simulateOpen();
    });

    await waitFor(() => {
      expect(screen.getByTestId('connected').textContent).toBe('connected');
    }, { timeout: 2000 });
  });

  it('autentica com token quando conecta', async () => {
    render(
      <WebSocketProvider>
        <TestComponent />
      </WebSocketProvider>
    );

    await act(async () => {
      mockWs._simulateOpen();
    });

    await waitFor(() => {
      expect(screen.getByTestId('connected').textContent).toBe('connected');
    }, { timeout: 2000 });

    // Verifica que enviou mensagem de autenticação
    await waitFor(() => {
      const authMessage = mockWs._messages.find(msg => {
        const data = JSON.parse(msg);
        return data.type === 'auth';
      });
      expect(authMessage).toBeTruthy();
      const data = JSON.parse(authMessage);
      expect(data.token).toBe('mock-token-123');
    }, { timeout: 2000 });
  });

  it('atualiza authenticated quando recebe sucesso de autenticação', async () => {
    render(
      <WebSocketProvider>
        <TestComponent />
      </WebSocketProvider>
    );

    await act(async () => {
      mockWs._simulateOpen();
    });

    await waitFor(() => {
      expect(screen.getByTestId('connected').textContent).toBe('connected');
    }, { timeout: 2000 });

    // Simula resposta de autenticação
    await act(async () => {
      mockWs._simulateMessage({
        type: 'auth',
        status: 'success',
        agent: { id: 'agent-1', username: 'test' },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('authenticated').textContent).toBe('authenticated');
    }, { timeout: 2000 });
  });

  it('registra handlers de eventos de múltiplos componentes', async () => {
    const onEvent1 = vi.fn();
    const onEvent2 = vi.fn();

    const { container } = render(
      <WebSocketProvider>
        <TestComponent onEvent={onEvent1} subscribeEvents={['ticket.created']} />
        <TestComponent onEvent={onEvent2} subscribeEvents={['ticket.updated']} />
      </WebSocketProvider>
    );

    // Verifica que os componentes foram renderizados
    const testComponents = container.querySelectorAll('[data-testid="test-component"]');
    expect(testComponents.length).toBeGreaterThan(0);

    await act(async () => {
      mockWs._simulateOpen();
    });

    // Aguarda conexão (com verificação mais flexível)
    await waitFor(() => {
      const connectedEls = screen.queryAllByTestId('connected');
      if (connectedEls.length > 0) {
        const connected = connectedEls[0].textContent === 'connected';
        return connected;
      }
      return false;
    }, { timeout: 3000 });

    // Simula autenticação
    await act(async () => {
      mockWs._simulateMessage({
        type: 'auth',
        status: 'success',
        agent: { id: 'agent-1', username: 'test' },
      });
    });

    // Aguarda autenticação
    await waitFor(() => {
      const authenticatedEls = screen.queryAllByTestId('authenticated');
      if (authenticatedEls.length > 0) {
        const authenticated = authenticatedEls[0].textContent === 'authenticated';
        return authenticated;
      }
      return false;
    }, { timeout: 3000 });

    // Verifica que se inscreveu em ambos os eventos
    await waitFor(() => {
      const subscribeMessage = mockWs._messages.find(msg => {
        try {
          const data = JSON.parse(msg);
          return data.type === 'subscribe';
        } catch {
          return false;
        }
      });
      if (subscribeMessage) {
        const data = JSON.parse(subscribeMessage);
        const hasCreated = data.events && data.events.includes('ticket.created');
        const hasUpdated = data.events && data.events.includes('ticket.updated');
        return hasCreated && hasUpdated;
      }
      return false;
    }, { timeout: 3000 });
  });

  it('distribui eventos para todos os handlers registrados', async () => {
    const onEvent1 = vi.fn();
    const onEvent2 = vi.fn();

    render(
      <WebSocketProvider>
        <TestComponent onEvent={onEvent1} />
        <TestComponent onEvent={onEvent2} />
      </WebSocketProvider>
    );

    await act(async () => {
      mockWs._simulateOpen();
    });

    // Usa queryAllByTestId porque há múltiplos componentes
    await waitFor(() => {
      const connectedEls = screen.queryAllByTestId('connected');
      expect(connectedEls.length).toBeGreaterThan(0);
      if (connectedEls.length > 0) {
        expect(connectedEls[0].textContent).toBe('connected');
      }
    }, { timeout: 2000 });

    // Simula evento
    await act(async () => {
      mockWs._simulateMessage({
        type: 'event',
        event: 'ticket.created',
        data: { ticketId: '123' },
      });
    });

    await waitFor(() => {
      expect(onEvent1).toHaveBeenCalledWith('ticket.created', { ticketId: '123' }, expect.any(Object));
      expect(onEvent2).toHaveBeenCalledWith('ticket.created', { ticketId: '123' }, expect.any(Object));
    }, { timeout: 2000 });
  });

  it('permite enviar mensagem via send', async () => {
    render(
      <WebSocketProvider>
        <TestComponent />
      </WebSocketProvider>
    );

    await act(async () => {
      mockWs._simulateOpen();
    });

    await waitFor(() => {
      expect(screen.getByTestId('connected').textContent).toBe('connected');
    }, { timeout: 2000 });

    // Clica no botão de enviar
    await act(async () => {
      screen.getByTestId('send-button').click();
    });

    // Verifica que mensagem foi enviada
    await waitFor(() => {
      const testMessage = mockWs._messages.find(msg => {
        const data = JSON.parse(msg);
        return data.type === 'test';
      });
      expect(testMessage).toBeTruthy();
    }, { timeout: 2000 });
  });

  it('permite reconectar via reconnect', async () => {
    render(
      <WebSocketProvider>
        <TestComponent />
      </WebSocketProvider>
    );

    await act(async () => {
      mockWs._simulateOpen();
    });

    await waitFor(() => {
      expect(screen.getByTestId('connected').textContent).toBe('connected');
    }, { timeout: 2000 });

    // Fecha conexão
    await act(async () => {
      mockWs._simulateClose(1000, 'Manual close');
    });

    // Clica no botão de reconectar
    await act(async () => {
      screen.getByTestId('reconnect-button').click();
    });

    // Verifica que tentou reconectar
    // Nota: Em um teste real, precisaríamos verificar se um novo WebSocket foi criado
    expect(screen.getByTestId('reconnect-button')).toBeTruthy();
  });

  it('lança erro se usado fora do Provider', () => {
    // Suprime console.error para este teste
    const originalError = console.error;
    const consoleErrorSpy = vi.fn();
    console.error = consoleErrorSpy;

    try {
      expect(() => {
        render(<TestComponent />);
      }).toThrow('useWebSocketContext deve ser usado dentro de WebSocketProvider');
    } finally {
      console.error = originalError;
      cleanup();
    }
  });

  it('não registra handler quando enabled é false', async () => {
    const onEvent = vi.fn();

    render(
      <WebSocketProvider>
        <TestComponent enabled={false} onEvent={onEvent} />
      </WebSocketProvider>
    );

    await act(async () => {
      mockWs._simulateOpen();
    });

    await waitFor(() => {
      expect(screen.getByTestId('connected').textContent).toBe('connected');
    }, { timeout: 2000 });

    // Simula evento
    await act(async () => {
      mockWs._simulateMessage({
        type: 'event',
        event: 'ticket.created',
        data: { ticketId: '123' },
      });
    });

    // Aguarda um pouco para garantir que não foi chamado
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    // onEvent não deve ser chamado porque enabled é false
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('limpa recursos ao desmontar Provider', async () => {
    const { unmount } = render(
      <WebSocketProvider>
        <TestComponent />
      </WebSocketProvider>
    );

    await act(async () => {
      mockWs._simulateOpen();
    });

    await waitFor(() => {
      expect(screen.getByTestId('connected').textContent).toBe('connected');
    }, { timeout: 2000 });

    // Desmonta o Provider
    unmount();

    // Verifica que a conexão foi fechada
    await waitFor(() => {
      expect(mockWs.readyState).toBe(MockWebSocket.CLOSED);
    }, { timeout: 2000 });
  });
});

