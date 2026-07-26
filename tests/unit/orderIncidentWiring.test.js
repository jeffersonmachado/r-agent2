'use strict';

/**
 * Regressão — POST /orders/:orderId/incidents retornava 500 sempre.
 *
 * Falha observada (2026-07-26, cenário real FOOD-FLOW-ORDER-LIFECYCLE):
 * o controller de incidentes chama `deps.createTicket(...)`, mas o wiring
 * de `domain-business/routes.js` repassa `ctx.createTicket` do contexto
 * EXTENDED (`buildExtendedRoutingContext`), que não incluía `createTicket`
 * (a função existia apenas no contexto PLATFORM, em
 * `buildPlatformContentDeps`). Resultado: `deps.createTicket is not a
 * function` → 500 "Erro ao abrir incidente" em qualquer tentativa de
 * registrar incidente de pedido — quebra de funcionalidade PRODUCTION.
 *
 * Comportamento correto: o contexto extended expõe `createTicket` (mesma
 * função de `queueService` usada no contexto platform) e o módulo order
 * recebe tudo que o controller de incidentes consome.
 */

const { createBuildExtendedRoutingContext } = require('../../api/composition/extended/buildExtendedRoutingContext');
const { createTicket } = require('../../api/services/queueService');

function buildContext() {
  const builder = createBuildExtendedRoutingContext({ requireTenant: () => 'system' });
  const req = { method: 'POST', path: '/orders/order-1/incidents', url: '/orders/order-1/incidents' };
  const res = {};
  return builder(req, res);
}

describe('wiring de incidentes de pedido (regressão: 500 em POST /orders/:id/incidents)', () => {
  it('contexto extended expõe createTicket como função', () => {
    const ctx = buildContext();
    expect(typeof ctx.createTicket).toBe('function');
  });

  it('createTicket do contexto extended é a função real do queueService', () => {
    const ctx = buildContext();
    expect(ctx.createTicket).toBe(createTicket);
  });

  it('contexto extended expõe getTicket (leitura de incidente idempotente)', () => {
    const ctx = buildContext();
    expect(typeof ctx.getTicket).toBe('function');
  });
});
