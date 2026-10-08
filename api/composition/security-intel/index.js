'use strict';

/**
 * Composição Express do módulo RAP VERSION & SECURITY INTELLIGENCE.
 *
 * Superfície de ENGENHARIA (DEVELOPMENT): monta apenas o necessário —
 * autenticação, helpers HTTP e o guard de classificação aplicado dentro do
 * módulo de rotas (`checkClassification` fail-closed, classificação resolvida
 * server-side).
 *
 * Nenhum serviço da capacidade é instanciado aqui: as rotas carregam os serviços
 * sob demanda, o que mantém o boot da API leve e evita abrir conexão de banco no
 * carregamento do router.
 */

const { requireAuth, requirePermission } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const { createSecurityIntelRoutes } = require('../../modules/security-intel/routes');

function createSecurityIntelExpressRouter({ buildCoreRoutingContext } = {}) {
  return createSecurityIntelRoutes({
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

module.exports = { createSecurityIntelExpressRouter };
