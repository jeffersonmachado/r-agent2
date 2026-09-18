'use strict';

/**
 * Composição Express do módulo de PESQUISA DE BENCHMARKS.
 *
 * Superfície de ENGENHARIA (DEVELOPMENT): monta apenas o necessário para o
 * módulo — autenticação, helpers HTTP e o factory do supervisor.
 *
 * §P0 RAP_CORE_RESEARCH_EGRESS (2026-09-18) — o caminho PADRÃO das capabilities
 * `research.*` é o Canonical Tool Registry: tools de MCP externo registradas no
 * startup (MCP Control Plane), resolvidas por capability com delegação de escopo
 * DECLARADA na configuração persistida da conexão. O provider NATIVO
 * (`api/services/research/nativeResearchProvider.js`) deixou de ser default: ele
 * só é usado com opt-in EXPLÍCITO (`RESEARCH_NATIVE_PROVIDER_ENABLED=1`) e o uso
 * é auditado em log. Sem provider governado e sem opt-in, o conjunto é vazio e a
 * pesquisa reporta `RESEARCH_BLOCKED_NO_EXTERNAL_ACCESS` com a lista nominal das
 * capabilities ausentes — fail closed, nunca egress direto do Core.
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
