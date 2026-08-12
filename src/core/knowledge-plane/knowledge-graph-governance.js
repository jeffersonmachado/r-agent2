'use strict';

/**
 * Knowledge Graph Governance — extensão multi-tenant e segregada do Knowledge Graph.
 *
 * Regras:
 *  - Tenant A cannot query Tenant B graph nodes
 *  - PRODUCTION cannot query SYSTEM nodes
 *  - SUPPORT cannot query DEVELOPMENT-only graph data unless policy allows
 *  - Unknown classification → DENY
 *
 * Extende o Knowledge Graph existente (api/modules/knowledge-graph/service.js)
 * com políticas de acesso governadas pelo Knowledge Router.
 */

const { resolveKnowledgeContext } = require('./knowledge-router');

function defaultLogger() {
  try { return require('../../../api/utils/logger'); } catch (_) { return { info: () => {}, warn: () => {}, error: () => {} }; }
}

/**
 * Valida acesso ao Knowledge Graph com políticas de segregation.
 *
 * @param {Object} args
 * @param {string} args.tenantId
 * @param {Object} args.principal - { classification }
 * @param {string} [args.requestedDomain] - OPERATIONAL ou SYSTEM
 * @param {string} [args.retrievalPurpose]
 * @returns {Object} { allowed, scope, reason }
 */
function validateGraphAccess({ tenantId, principal, requestedDomain = null, retrievalPurpose = null }) {
  if (!tenantId) return { allowed: false, reason: 'graph_tenant_required' };

  const knowledgeResult = resolveKnowledgeContext({
    principal: principal || { classification: 'PRODUCTION' },
    requestedDomain,
    retrievalPurpose,
  });

  if (!knowledgeResult.allowed) {
    return {
      allowed: false,
      reason: `graph_access_denied: ${knowledgeResult.scope.reason}`,
      scope: knowledgeResult.scope,
    };
  }

  return {
    allowed: true,
    scope: knowledgeResult.scope,
    reason: 'graph_access_authorized',
  };
}

/**
 * Filtra nós do Knowledge Graph por tenant + domain + classification.
 * Aplica-se tanto na query quanto na listagem.
 *
 * @param {Array} nodes - nós do Knowledge Graph
 * @param {Object} access — resultado de validateGraphAccess
 * @param {string} tenantId
 * @returns {Array} nós filtrados
 */
function filterGraphNodes(nodes, access, tenantId) {
  if (!Array.isArray(nodes)) return [];

  return nodes.filter((node) => {
    // Tenant isolation
    if (node.tenantId && node.tenantId !== tenantId) return false;

    // Domain + classification filter
    if (access.scope) {
      const nodeDomain = node.domain || node.nodeDomain || 'OPERATIONAL';
      const nodeClassification = node.classification || 'PRODUCTION';

      if (nodeDomain !== access.scope.domain) return false;
      if (!access.scope.classifications.includes(nodeClassification)) return false;
    }

    return true;
  });
}

/**
 * Adiciona campos de governança a um nó do Knowledge Graph.
 *
 * @param {Object} node
 * @param {Object} args
 * @returns {Object} nó com campos de governança
 */
function withGovernance(node, { domain, classification, sensitivity, tenantId }) {
  return {
    ...node,
    domain: domain || node.domain || 'OPERATIONAL',
    classification: classification || node.classification || 'PRODUCTION',
    sensitivity: sensitivity || node.sensitivity || 'internal',
    tenantId: tenantId || node.tenantId || null,
    governedAt: new Date().toISOString(),
  };
}

module.exports = {
  validateGraphAccess,
  filterGraphNodes,
  withGovernance,
};
