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

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeTrim(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value).trim(); } catch (_) { return fallback; }
}

function safeErrorMessage(err, fallback = '') {
  if (err == null) return fallback;
  let message = '';
  try { message = err.message; } catch (_) { message = ''; }
  if (message) {
    try { return String(message); } catch (_) { return fallback; }
  }
  try { return String(err); } catch (_) { return fallback; }
}

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
 * Índice de clientes por tenant (chave null agrupa não autenticados).
 * Mantido no connect/auth/disconnect para que broadcastToTenant não
 * precise varrer clientes de todos os tenants.
 * @type {Map<string|null, Set<WebSocketClient>>}
 */
const tenantClients = new Map();

function addClientToTenantIndex(client) {
  const key = client.tenantId || null;
  let set = tenantClients.get(key);
  if (!set) {
    set = new Set();
    tenantClients.set(key, set);
  }
  set.add(client);
}

function removeClientFromTenantIndex(client) {
  if (!client) return;
  const key = client.tenantId || null;
  const set = tenantClients.get(key);
  if (set) {
    set.delete(client);
    if (set.size === 0) tenantClients.delete(key);
  }
}

// Remove cliente do mapa principal e do índice por tenant (todos os
// caminhos de desconexão/limpeza devem usar este helper).
function removeClient(clientId) {
  const client = clients.get(clientId);
  if (client) {
    removeClientFromTenantIndex(client);
    clients.delete(clientId);
  }
}

function getConnectedAgentsByTenant(tenantId) {
  const result = new Map();
  if (!tenantId) return result;
  for (const client of clients.values()) {
    if (!client || client.tenantId !== tenantId) continue;
    if (!client.agentId) continue;
    const agentId = safeToString(client.agentId);
    const existing = result.get(agentId);
    if (!existing) {
      result.set(agentId, {
        agentId,
        connections: 1,
        lastActivity: client.lastActivity ? client.lastActivity.toISOString() : null,
      });
    } else {
      existing.connections += 1;
      const last = client.lastActivity ? client.lastActivity.toISOString() : null;
      if (last && (!existing.lastActivity || last > existing.lastActivity)) {
        existing.lastActivity = last;
      }
    }
  }
  return result;
}

/**
 * Rate limit de handshakes WebSocket por cliente.
 *
 * Protege o servidor contra clientes que reconectam em loop (ex.: token
 * inválido retentando indefinidamente). Caso real de 2026-09-30: cliente em
 * Electron/VS Code abrindo ~12 conexões/min durante horas, pressionando a API e
 * o Postgres.
 *
 * DESLIGADO POR PADRÃO (RATE_LIMIT_WS_POINTS=0). Motivo medido em produção: o
 * Apache fala com a API por um salto de rede que sofre SNAT para o IP do host
 * (10.10.2.30) e o X-Forwarded-For não chega no upgrade do WebSocket, então
 * todos os clientes caem no mesmo balde e o limite bloqueia a todos (o teste em
 * produção zerou as conexões aceitas). Para habilitar com segurança é preciso
 * antes propagar o IP real do cliente (PROXY protocol + mod_remoteip no Apache)
 * ou identificar o cliente por outro atributo (ex.: id de instância enviado pela
 * própria aplicação).
 */
const WS_RATE_LIMIT_POINTS = Number.parseInt(process.env.RATE_LIMIT_WS_POINTS ?? '0', 10);
const WS_RATE_LIMIT_WINDOW_MS =
  Number.parseInt(process.env.RATE_LIMIT_WS_DURATION ?? '60', 10) * 1000;
const wsConnectAttempts = new Map(); // ip -> [timestamps]

/**
 * Resolve o IP do cliente considerando proxies reversos (X-Forwarded-For).
 *
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
function resolveClientIp(req) {
  const forwarded = safeTrim(req?.headers?.['x-forwarded-for']);
  if (forwarded) {
    return safeTrim(forwarded.split(',')[0]) || 'unknown';
  }
  return safeTrim(req?.socket?.remoteAddress) || 'unknown';
}

/**
 * Verifica (e registra) a taxa de handshakes WS do IP informado.
 *
 * @param {string} ip
 * @returns {boolean} true quando o limite foi excedido
 */
