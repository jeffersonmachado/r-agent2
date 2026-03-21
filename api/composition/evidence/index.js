'use strict';

const { requireAuth } = require('../../middleware/auth');
const { sendJson, parseJsonBody } = require('../../express/httpHelpers');
const { requireTenant } = require('../shared/requireTenant');
const { createEvidenceRoutes } = require('../../modules/evidence/routes');

function createEvidenceExpressRouter() {
  return createEvidenceRoutes({
    buildDeps: () => ({
      requireAuth,
      requireTenant,
      sendJson,
      parseJsonBody,
    }),
  });
}

module.exports = {
  createEvidenceExpressRouter,
};
