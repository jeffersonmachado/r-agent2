'use strict';

const express = require('express');
const { createPublicTokenRoutes } = require('../public-token/routes');
const { handleStorefrontRoutes } = require('./handleStorefrontRoutes');
const { handlePhysicalPublicRoutes } = require('./handlePhysicalPublicRoutes');
const { handlePhysicalStationRoutes } = require('./handlePhysicalStationRoutes');

function createPlatformPublicRoutes({ buildDeps }) {
  const router = express.Router();

  function runHandled(handler, selectDeps) {
    return async (req, res, next) => {
      try {
        const pathname = new URL(req.originalUrl || req.url || '/', 'http://localhost').pathname;
        const ctx = buildDeps(req, res);
        const handled = await handler({
          req,
          res,
          method: (req.method || 'GET').toUpperCase(),
          pathname,
          deps: selectDeps(ctx),
        });
        if (!handled && !res.writableEnded) {
          next();
        }
      } catch (err) {
        next(err);
      }
    };
  }

  router.use(runHandled(handleStorefrontRoutes, (ctx) => ({
    sendJson: ctx.sendJson,
    badRequest: ctx.badRequest,
    hasJsonContentType: ctx.hasJsonContentType,
    parseJsonBody: ctx.parseJsonBody,
    logger: ctx.logger,
    checkRateLimit: ctx.checkRateLimit,
  })));

  router.use(runHandled(handlePhysicalPublicRoutes, (ctx) => ({
    sendJson: ctx.sendJson,
    badRequest: ctx.badRequest,
    hasJsonContentType: ctx.hasJsonContentType,
    parseJsonBody: ctx.parseJsonBody,
    logger: ctx.logger,
    checkRateLimit: ctx.checkRateLimit,
    logAction: ctx.logAction,
  })));

  router.use(runHandled(handlePhysicalStationRoutes, (ctx) => ({
    sendJson: ctx.sendJson,
    badRequest: ctx.badRequest,
    hasJsonContentType: ctx.hasJsonContentType,
    parseJsonBody: ctx.parseJsonBody,
    logger: ctx.logger,
    checkRateLimit: ctx.checkRateLimit,
    logAction: ctx.logAction,
    createTicket: ctx.createTicket,
  })));

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
