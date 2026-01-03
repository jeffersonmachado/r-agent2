/**
 * Serviço de WebSocket para atualizações em tempo real.
 * 
 * Permite que clientes se conectem via WebSocket para receber
 * atualizações em tempo real de eventos do sistema.
 * 
 * Eventos suportados:
 * - ticket.created
 * - ticket.updated
 * - ticket.message.received
 * - ticket.message.sent
 * - agent.online
 * - agent.offline
 * - flow.updated
 */

const WebSocket = require('ws');
const { WebSocketServer } = WebSocket;
const { validateToken } = require('./authService');
const logger = require('../utils/logger');

/**
 * @typedef {Object} WebSocketClient
 * @property {string} id - ID único da conexão
 * @property {WebSocket} ws - Instância do WebSocket
 * @property {string} tenantId - ID do tenant
 * @property {string} agentId - ID do agente (se autenticado)
 * @property {string} username - Username do agente
 * @property {Date} connectedAt - Data de conexão
 * @property {Date} lastActivity - Última atividade
 */

/**
 * Servidor WebSocket global.
 * @type {WebSocketServer|null}
 */
let wss = null;

/**
 * Clientes conectados.
 * @type {Map<string, WebSocketClient>}
 */
const clients = new Map();

/**
 * Inicializa o servidor WebSocket.
 * 
 * @param {http.Server} httpServer - Servidor HTTP
 */
function initializeWebSocket(httpServer) {
  if (wss) {
    logger.warn('[WebSocketService] WebSocket já inicializado');
    return;
  }

  wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    clientTracking: true,
  });

  wss.on('connection', (ws, req) => {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const client = {
      id: clientId,
      ws,
      tenantId: null,
      agentId: null,
      username: null,
      connectedAt: new Date(),
      lastActivity: new Date(),
    };

    clients.set(clientId, client);

    logger.info(`[WebSocketService] Cliente conectado: ${clientId}`);

    // Envia mensagem de boas-vindas
    sendToClient(clientId, {
      type: 'connection',
      status: 'connected',
      clientId,
      message: 'Conectado ao servidor WebSocket',
    });

    // Handler de mensagens
    ws.on('message', async (message) => {
      try {
        client.lastActivity = new Date();
        const data = JSON.parse(message.toString());

        // Autenticação
        if (data.type === 'auth' && data.token) {
          const validation = validateToken(data.token);
          if (validation.valid) {
            client.tenantId = validation.agent.tenantId;
            client.agentId = validation.agent.id;
            client.username = validation.agent.username;

            sendToClient(clientId, {
              type: 'auth',
              status: 'success',
              message: 'Autenticado com sucesso',
              agent: {
                id: validation.agent.id,
                username: validation.agent.username,
                tenantId: validation.agent.tenantId,
              },
            });

            logger.info(`[WebSocketService] Cliente ${clientId} autenticado como ${client.username}`);
          } else {
            sendToClient(clientId, {
              type: 'auth',
              status: 'error',
              message: 'Token inválido',
            });
          }
          return;
        }

        // Ping/Pong para manter conexão viva
        if (data.type === 'ping') {
          sendToClient(clientId, {
            type: 'pong',
            timestamp: new Date().toISOString(),
          });
          return;
        }

        // Subscribe a eventos
        if (data.type === 'subscribe' && Array.isArray(data.events)) {
          // Por enquanto, todos os clientes recebem todos os eventos do seu tenant
          // Pode ser melhorado com sistema de subscriptions mais granular
          sendToClient(clientId, {
            type: 'subscribe',
            status: 'success',
            message: 'Inscrito em eventos',
            events: data.events,
          });
          return;
        }

        // Mensagem desconhecida
        sendToClient(clientId, {
          type: 'error',
          message: 'Tipo de mensagem não reconhecido',
        });
      } catch (err) {
        logger.error(`[WebSocketService] Erro ao processar mensagem do cliente ${clientId}:`, err);
        sendToClient(clientId, {
          type: 'error',
          message: 'Erro ao processar mensagem',
        });
      }
    });

    // Handler de fechamento
    ws.on('close', () => {
      clients.delete(clientId);
      logger.info(`[WebSocketService] Cliente desconectado: ${clientId}`);
    });

    // Handler de erro
    ws.on('error', (err) => {
      logger.error(`[WebSocketService] Erro no WebSocket do cliente ${clientId}:`, err);
      clients.delete(clientId);
    });
  });

  // Limpeza periódica de clientes inativos
  setInterval(() => {
    const now = new Date();
    const INACTIVE_TIMEOUT = 30 * 60 * 1000; // 30 minutos

    for (const [clientId, client] of clients.entries()) {
      const inactiveTime = now - client.lastActivity;
      if (inactiveTime > INACTIVE_TIMEOUT) {
        logger.info(`[WebSocketService] Desconectando cliente inativo: ${clientId}`);
        client.ws.close();
        clients.delete(clientId);
      }
    }
  }, 5 * 60 * 1000); // Verifica a cada 5 minutos

  logger.info('[WebSocketService] Servidor WebSocket inicializado');
}

