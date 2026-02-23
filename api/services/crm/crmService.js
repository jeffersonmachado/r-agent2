'use strict';

const crypto = require('crypto');
const { getSequelize } = require('../../db/sequelize');
const {
  CrmAccount,
  CrmContact,
  CrmLead,
  CrmPipeline,
  CrmOpportunity,
  CrmActivity,
  CrmEvent,
} = require('../../db/models');
const { appendEventV1, listEvents } = require('../eventLedgerService');

function dbAvailable() {
  return !!getSequelize();
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function safeStr(v) {
  return v == null ? '' : String(v).trim();
}

function normalizeEmail(v) {
  const s = safeStr(v).toLowerCase();
  if (!s) return null;
  if (s.length > 255) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
}

function normalizePhone(v) {
  const s = safeStr(v).replace(/[^\d+]/g, '');
  if (!s) return null;
  const out = s.startsWith('+') ? s : `+${s}`;
  if (!/^\+[1-9]\d{7,20}$/.test(out)) return null;
  return out;
}

async function persistCrmEventProjection({
  tenantId,
  sourceEvent,
  eventType,
  subjectType = null,
  subjectId = null,
  correlationId = null,
  payload = {},
}) {
  if (!dbAvailable()) return;
  const Model = CrmEvent();
  await Model.create({
    id: newId('crmevt'),
    tenant_key: String(tenantId),
    tenantId: String(tenantId),
    source_event_id: sourceEvent && sourceEvent.id ? String(sourceEvent.id) : null,
    event_type: String(eventType),
    correlation_id: correlationId ? String(correlationId) : null,
    subject_type: subjectType ? String(subjectType) : null,
    subject_id: subjectId ? String(subjectId) : null,
    payload: payload && typeof payload === 'object' ? payload : {},
    occurred_at: sourceEvent && sourceEvent.occurred_at ? new Date(sourceEvent.occurred_at) : new Date(),
  }).catch(() => null);
}

async function emitCrmEvent({
  tenantId,
  eventType,
  subjectType = null,
  subjectId = null,
  correlationId = null,
  actorId = null,
  payload = {},
}) {
  const evt = await appendEventV1({
    tenantId,
    type: String(eventType),
    source: 'crm.v1',
    occurredAt: new Date(),
    correlationId,
    subject: subjectType && subjectId ? { type: String(subjectType), id: String(subjectId) } : { type: 'crm', id: 'operation' },
    actor: actorId ? { type: 'user', id: String(actorId) } : { type: 'system', id: 'crm' },
    idempotencyKey: null,
    payload: payload && typeof payload === 'object' ? payload : {},
  }).catch(() => null);

  await persistCrmEventProjection({
    tenantId,
    sourceEvent: evt,
    eventType,
    subjectType,
    subjectId,
    correlationId,
    payload,
  });

  return evt;
}

function getPagination(limit, offset, maxLimit = 2000) {
  return {
    limit: Math.min(Math.max(Number(limit) || 200, 1), maxLimit),
    offset: Math.max(Number(offset) || 0, 0),
  };
}

async function listSimple({ modelGetter, tenantId, where = {}, order = [['updated_at', 'DESC']], limit = 200, offset = 0 }) {
  if (!dbAvailable()) return { total: 0, items: [], limit: 0, offset: 0 };
  const Model = modelGetter();
  const pg = getPagination(limit, offset);
  const { count, rows } = await Model.findAndCountAll({
    where: {
      tenant_key: String(tenantId),
      ...(where && typeof where === 'object' ? where : {}),
    },
    order,
    limit: pg.limit,
    offset: pg.offset,
  });
  return { total: count, items: rows.map((r) => (r.toJSON ? r.toJSON() : r)), limit: pg.limit, offset: pg.offset };
}

async function upsertAccount({ tenantId, id = null, externalId = null, name, ownerUserId = null, status = 'active', attributes = {}, actorId = null }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const t = safeStr(tenantId);
  if (!t) return { ok: false, error: 'tenant_required' };
  const n = safeStr(name);
  if (!n) return { ok: false, error: 'name_required' };

  const Model = CrmAccount();
  const where = id ? { tenant_key: t, id: String(id) } : (externalId ? { tenant_key: t, external_id: String(externalId).trim() } : null);
  const existing = where ? await Model.findOne({ where }) : null;

  const row = existing
    ? await existing.update({
      external_id: externalId ? String(externalId).trim() : existing.external_id,
      name: n,
      owner_user_id: ownerUserId ? String(ownerUserId) : null,
      status: safeStr(status) || 'active',
      attributes: attributes && typeof attributes === 'object' ? attributes : {},
    })
    : await Model.create({
      id: newId('crmacc'),
      tenant_key: t,
      tenantId: t,
      external_id: externalId ? String(externalId).trim() : null,
      name: n,
      owner_user_id: ownerUserId ? String(ownerUserId) : null,
      status: safeStr(status) || 'active',
      attributes: attributes && typeof attributes === 'object' ? attributes : {},
    });

  const account = row.toJSON ? row.toJSON() : row;
  await emitCrmEvent({
    tenantId: t,
    eventType: 'CrmAccountUpserted',
    subjectType: 'crm_account',
    subjectId: account.id,
    actorId,
    payload: { accountId: account.id, status: account.status, ownerUserId: account.owner_user_id || null },
  });

  return { ok: true, account, created: !existing };
}

async function upsertContact({ tenantId, id = null, accountId = null, externalId = null, name, email = null, phone = null, role = null, ownerUserId = null, status = 'active', attributes = {}, actorId = null }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const t = safeStr(tenantId);
  if (!t) return { ok: false, error: 'tenant_required' };
  const n = safeStr(name);
  if (!n) return { ok: false, error: 'name_required' };

  const Model = CrmContact();
  const where = id ? { tenant_key: t, id: String(id) } : (externalId ? { tenant_key: t, external_id: String(externalId).trim() } : null);
  const existing = where ? await Model.findOne({ where }) : null;

  const row = existing
    ? await existing.update({
      account_id: accountId ? String(accountId) : null,
      external_id: externalId ? String(externalId).trim() : existing.external_id,
      name: n,
      email: normalizeEmail(email),
      phone: normalizePhone(phone),
      role: role ? String(role).trim() : null,
      owner_user_id: ownerUserId ? String(ownerUserId) : null,
      status: safeStr(status) || 'active',
      attributes: attributes && typeof attributes === 'object' ? attributes : {},
    })
    : await Model.create({
      id: newId('crmctt'),
      tenant_key: t,
      tenantId: t,
      account_id: accountId ? String(accountId) : null,
      external_id: externalId ? String(externalId).trim() : null,
      name: n,
      email: normalizeEmail(email),
      phone: normalizePhone(phone),
      role: role ? String(role).trim() : null,
      owner_user_id: ownerUserId ? String(ownerUserId) : null,
      status: safeStr(status) || 'active',
      attributes: attributes && typeof attributes === 'object' ? attributes : {},
    });

  const contact = row.toJSON ? row.toJSON() : row;
  await emitCrmEvent({
    tenantId: t,
    eventType: 'CrmContactUpserted',
    subjectType: 'crm_contact',
    subjectId: contact.id,
    actorId,
    payload: { contactId: contact.id, accountId: contact.account_id || null, status: contact.status },
  });

  return { ok: true, contact, created: !existing };
}

async function upsertLead({ tenantId, id = null, accountId = null, contactId = null, externalId = null, source = null, ownerUserId = null, status = 'new', score = 0, attributes = {}, actorId = null }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const t = safeStr(tenantId);
  if (!t) return { ok: false, error: 'tenant_required' };

  const Model = CrmLead();
  const where = id ? { tenant_key: t, id: String(id) } : (externalId ? { tenant_key: t, external_id: String(externalId).trim() } : null);
  const existing = where ? await Model.findOne({ where }) : null;

  const row = existing
    ? await existing.update({
      account_id: accountId ? String(accountId) : null,
      contact_id: contactId ? String(contactId) : null,
      external_id: externalId ? String(externalId).trim() : existing.external_id,
      source: source ? String(source).trim() : null,
      owner_user_id: ownerUserId ? String(ownerUserId) : null,
      status: safeStr(status) || 'new',
      score: Number.isFinite(Number(score)) ? Number(score) : (Number(existing.score) || 0),
      attributes: attributes && typeof attributes === 'object' ? attributes : {},
    })
    : await Model.create({
      id: newId('crmled'),
      tenant_key: t,
      tenantId: t,
      account_id: accountId ? String(accountId) : null,
      contact_id: contactId ? String(contactId) : null,
      external_id: externalId ? String(externalId).trim() : null,
      source: source ? String(source).trim() : null,
      owner_user_id: ownerUserId ? String(ownerUserId) : null,
      status: safeStr(status) || 'new',
      score: Number.isFinite(Number(score)) ? Number(score) : 0,
      attributes: attributes && typeof attributes === 'object' ? attributes : {},
    });

  const lead = row.toJSON ? row.toJSON() : row;
  await emitCrmEvent({
    tenantId: t,
    eventType: 'CrmLeadUpserted',
    subjectType: 'crm_lead',
    subjectId: lead.id,
    actorId,
    payload: { leadId: lead.id, status: lead.status, score: lead.score || 0, source: lead.source || null },
  });

  return { ok: true, lead, created: !existing };
}

async function upsertPipeline({ tenantId, id = null, name, status = 'active', isDefault = false, stages = [], attributes = {}, actorId = null }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const t = safeStr(tenantId);
  if (!t) return { ok: false, error: 'tenant_required' };
  const n = safeStr(name);
  if (!n) return { ok: false, error: 'name_required' };

  const Model = CrmPipeline();
  const where = id ? { tenant_key: t, id: String(id) } : { tenant_key: t, name: n };
  const existing = await Model.findOne({ where });

  const normalizedStages = Array.isArray(stages)
    ? stages
      .map((s, idx) => ({
        id: safeStr(s && s.id) || `stage-${idx + 1}`,
        name: safeStr(s && s.name) || `Etapa ${idx + 1}`,
        order: Number.isFinite(Number(s && s.order)) ? Number(s.order) : idx + 1,
      }))
      .slice(0, 50)
    : [];

  const row = existing
    ? await existing.update({
      name: n,
      status: safeStr(status) || 'active',
      is_default: isDefault === true,
      stages: normalizedStages,
      attributes: attributes && typeof attributes === 'object' ? attributes : {},
    })
    : await Model.create({
      id: newId('crmpl'),
      tenant_key: t,
      tenantId: t,
      name: n,
      status: safeStr(status) || 'active',
      is_default: isDefault === true,
      stages: normalizedStages,
      attributes: attributes && typeof attributes === 'object' ? attributes : {},
    });

  if (isDefault === true) {
    await Model.update({ is_default: false }, {
      where: {
        tenant_key: t,
        id: { [Model.sequelize.constructor.Op.ne]: row.id },
      },
    }).catch(() => null);
  }

  const pipeline = row.toJSON ? row.toJSON() : row;
  await emitCrmEvent({
    tenantId: t,
    eventType: 'CrmPipelineUpserted',
    subjectType: 'crm_pipeline',
    subjectId: pipeline.id,
    actorId,
    payload: { pipelineId: pipeline.id, status: pipeline.status, stagesCount: Array.isArray(pipeline.stages) ? pipeline.stages.length : 0 },
  });

  return { ok: true, pipeline, created: !existing };
}

async function upsertOpportunity({
  tenantId,
  id = null,
  pipelineId,
  stageId,
  title,
  accountId = null,
  contactId = null,
  leadId = null,
  ownerUserId = null,
  valueCents = 0,
  currency = 'BRL',
  status = 'open',
  correlationId = null,
  expectedCloseAt = null,
  attributes = {},
  actorId = null,
}) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const t = safeStr(tenantId);
  if (!t) return { ok: false, error: 'tenant_required' };
  if (!safeStr(pipelineId)) return { ok: false, error: 'pipeline_required' };
  if (!safeStr(stageId)) return { ok: false, error: 'stage_required' };
  if (!safeStr(title)) return { ok: false, error: 'title_required' };

  const Model = CrmOpportunity();
  const existing = id ? await Model.findOne({ where: { tenant_key: t, id: String(id) } }) : null;

  const row = existing
    ? await existing.update({
      pipeline_id: String(pipelineId),
      stage_id: String(stageId),
      title: String(title).trim(),
      account_id: accountId ? String(accountId) : null,
      contact_id: contactId ? String(contactId) : null,
      lead_id: leadId ? String(leadId) : null,
      owner_user_id: ownerUserId ? String(ownerUserId) : null,
      value_cents: Number.isFinite(Number(valueCents)) ? Number(valueCents) : Number(existing.value_cents || 0),
      currency: safeStr(currency) || 'BRL',
      status: safeStr(status) || 'open',
      correlation_id: correlationId ? String(correlationId).trim() : null,
      expected_close_at: expectedCloseAt ? new Date(String(expectedCloseAt)) : null,
      attributes: attributes && typeof attributes === 'object' ? attributes : {},
    })
    : await Model.create({
      id: newId('crmopp'),
      tenant_key: t,
      tenantId: t,
      pipeline_id: String(pipelineId),
      stage_id: String(stageId),
      title: String(title).trim(),
      account_id: accountId ? String(accountId) : null,
      contact_id: contactId ? String(contactId) : null,
      lead_id: leadId ? String(leadId) : null,
      owner_user_id: ownerUserId ? String(ownerUserId) : null,
      value_cents: Number.isFinite(Number(valueCents)) ? Number(valueCents) : 0,
      currency: safeStr(currency) || 'BRL',
      status: safeStr(status) || 'open',
      correlation_id: correlationId ? String(correlationId).trim() : null,
      expected_close_at: expectedCloseAt ? new Date(String(expectedCloseAt)) : null,
      attributes: attributes && typeof attributes === 'object' ? attributes : {},
    });

  const opp = row.toJSON ? row.toJSON() : row;
  await emitCrmEvent({
    tenantId: t,
    eventType: 'CrmOpportunityUpserted',
    subjectType: 'crm_opportunity',
    subjectId: opp.id,
    correlationId: opp.correlation_id || null,
    actorId,
    payload: {
      opportunityId: opp.id,
      pipelineId: opp.pipeline_id,
      stageId: opp.stage_id,
      status: opp.status,
      ownerUserId: opp.owner_user_id || null,
      valueCents: Number(opp.value_cents || 0),
    },
  });

  return { ok: true, opportunity: opp, created: !existing };
}

