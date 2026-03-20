'use strict';

const express = require('express');
const publicAccessTokenService = require('../../services/publicAccessTokenService');
const { createPublicTokenRepository } = require('./repository');
const { createPublicTokenService } = require('./service');
const { createPublicTokenController } = require('./controller');

function createPublicTokenRoutes({ buildDeps }) {
  const router = express.Router();
  const repository = createPublicTokenRepository(publicAccessTokenService);

  function controllerFor(req, res) {
    const deps = buildDeps(req, res);
    const service = createPublicTokenService({ repository });

    return createPublicTokenController({
      service,
      deps,
    });
  }

  router.get('/public-tokens', (req, res) => controllerFor(req, res).list(req, res));
  router.get('/public-tokens/stats', (req, res) => controllerFor(req, res).stats(req, res));
  router.post('/public-tokens', (req, res) => controllerFor(req, res).create(req, res));
  router.post('/public-tokens/:tokenId/revoke', (req, res) => controllerFor(req, res).revoke(req, res));
  router.post('/public-tokens/:tokenId/rotate', (req, res) => controllerFor(req, res).rotate(req, res));
  router.get('/public-tokens/resolve', (req, res) => controllerFor(req, res).resolve(req, res));

  return router;
}

module.exports = {
  createPublicTokenRoutes,
};
