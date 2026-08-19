'use strict';

const getKnowledgeGraphNodeModel = require('../../db/models/KnowledgeGraphNode');
const getKnowledgeGraphEdgeModel = require('../../db/models/KnowledgeGraphEdge');
const logger = require('../../utils/logger');

// Fail-closed: o service exige tenant explícito do caller (o boundary HTTP
// garante); sem tenant, lança TENANT_REQUIRED em vez de persistir/consultar o
// tenant 'system' por fallback silencioso.
function requireTenantId(tenantId) {
  const tid = typeof tenantId === 'string' ? tenantId.trim() : tenantId;
  if (!tid) throw Object.assign(new Error('tenantId é obrigatório'), { code: 'TENANT_REQUIRED' });
  return tid;
}

async function upsertNode({ tenantId, type, label, properties, externalRef, externalType }) {
  const KGNode = getKnowledgeGraphNodeModel();
  const where = { tenant_id: requireTenantId(tenantId), external_ref: externalRef, external_type: externalType };

  if (externalRef && externalType) {
    const existing = await KGNode.findOne({ where });
    if (existing) {
      await existing.update({ label, properties: { ...existing.properties, ...properties } });
      return existing;
    }
  }

  return KGNode.create({
    tenant_id: requireTenantId(tenantId),
    type,
    label,
    properties: properties || {},
    externalRef: externalRef || null,
    externalType: externalType || null,
  });
}

async function createEdge({ tenantId, sourceNodeId, targetNodeId, relationship, weight, properties }) {
  const KGEdge = getKnowledgeGraphEdgeModel();
  return KGEdge.create({
    tenant_id: requireTenantId(tenantId),
    sourceNodeId,
    targetNodeId,
    relationship,
    weight: weight || 1.0,
    properties: properties || {},
  });
}

async function queryGraph({ tenantId, nodeTypes, maxDepth = 3 }) {
  const KGNode = getKnowledgeGraphNodeModel();
  const KGEdge = getKnowledgeGraphEdgeModel();
  const { Op } = require('sequelize');

  const where = { tenant_id: requireTenantId(tenantId) };
  if (nodeTypes && nodeTypes.length > 0) {
    where.type = { [Op.in]: nodeTypes };
  }

  const nodes = await KGNode.findAll({ where });
  const nodeIds = nodes.map(n => n.id);

  const edges = await KGEdge.findAll({
    where: {
      tenant_id: requireTenantId(tenantId),
      [Op.or]: [
        { sourceNodeId: { [Op.in]: nodeIds } },
        { targetNodeId: { [Op.in]: nodeIds } },
      ],
    },
  });

  return { nodes, edges };
}

async function findRelated({ tenantId, nodeId, relationship, direction = 'both' }) {
  const KGEdge = getKnowledgeGraphEdgeModel();
  const KGNode = getKnowledgeGraphNodeModel();
  const { Op } = require('sequelize');

  const edgeWhere = { tenant_id: requireTenantId(tenantId) };
  if (relationship) edgeWhere.relationship = relationship;

  let edgeCondition;
  if (direction === 'outgoing') {
    edgeCondition = { sourceNodeId: nodeId };
  } else if (direction === 'incoming') {
    edgeCondition = { targetNodeId: nodeId };
  } else {
    edgeCondition = { [Op.or]: [{ sourceNodeId: nodeId }, { targetNodeId: nodeId }] };
  }

  const edges = await KGEdge.findAll({ where: { ...edgeWhere, ...edgeCondition } });
  const relatedNodeIds = new Set();
  for (const edge of edges) {
    if (edge.sourceNodeId !== nodeId) relatedNodeIds.add(edge.sourceNodeId);
    if (edge.targetNodeId !== nodeId) relatedNodeIds.add(edge.targetNodeId);
  }

  const relatedNodes = await KGNode.findAll({
    where: { id: { [Op.in]: Array.from(relatedNodeIds) } },
  });

  return { edges, relatedNodes };
}

async function deleteNode(nodeId, tenantId) {
  const KGNode = getKnowledgeGraphNodeModel();
  const KGEdge = getKnowledgeGraphEdgeModel();
  const { Op } = require('sequelize');

  await KGEdge.destroy({
    where: {
      tenant_id: requireTenantId(tenantId),
      [Op.or]: [{ sourceNodeId: nodeId }, { targetNodeId: nodeId }],
    },
  });

  return KGNode.destroy({ where: { id: nodeId, tenant_id: requireTenantId(tenantId) } });
}

module.exports = {
  upsertNode,
  createEdge,
  queryGraph,
  findRelated,
  deleteNode,
};
