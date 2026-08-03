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

  // Agregações no SQL (tabela append-only: findAll sem limite + agregação em
  // JS escalava mal). byType/byRiskLevel/totais/agentes via GROUP BY/COUNT/SUM.
  const [byTypeRows, byRiskRows, totalsRow] = await Promise.all([
    AiGovernanceRecord.findAll({
      where,
      attributes: ['eventType', [fn('COUNT', col('event_type')), 'count']],
      group: ['eventType'],
      raw: true,
    }),
    AiGovernanceRecord.findAll({
      where,
      attributes: ['riskLevel', [fn('COUNT', col('risk_level')), 'count']],
      group: ['riskLevel'],
      raw: true,
    }),
    AiGovernanceRecord.findOne({
      where,
      attributes: [
        [fn('COUNT', col('id')), 'totalEvents'],
        [fn('COALESCE', fn('SUM', col('cost')), 0), 'totalCost'],
        [fn('COUNT', fn('DISTINCT', col('agent_id'))), 'agentsInvolved'],
      ],
      raw: true,
    }),
  ]);

  const byType = {};
  for (const row of byTypeRows || []) {
    byType[row.eventType] = Number(row.count) || 0;
  }
  const byRiskLevel = {};
  for (const row of byRiskRows || []) {
    byRiskLevel[row.riskLevel] = Number(row.count) || 0;
  }

  // dataAccessed (jsonb array) é caro de agregar no SQL; mantém scan limitado
  // às 10k linhas mais recentes para o conjunto de dados acessados.
  const DATA_ACCESSED_SCAN_LIMIT = 10000;
  const dataAccessedRows = await AiGovernanceRecord.findAll({
    where,
    attributes: ['dataAccessed'],
    order: [['created_at', 'DESC']],
    limit: DATA_ACCESSED_SCAN_LIMIT,
  });
  const dataAccessed = new Set();
  for (const r of dataAccessedRows || []) {
    for (const d of (r.dataAccessed || [])) dataAccessed.add(d);
  }

  // Payload de registros limitado aos 1000 mais recentes (antes: sem limite).
  const RECORDS_LIMIT = 1000;
  const records = await AiGovernanceRecord.findAll({
    where,
    order: [['created_at', 'DESC']],
    limit: RECORDS_LIMIT,
  });

  return {
    period: { startDate: startDate || 'beginning', endDate: endDate || 'now' },
    summary: {
      totalEvents: Number(totalsRow?.totalEvents) || 0,
      byType,
      byRiskLevel,
      totalCost: Number(totalsRow?.totalCost) || 0,
      agentsInvolved: Number(totalsRow?.agentsInvolved) || 0,
      dataAccessedCount: dataAccessed.size,
      // Set serializa como {} em JSON — o payload publica o array
      // determinístico (ordenado) com os dados efetivamente acessados.
      dataAccessed: [...dataAccessed].sort(),
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
