'use strict';

/**
 * Links operacionais de dado vivo do "Perguntar à IA" (T-A4).
 *
 * Quando a resposta é fundamentada em dados vivos de uma entidade do contexto,
 * o copiloto emite UM link operacional para a tela real daquela entidade —
 * "Ver aluno", "Ver atendimento" — para que o operador confira o dado na
 * superfície de trabalho.
 *
 * Regras não negociáveis:
 *  - o mapa de rotas é FECHADO e aponta apenas para rotas reais do frontend
 *    (`frontend/src/navigation/menu.js`); tipo de entidade sem mapeamento não
 *    gera link (fail-closed — nunca inventar URL);
 *  - a posse da entidade já foi revalidada no backend ANTES desta função ser
 *    chamada (orchestrator → validateEntityContext); aqui reaplicamos a
 *    PERMISSÃO do ator sobre a rota de destino (`hasPermission`), a mesma do
 *    menu/HTTP;
 *  - nenhum identificador interno (toolId, chunkId) entra no link.
 */

const { hasPermission } = require('../rbacService');

/**
 * Rotas reais do frontend por tipo de entidade, com a permissão que o menu
 * exige para a tela de destino. `url` como função recebe o entityId já
 * validado pelo contrato de contexto (SAFE_ID_PATTERN).
 */
const OPERATIONAL_LINK_ROUTES = Object.freeze({
  FITNESS_STUDENT: Object.freeze({
    label: 'Ver aluno',
    url: '/fitness/students',
    permission: Object.freeze({ resource: 'reports', action: 'read' }),
  }),
  CONVERSATION: Object.freeze({
    label: 'Ver atendimento',
    url: (entityId) => `/inbox?conversationId=${encodeURIComponent(entityId)}`,
    permission: Object.freeze({ resource: 'inbox', action: 'read' }),
  }),
  ORDER: Object.freeze({
    label: 'Ver pedido',
    url: '/orders',
    permission: Object.freeze({ resource: 'reports', action: 'read' }),
  }),
  BOOKING: Object.freeze({
    label: 'Ver agendamento',
    url: '/agenda',
    permission: Object.freeze({ resource: 'reports', action: 'read' }),
  }),
});

/**
 * Monta o link operacional da entidade do contexto, ou null.
 *
 * @param {Object} input
 * @param {{type: string, id: string}|null} input.entity entidade JÁ revalidada
 * @param {Object} input.actor `req.agent`
 * @param {boolean} input.liveDataUsed alguma tool devolveu dado encontrado
 * @returns {{sourceType: 'LIVE_DATA', title: string, label: string, url: string}|null}
 */
function buildOperationalLink({ entity, actor, liveDataUsed = false } = {}) {
  if (!liveDataUsed) return null;
  if (!entity?.type || !entity?.id) return null;

  const route = OPERATIONAL_LINK_ROUTES[String(entity.type)];
  if (!route) return null;

  const { resource, action } = route.permission;
  if (!hasPermission(actor, resource, action)) return null;

  const url = typeof route.url === 'function' ? route.url(entity.id) : route.url;
  return {
    sourceType: 'LIVE_DATA',
    title: route.label,
    label: route.label,
    url,
  };
}

module.exports = {
  OPERATIONAL_LINK_ROUTES,
  buildOperationalLink,
};
