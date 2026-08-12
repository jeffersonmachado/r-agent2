'use strict';

/**
 * MCP Authorization — construção e validação do Principal em requisições MCP.
 *
 * Regras absolutas:
 *  - Tenant SEMPRE vem do contexto autenticado, nunca do input da tool.
 *  - Tool input não pode trocar tenant (tenantId/tenant_key no payload é
 *    rejeitado).
 *  - Fail closed: contexto incompleto ou inválido é negado.
 *  - Nenhum wildcard implícito: permissões vêm do principal autenticado.
 */

const { isValidVisibility } = require('../cognitive/visibility');

const TENANT_OVERRIDE_FIELDS = ['tenantId', 'tenant_id', 'tenantKey', 'tenant_key'];

/**
 * Valida o contexto autenticado e produz o MCP execution context.
 *
 * @param {object} authContext
 * @param {string} authContext.tenantId        obrigatório (da sessão autenticada)
 * @param {string} authContext.principalId     obrigatório
 * @param {string} authContext.principalType   user | agent | service
 * @param {string} [authContext.agentId]
 * @param {string} authContext.classification  PRODUCTION | SUPPORT | DEVELOPMENT
 * @param {string[]} [authContext.permissions]
 * @param {string[]} [authContext.capabilities]
 * @param {string} [authContext.sessionId]
 * @param {string} [authContext.correlationId]
 */
function buildMcpExecutionContext(authContext = {}) {
  const tenantId = String(authContext.tenantId || '').trim();
  if (!tenantId) throw new Error('mcp_principal_invalid: tenant_required');

  const principalId = String(authContext.principalId || authContext.userId || authContext.agentId || '').trim();
  if (!principalId) throw new Error('mcp_principal_invalid: principal_required');

  const classification = String(authContext.classification || '').toUpperCase();
  if (!isValidVisibility(classification)) {
    throw new Error('mcp_principal_invalid: classification_required');
  }

  return {
    tenantId,
    principalId,
    principalType: authContext.principalType || (authContext.agentId ? 'agent' : 'user'),
    agentId: authContext.agentId || null,
    classification,
    permissions: Array.isArray(authContext.permissions) ? [...authContext.permissions] : [],
    capabilities: Array.isArray(authContext.capabilities) ? [...authContext.capabilities] : [],
    sessionId: authContext.sessionId || null,
    correlationId: authContext.correlationId || null,
  };
}

/**
 * Rejeita qualquer tentativa de trocar tenant via input da tool.
 * Retorna uma cópia sanitizada dos argumentos (sem campos de tenant).
 */
function stripTenantOverride(args = {}) {
  const clean = { ...(args || {}) };
  const violations = [];
  for (const field of TENANT_OVERRIDE_FIELDS) {
    if (clean[field] !== undefined) {
      violations.push(field);
      delete clean[field];
    }
  }
  // _meta carrega correlação — nunca tenant.
  if (clean._meta && typeof clean._meta === 'object') {
    for (const field of TENANT_OVERRIDE_FIELDS) {
      if (clean._meta[field] !== undefined) {
        violations.push(`_meta.${field}`);
        delete clean._meta[field];
      }
    }
  }
  if (violations.length > 0) {
    const error = new Error(`mcp_tenant_override_forbidden: ${violations.join(', ')}`);
    error.code = 'mcp_tenant_override_forbidden';
    error.violations = violations;
    throw error;
  }
  return clean;
}

module.exports = {
  buildMcpExecutionContext,
  stripTenantOverride,
  TENANT_OVERRIDE_FIELDS,
};