async function moveOpportunityStage({ tenantId, opportunityId, toStageId, actorId = null }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const t = safeStr(tenantId);
  const oppId = safeStr(opportunityId);
  const nextStage = safeStr(toStageId);
  if (!t) return { ok: false, error: 'tenant_required' };
  if (!oppId) return { ok: false, error: 'opportunity_required' };
  if (!nextStage) return { ok: false, error: 'stage_required' };

  const Model = CrmOpportunity();
  const row = await Model.findOne({ where: { tenant_key: t, id: oppId } });
  if (!row) return { ok: false, error: 'opportunity_not_found' };

  const before = row.toJSON ? row.toJSON() : row;
  await row.update({ stage_id: nextStage, updated_at: new Date() });
  const after = row.toJSON ? row.toJSON() : row;

  await emitCrmEvent({
    tenantId: t,
    eventType: 'CrmOpportunityStageChanged',
    subjectType: 'crm_opportunity',
    subjectId: after.id,
    correlationId: after.correlation_id || null,
    actorId,
    payload: {
      opportunityId: after.id,
      fromStageId: before.stage_id,
      toStageId: after.stage_id,
      pipelineId: after.pipeline_id,
    },
  });

  return { ok: true, opportunity: after };
}

async function logActivity({
  tenantId,
  type,
  status = 'open',
  subjectType = null,
  subjectId = null,
  accountId = null,
  contactId = null,
  leadId = null,
  opportunityId = null,
  ownerUserId = null,
  dueAt = null,
  completedAt = null,
  correlationId = null,
  payload = {},
  actorId = null,
}) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const t = safeStr(tenantId);
  const tp = safeStr(type);
  if (!t) return { ok: false, error: 'tenant_required' };
  if (!tp) return { ok: false, error: 'type_required' };

  const Model = CrmActivity();
  const row = await Model.create({
    id: newId('crmact'),
    tenant_key: t,
    tenantId: t,
    type: tp,
    status: safeStr(status) || 'open',
    subject_type: subjectType ? String(subjectType) : null,
    subject_id: subjectId ? String(subjectId) : null,
    account_id: accountId ? String(accountId) : null,
    contact_id: contactId ? String(contactId) : null,
    lead_id: leadId ? String(leadId) : null,
    opportunity_id: opportunityId ? String(opportunityId) : null,
    owner_user_id: ownerUserId ? String(ownerUserId) : null,
    due_at: dueAt ? new Date(String(dueAt)) : null,
    completed_at: completedAt ? new Date(String(completedAt)) : null,
    correlation_id: correlationId ? String(correlationId) : null,
    payload: payload && typeof payload === 'object' ? payload : {},
  });

  const activity = row.toJSON ? row.toJSON() : row;
  await emitCrmEvent({
    tenantId: t,
    eventType: 'CrmActivityLogged',
    subjectType: activity.subject_type || 'crm_activity',
    subjectId: activity.subject_id || activity.id,
    correlationId: activity.correlation_id || null,
    actorId,
    payload: {
      activityId: activity.id,
      type: activity.type,
      status: activity.status,
      opportunityId: activity.opportunity_id || null,
    },
  });

  return { ok: true, activity };
}

