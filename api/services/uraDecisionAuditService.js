'use strict';

const crypto = require('crypto');
const { UraDecisionAudit } = require('../db/models');

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function safeStr(value) {
  return String(value == null ? '' : value).trim();
}

function toJson(row) {
  return row?.toJSON ? row.toJSON() : row;
}

function normalizeAudit(row) {
  const item = toJson(row);
  return {
    id: item.id,
    tenantId: item.tenant_key,
    ticketId: item.ticket_id || null,
    messageId: item.message_id || null,
    intent: item.intent || null,
    secondaryIntent: item.secondary_intent || null,
    confidence: item.confidence == null ? null : Number(item.confidence),
    fallbackUsed: item.fallback_used === true,
    departmentId: item.department_id || null,
    queueName: item.queue_name || null,
    ragUsed: item.rag_used === true,
    providerStatus: item.provider_status || null,
    latencyMs: item.latency_ms == null ? null : Number(item.latency_ms),
    contextUsedSummary: item.context_used_summary_json || null,
    createdAt: item.created_at || item.createdAt || null,
  };
}

async function recordDecision({
  tenantId,
  ticketId = null,
  messageId = null,
  aiResult = null,
  routingResult = null,
}) {
  if (!tenantId || !routingResult) return { ok: false, skipped: true, reason: 'missing_context' };
  const row = await UraDecisionAudit().create({
    id: newId('uraaudit'),
    tenant_key: String(tenantId),
    ticket_id: ticketId ? String(ticketId) : null,
    message_id: messageId ? String(messageId) : null,
    intent: safeStr(aiResult?.intent) || null,
    secondary_intent: safeStr(aiResult?.secondaryIntent) || null,
    confidence: aiResult?.confidence == null ? null : Number(aiResult.confidence),
    fallback_used: String(routingResult?.modeUsed || '').toLowerCase() !== 'ai',
    department_id: safeStr(routingResult?.departmentId) || null,
    queue_name: safeStr(routingResult?.queueName) || null,
    rag_used: aiResult?.ragUsed === true,
    provider_status: safeStr(aiResult?.providerStatus) || null,
    latency_ms: aiResult?.latencyMs == null ? null : Math.max(0, Number(aiResult.latencyMs || 0)),
    context_used_summary_json: aiResult?.contextUsed && typeof aiResult.contextUsed === 'object' ? aiResult.contextUsed : null,
  });
  return { ok: true, item: normalizeAudit(row) };
}

async function listRecentAudits({ tenantId, limit = 50 }) {
  const rows = await UraDecisionAudit().findAll({
    where: { tenant_key: String(tenantId) },
    order: [['created_at', 'DESC']],
    limit: Math.min(Math.max(Number(limit) || 50, 1), 200),
  });
  return { ok: true, items: rows.map(normalizeAudit) };
}

async function cleanupOldAudits({ days = 30 } = {}) {
  const maxAgeDays = Math.max(1, Number(days) || 30);
  const cutoff = new Date(Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000));
  const deleted = await UraDecisionAudit().destroy({
    where: {
      created_at: { [require('sequelize').Op.lt]: cutoff },
    },
  });
  return { ok: true, deleted };
}

module.exports = {
  recordDecision,
  listRecentAudits,
  cleanupOldAudits,
};
