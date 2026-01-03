const WebSocket = require('ws');
const http = require('http');
const {
  initializeWebSocket,
  sendToClient,
  broadcastToTenant,
  sendToAgent,
  emitEvent,
  getStats,
} = require('../websocketService');
const { createAgent, login } = require('../authService');

// Mock do logger
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('websocketService', () => {
  let httpServer;
  let wssPort;

  beforeAll((done) => {
    httpServer = http.createServer();
    initializeWebSocket(httpServer);

    httpServer.listen(0, () => {
      const address = httpServer.address();
      if (address && typeof address === 'object') {
        wssPort = address.port;
      }
      done();
    });
  });

  afterAll((done) => {
    if (httpServer) {
      httpServer.closeAllConnections();
      httpServer.close(() => {
        // Aguarda um pouco para garantir que todas as conexões foram fechadas
        setTimeout(done, 500);
      });
    } else {
      done();
    }
  });

  describe('Conexão WebSocket', () => {
    test('cliente pode conectar ao servidor', (done) => {
      const ws = new WebSocket(`ws://localhost:${wssPort}/ws`);

      ws.on('open', () => {
        expect(ws.readyState).toBe(WebSocket.OPEN);
        ws.close();
        done();
      });

      ws.on('error', (err) => {
        done(err);
      });
    });

    test('recebe mensagem de conexão ao conectar', (done) => {
      const ws = new WebSocket(`ws://localhost:${wssPort}/ws`);

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'connection') {
          expect(message.status).toBe('connected');
          expect(message.clientId).toBeDefined();
          ws.close();
          done();
        }
      });

      ws.on('error', (err) => {
        done(err);
      });
    });
  });

  describe('Autenticação', () => {
    test('cliente pode autenticar com token válido', async () => {
      // Cria agente de teste com nome único
      const uniqueUsername = `test-user-${Date.now()}`;
      const agentResult = createAgent({
        tenantId: 'tenant-test',
        username: uniqueUsername,
        email: `test-${Date.now()}@example.com`,
        password: 'password123',
        role: 'agent',
      });

      if (!agentResult.success) {
        // Se falhar, pode ser que já existe, tenta fazer login
        const loginResult = login(uniqueUsername, 'password123', '127.0.0.1', 'test');
        if (!loginResult.success) {
          throw new Error(`Falha ao criar agente: ${agentResult.error}`);
        }
      }

      // Faz login para obter token
      const loginResult = login(uniqueUsername, 'password123', '127.0.0.1', 'test');

      if (!loginResult.success) {
        throw new Error(`Falha ao fazer login: ${loginResult.error}`);
      }

      return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${wssPort}/ws`);
        let connectionReceived = false;
        let authSent = false;

        ws.on('open', () => {
          // Aguarda mensagem de conexão antes de autenticar
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          
          // Primeiro recebe mensagem de conexão
          if (message.type === 'connection' && !connectionReceived) {
            connectionReceived = true;
            // Agora envia autenticação
            if (!authSent) {
              authSent = true;
              ws.send(
                JSON.stringify({
                  type: 'auth',
                  token: loginResult.token,
                })
              );
            }
          }
          
          // Depois recebe resposta de autenticação
          if (message.type === 'auth' && message.status === 'success') {
            expect(message.agent).toBeDefined();
            expect(message.agent.username).toBe(uniqueUsername);
            ws.close();
            resolve();
          }
          
          if (message.type === 'auth' && message.status === 'error') {
            ws.close();
            reject(new Error(`Autenticação falhou: ${message.message}`));
          }
        });

        ws.on('error', (err) => {
          ws.close();
          reject(err);
        });

        // Timeout de segurança
        setTimeout(() => {
          if (ws.readyState !== WebSocket.CLOSED) {
            ws.close();
            reject(new Error('Timeout ao aguardar autenticação'));
          }
        }, 5000);
      });
    });

    test('cliente recebe erro com token inválido', (done) => {
      const ws = new WebSocket(`ws://localhost:${wssPort}/ws`);

      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            type: 'auth',
            token: 'invalid-token',
          })
        );
      });

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'auth' && message.status === 'error') {
          expect(message.message).toBeDefined();
          ws.close();
          done();
        }
      });

      ws.on('error', (err) => {
        done(err);
      });
    });
  });

  describe('Ping/Pong', () => {
    test('cliente recebe pong ao enviar ping', (done) => {
      const ws = new WebSocket(`ws://localhost:${wssPort}/ws`);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'ping' }));
      });

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'pong') {
          expect(message.timestamp).toBeDefined();
          ws.close();
          done();
        }
      });

      ws.on('error', (err) => {
        done(err);
      });
    });
  });

  describe('Subscribe', () => {
    test('cliente pode se inscrever em eventos', (done) => {
      const ws = new WebSocket(`ws://localhost:${wssPort}/ws`);

      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            type: 'subscribe',
            events: ['ticket.created', 'ticket.updated'],
          })
        );
      });

      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'subscribe' && message.status === 'success') {
          expect(message.events).toEqual(['ticket.created', 'ticket.updated']);
          ws.close();
          done();
        }
      });

      ws.on('error', (err) => {
        done(err);
      });
    });
  });

  describe('emitEvent', () => {
    test('emite evento para tenant específico', async () => {
      // Cria agente e autentica com nome único
      const uniqueUsername = `test-ws-user-${Date.now()}`;
      const agentResult = createAgent({
        tenantId: 'tenant-test-ws',
        username: uniqueUsername,
        email: `test-ws-${Date.now()}@example.com`,
        password: 'password123',
        role: 'agent',
      });

      if (!agentResult.success) {
        // Se falhar, pode ser que já existe, tenta fazer login
        const loginResult = login(uniqueUsername, 'password123', '127.0.0.1', 'test');
        if (!loginResult.success) {
          throw new Error(`Falha ao criar agente: ${agentResult.error}`);
        }
      }

      const loginResult = login(uniqueUsername, 'password123', '127.0.0.1', 'test');

      if (!loginResult.success) {
        throw new Error(`Falha ao fazer login: ${loginResult.error}`);
      }

      return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${wssPort}/ws`);
        let connectionReceived = false;
        let authenticated = false;

        ws.on('open', () => {
          // Aguarda mensagem de conexão
        });

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());

          // Primeiro recebe mensagem de conexão
          if (message.type === 'connection' && !connectionReceived) {
            connectionReceived = true;
            // Agora envia autenticação
            ws.send(
              JSON.stringify({
                type: 'auth',
                token: loginResult.token,
              })
            );
          }

          // Depois recebe resposta de autenticação
          if (message.type === 'auth' && message.status === 'success' && !authenticated) {
            authenticated = true;
            // Emite evento após autenticação
            setTimeout(() => {
              emitEvent(
                'ticket.created',
                { ticketId: '123', queue: 'suporte' },
                { tenantId: 'tenant-test-ws' }
              );
            }, 100);
          }

          if (authenticated && message.type === 'event') {
            expect(message.event).toBe('ticket.created');
            expect(message.data.ticketId).toBe('123');
            ws.close();
            resolve();
          }
        });

        ws.on('error', (err) => {
          ws.close();
          reject(err);
        });

        // Timeout de segurança
        setTimeout(() => {
          if (ws.readyState !== WebSocket.CLOSED) {
            ws.close();
            reject(new Error('Timeout ao aguardar evento'));
          }
        }, 5000);
      });
    });
  });

  describe('getStats', () => {
    test('retorna estatísticas de conexões', () => {
      const stats = getStats();
      expect(stats).toHaveProperty('totalClients');
      expect(stats).toHaveProperty('authenticatedClients');
      expect(stats).toHaveProperty('unauthenticatedClients');
      expect(stats).toHaveProperty('uniqueTenants');
      expect(stats).toHaveProperty('uniqueAgents');
      expect(typeof stats.totalClients).toBe('number');
    });
  });
});

