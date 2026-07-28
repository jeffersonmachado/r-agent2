'use strict';

const getAiGovernanceRecordModel = require('../../db/models/AiGovernanceRecord');
const logger = require('../../utils/logger');

async function logGovernanceEvent({ tenantId, agentId, eventType, actor, actorRole, description, metadata, decision, dataAccessed, toolsUsed, cost, riskLevel }) {
  const AiGovernanceRecord = getAiGovernanceRecordModel();
  return AiGovernanceRecord.create({
    tenant_id: tenantId || 'system',
    agentId: agentId || null,
    eventType,
    actor: actor || null,
    actorRole: actorRole || null,
    description: description || null,
    metadata: metadata || {},
    decision: decision || null,
    dataAccessed: dataAccessed || [],
    toolsUsed: toolsUsed || [],
    cost: cost || 0,
    riskLevel: riskLevel || 'low',
  });
}

async function getAuditTrail({ tenantId, agentId, eventTypes, limit = 100 }) {
  const AiGovernanceRecord = getAiGovernanceRecordModel();
  const where = { tenant_id: tenantId || 'system' };

  if (agentId) where.agentId = agentId;
  if (eventTypes && eventTypes.length > 0) {
    const { Op } = require('sequelize');
    where.eventType = { [Op.in]: eventTypes };
  }

  return AiGovernanceRecord.findAll({
    where,
    order: [['created_at', 'DESC']],
    limit,
  });
}

async function getDecisionLog({ tenantId, agentId, limit = 100 }) {
  const AiGovernanceRecord = getAiGovernanceRecordModel();
  const where = {
    tenant_id: tenantId || 'system',
    eventType: { [require('sequelize').Op.in]: ['decision', 'execute'] },
  };
  if (agentId) where.agentId = agentId;

  return AiGovernanceRecord.findAll({
    where,
    order: [['created_at', 'DESC']],
    limit,
  });
}

async function generateComplianceReport({ tenantId, startDate, endDate }) {
  const AiGovernanceRecord = getAiGovernanceRecordModel();
  const { Op, fn, col } = require('sequelize');

  const where = { tenant_id: tenantId || 'system' };
  if (startDate || endDate) {
    where.created_at = {};
    if (startDate) where.created_at[Op.gte] = new Date(startDate);
    if (endDate) where.created_at[Op.lte] = new Date(endDate);
  }

  const records = await AiGovernanceRecord.findAll({
    where,
    order: [['created_at', 'DESC']],
  });

  const summary = {
    totalEvents: records.length,
    byType: {},
    byRiskLevel: {},
    totalCost: 0,
    agentsInvolved: new Set(),
    dataAccessed: new Set(),
  };

  for (const r of records) {
    summary.byType[r.eventType] = (summary.byType[r.eventType] || 0) + 1;
    summary.byRiskLevel[r.riskLevel] = (summary.byRiskLevel[r.riskLevel] || 0) + 1;
    summary.totalCost += r.cost || 0;
    if (r.agentId) summary.agentsInvolved.add(r.agentId);
    for (const d of (r.dataAccessed || [])) summary.dataAccessed.add(d);
  }

  return {
    period: { startDate: startDate || 'beginning', endDate: endDate || 'now' },
    summary: {
      totalEvents: summary.totalEvents,
      byType: summary.byType,
      byRiskLevel: summary.byRiskLevel,
      totalCost: summary.totalCost,
      agentsInvolved: summary.agentsInvolved.size,
      dataAccessedCount: summary.dataAccessed.size,
      // Set serializa como {} em JSON — o payload publica o array
      // determinístico (ordenado) com os dados efetivamente acessados.
      dataAccessed: [...summary.dataAccessed].sort(),
    },
    records,
  };
}

module.exports = {
  logGovernanceEvent,
  getAuditTrail,
  getDecisionLog,
  generateComplianceReport,
};
