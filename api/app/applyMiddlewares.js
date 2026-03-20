'use strict';

/**
 * Aplica middlewares globais na instância Express.
 *
 * Extrai do buildExpressApp() o bloco de configuração do app:
 * express.json, request tracing e similares.
 */

const express = require('express');

/**
 * @param {import('express').Application} app
 * @param {{ ensureRequestTracing: Function }} opts
 */
function applyGlobalMiddlewares(app, { ensureRequestTracing }) {
  app.use((req, res, next) => {
    ensureRequestTracing(req);
    next();
  });

  app.use(express.json({ limit: '10mb' }));
}

module.exports = { applyGlobalMiddlewares };
