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
const { getRagHealth, getRagServiceUrl } = require('./ragService');
const { getRagInternalHeaders } = require('./rag/ragRuntime');
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
      const nodeEnv = process.env.NODE_ENV || 'development';
      const allowRedisToMemoryFallback = config.get('fallbacks.rateLimitRedisToMemory', false) === true;
      const isProduction = nodeEnv === 'production';

      return {
        status: isProduction ? 'unhealthy' : 'degraded',
        ...(isProduction ? { error: 'Redis não configurado em produção' } : {}),
        details: {
          configured: false,
          mode: 'memory',
          fallbackEnabled: allowRedisToMemoryFallback,
          environment: nodeEnv,
          note: isProduction
            ? 'Redis é obrigatório em produção para rate limiting seguro'
            : allowRedisToMemoryFallback
              ? 'Redis não configurado; fallback em memória permitido fora de produção'
              : 'Redis não configurado; fallback Redis→memória desabilitado',
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
    // TRI-ESTADO: o serviço Python publica `healthy`, `degraded` (liveness OK
    // mas readiness negada — ex.: `database_not_configured`) e ausência/erro.
    // Antes o adapter colapsava tudo em booleano (`status === 'healthy'`), e um
    // RAG degradado aparecia no /dev como "Serviço RAG não disponível"
    // (vermelho), escondendo a causa real do operador.
    const health = await getRagHealth();
    const available = health.state === 'healthy';

    if (health.state === 'degraded') {
      const degradedPayload = health.payload || {};
      const degradedReason = degradedPayload.reason || health.reason || 'not_ready';
      const degradedServiceUrl = health.serviceUrl || getRagServiceUrl();
      return {
        status: 'degraded',
        error: `Serviço RAG no ar, mas não está pronto para servir requisições (${degradedReason})`,
        details: {
          port: extractPortFromUrl(degradedServiceUrl, 8001),
          serviceUrl: degradedServiceUrl,
          ready: degradedPayload.ready === true,
          reason: degradedReason,
          dbConfigured: degradedPayload.dbConfigured ?? null,
          vectorStore: degradedPayload.vectorStore ?? null,
          embeddingModel: degradedPayload.embeddingModel ?? null,
          hint: degradedPayload.dbConfigured === false
            ? 'RAG subiu sem banco configurado (DSN/Postgres): suba com --env-file .env — nesse estado nenhuma indexação/consulta persiste.'
            : 'Liveness OK e readiness negada pelo serviço RAG. Inspecione /rag/health.',
        },
      };
    }

    if (available) {
      // Detalhes: reutiliza o payload JÁ medido por getRagHealth. Antes havia um
      // segundo probe de /rag/health aqui — redundante (custava até 2s por
      // chamada em /system/status) e origem de um "healthy básico" sem
      // consistência quando esse probe falhava.
      const ragServiceUrl = health.serviceUrl || getRagServiceUrl();
      const data = health.payload || {};

      // Extrai a porta da URL do serviço RAG
      const port = extractPortFromUrl(ragServiceUrl, 8001);

      // -------------------------------------------------------------------
      // Unificação: também reporta consistência BD vs Vector Store (agregado)
      // - /system/status é público, então NÃO usa tenantId (agregado).
      // - Compara apenas contagens (não vaza conteúdo).
      // -------------------------------------------------------------------
      let dbIndexedDocuments = null;
      let dbInconsistentDocuments = null;
      let dbFailedDocuments = null;
      let dbTotalDocuments = null;
      let consistency = null;
      // Saúde do ÍNDICE (não do processo): o /dev precisa enxergar drift
      // BD↔vetor e documentos presos em `failed`, não só o heartbeat.
      let indexHealth = null;
      let indexDriftDetected = false;
      try {
        if (getSequelize()) {
          const RagDocumentModel = typeof RagDocumentGetter === 'function' ? RagDocumentGetter() : RagDocumentGetter;
          dbIndexedDocuments = await RagDocumentModel.count({ where: { index_status: 'indexed' } });
          dbInconsistentDocuments = await RagDocumentModel.count({ where: { inconsistent: true } });
          try {
            dbFailedDocuments = await RagDocumentModel.count({ where: { index_status: 'failed' } });
            dbTotalDocuments = await RagDocumentModel.count();
          } catch (indexCountErr) {
            logger.debug('[SystemStatus] Falha ao contar documentos failed/total (best-effort)', { error: safeErrorMessage(indexCountErr) });
          }

          // Vetores: conta direto do pgvector (mesma fonte de verdade do BD).
          // Não usa `data.indexedDocuments` do /rag/health, que é
          // scope-restricted sem tenant_id (retorna 0) e gerava falso
          // warning de inconsistência.
          let vectorDocs = 0;
          let vectorChunks = 0;
          try {
            const [vectorRows] = await getSequelize().query(
              `SELECT COUNT(*)::int AS chunks, COUNT(DISTINCT document_id)::int AS docs FROM rag_chunks`,
            );
            const vectorRow = Array.isArray(vectorRows) && vectorRows[0] ? vectorRows[0] : null;
            vectorChunks = Number(vectorRow?.chunks || 0);
            vectorDocs = Number(vectorRow?.docs || 0);
          } catch (vectorErr) {
            logger.debug('[SystemStatus] Falha ao contar rag_chunks (best-effort)', { error: safeErrorMessage(vectorErr) });
          }

          const inconsistent =
            (dbIndexedDocuments || 0) > 0 &&
            (vectorChunks === 0 || vectorDocs === 0);

          // Drift real = índice declarado no BD sem representação no vetor
          // (ou documentos marcados `inconsistent`). Diferença de contagem
          // sozinha NÃO degrada: é usada apenas como informação.
          indexDriftDetected = inconsistent || (Number(dbInconsistentDocuments) || 0) > 0;

          indexHealth = {
            total: dbTotalDocuments,
            indexed: dbIndexedDocuments,
            failed: dbFailedDocuments,
            inconsistent: dbInconsistentDocuments,
          };

          consistency = {
            status: indexDriftDetected ? 'warning' : 'ok',
            dbIndexedDocuments,
            dbInconsistentDocuments,
            dbFailedDocuments,
            dbTotalDocuments,
            vectorIndexedDocuments: vectorDocs,
            vectorIndexedChunks: vectorChunks,
            deltaDocuments: (dbIndexedDocuments || 0) - vectorDocs,
            message: indexDriftDetected
              ? `Inconsistência RAG detectada (BD indexed=${dbIndexedDocuments}, vector docs=${vectorDocs}, vector chunks=${vectorChunks}, inconsistent=${dbInconsistentDocuments})`
              : 'Consistência RAG OK (BD vs Vector Store)',
          };
        }
      } catch (dbErr) {
        // Best-effort: não quebra /system/status se DB estiver indisponível
        logger.debug('[SystemStatus] Não foi possível obter contagem do BD para consistência RAG', { error: safeErrorMessage(dbErr) });
      }

      return {
        // Índice com drift (BD↔vetor ou documentos `inconsistent`) é
        // `degraded`: o processo responde, mas a recuperação serve dados
        // inconsistentes. Liveness/readiness do serviço seguem OK.
        status: indexDriftDetected ? 'degraded' : 'healthy',
        ...(indexDriftDetected
          ? { error: consistency ? consistency.message : 'Inconsistência do índice RAG detectada' }
          : {}),
        details: {
          port: port,
          vectorStore: data.vectorStore,
          embeddingModel: data.embeddingModel,
          indexedDocuments: data.indexedDocuments || 0,
          indexedChunks: data.indexedChunks || 0,
          dbIndexedDocuments,
          dbInconsistentDocuments,
          dbFailedDocuments,
          dbTotalDocuments,
          indexHealth,
          consistency,
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
          headers: getRagInternalHeaders(),
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
    
    // Prefere a causa JÁ MEDIDA por getRagHealth (a mesma chamada que decidiu o
    // estado). O probe extra acima fica como reforço apenas quando o transporte
    // não classificou o erro.
    // Corpo de erro do rag-service (ex.: HTTP 503 `service_misconfigured` /
    // "Autenticação interna do RAG não configurada") entra na mensagem: sem ele
    // o operador só via "HTTP 503" e não sabia o que configurar.
    const httpErrorDetail = health.errorType === 'http_error'
      ? [
        health.payload?.error || null,
        health.payload?.message || null,
      ].filter(Boolean).join(': ') || null
      : null;

    const measuredErrorByType = {
      timeout: 'Timeout ao conectar com serviço RAG',
      connection_refused: 'Conexão recusada - serviço RAG não está rodando',
      host_not_found: `Host não encontrado: ${ragServiceUrl}`,
      http_error: `Serviço RAG retornou status HTTP ${health.httpStatus}${httpErrorDetail ? ` (${httpErrorDetail})` : ''}`,
      circuit_breaker_open: 'Circuito aberto para o serviço RAG (falhas recentes)',
    };
    const measuredError = measuredErrorByType[health.errorType] || null;

    return {
      status: 'unhealthy',
      error: safeErrorMessage(measuredError || errorDetails.error),
      details: {
        serviceUrl: ragServiceUrl,
        errorType: health.errorType || errorDetails.errorType,
        httpStatus: health.httpStatus ?? errorDetails.httpStatus,
        reason: health.reason || null,
        message: health.payload?.message || null,
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

