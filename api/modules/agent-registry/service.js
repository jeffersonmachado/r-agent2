'use strict';

const { getSequelize } = require('../../db/sequelize');
const getCorporateAgentModel = require('../../db/models/CorporateAgent');
const logger = require('../../utils/logger');

async function listCorporateAgents({ tenantId, filters = {} }) {
  const CorporateAgent = getCorporateAgentModel();
  const where = { tenant_id: tenantId || 'system' };

  if (filters.classification) {
    where.classification = filters.classification;
  }
  if (filters.lifecycle) {
    where.lifecycle = filters.lifecycle;
  }
  if (filters.status) {
    where.status = filters.status;
  }
  if (filters.search) {
    const { Op } = require('sequelize');
    where[Op.or] = [
      { name: { [Op.iLike]: `%${filters.search}%` } },
      { slug: { [Op.iLike]: `%${filters.search}%` } },
      { description: { [Op.iLike]: `%${filters.search}%` } },
    ];
  }

  const agents = await CorporateAgent.findAll({
    where,
    order: [['updated_at', 'DESC']],
  });

  return agents;
}

async function getCorporateAgentById(id, tenantId) {
  const CorporateAgent = getCorporateAgentModel();
  const agent = await CorporateAgent.findOne({
    where: { id, tenant_id: tenantId || 'system' },
  });
  if (!agent) return null;
  return agent;
}

async function createCorporateAgent(data) {
  const CorporateAgent = getCorporateAgentModel();
  const agent = await CorporateAgent.create({
    tenant_id: data.tenantId || 'system',
    name: data.name,
    slug: data.slug,
    description: data.description || null,
    owner: data.owner || null,
    department: data.department || null,
    version: data.version || '1.0.0',
    classification: data.classification || 'DEVELOPMENT',
    capabilities: data.capabilities || [],
    tools: data.tools || [],
    knowledgeSources: data.knowledgeSources || [],
    permissions: data.permissions || [],
    connectedSystems: data.connectedSystems || [],
    metrics: data.metrics || { executions: 0, successRate: 0, latency: 0, cost: 0, satisfaction: 0 },
    governance: data.governance || { approvedBy: null, approvedAt: null, riskLevel: 'low', auditEnabled: false },
    lifecycle: data.lifecycle || 'draft',
    config: data.config || {},
  });
  logger.info(`[AgentRegistry] Corporate agent created: ${agent.slug}`);
  return agent;
}

async function updateCorporateAgent(id, data, tenantId) {
  const CorporateAgent = getCorporateAgentModel();
  const agent = await CorporateAgent.findOne({
    where: { id, tenant_id: tenantId || 'system' },
  });
  if (!agent) return null;

  const updatableFields = [
    'name', 'slug', 'description', 'owner', 'department', 'version',
    'status', 'classification', 'capabilities', 'tools', 'knowledgeSources',
    'permissions', 'connectedSystems', 'metrics', 'governance', 'lifecycle', 'config',
  ];

  for (const field of updatableFields) {
    if (data[field] !== undefined) {
      agent[field] = data[field];
    }
  }

  await agent.save();
  logger.info(`[AgentRegistry] Corporate agent updated: ${agent.slug}`);
  return agent;
}

async function deleteCorporateAgent(id, tenantId) {
  const CorporateAgent = getCorporateAgentModel();
  const deleted = await CorporateAgent.destroy({
    where: { id, tenant_id: tenantId || 'system' },
  });
  return deleted > 0;
}

async function getAgentsByClassification(classification, tenantId) {
  const CorporateAgent = getCorporateAgentModel();
  return CorporateAgent.findAll({
    where: { classification, tenant_id: tenantId || 'system', lifecycle: 'active' },
    order: [['name', 'ASC']],
  });
}

module.exports = {
  listCorporateAgents,
  getCorporateAgentById,
  createCorporateAgent,
  updateCorporateAgent,
  deleteCorporateAgent,
  getAgentsByClassification,
};
