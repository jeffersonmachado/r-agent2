'use strict';

/**
 * Composição das rotas de administração do MCP Control Plane (§M8).
 *
 * O módulo é puro quanto a dependências: a composição injeta auth, helpers HTTP
 * e resolução de tenant, exatamente como as demais superfícies de engenharia.
 */

const { requireAuth } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const { tenantFromRequest } = require('../../../lib/rpaSecurity');
const { createMcpRoutes } = require('../../modules/mcp/routes');

function buildMcpRouteDeps() {
  return {
    requireAuth,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    /** Tenant SEMPRE do contexto autenticado, nunca do payload. */
    tenantFromRequest: (req, auth) => tenantFromRequest(req, auth),
  };
}

function createMcpExpressRouter() {
  return createMcpRoutes({ buildDeps: () => buildMcpRouteDeps() });
}

module.exports = { createMcpExpressRouter, buildMcpRouteDeps };