async function getUnifiedTimeline({ tenantId, subjectType = null, subjectId = null, correlationId = null, limit = 200, offset = 0 }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const t = safeStr(tenantId);
  if (!t) return { ok: false, error: 'tenant_required' };

  const pg = getPagination(limit, offset, 500);

  const [eventLedger, activities] = await Promise.all([
    listEvents({
      tenantId: t,
      subjectType: subjectType ? String(subjectType) : null,
      subjectId: subjectId ? String(subjectId) : null,
      correlationId: correlationId ? String(correlationId) : null,
      limit: pg.limit,
      offset: pg.offset,
    }),
    (async () => {
      const Model = CrmActivity();
      const Op = Model.sequelize.constructor.Op;
      const where = { tenant_key: t };
      if (correlationId) where.correlation_id = String(correlationId);
      if (subjectType && subjectId) {
        where[Op.or] = [
          { subject_type: String(subjectType), subject_id: String(subjectId) },
          { opportunity_id: String(subjectId), subject_type: 'crm_opportunity' },
        ];
      }
      const rows = await Model.findAll({
        where,
        order: [['created_at', 'DESC']],
        limit: pg.limit,
        offset: pg.offset,
      });
      return rows.map((r) => (r.toJSON ? r.toJSON() : r));
    })(),
  ]);

  const items = [
    ...(eventLedger && Array.isArray(eventLedger.items)
      ? eventLedger.items.map((evt) => ({
        source: 'event_ledger',
        type: evt.type,
        occurredAt: evt.occurred_at || evt.received_at || null,
        correlationId: evt.correlation_id || null,
        subjectType: evt.subject_type || null,
        subjectId: evt.subject_id || null,
        payload: evt.payload || {},
        raw: evt,
      }))
      : []),
    ...(activities || []).map((act) => ({
      source: 'crm_activity',
      type: act.type || 'Activity',
      occurredAt: act.completed_at || act.created_at || null,
      correlationId: act.correlation_id || null,
      subjectType: act.subject_type || null,
      subjectId: act.subject_id || null,
      payload: act.payload || {},
      raw: act,
    })),
  ];

  items.sort((a, b) => {
    const ta = a.occurredAt ? new Date(a.occurredAt).getTime() : 0;
    const tb = b.occurredAt ? new Date(b.occurredAt).getTime() : 0;
    return tb - ta;
  });

  return {
    ok: true,
    total: items.length,
    items: items.slice(0, pg.limit),
    limit: pg.limit,
    offset: pg.offset,
  };
}

module.exports = {
  listAccounts: (args) => listSimple({ modelGetter: CrmAccount, order: [['updated_at', 'DESC']], ...args }),
  upsertAccount,
  listContacts: (args) => listSimple({ modelGetter: CrmContact, order: [['updated_at', 'DESC']], ...args }),
  upsertContact,
  listLeads: (args) => listSimple({ modelGetter: CrmLead, order: [['updated_at', 'DESC']], ...args }),
  upsertLead,
  listPipelines: (args) => listSimple({ modelGetter: CrmPipeline, order: [['is_default', 'DESC'], ['updated_at', 'DESC']], ...args }),
  upsertPipeline,
  listOpportunities: (args) => listSimple({ modelGetter: CrmOpportunity, order: [['updated_at', 'DESC']], ...args }),
  upsertOpportunity,
  moveOpportunityStage,
  listActivities: (args) => listSimple({ modelGetter: CrmActivity, order: [['created_at', 'DESC']], ...args }),
  logActivity,
  getUnifiedTimeline,
};
