'use strict';

/**
 * Autorização de ferramentas operacionais do "Perguntar à IA".
 *
 * GAP CONFIRMADO (auditoria 2026-09-11): não existia camada de tools, então
 * não existia autorização por tool. Com a introdução do copiloto operacional,
 * a regra passa a ser explícita: o copiloto executa ferramentas com a
 * IDENTIDADE REAL do usuário — nunca como superusuário invisível.
 *
 * Regras:
 *  - Cada tool declara `{resource, action}` do RBAC; a decisão vem de
 *    `hasPermission(agent, resource, action)` — a mesma função usada pelas
 *    rotas HTTP do produto.
 *  - Negação é silenciosa quanto ao conteúdo: a tool não é executada e nenhum
 *    valor derivado é exposto. A resposta informa apenas que o usuário não
 *    possui acesso àquela informação.
 *  - `super_admin` continua sendo o único bypass (RBAC global), o que é
 *    coerente com o resto da plataforma.
 */

const { hasPermission, canAccessTicket } = require('../rbacService');

/**
 * Filtra as tools permitidas para o ator.
 *
 * @param {Object} input
 * @param {Object} input.actor - `req.agent`
 * @param {Array<Object>} input.tools - Definições de tool
 * @returns {{allowed: Array<Object>, denied: Array<{toolId: string, reason: string}>}}
 */
function authorizeTools({ actor, tools }) {
  const allowed = [];
  const denied = [];

  for (const tool of tools || []) {
    const capability = tool?.capability;
    if (!capability?.resource || !capability?.action) {
      denied.push({ toolId: tool?.id || 'unknown', reason: 'tool_without_capability' });
      continue;
    }
    if (!actor?.role) {
      denied.push({ toolId: tool.id, reason: 'no_actor' });
      continue;
    }
    if (!hasPermission(actor, capability.resource, capability.action)) {
      denied.push({ toolId: tool.id, reason: 'capability_denied' });
      continue;
    }
    allowed.push(tool);
  }

  return { allowed, denied };
}

/**
 * Verifica se o ator pode acessar uma entidade de ticket/caso (usado quando a
 * tool opera sobre entidade sensível). Delega ao RBAC existente.
 */
function canAccessEntity(actor, entity) {
  if (!actor || !entity) return false;
  if (entity.type === 'TICKET' || entity.type === 'CASE') {
    return canAccessTicket(actor, entity.value || entity);
  }
  return true;
}

module.exports = {
  authorizeTools,
  canAccessEntity,
};
