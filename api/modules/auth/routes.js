'use strict';

const express = require('express');
const { getClassificationForAgent } = require('../agent-os/experience-segregation');

/**
 * Garante que o payload do agent expõe a classificação de plataforma
 * (eixo independente do tenant role) sem remover nenhum campo existente.
 */
function withClassificationPayload(agent) {
  if (!agent || typeof agent !== 'object') return agent;
  return {
    ...agent,
    platformRole: agent.platformRole || null,
    classification: getClassificationForAgent(agent),
  };
}

function createAuthRoutes({
  sendJson,
  badRequest,
  validateInput,
  schemas,
  ValidationError,
  authLogin,
  createSaasSignupAccount,
  loginWithRpaToken,
  validateToken,
  authLogout,
  logoutAllSessions,
  logAction,
  logger,
  requireAuth,
  checkClassification,
  checkRateLimit,
}) {
  const router = express.Router();
  const jsonParser = express.json({ limit: '1mb' });

  function getIpAddress(req) {
    return req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  }

  function getUserAgent(req, fallback = 'unknown') {
    return req.headers['user-agent'] || fallback;
  }

  /**
   * Anti brute-force dos endpoints pré-autenticação (login, signup, rpa/login):
   * limita por IP via política AUTH_PUBLIC. Sem isso essas rotas ficavam sem
   * nenhuma proteção (são excluídas do rate limit por tenant por design).
   * Retorna true quando o fluxo pode prosseguir; responde 429 e retorna false
   * quando o limite foi excedido.
   */
  async function allowAuthPublicRequest(req, res) {
    const rl = await checkRateLimit({ userId: `ip:${getIpAddress(req)}`, operationType: 'AUTH_PUBLIC' });
    if (rl.allowed) return true;
    const retryAfter = rl.retryAfter || 60;
    res.setHeader('Retry-After', retryAfter);
    sendJson(res, 429, {
      error: 'rate_limit_exceeded',
      message: `Limite de requisições excedido. Tente novamente em ${retryAfter} segundos.`,
      retryAfter,
    });
    return false;
  }

  router.post(['/auth/login', '/api/auth/login'], jsonParser, async (req, res) => {
    try {
      if (!(await allowAuthPublicRequest(req, res))) return;
      let validated;
      try {
        validated = validateInput(req.body || {}, schemas.login);
      } catch (err) {
        if (err instanceof ValidationError) {
          badRequest(res, err.message);
          return;
        }
        throw err;
      }

      const { username, password } = validated;
      const ipAddress = getIpAddress(req);
      const userAgent = getUserAgent(req);
      const result = await authLogin(username, password, ipAddress, userAgent);

      if (!result.success) {
        sendJson(res, 401, { error: 'authentication_failed', message: result.error });
        return;
      }

      logAction({
        agentId: result.agent.id,
        username: result.agent.username,
        action: 'login',
        resource: 'auth',
        ipAddress,
        userAgent,
      });

      sendJson(res, 200, {
        token: result.token,
        agent: withClassificationPayload(result.agent),
      });
    } catch (err) {
      if (err instanceof SyntaxError || err?.type === 'entity.parse.failed') {
        badRequest(res, 'JSON inválido no corpo da requisição');
        return;
      }
      logger.error('Erro ao fazer login:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao processar login' });
    }
  });

  router.post(['/auth/signup', '/api/auth/signup'], jsonParser, async (req, res) => {
    try {
      if (!(await allowAuthPublicRequest(req, res))) return;
      let validated;
      try {
        validated = validateInput(req.body || {}, schemas.signupSaas);
      } catch (err) {
        if (err instanceof ValidationError) {
          badRequest(res, err.message);
          return;
        }
        throw err;
      }

      const result = await createSaasSignupAccount(validated);
      if (!result.success) {
        sendJson(res, 400, { error: 'signup_failed', message: result.error || 'Não foi possível criar conta' });
        return;
      }

      sendJson(res, 201, {
        success: true,
        message: 'Conta criada com sucesso',
        tenant: result.tenant,
        credentials: result.credentials,
      });
    } catch (err) {
      if (err instanceof SyntaxError || err?.type === 'entity.parse.failed') {
        badRequest(res, 'JSON inválido no corpo da requisição');
        return;
      }
      logger.error('Erro ao criar conta SaaS:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao criar conta' });
    }
  });

  router.post(['/auth/rpa/login', '/api/auth/rpa/login'], jsonParser, async (req, res) => {
    try {
      if (!(await allowAuthPublicRequest(req, res))) return;
      const rpaToken = req.body?.token || req.body?.rpaToken;
      const tenantId = req.body?.tenantId;

      if (!rpaToken) {
        badRequest(res, 'Token RPA é obrigatório');
        return;
      }
      if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
        badRequest(res, 'tenantId é obrigatório');
        return;
      }

      const ipAddress = getIpAddress(req);
      const userAgent = getUserAgent(req, 'RPA-Automation');
      const result = await loginWithRpaToken(rpaToken, tenantId, ipAddress, userAgent);

      if (!result.success) {
        sendJson(res, 401, { error: 'rpa_authentication_failed', message: result.error });
        return;
      }

      logAction({
        agentId: result.agent.id,
        username: result.agent.username,
        action: 'rpa_login',
        resource: 'auth',
        ipAddress,
        userAgent,
      });

      sendJson(res, 200, {
        token: result.token,
        agent: result.agent,
      });
    } catch (err) {
      if (err instanceof SyntaxError || err?.type === 'entity.parse.failed') {
        badRequest(res, 'JSON inválido no corpo da requisição');
        return;
      }
      logger.error('Erro ao fazer login RPA:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao processar login RPA' });
    }
  });

  router.get(['/auth/rpa/token', '/api/auth/rpa/token'], (req, res) => {
    // O token RPA é um segredo compartilhado de serviço: emiti-lo exige sessão
    // autenticada com classificação mínima SUPPORT (RPA é mecanismo interno;
    // ver AGENTS.md — APIs de replay/RPA exigem requireClassification('SUPPORT')).
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }
    const classificationCheck = checkClassification(req, 'SUPPORT');
    if (!classificationCheck.allowed) {
      sendJson(res, 403, {
        error: 'classification_required',
        required: classificationCheck.required,
        classification: classificationCheck.classification,
      });
      return;
    }
    try {
      const rpaTokenManager = require('../../../core/rpa/utils/rpaTokenManager');
      const token = rpaTokenManager.getOrCreateRpaToken();
      sendJson(res, 200, {
        token,
        message: 'Token RPA obtido com sucesso',
        note: 'Use este token para autenticação RPA via POST /auth/rpa/login',
      });
    } catch (err) {
      logger.error('Erro ao obter token RPA:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter token RPA' });
    }
  });

  router.post(['/auth/logout', '/api/auth/logout'], (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '') || null;

    if (!token) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Token não fornecido' });
      return;
    }

    const validation = validateToken(token);
    if (!validation.valid) {
      authLogout(token);
      sendJson(res, 200, { success: true, message: 'Logout realizado' });
      return;
    }

    logAction({
      agentId: validation.agent.id,
      username: validation.agent.username,
      action: 'logout',
      resource: 'auth',
      ipAddress: getIpAddress(req),
      userAgent: getUserAgent(req),
    });

    const result = authLogout(token);
    sendJson(res, 200, { success: result.success });
  });

  router.post(['/auth/logout-all', '/api/auth/logout-all'], (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '') || null;

    if (!token) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Token não fornecido' });
      return;
    }

    const validation = validateToken(token);
    if (!validation.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: validation.error || 'Token inválido' });
      return;
    }

    logAction({
      agentId: validation.agent.id,
      username: validation.agent.username,
      action: 'logout_all',
      resource: 'auth',
      ipAddress: getIpAddress(req),
      userAgent: getUserAgent(req),
    });

    const removed = logoutAllSessions(validation.agent.id);
    sendJson(res, 200, {
      success: true,
      message: 'Todas as sessões foram encerradas',
      sessionsRemoved: removed,
    });
  });

  router.get(['/auth/me', '/api/auth/me'], (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '') || null;

    if (!token) {
      sendJson(res, 401, { error: 'unauthorized', message: 'Token não fornecido' });
      return;
    }

    const validation = validateToken(token);
    if (!validation.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: validation.error || 'Token inválido' });
      return;
    }

    sendJson(res, 200, { agent: withClassificationPayload(validation.agent) });
  });

  return router;
}

module.exports = {
  createAuthRoutes,
};
