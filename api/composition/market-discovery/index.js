'use strict';

/**
 * Composição Express do módulo de DESCOBERTA DE MERCADO.
 *
 * Superfície de ENGENHARIA (DEVELOPMENT, tenant SYSTEM): monta apenas o
 * necessário — autenticação, helpers HTTP e o factory do módulo de rotas. As
 * capabilities `research.*` são atendidas pelo provider NATIVO de pesquisa
 * (default no módulo de rotas) ou por tools externas governadas via MCP
 * (registradas no mesmo Canonical Tool Registry no startup); se nenhuma das
 * duas atender, o run reporta `MARKET_DISCOVERY_BLOCKED_NO_EXTERNAL_ACCESS`
 * em vez de inventar.
 */

const { requireAuth, requirePermission } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const logger = require('../../utils/logger');
const { createMarketDiscoveryRoutes } = require('../../modules/market-discovery/routes');

function createMarketDiscoveryExpressRouter({ buildCoreRoutingContext, resolveDiscoveryDeps } = {}) {
  return createMarketDiscoveryRoutes({
    buildDeps: (req, res) => {
      const ctx = typeof buildCoreRoutingContext === 'function' ? buildCoreRoutingContext(req, res) : {};
      return {
        requireAuth: ctx.requireAuth || requireAuth,
        requirePermission: ctx.requirePermission || requirePermission,
        sendJson: ctx.sendJson || sendJson,
        badRequest: ctx.badRequest || badRequest,
        hasJsonContentType: ctx.hasJsonContentType || hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody || parseJsonBody,
        logAction: ctx.logAction || null,
        logger: ctx.logger || logger,
      };
    },
    resolveDiscoveryDeps,
  });
}

module.exports = { createMarketDiscoveryExpressRouter };
