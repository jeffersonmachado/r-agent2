'use strict';

/**
 * Aplica middlewares globais na instância Express.
 *
 * Extrai do buildExpressApp() o bloco de configuração do app:
 * express.json, request tracing e similares.
 */

const express = require('express');
const { setCorsHeaders } = require('../express/httpHelpers');

/**
 * @param {import('express').Application} app
 * @param {{ ensureRequestTracing: Function }} opts
 */
function applyGlobalMiddlewares(app, { ensureRequestTracing }) {
  // CORS precisa ser aplicado antes de auth/tenant/rotas para que também
  // respostas 401/403/404 e preflights sejam legíveis pelo frontend. Antes,
  // somente handlers que usavam sendJson() recebiam esses headers.
  app.use((req, res, next) => {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    return next();
  });

  app.use((req, res, next) => {
    ensureRequestTracing(req);
    next();
  });

  app.use(express.json({ limit: '10mb' }));
}

module.exports = { applyGlobalMiddlewares };
