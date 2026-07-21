'use strict';

const getKnowledgeGraphNodeModel = require('../../db/models/KnowledgeGraphNode');
const getKnowledgeGraphEdgeModel = require('../../db/models/KnowledgeGraphEdge');
const logger = require('../../utils/logger');

async function upsertNode({ tenantId, type, label, properties, externalRef, externalType }) {
  const KGNode = getKnowledgeGraphNodeModel();
  const where = { tenant_id: tenantId || 'system', external_ref: externalRef, external_type: externalType };

  if (externalRef && externalType) {
    const existing = await KGNode.findOne({ where });
    if (existing) {
      await existing.update({ label, properties: { ...existing.properties, ...properties } });
      return existing;
    }
  }

  return KGNode.create({
    tenant_id: tenantId || 'system',
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
    tenant_id: tenantId || 'system',
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

  const where = { tenant_id: tenantId || 'system' };
  if (nodeTypes && nodeTypes.length > 0) {
    where.type = { [Op.in]: nodeTypes };
  }

  const nodes = await KGNode.findAll({ where });
  const nodeIds = nodes.map(n => n.id);

  const edges = await KGEdge.findAll({
    where: {
      tenant_id: tenantId || 'system',
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

  const edgeWhere = { tenant_id: tenantId || 'system' };
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
      tenant_id: tenantId || 'system',
      [Op.or]: [{ sourceNodeId: nodeId }, { targetNodeId: nodeId }],
    },
  });

  return KGNode.destroy({ where: { id: nodeId, tenant_id: tenantId || 'system' } });
}

module.exports = {
  upsertNode,
  createEdge,
  queryGraph,
  findRelated,
  deleteNode,
};
