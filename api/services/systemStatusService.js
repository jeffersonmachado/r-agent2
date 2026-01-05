/**
 * Serviço de verificação de status de todos os serviços fundamentais da plataforma.
 * 
 * Verifica:
 * - API Server (Node.js)
 * - RAG Service (Python/FastAPI)
 * - Redis (Rate Limiting)
 * - WebSocket
 */

const logger = require('../utils/logger');
const config = require('../utils/config');
const { isRedisAvailable, getRateLimitClient } = require('../../infra/redis/rateLimitClient');
const { isRagAvailable, getRagServiceUrl } = require('./ragService');
const { getWebSocketServer } = require('./websocketService');

/**
 * Verifica status do Redis.
 * 
 * @returns {Promise<{status: string, details?: any, error?: string}>}
 */
async function checkRedisStatus() {
  try {
    const available = await isRedisAvailable();
    if (available) {
      const client = getRateLimitClient();
      if (client) {
        try {
          const info = await client.info('server');
          const versionMatch = info.match(/redis_version:([^\r\n]+)/);
          const version = versionMatch ? versionMatch[1].trim() : 'unknown';
          
          return {
            status: 'healthy',
            details: {
              version,
              status: client.status,
            },
          };
        } catch (infoErr) {
          // Se ping funcionou mas info falhou, ainda consideramos saudável
          logger.debug('[SystemStatus] Erro ao obter info do Redis, mas ping OK', { error: infoErr.message });
          return {
            status: 'healthy',
            details: {
              version: 'unknown',
              status: client.status,
              note: 'Ping OK, mas info não disponível',
            },
          };
        }
      }
    }
    
    // Tenta verificar se o Redis está realmente indisponível ou apenas não conectado
    const client = getRateLimitClient();
    if (client) {
      const status = client.status;
      // Se está conectando, considera como "degraded" em vez de "unhealthy"
      if (status === 'connect' || status === 'connecting') {
        return {
          status: 'degraded',
          error: `Redis conectando (status: ${status})`,
          details: {
            status: status,
            hint: 'Conexão em andamento, aguarde alguns segundos',
          },
        };
      }
      
      return {
        status: 'unhealthy',
        error: `Redis não conectado (status: ${status})`,
        details: {
          status: status,
        },
      };
    }
    
    return {
      status: 'unhealthy',
      error: 'Redis não disponível ou não conectado',
    };
  } catch (err) {
    logger.error('[SystemStatus] Erro ao verificar Redis', { error: err.message });
    return {
      status: 'unhealthy',
      error: err.message,
    };
  }
}

/**
 * Verifica status do RAG Service.
 * 
 * @returns {Promise<{status: string, details?: any, error?: string}>}
 */
async function checkRagServiceStatus() {
  try {
    const available = await isRagAvailable();
    if (available) {
      // Tenta obter informações detalhadas do health check
      const ragServiceUrl = getRagServiceUrl();
      
      // Usa fetch nativo do Node.js 18+ ou fallback
      let fetchFn;
      try {
        // Node.js 18+ tem fetch nativo
        if (typeof global.fetch === 'function') {
          fetchFn = global.fetch;
        } else {
          // Tenta usar node-fetch se disponível
          fetchFn = require('node-fetch');
        }
      } catch (err) {
        // Se não tiver fetch, retorna status básico
        return {
          status: 'healthy',
          details: {
            serviceUrl: ragServiceUrl,
            note: 'Detalhes não disponíveis (fetch não disponível)',
          },
        };
      }
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        
        const response = await fetchFn(`${ragServiceUrl}/rag/health`, {
          method: 'GET',
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const data = await response.json();
          return {
            status: 'healthy',
            details: {
              vectorStore: data.vectorStore,
              embeddingModel: data.embeddingModel,
              indexedDocuments: data.indexedDocuments || 0,
              indexedChunks: data.indexedChunks || 0,
            },
          };
        }
      } catch (fetchErr) {
        // Se falhar, retorna status básico
        logger.debug('[SystemStatus] Não foi possível obter detalhes do RAG', { error: fetchErr.message });
      }
      
      return {
        status: 'healthy',
        details: {
          serviceUrl: ragServiceUrl,
        },
      };
    }
    
    return {
      status: 'unhealthy',
      error: 'Serviço RAG não disponível',
    };
  } catch (err) {
    logger.error('[SystemStatus] Erro ao verificar RAG Service', { error: err.message });
    return {
      status: 'unhealthy',
      error: err.message,
    };
  }
}

