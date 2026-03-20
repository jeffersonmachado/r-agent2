const { validateProviderCredentials } = require('./configRouteUtils');

async function handleConfigValidationRoutes({ req, res, method, pathname, deps }) {
  const {
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  } = deps;

  if (pathname !== '/config/validate-provider-token' && pathname !== '/config/validate-redis') {
    return false;
  }

  // POST /config/validate-provider-token
  if (method === 'POST' && pathname === '/config/validate-provider-token') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { provider, apiKey } = body;

      if (!provider || !apiKey) {
        badRequest(res, 'Provider e apiKey são obrigatórios');
        return true;
      }

      if (provider !== 'openai' && provider !== 'anthropic') {
        badRequest(res, 'Provider deve ser "openai" ou "anthropic"');
        return true;
      }

      const cleanApiKey = apiKey.trim();
      if (!cleanApiKey) {
        sendJson(res, 200, {
          success: true,
          valid: false,
          error: 'Token não pode estar vazio',
        });
        return true;
      }

      const validation = await validateProviderCredentials(provider, cleanApiKey);
      sendJson(res, 200, {
        success: true,
        valid: validation.valid,
        error: validation.error || null,
      });
    } catch (err) {
      logger.error('Erro ao validar token de provedor', err);
      sendJson(res, 500, {
        success: false,
        error: 'Erro ao validar token',
        message: err.message,
      });
    }
    return true;
  }

  // POST /config/validate-redis
  if (method === 'POST' && pathname === '/config/validate-redis') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { redisUrl } = body;

      if (!redisUrl || typeof redisUrl !== 'string' || redisUrl.trim() === '') {
        sendJson(res, 200, {
          success: true,
          valid: false,
          error: 'URL do Redis não pode estar vazia',
        });
        return true;
      }

      const redisUrlPattern = /^(redis|rediss):\/\/([^:\/]+)(:(\d+))?(\/.*)?$/;
      const match = redisUrl.trim().match(redisUrlPattern);
      if (!match) {
        sendJson(res, 200, {
          success: true,
          valid: false,
          error: 'Formato de URL inválido. Formato esperado: redis://host:port ou rediss://host:port',
        });
        return true;
      }

      const port = match[4];
      if (port) {
        const portNum = parseInt(port, 10);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
          sendJson(res, 200, {
            success: true,
            valid: false,
            error: `Porta inválida: ${port}. Deve ser um número entre 1 e 65535`,
          });
          return true;
        }
      }

      let isValid = false;
      let error = null;

      try {
        const Redis = require('ioredis');
        const testClient = new Redis(redisUrl.trim(), {
          connectTimeout: 5000,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        });

        const connectPromise = testClient.connect();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout ao conectar ao Redis (5s)')), 5000)
        );

        await Promise.race([connectPromise, timeoutPromise]);

        const pingResult = await testClient.ping();
        isValid = pingResult === 'PONG';

        await testClient.quit();
      } catch (validationError) {
        if (validationError.message && validationError.message.includes('Timeout')) {
          error = 'Timeout ao conectar ao Redis. Verifique se o servidor está rodando e acessível.';
        } else if (validationError.message && (validationError.message.includes('ECONNREFUSED') || validationError.message.includes('connect ECONNREFUSED'))) {
          error = 'Conexão recusada. Verifique se o Redis está rodando e se a porta está correta.';
        } else if (validationError.message && (validationError.message.includes('ENOTFOUND') || validationError.message.includes('getaddrinfo'))) {
          error = 'Host não encontrado. Verifique se o endereço do Redis está correto.';
        } else if (validationError.message && validationError.message.includes('invalid password')) {
          error = 'Senha inválida. Verifique as credenciais do Redis.';
        } else {
          error = validationError.message || 'Erro ao conectar ao Redis';
        }
      }

      sendJson(res, 200, {
        success: true,
        valid: isValid,
        error: error || null,
      });
    } catch (err) {
      logger.error('Erro ao validar conexão do Redis', err);
      sendJson(res, 500, {
        success: false,
        error: 'Erro ao validar conexão do Redis',
        message: err.message,
      });
    }
    return true;
  }

  return false;
}

module.exports = { handleConfigValidationRoutes };