function isWsConnectRateLimited(ip) {
  if (!Number.isFinite(WS_RATE_LIMIT_POINTS) || WS_RATE_LIMIT_POINTS <= 0) {
    return false;
  }

  const now = Date.now();
  const windowStart = now - WS_RATE_LIMIT_WINDOW_MS;
  const recent = (wsConnectAttempts.get(ip) || []).filter((ts) => ts > windowStart);
  recent.push(now);
  wsConnectAttempts.set(ip, recent);

  // Limpeza oportunista: evita crescimento indefinido do mapa.
  if (wsConnectAttempts.size > 5000) {
    for (const [key, attempts] of wsConnectAttempts.entries()) {
      const alive = attempts.filter((ts) => ts > windowStart);
      if (alive.length === 0) {
        wsConnectAttempts.delete(key);
      } else {
        wsConnectAttempts.set(key, alive);
      }
    }
  }

  return recent.length > WS_RATE_LIMIT_POINTS;
}

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
    // Rejeita o upgrade (429) quando o cliente excede o limite de conexões por
    // janela — evita que um cliente em loop consuma o servidor inteiro.
    verifyClient: (info, callback) => {
      const clientIp = resolveClientIp(info.req);
      if (isWsConnectRateLimited(clientIp)) {
        logger.warn('[WebSocketService] Handshake bloqueado por rate limit', {
          clientIp,
          points: WS_RATE_LIMIT_POINTS,
          windowMs: WS_RATE_LIMIT_WINDOW_MS,
        });
        callback(false, 429, 'Too Many Requests');
        return;
      }
      callback(true);
    },
  });

  wss.on('error', (err) => {
    logger.error('[WebSocketService] Erro no servidor WebSocket:', safeErrorMessage(err));
  });

  wss.on('connection', (ws, req) => {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const client = {
      id: clientId,
      ws,
      tenantId: null,
      agentId: null,
      username: null,
      authenticated: false,
      // Subscriptions por executionId (pipeline)
      executionIds: new Set(),
      connectedAt: new Date(),
      lastActivity: new Date(),
    };

    clients.set(clientId, client);

    // Conexão pré-login é legítima (SPA conecta antes do login e autentica
    // depois): NÃO há deadline de handshake. A invariante de segurança é
    // garantida sem ele — subscribe exige autenticação e broadcasts só vão
    // para clientes autenticados do mesmo tenant.

    logger.info(`[WebSocketService] Cliente conectado: ${clientId}`);

    // Envia mensagem de boas-vindas
    sendToClient(clientId, {
      type: 'connection',
      status: 'authentication_required',
      clientId,
      message: 'Conectado; autentique antes de assinar ou receber eventos',
    });

    // Handler de mensagens
    ws.on('message', async (message) => {
      try {
        client.lastActivity = new Date();
        const data = JSON.parse(safeToString(message));

        // Autenticação
        if (data.type === 'auth' && data.token) {
          const validation = validateToken(data.token);
          if (validation.valid) {
            const tenantId = safeTrim(validation.agent?.tenantId || validation.agent?.tenant_id);
            if (!tenantId) {
              sendToClient(clientId, { type: 'auth', status: 'error', message: 'Token sem tenant válido' });
              try { ws.close(4403, 'tenant_required'); } catch (_) { /* noop */ }
              return;
            }
            removeClientFromTenantIndex(client);
            client.tenantId = tenantId;
            client.agentId = validation.agent.id;
            client.username = validation.agent.username;
            client.authenticated = true;
            addClientToTenantIndex(client);

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
            setTimeout(() => {
              try { ws.close(4401, 'invalid_token'); } catch (_) { /* noop */ }
            }, 10);
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

        if (!client.authenticated || !client.tenantId || !client.agentId) {
          sendToClient(clientId, {
            type: 'error',
            code: 'authentication_required',
            message: 'Autentique antes de assinar eventos',
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

        // Subscribe por executionId (pipeline): permite isolar eventos por execução
        if (data.type === 'subscribeExecution' && data.executionId) {
          const executionId = typeof data.executionId === 'string' ? safeTrim(data.executionId) : '';
          const isValidExecutionId = !!(executionId && executionId.length <= 96 && /^exec-[a-zA-Z0-9-]+$/.test(executionId));
          if (!isValidExecutionId) {
            sendToClient(clientId, {
              type: 'subscribeExecution',
              status: 'error',
              message: 'executionId inválido',
              executionId: executionId || null,
            });
            return;
          }
          client.executionIds.add(executionId);
          sendToClient(clientId, {
            type: 'subscribeExecution',
            status: 'success',
            message: 'Inscrito no executionId',
            executionId,
          });
          return;
        }

        if (data.type === 'unsubscribeExecution' && data.executionId) {
          const executionId = typeof data.executionId === 'string' ? safeTrim(data.executionId) : '';
          if (executionId) client.executionIds.delete(executionId);
          sendToClient(clientId, {
            type: 'unsubscribeExecution',
            status: 'success',
            message: 'Desinscrito do executionId',
            executionId: executionId || null,
          });
          return;
        }

        // Mensagem desconhecida
        sendToClient(clientId, {
          type: 'error',
          message: 'Tipo de mensagem não reconhecido',
        });
      } catch (err) {
        logger.error(`[WebSocketService] Erro ao processar mensagem do cliente ${clientId}:`, safeErrorMessage(err));
        sendToClient(clientId, {
          type: 'error',
          message: 'Erro ao processar mensagem',
        });
      }
    });

    // Handler de fechamento
    ws.on('close', () => {
      removeClient(clientId);
      logger.info(`[WebSocketService] Cliente desconectado: ${clientId}`);
    });

    // Handler de erro
    ws.on('error', (err) => {
      logger.error(`[WebSocketService] Erro no WebSocket do cliente ${clientId}:`, safeErrorMessage(err));
      removeClient(clientId);
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
        removeClient(clientId);
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
    logger.error(`[WebSocketService] Erro ao enviar mensagem para cliente ${clientId}:`, safeErrorMessage(err));
  }
}

/**
 * Envia mensagem para todos os clientes de um tenant.
 * 
 * @param {string} tenantId - ID do tenant
 * @param {Object} data - Dados a enviar
 */
function broadcastToTenant(tenantId, data) {
  if (!tenantId) return 0;
  // Serializa uma única vez fora do loop
  const payload = JSON.stringify(data);
  let sent = 0;
  const tenantSet = tenantClients.get(tenantId || null);
  if (tenantSet) {
    for (const client of tenantSet) {
      if (client.authenticated && client.agentId && client.ws.readyState === 1) {
        try {
          client.ws.send(payload);
          sent++;
        } catch (err) {
          logger.error(`[WebSocketService] Erro ao enviar broadcast para cliente ${client.id}:`, safeErrorMessage(err));
        }
      }
    }
  }
  // Mantém debug para alto volume, mas sobe para info no caso do pipeline (para diagnóstico).
  const isPipelineStatus = data?.type === 'event' && data?.event === 'pipeline.status';
  const msg = `[WebSocketService] Broadcast enviado para ${sent} cliente(s) do tenant ${tenantId}`;
  if (isPipelineStatus) {
    logger.info(msg, {
      tenantId,
      sent,
      executionId: data?.data?.executionId || null,
      status: data?.data?.status || null,
    });
  } else {
    logger.debug(msg);
  }
  return sent;
}

/**
 * Envia mensagem apenas para clientes de um tenant inscritos no executionId.
 *
 * @param {string} tenantId
 * @param {string} executionId
 * @param {Object} data
 */
function broadcastToExecution(tenantId, executionId, data) {
  const payload = JSON.stringify(data);
  let sent = 0;
  const tenantSet = tenantClients.get(tenantId || null);
  if (tenantSet) {
    for (const client of tenantSet) {
      if (!client.authenticated || !client.agentId) continue;
      if (!client.executionIds || !(client.executionIds instanceof Set)) continue;
      if (!client.executionIds.has(executionId)) continue;
      if (client.ws.readyState !== 1) continue;
      try {
        client.ws.send(payload);
        sent++;
      } catch (err) {
        logger.error(`[WebSocketService] Erro ao enviar broadcast (execution) para cliente ${client.id}:`, safeErrorMessage(err));
      }
    }
  }
  logger.info('[WebSocketService] Broadcast (execution) enviado', { tenantId, executionId, sent, event: data?.event || null });
  return sent;
}

/**
 * Envia mensagem para um agente específico.
 * 
 * @param {string} agentId - ID do agente
 * @param {Object} data - Dados a enviar
 * @param {string} tenantId - Tenant autenticado do agente
 */
function sendToAgent(agentId, data, tenantId) {
  const scopedTenantId = safeTrim(tenantId);
  const scopedAgentId = safeTrim(agentId);
  if (!scopedTenantId || !scopedAgentId) {
    logger.error('[WebSocketService] Mensagem para agente descartada sem tenant/agent', {
      hasTenantId: Boolean(scopedTenantId),
      hasAgentId: Boolean(scopedAgentId),
    });
    return 0;
  }
  const payload = JSON.stringify(data);
  let sent = 0;
  const tenantSet = tenantClients.get(scopedTenantId);
  if (tenantSet) {
    for (const client of tenantSet) {
      if (!client.authenticated || safeTrim(client.agentId) !== scopedAgentId || client.ws.readyState !== 1) continue;
      try {
        client.ws.send(payload);
        sent++;
      } catch (err) {
        logger.error(`[WebSocketService] Erro ao enviar mensagem para agente ${scopedAgentId}:`, safeErrorMessage(err));
      }
    }
  }
  logger.debug(`[WebSocketService] Mensagem enviada para ${sent} conexão(ões) do agente ${scopedAgentId}`);
  return sent;
}

/**
 * Envia evento para clientes relevantes.
 * 
 * @param {string} event - Nome do evento
 * @param {Object} payload - Dados do evento
 * @param {Object} options - Opções (tenantId, agentId, executionId)
 */
function emitEvent(event, payload, options = {}) {
  const { tenantId, agentId, executionId } = options;

  const message = {
    type: 'event',
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  };

  if (tenantId) {
    // Observabilidade: eventos críticos para pipeline devem ser rastreáveis em DEV.
    if (event === 'pipeline.status') {
      logger.info('[WebSocketService] Emitindo pipeline.status', {
        tenantId,
        executionId: payload?.executionId || null,
        status: payload?.status || null,
        stages: payload?.stages ? Object.keys(payload.stages).filter((k) => payload.stages[k] === true) : [],
      });
    }
    if (agentId) {
      return sendToAgent(agentId, message, tenantId);
    }
    if (executionId && typeof executionId === 'string' && safeTrim(executionId)) {
      return broadcastToExecution(tenantId, safeTrim(executionId), message);
    } else {
      return broadcastToTenant(tenantId, message);
    }
  } else {
    logger.error('[WebSocketService] Evento descartado por ausência de tenantId', { event });
    return 0;
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

/**
 * Obtém informações detalhadas sobre conexões WebSocket.
 * 
 * @returns {Object}
 */
function getConnectionsInfo() {
  const stats = getStats();
  const wss = getWebSocketServer();
  
  const connections = Array.from(clients.values()).map((client) => {
    const readyState = client.ws.readyState;
    const stateNames = {
      0: 'CONNECTING',
      1: 'OPEN',
      2: 'CLOSING',
      3: 'CLOSED',
    };
    
    return {
      id: client.id,
      state: stateNames[readyState] || 'UNKNOWN',
      authenticated: client.authenticated === true && client.agentId !== null,
      tenantId: client.tenantId || null,
      agentId: client.agentId || null,
      username: client.username || null,
      connectedAt: client.connectedAt.toISOString(),
      lastActivity: client.lastActivity.toISOString(),
      uptime: Math.floor((Date.now() - client.connectedAt.getTime()) / 1000), // em segundos
    };
  });

  return {
    server: {
      initialized: wss !== null,
      path: wss ? '/ws' : null,
    },
    stats,
    connections,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Obtém o servidor WebSocket.
 * 
 * @returns {WebSocketServer|null}
 */
function getWebSocketServer() {
  return wss;
}

/**
 * Verifica se um agente está online (tem ao menos uma conexão WebSocket autenticada OPEN).
 * @param {string} agentId
 * @returns {boolean}
 */
function isAgentOnline(agentId) {
  if (!agentId) return false;
  for (const client of clients.values()) {
    if (client.agentId === agentId && client.ws.readyState === 1) return true;
  }
  return false;
}

/**
 * Retorna IDs de agentes online para um tenant.
 * @param {string} tenantId
 * @returns {string[]}
 */
function getOnlineAgentsByTenant(tenantId) {
  const set = new Set();
  if (!tenantId) return [];
  for (const client of clients.values()) {
    if (client.tenantId === tenantId && client.agentId && client.ws.readyState === 1) {
      set.add(client.agentId);
    }
  }
  return Array.from(set.values());
}

/**
 * Encerra o servidor WebSocket e limpa conexões.
 *
 * @returns {Promise<void>}
 */
async function shutdownWebSocket() {
  if (!wss) return;

  try {
    for (const client of clients.values()) {
      try {
        if (client.ws && client.ws.readyState === WebSocket.OPEN) {
          client.ws.close();
        }
      } catch {
        // best-effort
      }
    }
    clients.clear();
    tenantClients.clear();
  } catch {
    // best-effort
  }

  await new Promise((resolve) => {
    try {
      wss.close(() => resolve());
    } catch {
      resolve();
    }
  });

  wss = null;
}

module.exports = {
  initializeWebSocket,
  shutdownWebSocket,
  sendToClient,
  broadcastToTenant,
  broadcastToExecution,
  sendToAgent,
  emitEvent,
  getStats,
  getConnectionsInfo,
  getWebSocketServer,
  isAgentOnline,
  getOnlineAgentsByTenant,
  getConnectedAgentsByTenant,
  // Funções internas para testes
  _internal: {
    clients,
    tenantClients,
    removeClient,
    resolveClientIp,
    isWsConnectRateLimited,
    wsConnectAttempts,
  },
};
