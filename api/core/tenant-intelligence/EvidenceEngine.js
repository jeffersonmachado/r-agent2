'use strict';

const { TenantInsightEvidence } = require('../../db/models');
const { buildId } = require('./helpers');

class EvidenceEngine {
  async createEvidence({
    tenantId,
    insightId,
    evidenceType,
    sourceType,
    sourceId = null,
    excerpt = null,
    structuredData = {},
    metadata = {},
  } = {}) {
    if (!tenantId || !insightId || !evidenceType || !sourceType) {
      throw new Error('tenantId, insightId, evidenceType and sourceType are required');
    }

    const EvidenceModel = TenantInsightEvidence();
    const row = await EvidenceModel.create({
      id: buildId('evidence'),
      tenant_key: String(tenantId),
      insight_id: String(insightId),
      evidence_type: String(evidenceType),
      source_type: String(sourceType),
      source_id: sourceId ? String(sourceId) : null,
      excerpt: excerpt ? String(excerpt) : null,
      structured_data: structuredData && typeof structuredData === 'object' ? structuredData : {},
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
    });

    return row.toJSON ? row.toJSON() : row;
  }

  async listByInsight({ tenantId, insightId, limit = 100 } = {}) {
    if (!tenantId || !insightId) throw new Error('tenantId and insightId are required');

    const EvidenceModel = TenantInsightEvidence();
    const rows = await EvidenceModel.findAll({
      where: {
        tenant_key: String(tenantId),
        insight_id: String(insightId),
      },
      order: [['created_at', 'DESC']],
      limit: Math.min(Math.max(Number(limit) || 100, 1), 500),
    });

    const items = (rows || []).map((row) => (row.toJSON ? row.toJSON() : row));
    return { items, total: items.length };
  }
}

module.exports = {
  EvidenceEngine,
};
