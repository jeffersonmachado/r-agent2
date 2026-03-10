'use strict';

const crypto = require('crypto');
const { getSequelize } = require('../../db/sequelize');
const {
  CrmActivity,
  CrmOpportunity,
  RevenueOpportunity,
  CrmContact,
} = require('../../db/models');
const { resolveOperationalEventModel } = require('../operational-compat');

function dbAvailable() {
  return !!getSequelize();
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function safeStr(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toJson(row) {
  return row && typeof row.toJSON === 'function' ? row.toJSON() : row;
}

function toIsoDate(value) {
  const d = value ? new Date(value) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function getOp(Model) {
  return Model && Model.sequelize && Model.sequelize.constructor
    ? Model.sequelize.constructor.Op
    : null;
}

function normalizeOperationalEvent(raw, defaults = {}) {
  const item = toJson(raw) || {};
  const payload = safeObject(item.payload);
  return {
    id: safeStr(item.id) || newId('crmevt'),
    tenant_id: safeStr(item.tenantId || item.tenant_id || item.tenant_key),
    contact_id: safeStr(payload.contact_id || payload.contactId || item.contact_id || defaults.contact_id),
    account_id: safeStr(payload.account_id || payload.accountId || item.account_id || defaults.account_id),
    type: safeStr(item.event_type || item.type || defaults.type) || 'crm_event',
    source_module: safeStr(payload.source_module || payload.sourceModule || defaults.source_module) || 'crm',
    reference_type: safeStr(payload.reference_type || payload.referenceType || defaults.reference_type || item.subject_type),
    reference_id: safeStr(payload.reference_id || payload.referenceId || defaults.reference_id || item.subject_id || item.id),
    payload,
    actor_type: safeStr(payload.actor_type || payload.actorType || defaults.actor_type),
    actor_id: safeStr(payload.actor_id || payload.actorId || defaults.actor_id),
    created_at: toIsoDate(item.occurred_at || item.completed_at || item.created_at),
  };
}

function isRecentActivity(lastEventAt, recentEventsCount) {
  const ts = lastEventAt ? new Date(lastEventAt).getTime() : 0;
  const dayMs = 24 * 60 * 60 * 1000;
  return recentEventsCount > 0 || (ts > 0 && (Date.now() - ts) <= dayMs);
}

async function createOperationalEvent({
  tenantId,
  contactId = null,
  accountId = null,
  type,
  sourceModule = 'crm',
  referenceType = null,
  referenceId = null,
  payload = {},
  actorType = null,
  actorId = null,
  correlationId = null,
  createdAt = null,
}) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const tenantKey = safeStr(tenantId);
  const eventType = safeStr(type);
  if (!tenantKey) return { ok: false, error: 'tenant_required' };
  if (!eventType) return { ok: false, error: 'type_required' };

  const Model = resolveOperationalEventModel();
  const basePayload = safeObject(payload);
  const row = await Model.create({
    id: newId('crmevt'),
    tenant_key: tenantKey,
    tenantId: tenantKey,
    source_event_id: null,
    event_type: eventType,
    correlation_id: safeStr(correlationId),
    subject_type: safeStr(referenceType) || (safeStr(contactId) ? 'crm_contact' : null),
    subject_id: safeStr(referenceId) || safeStr(contactId),
    payload: {
      ...basePayload,
      contactId: safeStr(contactId),
      accountId: safeStr(accountId),
      sourceModule: safeStr(sourceModule) || 'crm',
      referenceType: safeStr(referenceType),
      referenceId: safeStr(referenceId),
      actorType: safeStr(actorType),
      actorId: safeStr(actorId),
    },
    occurred_at: createdAt ? new Date(createdAt) : new Date(),
  });

  return {
    ok: true,
    event: normalizeOperationalEvent(row),
  };
}

async function listContactOpportunities({ tenantId, contactId, status = 'open', limit = 20 }) {
  const service = require('./CRMOpportunityBridgeService');
  return service.listContactOpportunities({ tenantId, contactId, status, limit });
}

async function getContactRelationships({ tenantId, contactId }) {
  const service = require('./CRMRelationshipService');
  return service.getContactRelationships({ tenantId, contactId });
}

async function listContactTimeline({ tenantId, contactId, limit = 40, offset = 0 }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const tenantKey = safeStr(tenantId);
  const contactKey = safeStr(contactId);
  if (!tenantKey) return { ok: false, error: 'tenant_required' };
  if (!contactKey) return { ok: false, error: 'contact_required' };

  const pageLimit = Math.max(1, Math.min(Number(limit) || 40, 200));
  const pageOffset = Math.max(0, Number(offset) || 0);

  const eventModel = resolveOperationalEventModel();
  const activityModel = CrmActivity();
  const opportunityModel = CrmOpportunity();
  const revenueModel = RevenueOpportunity();
  const Op = getOp(eventModel);

  const [eventRows, activityRows, opportunityRows, revenueRows] = await Promise.all([
    eventModel.findAll({
      where: {
        tenant_key: tenantKey,
        ...(Op
          ? {
            [Op.or]: [
              { subject_type: 'crm_contact', subject_id: contactKey },
              { subject_type: 'contact', subject_id: contactKey },
            ],
          }
          : { subject_type: 'crm_contact', subject_id: contactKey }),
      },
      order: [['occurred_at', 'DESC']],
      limit: Math.min(400, pageLimit + pageOffset + 40),
    }),
    activityModel.findAll({
      where: {
        tenant_key: tenantKey,
        ...(Op
          ? {
            [Op.or]: [
              { contact_id: contactKey },
              { subject_type: 'crm_contact', subject_id: contactKey },
            ],
          }
          : { contact_id: contactKey }),
      },
      order: [['created_at', 'DESC']],
      limit: Math.min(400, pageLimit + pageOffset + 40),
    }),
    opportunityModel.findAll({
      where: { tenant_key: tenantKey, contact_id: contactKey },
      order: [['updated_at', 'DESC']],
      limit: 60,
    }),
    revenueModel.findAll({
      where: {
        tenant_key: tenantKey,
        related_entity_type: 'crm_contact',
        related_entity_id: contactKey,
      },
      order: [['created_at', 'DESC']],
      limit: 60,
    }).catch(() => []),
  ]);

  const normalized = [
    ...(eventRows || []).map((row) => normalizeOperationalEvent(row, { contact_id: contactKey })),
    ...(activityRows || []).map((row) => {
      const item = toJson(row);
      return normalizeOperationalEvent(item, {
        contact_id: safeStr(item.contact_id) || contactKey,
        account_id: safeStr(item.account_id),
        type: safeStr(item.type) || 'crm_activity',
        source_module: 'crm_activity',
        reference_type: 'crm_activity',
        reference_id: safeStr(item.id),
      });
    }),
    ...(opportunityRows || []).map((row) => {
      const item = toJson(row);
      return normalizeOperationalEvent({
        id: `opp-${item.id}`,
        tenant_key: item.tenant_key,
        event_type: 'crm_opportunity_snapshot',
        subject_type: 'crm_opportunity',
        subject_id: item.id,
        occurred_at: item.updated_at || item.created_at,
        payload: {
          contactId: contactKey,
          accountId: item.account_id || null,
          sourceModule: 'crm_opportunity',
          referenceType: 'crm_opportunity',
          referenceId: item.id,
          opportunity: {
            id: item.id,
            title: item.title,
            stageId: item.stage_id,
            pipelineId: item.pipeline_id,
            status: item.status,
            valueCents: Number(item.value_cents || 0),
            currency: item.currency || 'BRL',
          },
        },
      }, { contact_id: contactKey });
    }),
    ...(revenueRows || []).map((row) => {
      const item = toJson(row);
      return normalizeOperationalEvent({
        id: `rev-${item.id}`,
        tenant_key: item.tenant_key,
        event_type: 'revenue_opportunity_snapshot',
        subject_type: 'revenue_opportunity',
        subject_id: item.id,
        occurred_at: item.updated_at || item.created_at,
        payload: {
          contactId: contactKey,
          sourceModule: 'revenue',
          referenceType: 'revenue_opportunity',
          referenceId: item.id,
          revenueOpportunity: {
            id: item.id,
            type: item.type,
            status: item.status,
            estimatedValue: Number(item.estimated_value || 0),
            confidence: Number(item.confidence || 0),
          },
        },
      }, { contact_id: contactKey });
    }),
  ];

  normalized.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const paged = normalized.slice(pageOffset, pageOffset + pageLimit);
  return {
    ok: true,
    contact_id: contactKey,
    total: normalized.length,
    limit: pageLimit,
    offset: pageOffset,
    items: paged,
  };
}

async function getContactProfile({ tenantId, contactId, timelineLimit = 40 }) {
  const service = require('./CRMContactProfileService');
  return service.getContactOperationalProfile({ tenantId, contactId, timelineLimit });
}

async function getContactOperationalSummary({ tenantId, contactId, recentWindowHours = 72 }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const tenantKey = safeStr(tenantId);
  const contactKey = safeStr(contactId);
  if (!tenantKey) return { ok: false, error: 'tenant_required' };
  if (!contactKey) return { ok: false, error: 'contact_required' };

  const contact = await CrmContact().findOne({ where: { tenant_key: tenantKey, id: contactKey } });
  if (!contact) return { ok: false, error: 'contact_not_found' };

  const eventModel = resolveOperationalEventModel();
  const Op = getOp(eventModel);
  const windowHours = Math.max(1, Math.min(Number(recentWindowHours) || 72, 24 * 30));
  const since = new Date(Date.now() - (windowHours * 3600 * 1000));

  const eventWhere = {
    tenant_key: tenantKey,
    ...(Op
      ? {
        [Op.or]: [
          { subject_type: 'crm_contact', subject_id: contactKey },
          { subject_type: 'contact', subject_id: contactKey },
        ],
      }
      : { subject_type: 'crm_contact', subject_id: contactKey }),
  };
  const eventWhereRecent = Op
    ? { ...eventWhere, occurred_at: { [Op.gte]: since } }
    : { ...eventWhere, occurred_at: since };

  const [recentEventsCount, opportunitiesCount, revenueOpportunitiesCount, lastEventRow] = await Promise.all([
    eventModel.count({ where: eventWhereRecent }),
    CrmOpportunity().count({
      where: {
        tenant_key: tenantKey,
        contact_id: contactKey,
        ...(Op ? { status: { [Op.ne]: 'lost' } } : { status: 'open' }),
      },
    }),
    RevenueOpportunity().count({
      where: {
        tenant_key: tenantKey,
        related_entity_type: 'crm_contact',
        related_entity_id: contactKey,
        status: 'open',
      },
    }).catch(() => 0),
    eventModel.findOne({ where: eventWhere, order: [['occurred_at', 'DESC']] }),
  ]);

  const lastEvent = lastEventRow ? normalizeOperationalEvent(lastEventRow, { contact_id: contactKey }) : null;
  return {
    ok: true,
    summary: {
      scope: 'contact',
      tenantId: tenantKey,
      contactId: contactKey,
      recentWindowHours: windowHours,
      eventsRecentCount: Number(recentEventsCount || 0),
      opportunitiesCount: Number(opportunitiesCount || 0),
      revenueOpportunitiesCount: Number(revenueOpportunitiesCount || 0),
      lastEvent,
      recentActivity: isRecentActivity(lastEvent?.created_at || null, Number(recentEventsCount || 0)),
    },
  };
}

async function getTenantOperationalSummary({ tenantId, recentWindowHours = 72 }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const tenantKey = safeStr(tenantId);
  if (!tenantKey) return { ok: false, error: 'tenant_required' };

  const eventModel = resolveOperationalEventModel();
  const opportunityModel = CrmOpportunity();
  const revenueModel = RevenueOpportunity();
  const Op = getOp(eventModel);
  const windowHours = Math.max(1, Math.min(Number(recentWindowHours) || 72, 24 * 30));
  const since = new Date(Date.now() - (windowHours * 3600 * 1000));

  const [recentEventsCount, opportunitiesCount, revenueOpportunitiesCount, lastEventRow] = await Promise.all([
    eventModel.count({
      where: Op
        ? { tenant_key: tenantKey, occurred_at: { [Op.gte]: since } }
        : { tenant_key: tenantKey, occurred_at: since },
    }),
    opportunityModel.count({
      where: Op
        ? { tenant_key: tenantKey, status: { [Op.ne]: 'lost' } }
        : { tenant_key: tenantKey, status: 'open' },
    }),
    revenueModel.count({ where: { tenant_key: tenantKey, status: 'open' } }).catch(() => 0),
    eventModel.findOne({ where: { tenant_key: tenantKey }, order: [['occurred_at', 'DESC']] }),
  ]);

  const lastEvent = lastEventRow ? normalizeOperationalEvent(lastEventRow) : null;
  return {
    ok: true,
    summary: {
      scope: 'tenant',
      tenantId: tenantKey,
      recentWindowHours: windowHours,
      eventsRecentCount: Number(recentEventsCount || 0),
      opportunitiesCount: Number(opportunitiesCount || 0),
      revenueOpportunitiesCount: Number(revenueOpportunitiesCount || 0),
      lastEvent,
      recentActivity: isRecentActivity(lastEvent?.created_at || null, Number(recentEventsCount || 0)),
    },
  };
}

module.exports = {
  createOperationalEvent,
  listContactTimeline,
  getContactProfile,
  listContactOpportunities,
  getContactRelationships,
  getContactOperationalSummary,
  getTenantOperationalSummary,
};
