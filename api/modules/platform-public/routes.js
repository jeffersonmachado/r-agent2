'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');
const { createPublicTokenRoutes } = require('../public-token/routes');
const { handleStorefrontRoutes } = require('../../serverHandlers/storefrontRoutes');
const { handlePhysicalPublicRoutes } = require('../../serverHandlers/physicalPublicRoutes');
const { handlePhysicalStationRoutes } = require('../../serverHandlers/physicalStationRoutes');

function createPlatformPublicRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: handleStorefrontRoutes,
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
        checkRateLimit: ctx.checkRateLimit,
      };
    },
  });

  mountExpressHandler(router, {
    handler: handlePhysicalPublicRoutes,
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
        checkRateLimit: ctx.checkRateLimit,
        logAction: ctx.logAction,
      };
    },
  });

  mountExpressHandler(router, {
    handler: handlePhysicalStationRoutes,
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
        checkRateLimit: ctx.checkRateLimit,
        logAction: ctx.logAction,
        createTicket: ctx.createTicket,
      };
    },
  });

  router.use(createPublicTokenRoutes({
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
        logAction: ctx.logAction,
        checkRateLimit: ctx.checkRateLimit,
      };
    },
  }));

  return router;
}

module.exports = {
  createPlatformPublicRoutes,
};