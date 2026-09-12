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
 *  - Cada tool declara `{resource, action}` do RBAC (`rbac`; contrato legado
 *    `capability` como objeto ainda é aceito) e a decisão vem de
 *    `hasPermission(agent, resource, action)` — a mesma função usada pelas
 *    rotas HTTP do produto.
 *  - `resolveCanonicalPermissions` TRADUZ o RBAC de produto para as permissões
 *    canônicas do Canonical Tool Registry. Esta é a `AskAiToolPolicy`: o
 *    copiloto não inventa permissão própria — ele projeta o RBAC real na
 *    linguagem de capabilities do registry.
 *  - Negação é silenciosa quanto ao conteúdo: a tool não é executada e nenhum
 *    valor derivado é exposto. A resposta informa apenas que o usuário não
 *    possui acesso àquela informação.
 *  - `super_admin` continua sendo o único bypass (RBAC global), o que é
 *    coerente com o resto da plataforma.
 */

const { hasPermission, canAccessTicket } = require('../rbacService');

/**
 * Resolve o RBAC declarado de uma tool, aceitando o contrato legado
 * (`capability` como objeto `{resource, action}`).
 */
function resolveToolRbac(tool) {
  const rbac = tool?.rbac;
  if (rbac && rbac.resource && rbac.action) return rbac;
  const legacy = tool?.capability;
  if (legacy && typeof legacy === 'object' && legacy.resource && legacy.action) return legacy;
  return null;
}

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
    const rbac = resolveToolRbac(tool);
    if (!rbac) {
      denied.push({ toolId: tool?.id || 'unknown', reason: 'tool_without_capability' });
      continue;
    }
    if (!actor?.role) {
      denied.push({ toolId: tool.id, reason: 'no_actor' });
      continue;
    }
    if (!hasPermission(actor, rbac.resource, rbac.action)) {
      denied.push({ toolId: tool.id, reason: 'capability_denied' });
      continue;
    }
    allowed.push(tool);
  }

  return { allowed, denied };
}

/**
 * Traduz o RBAC de produto para as permissões CANÔNICAS do Canonical Tool
 * Registry (`crm.read`, `reports.read`, ...). Sem isso, a execução no registry
 * negaria toda tool — o que transformaria a convergência em regressão.
 */
function resolveCanonicalPermissions(actor, tools) {
  const granted = new Set();
  if (!actor?.role) return [];
  for (const tool of tools || []) {
    const rbac = resolveToolRbac(tool);
    if (!rbac) continue;
    if (!hasPermission(actor, rbac.resource, rbac.action)) continue;
    for (const permission of tool.permissions || []) granted.add(permission);
  }
  return [...granted];
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
  resolveToolRbac,
  resolveCanonicalPermissions,
};