/**
 * Envia mensagem para um cliente específico.
 * 
 * @param {string} clientId - ID do cliente
 * @param {Object} data - Dados a enviar
 */
function sendToClient(clientId, data) {
  const client = clients.get(clientId);
  if (!client || client.ws.readyState !== 1) { // 1 = OPEN
    return;
  }

  try {
    client.ws.send(JSON.stringify(data));
  } catch (err) {
    logger.error(`[WebSocketService] Erro ao enviar mensagem para cliente ${clientId}:`, err);
  }
}

/**
 * Envia mensagem para todos os clientes de um tenant.
 * 
 * @param {string} tenantId - ID do tenant
 * @param {Object} data - Dados a enviar
 */
function broadcastToTenant(tenantId, data) {
  let sent = 0;
  for (const [clientId, client] of clients.entries()) {
    if (client.tenantId === tenantId && client.ws.readyState === 1) {
      try {
        client.ws.send(JSON.stringify(data));
        sent++;
      } catch (err) {
        logger.error(`[WebSocketService] Erro ao enviar broadcast para cliente ${clientId}:`, err);
      }
    }
  }
  logger.debug(`[WebSocketService] Broadcast enviado para ${sent} cliente(s) do tenant ${tenantId}`);
}

/**
 * Envia mensagem para um agente específico.
 * 
 * @param {string} agentId - ID do agente
 * @param {Object} data - Dados a enviar
 */
function sendToAgent(agentId, data) {
  let sent = 0;
  for (const [clientId, client] of clients.entries()) {
    if (client.agentId === agentId && client.ws.readyState === 1) {
      try {
        client.ws.send(JSON.stringify(data));
        sent++;
      } catch (err) {
        logger.error(`[WebSocketService] Erro ao enviar mensagem para agente ${agentId}:`, err);
      }
    }
  }
  logger.debug(`[WebSocketService] Mensagem enviada para ${sent} conexão(ões) do agente ${agentId}`);
}

/**
 * Envia evento para clientes relevantes.
 * 
 * @param {string} event - Nome do evento
 * @param {Object} payload - Dados do evento
 * @param {Object} options - Opções (tenantId, agentId)
 */
function emitEvent(event, payload, options = {}) {
  const { tenantId, agentId } = options;

  const message = {
    type: 'event',
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  };

  if (tenantId) {
    broadcastToTenant(tenantId, message);
  } else if (agentId) {
    sendToAgent(agentId, message);
  } else {
    // Broadcast para todos (cuidado!)
    logger.warn('[WebSocketService] Emitindo evento sem tenantId ou agentId - broadcast global');
    for (const [clientId, client] of clients.entries()) {
      if (client.ws.readyState === 1) {
        try {
          client.ws.send(JSON.stringify(message));
        } catch (err) {
          logger.error(`[WebSocketService] Erro ao enviar evento para cliente ${clientId}:`, err);
        }
      }
    }
  }
}

/**
 * Obtém estatísticas do WebSocket.
 * 
 * @returns {Object}
 */
function getStats() {
  const totalClients = clients.size;
  const authenticatedClients = Array.from(clients.values()).filter(
    (c) => c.agentId !== null
  ).length;

  const tenants = new Set();
  const agents = new Set();
  for (const client of clients.values()) {
    if (client.tenantId) {
      tenants.add(client.tenantId);
    }
    if (client.agentId) {
      agents.add(client.agentId);
    }
  }

  return {
    totalClients,
    authenticatedClients,
    unauthenticatedClients: totalClients - authenticatedClients,
    uniqueTenants: tenants.size,
    uniqueAgents: agents.size,
  };
}

module.exports = {
  initializeWebSocket,
  sendToClient,
  broadcastToTenant,
  sendToAgent,
  emitEvent,
  getStats,
};

