'use strict';

const express = require('express');
const publicAccessTokenService = require('../../services/publicAccessTokenService');
const { createPublicTokenRepository } = require('../public-token/repository');
const { createDeveloperKeyService } = require('./service');
const { createDeveloperKeyController } = require('./controller');

function createDeveloperKeyRoutes({ buildDeps }) {
  const router = express.Router();
  const repository = createPublicTokenRepository(publicAccessTokenService);

  function controllerFor(req, res) {
    const deps = buildDeps(req, res);
    const service = createDeveloperKeyService({ repository });

    return createDeveloperKeyController({
      service,
      deps,
    });
  }

  router.get('/developer/keys', (req, res) => controllerFor(req, res).list(req, res));
  router.post('/developer/keys', (req, res) => controllerFor(req, res).create(req, res));
  router.get('/developer/usage', (req, res) => controllerFor(req, res).usage(req, res));

  return router;
}

module.exports = {
  createDeveloperKeyRoutes,
};
