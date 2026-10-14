import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';
import { WebSocketProvider, useWebSocketContext } from '../WebSocketContext';
import { AuthContext } from '../authContext';
import { getToken } from '../../api/auth';

/**
 * REGRESSÃO do defeito medido em 2026-10-14: após o login, o WebSocket não
 * autenticava e a Central de Atendimento ficava em "Falha de auth" (sem tempo real)
 * até o usuário recarregar a página (F5).
 *
 * EVIDÊNCIA DE CAMPO que originou estes testes:
 *   - servidor: 3300 conexões, 2115 autenticadas e ZERO `invalid_token` — ou seja,
 *     o cliente simplesmente NÃO enviava o token em ~1/3 das conexões;
 *   - browser instrumentado: após o login, >60s de vida com `{"type":"ping"}` sendo
 *     enviado a cada 30s e **nenhum** `{"type":"auth"}`;
 *   - `Broadcast enviado para 0 cliente(s)` no servidor, com a página aberta.
 *
 * CAUSA: a autenticação só era tentada quando `connected`/`authenticated`/`authFailed`
 * mudavam, ou por um polling de 2s do localStorage. O login não disparava nenhum dos
 * dois de forma confiável, e `authenticateWebSocket()` retornava `false` EM SILÊNCIO
 * quando o socket não estava utilizável — sem reconectar.
 *
 * O teste 2 abaixo é o que FALHA no código anterior: com o socket inutilizável no
 * momento do login, nada acontecia (silêncio); agora o provider reconecta e autentica.
 */

vi.mock('../../utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../api/auth', () => ({ getToken: vi.fn(() => null) }));

class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this._messages = [];
    this._listeners = new Map();
    MockWebSocket.instances.push(this);
  }

  addEventListener(tipo, handler, opcoes) {
    const lista = this._listeners.get(tipo) || [];
    lista.push({ handler, once: Boolean(opcoes && opcoes.once) });
    this._listeners.set(tipo, lista);
  }

  _disparar(tipo, evento) {
    const lista = this._listeners.get(tipo) || [];
    for (const { handler, once } of lista.slice()) {
      try {
        handler(evento);
      } catch (_) {
        /* noop */
      }
      if (once) {
        this._listeners.set(tipo, (this._listeners.get(tipo) || []).filter((l) => l.handler !== handler));
      }
    }
  }

  send(data) {
    this._messages.push(data);
  }

  close(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    this._disparar('close', { code, reason, wasClean: code === 1000 });
    if (this.onclose) this.onclose({ code, reason, wasClean: code === 1000 });
  }

  _simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this._disparar('open', {});
    if (this.onopen) this.onopen();
  }

  _simulateClose(code = 1006, reason = 'queda') {
    this.readyState = MockWebSocket.CLOSED;
    this._disparar('close', { code, reason, wasClean: false });
    if (this.onclose) this.onclose({ code, reason, wasClean: false });
  }

  /** Mensagens de autenticação efetivamente ENVIADAS. */
  get authEnviados() {
    return this._messages.filter((m) => String(m).includes('"type":"auth"'));
  }

  static instances = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
}

global.WebSocket = MockWebSocket;

function Observador() {
  const { connected, authenticated } = useWebSocketContext({ enabled: false });
  return (
    <div>
      <span data-testid="connected">{connected ? 'sim' : 'nao'}</span>
      <span data-testid="authenticated">{authenticated ? 'sim' : 'nao'}</span>
    </div>
  );
}

function Harness({ sessaoAtiva }) {
  const valor = React.useMemo(() => ({ isAuthenticated: sessaoAtiva }), [sessaoAtiva]);
  return (
    <AuthContext.Provider value={valor}>
      <WebSocketProvider>
        <Observador />
      </WebSocketProvider>
    </AuthContext.Provider>
  );
}

const esperar = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const ultimoSocket = () => MockWebSocket.instances[MockWebSocket.instances.length - 1];

