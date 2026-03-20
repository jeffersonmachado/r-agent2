const fs = require('fs');
const config = require('../../utils/config');
const { ensureDataDir, configFile } = require('./configRouteUtils');

async function handleConfigCoreRoutes({ req, res, method, pathname, deps }) {
  const {
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    initializeAiProviders,
    detectProcessManager,
  } = deps;

  const isCoreRoute =
    pathname === '/config' ||
    pathname === '/server/process-manager' ||
    pathname === '/server/restart';

  if (!isCoreRoute) {
    return false;
  }

  // GET /config
  if (method === 'GET' && pathname === '/config') {
    const acceptHeader = req.headers.accept || '';
    const isApiRequest = acceptHeader.includes('application/json') || !acceptHeader.includes('text/html');

    if (!isApiRequest) {
      return false;
    }

    try {
      config.reload();
      const configData = config.getAll();

      if (!configData || typeof configData !== 'object' || Array.isArray(configData)) {
        throw new Error('Configuração retornada não é um objeto válido');
      }

      const sanitizedConfig = JSON.parse(JSON.stringify(configData));
      if (sanitizedConfig.ai) delete sanitizedConfig.ai;

      sendJson(res, 200, sanitizedConfig);
    } catch (err) {
      try {
        logger.error('Erro ao ler configuração:', err);
      } catch (logErr) {
        // eslint-disable-next-line no-console
        console.error('Erro ao ler configuração:', err);
        // eslint-disable-next-line no-console
        console.error('Erro ao logar erro:', logErr);
      }

      sendJson(res, 500, {
        error: 'Erro ao ler configuração',
        message: err.message || 'Erro desconhecido',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      });
    }
    return true;
  }

  // PUT /config
  if (method === 'PUT' && pathname === '/config') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        badRequest(res, 'Configuração deve ser um objeto JSON válido');
        return true;
      }

      sendJson(res, 200, {
        success: true,
        message: 'Configuração atualizada com sucesso. Servidor será reiniciado automaticamente.',
      });

      setImmediate(() => {
        try {
          ensureDataDir();
          const configData = JSON.stringify(body, null, 2);
          fs.writeFileSync(configFile, configData, 'utf8');

          config.reload();

          try {
            initializeAiProviders();
            logger.info('Providers de IA reinicializados com nova configuração');
          } catch (aiError) {
            logger.warn('Erro ao reinicializar providers de IA', { message: aiError.message });
          }

          logger.info('Configuração atualizada via API - nodemon reiniciará o servidor automaticamente');
        } catch (err) {
          logger.error('Erro ao salvar configuração após resposta', err);
        }
      });
    } catch (err) {
      logger.error('Erro ao atualizar configuração', err);
      sendJson(res, 500, { error: 'Erro ao atualizar configuração', message: err.message });
    }
    return true;
  }

  // GET /server/process-manager
  if (method === 'GET' && pathname === '/server/process-manager') {
    const processManager = detectProcessManager();
    sendJson(res, 200, {
      success: true,
      processManager: processManager.name,
      hasProcessManager: processManager.hasProcessManager,
      details: processManager.details,
    });
    return true;
  }

  // POST /server/restart
  if (method === 'POST' && pathname === '/server/restart') {
    logger.info('Reinício do servidor solicitado via API');

    const processManager = detectProcessManager();

    sendJson(res, 200, {
      success: true,
      message: processManager.hasProcessManager
        ? 'Servidor será reiniciado automaticamente em breve'
        : 'Servidor será encerrado. Reinicie manualmente.',
      processManager: processManager.name,
      hasProcessManager: processManager.hasProcessManager,
      note: processManager.hasProcessManager
        ? `Gerenciador detectado: ${processManager.name}. O servidor será reiniciado automaticamente.`
        : 'Nenhum gerenciador de processo detectado. Você precisará reiniciar o servidor manualmente usando "npm start" ou "node api/server.js".',
    });

    setTimeout(() => {
      logger.info('Encerrando servidor para reinício...');
      if (processManager.hasProcessManager) {
        logger.info(`Gerenciador ${processManager.name} irá reiniciar o servidor automaticamente`);
      } else {
        logger.warn('Nenhum gerenciador detectado. Servidor não será reiniciado automaticamente.');
      }
      process.exit(0);
    }, 500);

    return true;
  }

  return false;
}

module.exports = { handleConfigCoreRoutes };
