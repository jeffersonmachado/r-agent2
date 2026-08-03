'use strict';

function createConfigController({ service, deps }) {
  function ensureAuth(req, res) {
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return null;
    }
    return authResult;
  }

  function ensurePermission(req, res, resource, action, fallback) {
    const permResult = deps.requirePermission(req, resource, action);
    if (!permResult.allowed && !fallback) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return false;
    }
    return true;
  }

  function ensureJson(req, res) {
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return false;
    }
    return true;
  }

  return {
    async getConfig(req, res) {
      const acceptHeader = req.headers.accept || '';
      const isApiRequest = acceptHeader.includes('application/json') || !acceptHeader.includes('text/html');
      if (!isApiRequest) {
        return false;
      }

      // Pré-login (ex.: onboarding) recebe apenas a visão pública sanitizada —
      // o payload completo contém credenciais (ex.: database.url) e exige
      // auth + config:read.
      const authCheck = deps.requireAuth(req);
      if (!authCheck.valid) {
        deps.sendJson(res, 200, service.readPublicConfig());
        return true;
      }
      const isSuperAdminUser = deps.isSuperAdmin(authCheck.agent);
      if (!ensurePermission(req, res, 'config', 'read', isSuperAdminUser)) return true;

      try {
        deps.sendJson(res, 200, service.reloadAndReadConfig());
      } catch (err) {
        deps.logger.error('Erro ao ler configuração:', err);
        deps.sendJson(res, 500, {
          error: 'Erro ao ler configuração',
          message: err.message || 'Erro desconhecido',
          stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        });
      }
      return true;
    },

    async getQuestionGenerationRules(req, res) {
      try {
        const rules = service.readQuestionGenerationRules();
        if (!rules) {
          deps.sendJson(res, 404, { error: 'not_found', message: 'Arquivo de regras não encontrado' });
          return;
        }
        deps.setCorsHeaders(res);
        deps.sendJson(res, 200, rules);
      } catch (err) {
        deps.logger.error('Erro ao servir regras de geração de perguntas:', err);
        deps.sendJson(res, 500, { error: 'Erro ao ler regras', message: err.message || 'Erro desconhecido' });
      }
    },

    async getCurrentTenantAiConfig(req, res) {
      try {
        const authResult = ensureAuth(req, res);
        if (!authResult) return;
        const parsed = service.parseTenantKey(req, authResult);
        if (parsed.error) {
          deps.sendJson(res, 400, { error: 'bad_request', message: parsed.error });
          return;
        }
        const aiConfig = await service.getCurrentTenantAiConfig(parsed.tenantId);
        if (aiConfig === null) {
          deps.sendJson(res, 404, { error: 'not_found', message: 'Configuração de IA não encontrada para este tenant' });
          return;
        }
        deps.sendJson(res, 200, aiConfig);
      } catch (err) {
        deps.logger.error('Erro ao obter configuração de IA do tenant atual:', err);
        deps.sendJson(res, 500, { error: 'Erro ao obter configuração de IA', message: err.message });
      }
    },

    async saveCurrentTenantAiConfig(req, res) {
      if (!ensureJson(req, res)) return;
      try {
        const authResult = ensureAuth(req, res);
        if (!authResult) return;
        const parsed = service.parseTenantKey(req, authResult);
        if (parsed.error) {
          deps.sendJson(res, 400, { error: 'bad_request', message: parsed.error });
          return;
        }
        const isSuperAdminUser = deps.isSuperAdmin(authResult.agent);
        if (!ensurePermission(req, res, 'config', 'update', isSuperAdminUser)) return;
        const body = await deps.parseJsonBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          deps.badRequest(res, 'Configuração deve ser um objeto JSON válido');
          return;
        }
        const savedConfig = await service.saveCurrentTenantAiConfig(parsed.tenantId, body);
        deps.sendJson(res, 200, savedConfig);
      } catch (err) {
        deps.logger.error('Erro ao salvar configuração de IA do tenant atual:', err);
        deps.sendJson(res, 500, { error: 'Erro ao salvar configuração de IA', message: err.message });
      }
    },

    async saveCurrentTenantAiCredentials(req, res) {
      if (!ensureJson(req, res)) return;
      try {
        const authResult = ensureAuth(req, res);
        if (!authResult) return;
        const parsed = service.parseTenantKey(req, authResult);
        if (parsed.error) {
          deps.sendJson(res, 400, { error: 'bad_request', message: parsed.error });
          return;
        }
        const isSuperAdminUser = deps.isSuperAdmin(authResult.agent);
        if (!ensurePermission(req, res, 'config', 'update', isSuperAdminUser)) return;

        const body = await deps.parseJsonBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          deps.sendJson(res, 400, { error: 'invalid_request', message: 'Body deve ser um objeto JSON válido' });
          return;
        }
        const { provider, apiKey } = body;
        if (!provider || typeof provider !== 'string') {
          deps.sendJson(res, 400, { error: 'invalid_request', message: 'Provider é obrigatório' });
          return;
        }
        if (!apiKey || typeof apiKey !== 'string') {
          deps.sendJson(res, 400, { error: 'invalid_request', message: 'API key é obrigatória' });
          return;
        }
        await service.saveCurrentTenantAiCredentials(parsed.tenantId, provider, apiKey);
        deps.sendJson(res, 200, { success: true, message: 'Credenciais salvas com sucesso' });
      } catch (err) {
        deps.logger.error('Erro ao salvar credenciais de IA do tenant atual:', err);
        deps.sendJson(res, 500, { error: 'Erro ao salvar credenciais de IA', message: err.message });
      }
    },

    async testTenantAiCredentials(req, res) {
      if (!ensureJson(req, res)) return;
      try {
        const authResult = ensureAuth(req, res);
        if (!authResult) return;
        const body = await deps.parseJsonBody(req);
        const providerOverride = body && typeof body.provider === 'string' ? body.provider.trim().toLowerCase() : null;
        const result = await service.testStoredTenantCredentials({
          tenantKey: decodeURIComponent(String(req.params.tenantKey)),
          providerOverride,
          req,
          authResult,
        });
        if (result.kind === 'bad_request') {
          deps.sendJson(res, 400, { error: 'bad_request', message: result.message });
          return;
        }
        if (result.kind === 'forbidden') {
          deps.sendJson(res, 403, { error: 'forbidden', message: result.message });
          return;
        }
        if (result.kind === 'not_found') {
          deps.sendJson(res, 404, { error: 'not_found', message: result.message });
          return;
        }
        deps.sendJson(res, 200, result.payload);
      } catch (err) {
        if (err instanceof SyntaxError) {
          deps.badRequest(res, 'JSON inválido no corpo da requisição');
          return;
        }
        deps.logger.error('Erro ao validar credenciais salvas do tenant:', err);
        deps.sendJson(res, 500, {
          success: false,
          valid: false,
          error: err.message || 'Erro ao validar credenciais salvas do tenant',
        });
      }
    },

    async updateConfig(req, res) {
      if (!ensureJson(req, res)) return;
      // Sobrescreve a configuração inteira e reinicia o servidor: exige auth + config:update.
      const authResult = ensureAuth(req, res);
      if (!authResult) return;
      const isSuperAdminUser = deps.isSuperAdmin(authResult.agent);
      if (!ensurePermission(req, res, 'config', 'update', isSuperAdminUser)) return;
      try {
        const body = await deps.parseJsonBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          deps.badRequest(res, 'Configuração deve ser um objeto JSON válido');
          return;
        }
        deps.sendJson(res, 200, {
          success: true,
          message: 'Configuração atualizada com sucesso. Servidor será reiniciado automaticamente.',
        });
        setImmediate(() => {
          service.persistConfigUpdate(body, deps.logger).catch((err) => {
            deps.logger.error('Erro ao salvar configuração após resposta', err);
          });
        });
      } catch (err) {
        deps.logger.error('Erro ao atualizar configuração', err);
        deps.sendJson(res, 500, { error: 'Erro ao atualizar configuração', message: err.message });
      }
    },

    async getProcessManager(req, res) {
      const authResult = ensureAuth(req, res);
      if (!authResult) return;
      const isSuperAdminUser = deps.isSuperAdmin(authResult.agent);
      if (!ensurePermission(req, res, 'config', 'read', isSuperAdminUser)) return;
      const processManager = service.detectProcessManager();
      deps.sendJson(res, 200, {
        success: true,
        processManager: processManager.name,
        hasProcessManager: processManager.hasProcessManager,
        details: processManager.details,
      });
    },

    async validateProviderToken(req, res) {
      if (!ensureJson(req, res)) return;
      // Oracle de validação de tokens de provedor: exige auth + config:read.
      const authResult = ensureAuth(req, res);
      if (!authResult) return;
      const isSuperAdminUser = deps.isSuperAdmin(authResult.agent);
      if (!ensurePermission(req, res, 'config', 'read', isSuperAdminUser)) return;
      try {
        const body = await deps.parseJsonBody(req);
        const { provider, apiKey } = service.parseProviderTokenBody(body);
        if (!provider || !apiKey) {
          deps.badRequest(res, 'Provider e apiKey são obrigatórios');
          return;
        }
        if (provider !== 'openai' && provider !== 'anthropic') {
          deps.badRequest(res, 'Provider deve ser "openai" ou "anthropic"');
          return;
        }
        if (!String(apiKey).trim()) {
          deps.sendJson(res, 200, { success: true, valid: false, error: 'Token não pode estar vazio' });
          return;
        }
        const validation = await service.validateProviderToken(provider, String(apiKey).trim());
        deps.sendJson(res, 200, { success: true, valid: validation.valid, error: validation.error || null });
      } catch (err) {
        deps.logger.error('Erro ao validar token de provedor', err);
        deps.sendJson(res, 500, { success: false, error: 'Erro ao validar token', message: err.message });
      }
    },

    async validateBillingCredentials(req, res) {
      if (!ensureJson(req, res)) return;
      const authResult = ensureAuth(req, res);
      if (!authResult) return;
      const isSuperAdminUser = deps.isSuperAdmin(authResult.agent);
      if (!ensurePermission(req, res, 'config', 'read', isSuperAdminUser)) return;
      try {
        const body = await deps.parseJsonBody(req);
        const results = await service.validateBillingCredentials({
          provider: body?.provider,
          apiKey: body?.apiKey,
          webhookSecret: body?.webhookSecret,
        });
        deps.sendJson(res, 200, { success: true, ...results });
      } catch (err) {
        deps.logger.error('Erro ao validar credenciais de billing', err);
        deps.sendJson(res, 500, { success: false, error: 'Erro ao validar credenciais', message: err.message });
      }
    },

    async validateRedis(req, res) {
      if (!ensureJson(req, res)) return;
      // Tenta conexão TCP arbitrária (SSRF): exige auth + config:read.
      const authResult = ensureAuth(req, res);
      if (!authResult) return;
      const isSuperAdminUser = deps.isSuperAdmin(authResult.agent);
      if (!ensurePermission(req, res, 'config', 'read', isSuperAdminUser)) return;
      try {
        const body = await deps.parseJsonBody(req);
        const validation = service.validateRedisUrl(body?.redisUrl);
        if (!validation.valid) {
          deps.sendJson(res, 200, { success: true, valid: false, error: validation.error });
          return;
        }
        const result = await service.validateRedisConnection(body.redisUrl);
        deps.sendJson(res, 200, { success: true, valid: result.valid, error: result.error || null });
      } catch (err) {
        deps.logger.error('Erro ao validar conexão do Redis', err);
        deps.sendJson(res, 500, { success: false, error: 'Erro ao validar conexão do Redis', message: err.message });
      }
    },

    async restartServer(req, res) {
      // Encerra o processo (process.exit): operação destrutiva — auth + config:update.
      const authResult = ensureAuth(req, res);
      if (!authResult) return;
      const isSuperAdminUser = deps.isSuperAdmin(authResult.agent);
      if (!ensurePermission(req, res, 'config', 'update', isSuperAdminUser)) return;
      deps.logger.info('Reinício do servidor solicitado via API');
      const processManager = service.detectProcessManager();
      deps.sendJson(res, 200, {
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
        deps.logger.info('Encerrando servidor para reinício...');
        if (processManager.hasProcessManager) {
          deps.logger.info(`Gerenciador ${processManager.name} irá reiniciar o servidor automaticamente`);
        } else {
          deps.logger.warn('Nenhum gerenciador detectado. Servidor não será reiniciado automaticamente.');
        }
        process.exit(0);
      }, 500);
    },
  };
}

module.exports = {
  createConfigController,
};
