'use strict';

/**
 * Composição Express do módulo GOVERNANÇA DE ENGENHARIA.
 *
 * Superfície de ENGENHARIA (DEVELOPMENT): monta apenas autenticação, helpers HTTP
 * e o guard de classificação aplicado dentro do módulo de rotas
 * (`checkClassification` fail-closed, classificação resolvida server-side).
 *
 * Nenhum serviço é instanciado aqui: as rotas carregam sob demanda, mantendo o
 * boot leve e sem abrir conexão de banco no carregamento do router.
 */

const { requireAuth, requirePermission } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const { createDevGovernanceRoutes } = require('../../modules/dev-governance/routes');

function createDevGovernanceExpressRouter({ buildCoreRoutingContext } = {}) {
  return createDevGovernanceRoutes({
    buildDeps: (req, res) => {
      const ctx = typeof buildCoreRoutingContext === 'function' ? buildCoreRoutingContext(req, res) : {};
      return {
        requireAuth: ctx.requireAuth || requireAuth,
        requirePermission: ctx.requirePermission || requirePermission,
        sendJson: ctx.sendJson || sendJson,
        badRequest: ctx.badRequest || badRequest,
        hasJsonContentType: ctx.hasJsonContentType || hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody || parseJsonBody,
      };
    },
  });
}

module.exports = { createDevGovernanceExpressRouter };
