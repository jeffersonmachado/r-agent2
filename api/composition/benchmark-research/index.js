'use strict';

/**
 * Composição Express do módulo de PESQUISA DE BENCHMARKS.
 *
 * Superfície de ENGENHARIA (DEVELOPMENT): monta apenas o necessário para o
 * módulo — autenticação, helpers HTTP e o factory do supervisor. As
 * capabilities `research.*` são atendidas pelo provider NATIVO de pesquisa
 * (`api/services/research/nativeResearchProvider.js`, default no módulo de
 * rotas) ou por tools externas governadas via MCP (registradas no mesmo
 * Canonical Tool Registry no startup); se nenhuma das duas atender, a pesquisa
 * reporta `RESEARCH_BLOCKED_NO_EXTERNAL_ACCESS` em vez de inventar.
 */

const { requireAuth, requirePermission } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const logger = require('../../utils/logger');
const { createBenchmarkResearchRoutes } = require('../../modules/benchmark-research/routes');

function createBenchmarkResearchExpressRouter({ buildCoreRoutingContext, resolveResearchDeps } = {}) {
  return createBenchmarkResearchRoutes({
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
    resolveResearchDeps,
  });
}

module.exports = { createBenchmarkResearchExpressRouter };