/**
 * Verifica status do WebSocket.
 * 
 * @returns {Promise<{status: string, details?: any, error?: string}>}
 */
async function checkWebSocketStatus() {
  try {
    const wss = getWebSocketServer();
    if (wss) {
      // Obtém informações sobre clientes conectados
      const clients = wss.clients || new Set();
      const connectedCount = clients.size;
      
      // Conta clientes por estado (se disponível)
      let openClients = 0;
      let connectingClients = 0;
      let closingClients = 0;
      let closedClients = 0;
      
      if (clients.size > 0) {
        for (const client of clients) {
          const state = client.readyState;
          // Estados: 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED
          if (state === 0) connectingClients++;
          else if (state === 1) openClients++;
          else if (state === 2) closingClients++;
          else if (state === 3) closedClients++;
        }
      }
      
      // O servidor WebSocket não tem readyState - ele está sempre ativo quando inicializado
      // Mas podemos verificar se há clientes conectados
      const serverStatus = connectedCount > 0 ? 'active' : 'idle';
      
      return {
        status: 'healthy',
        details: {
          connectedClients: connectedCount,
          serverStatus: serverStatus,
          clientsByState: {
            open: openClients,
            connecting: connectingClients,
            closing: closingClients,
            closed: closedClients,
          },
        },
      };
    }
    
    return {
      status: 'unhealthy',
      error: 'Servidor WebSocket não inicializado',
    };
  } catch (err) {
    logger.error('[SystemStatus] Erro ao verificar WebSocket', { error: err.message });
    return {
      status: 'unhealthy',
      error: err.message,
    };
  }
}

/**
 * Verifica status da API Server.
 * 
 * @returns {Promise<{status: string, details?: any, error?: string}>}
 */
async function checkApiServerStatus() {
  try {
    const nodeEnv = config.get('nodeEnv', 'development');
    const apiPort = config.get('api.port', 3000);
    const uptime = process.uptime();
    
    // Informações sobre memória
    const memUsage = process.memoryUsage();
    
    return {
      status: 'healthy',
      details: {
        environment: nodeEnv,
        port: apiPort,
        uptime: Math.floor(uptime),
        uptimeFormatted: formatUptime(uptime),
        memory: {
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
          rss: Math.round(memUsage.rss / 1024 / 1024), // MB
        },
        nodeVersion: process.version,
      },
    };
  } catch (err) {
    logger.error('[SystemStatus] Erro ao verificar API Server', { error: err.message });
    return {
      status: 'unhealthy',
      error: err.message,
    };
  }
}

/**
 * Formata uptime em formato legível.
 * 
 * @param {number} seconds - Segundos de uptime
 * @returns {string}
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

/**
 * Verifica status de todos os serviços.
 * 
 * @returns {Promise<{timestamp: string, services: Object, overall: {status: string, healthy: number, total: number}}>}
 */
async function checkServicesStatus() {
  const timestamp = new Date().toISOString();
  
  // Verifica todos os serviços em paralelo
  const [apiServer, ragService, redis, webSocket] = await Promise.all([
    checkApiServerStatus(),
    checkRagServiceStatus(),
    checkRedisStatus(),
    checkWebSocketStatus(),
  ]);
  
  const services = {
    apiServer: {
      name: 'API Server',
      description: 'Servidor principal da API (Node.js)',
      ...apiServer,
    },
    ragService: {
      name: 'RAG Service',
      description: 'Serviço de Retrieval-Augmented Generation (Python/FastAPI)',
      ...ragService,
    },
    redis: {
      name: 'Redis',
      description: 'Cache e rate limiting',
      ...redis,
    },
    webSocket: {
      name: 'WebSocket',
      description: 'Conexões em tempo real',
      ...webSocket,
    },
  };
  
  // Calcula status geral
  const serviceStatuses = Object.values(services);
  const healthy = serviceStatuses.filter(s => s.status === 'healthy').length;
  const total = serviceStatuses.length;
  const overallStatus = healthy === total ? 'healthy' : healthy > 0 ? 'degraded' : 'unhealthy';
  
  return {
    timestamp,
    services,
    overall: {
      status: overallStatus,
      healthy,
      total,
      percentage: Math.round((healthy / total) * 100),
    },
  };
}

module.exports = {
  checkServicesStatus,
  checkApiServerStatus,
  checkRagServiceStatus,
  checkRedisStatus,
  checkWebSocketStatus,
};

