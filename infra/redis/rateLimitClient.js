/**
 * Cliente Redis dedicado para Rate Limiting.
 * 
 * Responsabilidades:
 * - Conexão Redis com prefixo exclusivo (rl:)
 * - Reconexão segura
 * - Tratamento de erros
 */

const Redis = require('ioredis');
const logger = require('../../api/utils/logger');
const config = require('../../api/utils/config');

let redisClient = null;
let connectionAttempts = 0;
const MAX_RECONNECTION_ATTEMPTS = process.env.NODE_ENV === 'production' ? null : 10; // Em produção, tenta indefinidamente; em dev, limita a 10

function getConfiguredRedisUrl() {
  return config.get('rateLimit.redis.url')
    || process.env.RATE_LIMIT_REDIS_URL
    || process.env.REDIS_URL
    || null;
}

/**
 * Obtém ou cria cliente Redis para rate limiting.
 * 
 * @returns {Redis|null} Cliente Redis ou null se não configurado
 */
function getRateLimitClient() {
  // Se já excedeu o limite de tentativas em desenvolvimento, retorna null
  if (MAX_RECONNECTION_ATTEMPTS && connectionAttempts >= MAX_RECONNECTION_ATTEMPTS) {
    // Se existe um cliente mas está desconectado, limpa ele
    if (redisClient) {
      if (redisClient.status === 'end' || redisClient.status === 'close' || redisClient.status === 'reconnecting') {
        redisClient = null;
      }
    }
    if (!redisClient) {
      logger.warn('[RateLimit] Limite de tentativas de conexão excedido, usando modo memória', {
        attempts: connectionAttempts,
        maxAttempts: MAX_RECONNECTION_ATTEMPTS
      });
      return null;
    }
  }

  // Se já existe um cliente conectado ou conectando, retorna ele
  if (redisClient && (redisClient.status === 'ready' || redisClient.status === 'connect' || redisClient.status === 'connecting')) {
    return redisClient;
  }

  // Lê do config.json com fallback para env vars
  const redisUrl = getConfiguredRedisUrl();
  
  // Se Redis não estiver disponível, retorna null (modo degradado)
  // Em produção, isso deve falhar explicitamente
  if (!redisUrl) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('[RateLimit] Redis URL não configurada em produção');
      throw new Error('RATE_LIMIT_REDIS_URL é obrigatória em produção');
    }
    return null;
  }

  try {
    redisClient = new Redis(redisUrl, {
      // Prefixo para todas as chaves de rate limiting
      keyPrefix: 'rl:',
      // Reconexão automática com limite em desenvolvimento
      retryStrategy: (times) => {
        connectionAttempts = times;
        
        // Em desenvolvimento, para após MAX_RECONNECTION_ATTEMPTS tentativas
        if (MAX_RECONNECTION_ATTEMPTS && times > MAX_RECONNECTION_ATTEMPTS) {
          logger.warn('[RateLimit] Limite de tentativas de reconexão atingido, desabilitando Redis', {
            attempts: times,
            maxAttempts: MAX_RECONNECTION_ATTEMPTS
          });
          // Fecha o cliente e retorna null para parar tentativas
          if (redisClient) {
            redisClient.disconnect();
            redisClient = null;
          }
          return null; // Para a reconexão
        }
        
        const delay = Math.min(times * 50, 2000);
        if (times <= MAX_RECONNECTION_ATTEMPTS || !MAX_RECONNECTION_ATTEMPTS) {
          logger.warn(`[RateLimit] Tentando reconectar ao Redis (tentativa ${times})`, { delay });
        }
        return delay;
      },
      // Timeout de conexão
      connectTimeout: 10000,
      // Lazy connect (conecta apenas quando necessário)
      lazyConnect: true,
      // Máximo de tentativas
      maxRetriesPerRequest: 3,
      // Desabilita reconexão automática após muitas falhas em desenvolvimento
      enableOfflineQueue: false, // Não enfileira comandos quando offline
    });

    // Event listeners
    redisClient.on('connect', () => {
      logger.info('[RateLimit] Conectado ao Redis');
      connectionAttempts = 0; // Reset contador ao conectar com sucesso
    });

    redisClient.on('ready', () => {
      logger.info('[RateLimit] Redis pronto para uso');
      connectionAttempts = 0; // Reset contador quando pronto
    });

    redisClient.on('error', (err) => {
      // Só loga erros se ainda estiver tentando conectar
      if (!MAX_RECONNECTION_ATTEMPTS || connectionAttempts <= MAX_RECONNECTION_ATTEMPTS) {
        logger.error('[RateLimit] Erro no Redis', { error: err.message });
      }
    });

    redisClient.on('close', () => {
      if (!MAX_RECONNECTION_ATTEMPTS || connectionAttempts <= MAX_RECONNECTION_ATTEMPTS) {
        logger.warn('[RateLimit] Conexão Redis fechada');
      }
    });

    redisClient.on('reconnecting', () => {
      if (!MAX_RECONNECTION_ATTEMPTS || connectionAttempts <= MAX_RECONNECTION_ATTEMPTS) {
        logger.info('[RateLimit] Reconectando ao Redis...');
      }
    });

    // Conecta explicitamente
    redisClient.connect().catch((err) => {
      connectionAttempts++;
      logger.error('[RateLimit] Erro ao conectar ao Redis', { error: err.message });
      // Em desenvolvimento, permite continuar sem Redis após algumas tentativas
      if (process.env.NODE_ENV !== 'production') {
        if (connectionAttempts >= MAX_RECONNECTION_ATTEMPTS) {
          logger.warn('[RateLimit] Limite de tentativas atingido, continuando sem Redis (modo desenvolvimento)');
          if (redisClient) {
            redisClient.disconnect();
            redisClient = null;
          }
        }
      } else {
        throw err;
      }
    });

    return redisClient;
  } catch (err) {
    logger.error('[RateLimit] Erro ao criar cliente Redis', { error: err.message });
    
    // Em desenvolvimento, permite continuar sem Redis
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('[RateLimit] Continuando sem Redis (modo desenvolvimento)');
      return null;
    }
    
    throw err;
  }
}

