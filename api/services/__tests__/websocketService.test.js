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
const { cleanupAfterTest, runWithTimeout, safeTest } = require('../../../tests/utils/testHelpers');

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
  const activeConnections = [];

  beforeAll(async () => {
    return runWithTimeout(async () => {
      httpServer = http.createServer();
      initializeWebSocket(httpServer);

      return new Promise((resolve, reject) => {
        httpServer.listen(0, () => {
          const address = httpServer.address();
          if (address && typeof address === 'object') {
            wssPort = address.port;
            resolve();
          } else {
            reject(new Error('Não foi possível obter porta do servidor'));
          }
        });
      });
    }, 10000);
  });

  afterAll(async () => {
    return runWithTimeout(async () => {
      // Fecha todas as conexões ativas com timeout individual
      const closePromises = activeConnections.map(ws => {
        return new Promise((resolve) => {
          try {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
              ws.once('close', resolve);
              ws.close();
              // Timeout de segurança
              setTimeout(resolve, 1000);
            } else {
              resolve();
            }
          } catch (err) {
            // Ignora erros ao fechar
            resolve();
          }
        });
      });
      
      await Promise.all(closePromises);
      activeConnections.length = 0;

      if (httpServer) {
        httpServer.closeAllConnections();
        return new Promise((resolve) => {
          const timeout = setTimeout(resolve, 2000); // Timeout de segurança
          httpServer.close(() => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
    }, 15000); // Aumentado para 15s para garantir limpeza completa
  });

  afterEach(() => {
    cleanupAfterTest();
  });

  describe('Conexão WebSocket', () => {
    test('cliente pode conectar ao servidor', async () => {
      return runWithTimeout(async () => {
        return new Promise((resolve, reject) => {
          const ws = new WebSocket(`ws://localhost:${wssPort}/ws`);
          activeConnections.push(ws);

          const timeout = setTimeout(() => {
            try {
              if (ws.readyState !== WebSocket.CLOSED) {
                ws.close();
              }
            } catch (err) {
              // Ignora erros
            }
            reject(new Error('Timeout ao conectar'));
          }, 5000);

          ws.on('open', () => {
            clearTimeout(timeout);
            expect(ws.readyState).toBe(WebSocket.OPEN);
            try {
              ws.close();
            } catch (err) {
              // Ignora erros
            }
            resolve();
          });

          ws.on('error', (err) => {
            clearTimeout(timeout);
            try {
              if (ws.readyState !== WebSocket.CLOSED) {
                ws.close();
              }
            } catch (closeErr) {
              // Ignora erros
            }
            reject(err);
          });
        });
      }, 10000);
    });

    test('recebe mensagem de conexão ao conectar', async () => {
      return runWithTimeout(async () => {
        return new Promise((resolve, reject) => {
          const ws = new WebSocket(`ws://localhost:${wssPort}/ws`);
          activeConnections.push(ws);

          const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('Timeout ao receber mensagem de conexão'));
          }, 5000);

          ws.on('message', (data) => {
            const message = JSON.parse(data.toString());
            if (message.type === 'connection') {
              clearTimeout(timeout);
              expect(message.status).toBe('connected');
              expect(message.clientId).toBeDefined();
              ws.close();
              resolve();
            }
          });

          ws.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });
      }, 10000);
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

      return runWithTimeout(async () => {
        return new Promise((resolve, reject) => {
          const ws = new WebSocket(`ws://localhost:${wssPort}/ws`);
          activeConnections.push(ws);
          let connectionReceived = false;
          let authSent = false;

          const timeout = setTimeout(() => {
            if (ws.readyState !== WebSocket.CLOSED) {
              ws.close();
            }
            reject(new Error('Timeout ao aguardar autenticação'));
          }, 10000);

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
              clearTimeout(timeout);
              expect(message.agent).toBeDefined();
              expect(message.agent.username).toBe(uniqueUsername);
              ws.close();
              resolve();
            }
            
            if (message.type === 'auth' && message.status === 'error') {
              clearTimeout(timeout);
              ws.close();
              reject(new Error(`Autenticação falhou: ${message.message}`));
            }
          });

          ws.on('error', (err) => {
            clearTimeout(timeout);
            ws.close();
            reject(err);
          });
        });
      }, 15000);
    });

    test('cliente recebe erro com token inválido', async () => {
      return runWithTimeout(async () => {
        return new Promise((resolve, reject) => {
          const ws = new WebSocket(`ws://localhost:${wssPort}/ws`);
          activeConnections.push(ws);

          const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('Timeout ao receber erro de autenticação'));
          }, 5000);

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
              clearTimeout(timeout);
              expect(message.message).toBeDefined();
              ws.close();
              resolve();
            }
          });

          ws.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });
      }, 10000);
    });
  });

  describe('Ping/Pong', () => {
    test('cliente recebe pong ao enviar ping', async () => {
      return runWithTimeout(async () => {
        return new Promise((resolve, reject) => {
          const ws = new WebSocket(`ws://localhost:${wssPort}/ws`);
          activeConnections.push(ws);

          const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('Timeout ao receber pong'));
          }, 5000);

          ws.on('open', () => {
            ws.send(JSON.stringify({ type: 'ping' }));
          });

          ws.on('message', (data) => {
            const message = JSON.parse(data.toString());
            if (message.type === 'pong') {
              clearTimeout(timeout);
              expect(message.timestamp).toBeDefined();
              ws.close();
              resolve();
            }
          });

          ws.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });
      }, 10000);
    });
  });

  describe('Subscribe', () => {
    test('cliente pode se inscrever em eventos', async () => {
      return runWithTimeout(async () => {
        return new Promise((resolve, reject) => {
          const ws = new WebSocket(`ws://localhost:${wssPort}/ws`);
          activeConnections.push(ws);

          const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('Timeout ao se inscrever em eventos'));
          }, 5000);

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
              clearTimeout(timeout);
              expect(message.events).toEqual(['ticket.created', 'ticket.updated']);
              ws.close();
              resolve();
            }
          });

          ws.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });
      }, 10000);
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

      return runWithTimeout(async () => {
        return new Promise((resolve, reject) => {
          const ws = new WebSocket(`ws://localhost:${wssPort}/ws`);
          activeConnections.push(ws);
          let connectionReceived = false;
          let authenticated = false;

          const timeout = setTimeout(() => {
            if (ws.readyState !== WebSocket.CLOSED) {
              ws.close();
            }
            reject(new Error('Timeout ao aguardar evento'));
          }, 10000);

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
              clearTimeout(timeout);
              expect(message.event).toBe('ticket.created');
              expect(message.data.ticketId).toBe('123');
              ws.close();
              resolve();
            }
          });

          ws.on('error', (err) => {
            clearTimeout(timeout);
            ws.close();
            reject(err);
          });
        });
      }, 15000);
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

