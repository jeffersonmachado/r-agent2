'use strict';

/**
 * Composition root do dominio Task (Tarefas operacionais).
 */

const { requireAuth, requirePermission } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const logger = require('../../utils/logger');
const { createTaskRoutes } = require('../../modules/task/routes');
const { requireTenant } = require('../shared/requireTenant');

function buildTaskRouteDeps() {
  return {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  };
}

function createTaskExpressRouter() {
  return createTaskRoutes({ buildDeps: () => buildTaskRouteDeps() });
}

module.exports = {
  buildTaskRouteDeps,
  createTaskExpressRouter,
};
