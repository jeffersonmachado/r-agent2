'use strict';

const { createIntegrationRoutes } = require('../../modules/integration/routes');
const { pickRouteDeps } = require('../shared/pickRouteDeps');

/**
 * Rotas públicas da camada de integração (webhooks de provedores externos).
 * Sem auth por design: o roteamento de tenant é resolvido server-side pela
 * identidade opaca da conexão na URL + verificação de assinatura fail-closed.
 */
function createIntegrationExpressRouter({ buildExtendedRoutingContext }) {
  return createIntegrationRoutes({
    buildDeps: (req, res) => {
      const ctx = buildExtendedRoutingContext(req, res);
      return pickRouteDeps(ctx, ['sendJson', 'parseJsonBodyWithRaw', 'logger']);
    },
  });
}

module.exports = { createIntegrationExpressRouter };
