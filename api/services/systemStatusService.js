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

function safeErrorMessage(err, fallback = '') {
  if (!err) return fallback;
  let message;
  try {
    message = err?.message;
  } catch (_) {
    message = null;
  }
  if (message !== null && message !== undefined) {
    try { return String(message); } catch (_) {}
  }
  try { return String(err); } catch (_) { return fallback; }
}
const { isRedisAvailable, getRateLimitClient } = require('../../infra/redis/rateLimitClient');
const { isRagAvailable, getRagServiceUrl } = require('./ragService');
const { getWebSocketServer } = require('./websocketService');
const { getSequelize } = require('../db/sequelize');
const { RagDocument: RagDocumentGetter } = require('../db/models');

function getConfiguredRedisUrl() {
  return config.get('rateLimit.redis.url')
    || process.env.RATE_LIMIT_REDIS_URL
    || process.env.REDIS_URL
    || null;
}

/**
 * Extrai a porta de uma URL.
 * 
 * @param {string} urlString - URL completa
 * @param {number} defaultPort - Porta padrão se não encontrar
 * @returns {number} Porta extraída
 */
function extractPortFromUrl(urlString, defaultPort = null) {
  if (!urlString) return defaultPort;
  
  // Primeiro tenta extrair porta manualmente (mais confiável)
  const portMatch = urlString.match(/:(\d+)(?:\/|$)/);
  if (portMatch) {
    const extractedPort = parseInt(portMatch[1], 10);
    if (!isNaN(extractedPort) && extractedPort > 0 && extractedPort <= 65535) {
      return extractedPort;
    }
  }
  
  // Se não encontrou porta explícita, tenta parsear URL
  try {
    const url = new URL(urlString);
    if (url.port) {
      return parseInt(url.port, 10);
    }
    // Se não tiver porta explícita, retorna padrão baseado no protocolo
    if (url.protocol === 'https:') return 443;
    if (url.protocol === 'http:') return 80;
    if (url.protocol === 'redis:') return 6379;
    if (url.protocol === 'rediss:') return 6380;
    return defaultPort;
  } catch (urlErr) {
    // Se falhar ao parsear URL, retorna defaultPort
    return defaultPort;
  }
}

/**
 * Verifica status do Redis.
 * 
 * @returns {Promise<{status: string, details?: any, error?: string}>}
 */