/**
 * Verifica se Redis está disponível.
 * 
 * @returns {Promise<boolean>}
 */
async function isRedisAvailable() {
  const client = getRateLimitClient();
  if (!client) {
    return false;
  }

  // Se o cliente não está conectado, tenta conectar
  if (client.status === 'end' || client.status === 'close') {
    try {
      await client.connect();
      // Aguarda um pouco após conectar para garantir que está pronto
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (err) {
      logger.debug('[RateLimit] Erro ao conectar Redis para verificação', { error: err.message });
      return false;
    }
  }
  
  // Se está em estado "connect", pode precisar aguardar um pouco mais
  if (client.status === 'connect') {
    // Aguarda até que mude para "ready" ou timeout
    const maxWait = 2000;
    const startTime = Date.now();
    while (client.status === 'connect' && (Date.now() - startTime) < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
      if (client.status === 'ready') {
        break;
      }
    }
  }

  // Aguarda um pouco se estiver conectando ou em estado connect
  if (client.status === 'connecting' || client.status === 'connect') {
    // Aguarda até 3 segundos para conectar completamente
    const maxWait = 3000;
    const startTime = Date.now();
    while ((client.status === 'connecting' || client.status === 'connect') && (Date.now() - startTime) < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
      // Se mudou para ready, pode sair do loop
      if (client.status === 'ready') {
        break;
      }
    }
  }

  // Verifica se o cliente está em um estado válido
  const validStates = ['ready', 'connect', 'connecting'];
  if (!validStates.includes(client.status)) {
    logger.debug('[RateLimit] Redis em estado inválido', { status: client.status });
    return false;
  }

  try {
    // Tenta fazer ping com timeout maior para estados transitórios
    const timeout = client.status === 'ready' ? 2000 : 5000; // Mais tempo se ainda está conectando
    const pingPromise = client.ping();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Timeout ao verificar Redis (${timeout}ms)`)), timeout)
    );
    await Promise.race([pingPromise, timeoutPromise]);
    return true;
  } catch (err) {
    // Se estiver em estado connect/connecting, pode ser apenas que ainda está conectando
    if (client.status === 'connect' || client.status === 'connecting') {
      logger.debug('[RateLimit] Redis ainda conectando', { 
        error: err.message, 
        status: client.status,
        hint: 'Conexão em andamento, pode estar disponível em breve'
      });
      // Retorna false mas não é um erro crítico
    } else {
      logger.debug('[RateLimit] Redis não disponível', { error: err.message, status: client.status });
    }
    return false;
  }
}

/**
 * Fecha conexão Redis (útil para testes ou shutdown).
 */
async function closeRateLimitClient() {
  if (redisClient) {
    try {
      const status = redisClient.status;
      if (status === 'ready' || status === 'connect' || status === 'connecting') {
        await redisClient.quit();
      } else {
        redisClient.disconnect();
      }
    } catch (err) {
      // Em testes/dev, falhas de fechamento não devem quebrar execução
      logger.debug('[RateLimit] Erro ao fechar cliente Redis (ignorado)', { error: err.message });
    }
    redisClient = null;
    connectionAttempts = 0; // Reset contador ao fechar
    logger.info('[RateLimit] Cliente Redis fechado');
  }
}

/**
 * Reseta o contador de tentativas de conexão (útil para tentar reconectar após falhas).
 */
function resetConnectionAttempts() {
  connectionAttempts = 0;
  logger.info('[RateLimit] Contador de tentativas de conexão resetado');
}

module.exports = {
  getRateLimitClient,
  isRedisAvailable,
  closeRateLimitClient,
  resetConnectionAttempts,
};
