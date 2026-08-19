'use strict';

/**
 * Tradução RBAC → permissões de tools do Cognitive Core.
 *
 * Fonte única compartilhada pelos boundaries que derivam o ator autenticado
 * para o Tool Registry:
 *  - api/modules/cognitive/routes.js (API cognitiva)
 *  - api/runtime/startMcpServer.js (boundary HTTP do MCP Server)
 *
 * Baseline (quem tem ai/execute pode operar a IA de negócio): agenda, canal,
 * tickets, transferência e chamadas. Permissões com recurso RBAC equivalente
 * (crm, campanhas, workspace) são derivadas do papel real do usuário.
 */

const { hasPermission } = require('../services/rbacService');

/**
 * @param {Object} agent - agente autenticado (req.agent)
 * @returns {string[]} permissões de tools (['*'] para super_admin)
 */
function resolveActorToolPermissions(agent) {
  if (String(agent?.role || '').toLowerCase() === 'super_admin') return ['*'];

  const granted = [];
  if (hasPermission(agent, 'ai', 'execute')) {
    granted.push('agenda.write', 'channel.send', 'ticket.write', 'conversation.transfer', 'pbx.call');
  }
  if (hasPermission(agent, 'crm', 'read')) granted.push('crm.read');
  if (hasPermission(agent, 'crm', 'create') || hasPermission(agent, 'crm', 'update')) granted.push('crm.write');
  if (hasPermission(agent, 'bulk_messaging', 'create') || hasPermission(agent, 'bulk_messaging', 'update')) granted.push('campaign.write');
  if (hasPermission(agent, 'workspace', 'write') || hasPermission(agent, 'workspace', 'action')) granted.push('workspace.write');
  return granted;
}

module.exports = { resolveActorToolPermissions };
