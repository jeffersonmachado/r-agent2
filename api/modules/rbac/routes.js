'use strict';

const express = require('express');
const { createRbacService } = require('./service');
const { createRbacController } = require('./controller');

function createRbacRoutes({ buildDeps }) {
  const router = express.Router();

  function controllerFor(req, res) {
    const deps = buildDeps(req, res);
    const service = createRbacService({ deps });
    return createRbacController({ service, deps });
  }

  router.get('/rbac/roles', (req, res) => controllerFor(req, res).listRoles(req, res));
  router.post('/rbac/roles', (req, res) => controllerFor(req, res).createRole(req, res));
  router.get('/rbac/permissions', (req, res) => controllerFor(req, res).listPermissions(req, res));
  router.post('/rbac/assign', (req, res) => controllerFor(req, res).assignRole(req, res));

  return router;
}

module.exports = {
  createRbacRoutes,
};
