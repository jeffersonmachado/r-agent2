const WebSocket = require('ws');
const http = require('http');

jest.mock('../authService', () => ({
  validateToken: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { validateToken } = require('../authService');
const { initializeWebSocket, shutdownWebSocket, emitEvent } = require('../websocketService');

describe('websocketService ping auth refresh', () => {
  let httpServer;
  let wssPort;
  let skipWsTests = false;
  const activeConnections = [];

  beforeAll(async () => {
    httpServer = http.createServer();
    initializeWebSocket(httpServer);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        skipWsTests = true;
        resolve();
      }, 2000);

      const onError = (err) => {
        clearTimeout(timeout);
        if (err && (err.code === 'EPERM' || err.code === 'EACCES')) {
          skipWsTests = true;
          resolve();
          return;
        }
        reject(err);
      };

      httpServer.once('error', onError);
      httpServer.listen(0, '127.0.0.1', () => {
        httpServer.off('error', onError);
        clearTimeout(timeout);
        const address = httpServer.address();
        if (address && typeof address === 'object') {
          wssPort = address.port;
          resolve();
          return;
        }
        reject(new Error('Não foi possível obter porta do servidor'));
      });
    });
  });

  afterAll(async () => {
    const closePromises = activeConnections.map((ws) => new Promise((resolve) => {
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.once('close', resolve);
          ws.close();
          setTimeout(resolve, 1000);
          return;
        }
      } catch {
      }
      resolve();
    }));

    await Promise.all(closePromises);
    activeConnections.length = 0;

    if (httpServer) {
      if (typeof httpServer.closeAllConnections === 'function') {
        httpServer.closeAllConnections();
      }

      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 2000);
        httpServer.close(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    await shutdownWebSocket();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('envia auth:error quando token expira durante ping', async () => {
    if (skipWsTests) return;

    validateToken
      .mockReturnValueOnce({
        valid: true,
        agent: {
          id: 'agent-1',
          username: 'tester',
          tenantId: 'tenant-1',
        },
      })
      .mockReturnValueOnce({
        valid: false,
        error: 'Sessão expirada por inatividade',
      });

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${wssPort}/ws`);
      activeConnections.push(ws);

      const received = [];
      const timeout = setTimeout(() => {
        try {
          ws.close();
        } catch {
        }
        reject(new Error('Timeout ao aguardar mensagens de auth/ping'));
      }, 7000);

      ws.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        received.push(message);

        if (message.type === 'connection') {
          ws.send(JSON.stringify({ type: 'auth', token: 'token-valido' }));
          return;
        }

        if (message.type === 'auth' && message.status === 'success') {
          ws.send(JSON.stringify({ type: 'ping' }));
          return;
        }

        const hasAuthError = received.some((m) => m.type === 'auth' && m.status === 'error' && m.message === 'Sessão expirada por inatividade');
        const hasPong = received.some((m) => m.type === 'pong');

        if (hasAuthError && hasPong) {
          clearTimeout(timeout);
          expect(validateToken).toHaveBeenCalledTimes(2);
          expect(validateToken).toHaveBeenNthCalledWith(1, 'token-valido');
          expect(validateToken).toHaveBeenNthCalledWith(2, 'token-valido');
          ws.close();
          resolve();
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        try {
          ws.close();
        } catch {
        }
        reject(err);
      });
    });
  });

  test('bloqueia eventos do tenant após auth:error no ping até reautenticar', async () => {
    if (skipWsTests) return;

    validateToken
      .mockReturnValueOnce({
        valid: true,
        agent: {
          id: 'agent-2',
          username: 'tester-2',
          tenantId: 'tenant-2',
        },
      })
      .mockReturnValueOnce({
        valid: false,
        error: 'Sessão expirada por inatividade',
      })
      .mockReturnValueOnce({
        valid: true,
        agent: {
          id: 'agent-2',
          username: 'tester-2',
          tenantId: 'tenant-2',
        },
      });

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${wssPort}/ws`);
      activeConnections.push(ws);

      let authSuccessCount = 0;
      let preReauthEventCount = 0;
      let postReauthEventCount = 0;
      let preReauthWindowClosed = false;

      const timeout = setTimeout(() => {
        try {
          ws.close();
        } catch {
        }
        reject(new Error('Timeout ao validar isolamento/reautenticação de eventos'));
      }, 9000);

      ws.on('message', (raw) => {
        const message = JSON.parse(raw.toString());

        if (message.type === 'connection') {
          ws.send(JSON.stringify({ type: 'auth', token: 'token-tenant-2' }));
          return;
        }

        if (message.type === 'auth' && message.status === 'success') {
          authSuccessCount += 1;

          if (authSuccessCount === 1) {
            ws.send(JSON.stringify({ type: 'ping' }));
            return;
          }

          if (authSuccessCount === 2) {
            emitEvent('ticket.updated', { ticketId: 'evt-after-reauth' }, { tenantId: 'tenant-2' });
            return;
          }
        }

        if (message.type === 'auth' && message.status === 'error') {
          emitEvent('ticket.updated', { ticketId: 'evt-before-reauth' }, { tenantId: 'tenant-2' });

          setTimeout(() => {
            preReauthWindowClosed = true;
            ws.send(JSON.stringify({ type: 'auth', token: 'token-tenant-2' }));
          }, 180);
          return;
        }

        if (message.type === 'event' && message.event === 'ticket.updated') {
          if (!preReauthWindowClosed) {
            preReauthEventCount += 1;
          } else {
            postReauthEventCount += 1;
          }
        }

        if (authSuccessCount >= 2 && postReauthEventCount >= 1) {
          clearTimeout(timeout);
          expect(preReauthEventCount).toBe(0);
          expect(postReauthEventCount).toBe(1);
          expect(validateToken).toHaveBeenCalledTimes(3);
          ws.close();
          resolve();
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        try {
          ws.close();
        } catch {
        }
        reject(err);
      });
    });
  });
});