async function checkRedisStatus() {
  try {
    const redisUrl = getConfiguredRedisUrl();
    if (!redisUrl) {
      return {
        status: 'healthy',
        details: {
          configured: false,
          mode: 'memory',
          note: 'Redis não configurado; fallback em memória ativo fora de produção',
        },
      };
    }

    const available = await isRedisAvailable();
    if (available) {
      const client = getRateLimitClient();
      if (client) {
        try {
          const info = await client.info('server');
          const versionMatch = info.match(/redis_version:([^\r\n]+)/);
          const version = versionMatch ? versionMatch[1].trim() : 'unknown';
          
          const port = extractPortFromUrl(redisUrl, 6379);
          
          return {
            status: 'healthy',
            details: {
              port: port,
              version,
              status: client.status,
            },
          };
        } catch (infoErr) {
          // Se ping funcionou mas info falhou, ainda consideramos saudável
          logger.debug('[SystemStatus] Erro ao obter info do Redis, mas ping OK', { error: safeErrorMessage(infoErr) });
          const port = extractPortFromUrl(redisUrl, 6379);
          
          return {
            status: 'healthy',
            details: {
              port: port,
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
    
    // Tenta obter informações sobre a configuração do Redis
    return {
      status: 'unhealthy',
      error: 'Redis não disponível ou não conectado',
      details: {
        redisUrl: redisUrl,
        hint: 'Verifique se o Redis está rodando e acessível na URL configurada',
      },
    };
  } catch (err) {
    logger.error('[SystemStatus] Erro ao verificar Redis', { error: safeErrorMessage(err) });
    const redisUrl = getConfiguredRedisUrl();
    return {
      status: 'unhealthy',
      error: safeErrorMessage(err),
      details: {
        redisUrl: redisUrl,
        errorType: 'verification_error',
        hint: 'Erro ao verificar status do Redis',
      },
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
        // Extrai a porta da URL do serviço RAG
        const port = extractPortFromUrl(ragServiceUrl, 8001);
        
        return {
          status: 'healthy',
          details: {
            port: port,
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
          
          // Extrai a porta da URL do serviço RAG
          const port = extractPortFromUrl(ragServiceUrl, 8001);

          // -------------------------------------------------------------------
          // Unificação: também reporta consistência BD vs Vector Store (agregado)
          // - /system/status é público, então NÃO usa tenantId (agregado).
          // - Compara apenas contagens (não vaza conteúdo).
          // -------------------------------------------------------------------
          let dbIndexedDocuments = null;
          let dbInconsistentDocuments = null;
          let consistency = null;
          try {
            if (getSequelize()) {
              const RagDocumentModel = typeof RagDocumentGetter === 'function' ? RagDocumentGetter() : RagDocumentGetter;
              dbIndexedDocuments = await RagDocumentModel.count({ where: { index_status: 'indexed' } });
              dbInconsistentDocuments = await RagDocumentModel.count({ where: { inconsistent: true } });

              const vectorDocs = data.indexedDocuments || 0;
              const vectorChunks = data.indexedChunks || 0;
              const inconsistent =
                (dbIndexedDocuments || 0) > 0 &&
                (vectorChunks === 0 || vectorDocs === 0);

              consistency = {
                status: inconsistent ? 'warning' : 'ok',
                dbIndexedDocuments,
                dbInconsistentDocuments,
                vectorIndexedDocuments: vectorDocs,
                vectorIndexedChunks: vectorChunks,
                deltaDocuments: (dbIndexedDocuments || 0) - vectorDocs,
                message: inconsistent
                  ? `Inconsistência RAG detectada (BD indexed=${dbIndexedDocuments}, vector docs=${vectorDocs}, vector chunks=${vectorChunks})`
                  : 'Consistência RAG OK (BD vs Vector Store)',
              };
            }
          } catch (dbErr) {
            // Best-effort: não quebra /system/status se DB estiver indisponível
            logger.debug('[SystemStatus] Não foi possível obter contagem do BD para consistência RAG', { error: safeErrorMessage(dbErr) });
          }
          
          return {
            status: 'healthy',
            details: {
              port: port,
              vectorStore: data.vectorStore,
              embeddingModel: data.embeddingModel,
              indexedDocuments: data.indexedDocuments || 0,
              indexedChunks: data.indexedChunks || 0,
              dbIndexedDocuments,
              dbInconsistentDocuments,
              consistency,
            },
          };
        }
      } catch (fetchErr) {
        // Se falhar, retorna status básico
        logger.debug('[SystemStatus] Não foi possível obter detalhes do RAG', { error: safeErrorMessage(fetchErr) });
      }
      
      // Extrai a porta da URL do serviço RAG
      const port = extractPortFromUrl(ragServiceUrl, 8001);
      
      return {
        status: 'healthy',
        details: {
          port: port,
          serviceUrl: ragServiceUrl,
        },
      };
    }
    
    // Tenta obter a URL do serviço para incluir na mensagem de erro
    const ragServiceUrl = getRagServiceUrl();
    
    // Tenta fazer uma verificação mais detalhada do erro
    let errorDetails = {
      serviceUrl: ragServiceUrl,
      error: 'Serviço RAG não disponível',
    };
    
    try {
      // Tenta fazer uma requisição para obter mais informações sobre o erro
      const fetchFn = typeof global.fetch === 'function' ? global.fetch : require('node-fetch');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      try {
        const response = await fetchFn(`${ragServiceUrl}/rag/health`, {
          method: 'GET',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          errorDetails.error = `Serviço RAG retornou status HTTP ${response.status}`;
          errorDetails.httpStatus = response.status;
        }
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        if (fetchErr.name === 'AbortError') {
          errorDetails.error = 'Timeout ao conectar com serviço RAG';
          errorDetails.errorType = 'timeout';
        } else if (safeErrorMessage(fetchErr).includes('ECONNREFUSED')) {
          errorDetails.error = 'Conexão recusada - serviço RAG não está rodando';
          errorDetails.errorType = 'connection_refused';
        } else if (safeErrorMessage(fetchErr).includes('ENOTFOUND')) {
          errorDetails.error = `Host não encontrado: ${ragServiceUrl}`;
          errorDetails.errorType = 'host_not_found';
        } else {
          errorDetails.error = `Erro ao conectar: ${safeErrorMessage(fetchErr)}`;
          errorDetails.errorType = 'connection_error';
        }
      }
    } catch (checkErr) {
      // Se não conseguir fazer verificação adicional, mantém erro básico
      logger.debug('[SystemStatus] Não foi possível obter detalhes do erro RAG', { error: safeErrorMessage(checkErr) });
    }
    
    return {
      status: 'unhealthy',
      error: safeErrorMessage(errorDetails.error),
      details: {
        serviceUrl: errorDetails.serviceUrl,
        errorType: errorDetails.errorType,
        httpStatus: errorDetails.httpStatus,
        hint: 'Verifique se o serviço RAG está rodando e acessível na URL configurada',
      },
    };
  } catch (err) {
    logger.error('[SystemStatus] Erro ao verificar RAG Service', { error: safeErrorMessage(err) });
    const ragServiceUrl = getRagServiceUrl();
    return {
      status: 'unhealthy',
      error: safeErrorMessage(err),
      details: {
        serviceUrl: ragServiceUrl,
        hint: 'Erro ao verificar status do serviço RAG',
      },
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
      
      // Obtém a porta da API (WebSocket usa a mesma porta)
      const apiPort = config.get('api.port', 3000);
      
      return {
        status: 'healthy',
        details: {
          port: apiPort,
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
      details: {
        hint: 'O servidor WebSocket pode não ter sido inicializado corretamente. Verifique os logs da API.',
      },
    };
  } catch (err) {
    logger.error('[SystemStatus] Erro ao verificar WebSocket', { error: safeErrorMessage(err) });
    return {
      status: 'unhealthy',
      error: safeErrorMessage(err),
      details: {
        errorType: 'verification_error',
        hint: 'Erro ao verificar status do servidor WebSocket',
      },
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
    logger.error('[SystemStatus] Erro ao verificar API Server', { error: safeErrorMessage(err) });
    const apiPort = config.get('api.port', 3000);
    return {
      status: 'unhealthy',
      error: safeErrorMessage(err),
      details: {
        port: apiPort,
        errorType: 'verification_error',
        hint: 'Erro ao verificar status do servidor API',
      },
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