describe('WebSocketContext — autenticação no LOGIN (regressão 2026-10-14)', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.mocked(getToken).mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('deslogado: conecta mas NÃO envia autenticação (não há token)', async () => {
    render(<Harness sessaoAtiva={false} />);
    await esperar(50);
    act(() => { ultimoSocket()._simulateOpen(); });
    await esperar(50);

    expect(ultimoSocket().authEnviados).toHaveLength(0);
  });

  it('DEFEITO: login com socket inutilizável reconecta e AUTENTICA (antes: silêncio absoluto)', async () => {
    const { rerender } = render(<Harness sessaoAtiva={false} />);
    await esperar(50);
    const socketAntigo = ultimoSocket();
    act(() => { socketAntigo._simulateOpen(); });
    await esperar(50);
    expect(socketAntigo.authEnviados).toHaveLength(0);

    // O socket aberto antes do login cai (cenário medido: servidor o mantém vivo,
    // mas o cliente não consegue usá-lo para autenticar).
    act(() => { socketAntigo._simulateClose(1006, 'queda antes do login'); });
    await esperar(50);
    const socketsAntesDoLogin = MockWebSocket.instances.length;

    // LOGIN: token passa a existir E a sessão fica ativa.
    vi.mocked(getToken).mockReturnValue('token-de-teste');
    await act(async () => {
      rerender(<Harness sessaoAtiva />);
      await new Promise((r) => setTimeout(r, 250));
    });

    // No código anterior nada acontecia aqui: silêncio, sem socket novo e sem auth.
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(socketsAntesDoLogin);
    }, { timeout: 3000 });

    act(() => { ultimoSocket()._simulateOpen(); });

    await waitFor(() => {
      expect(ultimoSocket().authEnviados.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    expect(String(ultimoSocket().authEnviados[0])).toContain('token-de-teste');
  });

  it('login com socket já aberto: autentica sem depender de polling', async () => {
    const { rerender } = render(<Harness sessaoAtiva={false} />);
    await esperar(50);
    const socket = ultimoSocket();
    act(() => { socket._simulateOpen(); });
    await esperar(50);
    expect(socket.authEnviados).toHaveLength(0);

    vi.mocked(getToken).mockReturnValue('token-aberto');
    await act(async () => {
      rerender(<Harness sessaoAtiva />);
    });

    // O envio acontece pelo gatilho de sessão (não por varredura de localStorage).
    await waitFor(() => {
      expect(socket.authEnviados.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
    expect(String(socket.authEnviados[0])).toContain('token-aberto');
  });

  it('NÃO usa polling de 2s para sincronizar token (setInterval proibido pelo projeto)', async () => {
    const origSetInterval = global.setInterval;
    const intervalos = [];
    global.setInterval = vi.fn((fn, ms) => {
      intervalos.push(ms);
      return origSetInterval(fn, ms);
    });

    try {
      const { rerender } = render(<Harness sessaoAtiva={false} />);
      await esperar(50);
      act(() => { ultimoSocket()._simulateOpen(); });
      vi.mocked(getToken).mockReturnValue('token-x');
      await act(async () => {
        rerender(<Harness sessaoAtiva />);
        await new Promise((r) => setTimeout(r, 300));
      });

      // O defeito antigo criava um setInterval de 2000ms para varrer o token.
      expect(intervalos.filter((ms) => ms === 2000)).toHaveLength(0);
    } finally {
      global.setInterval = origSetInterval;
    }
  });

  it('ao desmontar, socket ainda em CONNECTING é fechado quando abre (não deixa órfão no servidor)', async () => {
    const { unmount } = render(<Harness sessaoAtiva={false} />);
    await esperar(50);
    const socket = ultimoSocket();
    expect(socket.readyState).toBe(MockWebSocket.CONNECTING);

    unmount();

    // Abrir depois do unmount NÃO pode deixar o socket vivo no servidor.
    act(() => { socket._simulateOpen(); });
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
  });
});
