'use strict';

const express = require('express');

function createAuthRoutes({
  sendJson,
  badRequest,
  validateInput,
  schemas,
  ValidationError,
  authLogin,
  loginWithRpaToken,
  validateToken,
  authLogout,
  logoutAllSessions,
  logAction,
  logger,
}) {
  const router = express.Router();
  const jsonParser = express.json({ limit: '1mb' });

  function getIpAddress(req) {
    return req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  }

  function getUserAgent(req, fallback = 'unknown') {
    return req.headers['user-agent'] || fallback;
  }

  router.post('/auth/login', jsonParser, async (req, res) => {
    try {
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
        agent: result.agent,
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

  router.post('/auth/rpa/login', jsonParser, async (req, res) => {
    try {
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

  router.get('/auth/rpa/token', (req, res) => {
    try {
      const rpaTokenManager = require('../../../tests/rpa/utils/rpaTokenManager');
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

  router.post('/auth/logout', (req, res) => {
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

  router.post('/auth/logout-all', (req, res) => {
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

  router.get('/auth/me', (req, res) => {
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

    sendJson(res, 200, { agent: validation.agent });
  });

  return router;
}

module.exports = {
  createAuthRoutes,
};
