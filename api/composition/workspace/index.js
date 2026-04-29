'use strict';

const { requireAuth, requirePermission } = require('../../middleware/auth');
const { sendJson, parseJsonBody, hasJsonContentType, badRequest } = require('../../express/httpHelpers');
const { requireTenant } = require('../shared/requireTenant');
const logger = require('../../utils/logger');
const { createWorkspaceRoutes } = require('../../modules/workspace/workspace.routes');

function createWorkspaceExpressRouter() {
  return createWorkspaceRoutes({
    buildDeps: () => ({
      requireAuth,
      requirePermission,
      requireTenant,
      sendJson,
      parseJsonBody,
      hasJsonContentType,
      badRequest,
      logger,
    }),
  });
}

module.exports = {
  createWorkspaceExpressRouter,
};
