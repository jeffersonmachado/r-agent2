'use strict';

const crypto = require('crypto');
const logger = require('../../utils/logger');
const { getSequelize } = require('../../db/sequelize');
const {
  MarketingForm,
  MarketingLead,
  MarketingFormSubmission,
  MarketingScoringRule,
  MarketingEmailCampaign,
  MarketingEmailSend,
} = require('../../db/models');
const { appendEventV1 } = require('../eventLedgerService');
const outboundQueueService = require('../outboundQueueService');

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
  // Best-effort: mantém como "+<digits>" quando possível
  const out = s.startsWith('+') ? s : `+${s}`;
  if (!/^\+[1-9]\d{7,20}$/.test(out)) return null;
  return out;
}

async function listForms({ tenantId }) {
  if (!dbAvailable()) return [];
  const Model = MarketingForm();
  const rows = await Model.findAll({
    where: { tenant_key: String(tenantId) },
    order: [['updated_at', 'DESC']],
    limit: 2000,
  });
  return rows.map((r) => (r.toJSON ? r.toJSON() : r));
}

async function upsertForm({ tenantId, slug, name, fields = {}, landingHtml = null, settings = {}, status = 'active' }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const t = String(tenantId || '').trim();
  const s = safeStr(slug).toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  if (!t) return { ok: false, error: 'tenant_required' };
  if (!s) return { ok: false, error: 'slug_required' };
  const n = safeStr(name) || s;

  const Model = MarketingForm();
  const existing = await Model.findOne({ where: { tenant_key: t, slug: s } });
  const row = existing
    ? await existing.update({
      name: n,
      status: String(status || 'active'),
      fields: fields && typeof fields === 'object' ? fields : {},
      landing_html: landingHtml != null ? String(landingHtml) : null,
      settings: settings && typeof settings === 'object' ? settings : {},
    })
    : await Model.create({
      id: newId('mform'),
      tenant_key: t,
      slug: s,
      name: n,
      status: String(status || 'active'),
      fields: fields && typeof fields === 'object' ? fields : {},
      landing_html: landingHtml != null ? String(landingHtml) : null,
      settings: settings && typeof settings === 'object' ? settings : {},
    });

  return { ok: true, form: row.toJSON ? row.toJSON() : row };
}

async function getFormBySlug({ tenantId, slug }) {
  if (!dbAvailable()) return null;
  const Model = MarketingForm();
  const s = safeStr(slug).toLowerCase();
  const row = await Model.findOne({ where: { tenant_key: String(tenantId), slug: s } });
  return row ? (row.toJSON ? row.toJSON() : row) : null;
}

async function upsertLead({ tenantId, email = null, phone = null, externalId = null, name = null, attributesPatch = null, stage = null, lastSeenAt = null } = {}) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const Model = MarketingLead();
  const t = String(tenantId || '').trim();
  if (!t) return { ok: false, error: 'tenant_required' };

  const e = normalizeEmail(email);
  const p = normalizePhone(phone);
  const x = externalId ? safeStr(externalId) : null;
  const nm = name ? safeStr(name) : null;

  let row = null;
  if (e) row = await Model.findOne({ where: { tenant_key: t, email: e } });
  if (!row && p) row = await Model.findOne({ where: { tenant_key: t, phone: p } });
  if (!row && x) row = await Model.findOne({ where: { tenant_key: t, external_id: x } });

  const now = new Date();
  const attrs0 = (attributesPatch && typeof attributesPatch === 'object') ? attributesPatch : null;
  const patch = {
    ...(e ? { email: e } : {}),
    ...(p ? { phone: p } : {}),
    ...(x ? { external_id: x } : {}),
    ...(nm ? { name: nm } : {}),
    ...(stage ? { stage: String(stage) } : {}),
    ...(lastSeenAt ? { last_seen_at: lastSeenAt instanceof Date ? lastSeenAt : new Date(String(lastSeenAt)) } : { last_seen_at: now }),
  };

  if (row) {
    const json = row.toJSON ? row.toJSON() : row;
    const attrs = (json.attributes && typeof json.attributes === 'object') ? { ...json.attributes } : {};
    if (attrs0) Object.assign(attrs, attrs0);
    await row.update({ ...patch, attributes: attrs });
    return { ok: true, lead: row.toJSON ? row.toJSON() : row, created: false };
  }

  const row2 = await Model.create({
    id: newId('mlead'),
    tenant_key: t,
    email: e,
    phone: p,
    external_id: x,
    name: nm,
    stage: stage ? String(stage) : (e || p ? 'lead' : 'visitor'),
    score: 0,
    attributes: attrs0 || {},
    last_seen_at: now,
    created_at: now,
    updated_at: now,
  });
  return { ok: true, lead: row2.toJSON ? row2.toJSON() : row2, created: true };
}

async function listScoringRules({ tenantId }) {
  if (!dbAvailable()) return [];
  const Model = MarketingScoringRule();
  const rows = await Model.findAll({
    where: { tenant_key: String(tenantId) },
    order: [['updated_at', 'DESC']],
    limit: 5000,
  });
  return rows.map((r) => (r.toJSON ? r.toJSON() : r));
}

async function upsertScoringRule({ tenantId, id = null, name, enabled = true, eventType, delta = 0, conditions = null }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const Model = MarketingScoringRule();
  const t = String(tenantId || '').trim();
  if (!t) return { ok: false, error: 'tenant_required' };
  const n = safeStr(name);
  const et = safeStr(eventType);
  if (!n) return { ok: false, error: 'name_required' };
  if (!et) return { ok: false, error: 'event_type_required' };

  const existing = id ? await Model.findOne({ where: { tenant_key: t, id: String(id) } }) : null;
  const row = existing
    ? await existing.update({
      name: n,
      enabled: enabled === true,
      event_type: et,
      delta: Number(delta) || 0,
      conditions: conditions && typeof conditions === 'object' ? conditions : null,
    })
    : await Model.create({
      id: newId('mscore'),
      tenant_key: t,
      name: n,
      enabled: enabled !== false,
      event_type: et,
      delta: Number(delta) || 0,
      conditions: conditions && typeof conditions === 'object' ? conditions : null,
    });

  return { ok: true, rule: row.toJSON ? row.toJSON() : row };
}

async function applyScoring({ tenantId, leadId, eventType, payload = {} }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  if (!leadId) return { ok: true, applied: 0, delta: 0 };
  const RuleModel = MarketingScoringRule();
  const LeadModel = MarketingLead();

  const rules = await RuleModel.findAll({
    where: { tenant_key: String(tenantId), enabled: true, event_type: String(eventType) },
    order: [['created_at', 'ASC']],
    limit: 1000,
  }).catch(() => []);

  const delta = (rules || []).reduce((sum, r) => sum + (Number(r.delta) || 0), 0);
  if (!delta) return { ok: true, applied: rules.length, delta: 0 };

  const leadRow = await LeadModel.findOne({ where: { tenant_key: String(tenantId), id: String(leadId) } });
  if (!leadRow) return { ok: false, error: 'lead_not_found' };
  await leadRow.update({ score: (Number(leadRow.score) || 0) + delta, updated_at: new Date() });
  return { ok: true, applied: rules.length, delta };
}

async function recordMarketingEvent({ tenantId, eventType, correlationId = null, lead = null, payload = {} } = {}) {
  const leadId = lead && lead.id ? String(lead.id) : null;
  const subject = leadId ? { type: 'marketing_lead', id: leadId } : { type: 'marketing', id: 'anonymous' };
  const idemKey = payload && payload.idempotencyKey ? String(payload.idempotencyKey) : null;
  return appendEventV1({
    tenantId,
    type: String(eventType),
    source: 'marketing.v1',
    occurredAt: new Date(),
    correlationId: correlationId ? String(correlationId) : null,
    subject,
    actor: { type: 'system', id: 'marketing' },
    idempotencyKey: idemKey ? `marketing:${tenantId}:${idemKey}:${String(eventType)}` : null,
    payload: payload && typeof payload === 'object' ? payload : {},
  }).catch(() => null);
}

async function submitForm({ tenantId, slug, submissionId = null, data = {}, ipAddress = null, userAgent = null } = {}) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const t = String(tenantId || '').trim();
  const s = safeStr(slug).toLowerCase();
  if (!t) return { ok: false, error: 'tenant_required' };
  if (!s) return { ok: false, error: 'slug_required' };

  const form = await getFormBySlug({ tenantId: t, slug: s });
  if (!form) return { ok: false, error: 'form_not_found' };

  const payload = data && typeof data === 'object' ? data : {};
  const leadRes = await upsertLead({
    tenantId: t,
    email: payload.email || payload.Email || null,
    phone: payload.phone || payload.telefone || null,
    externalId: payload.externalId || payload.external_id || null,
    name: payload.name || payload.nome || null,
    attributesPatch: payload,
    stage: 'lead',
  });
  const lead = leadRes.ok ? leadRes.lead : null;

  const SubModel = MarketingFormSubmission();
  const externalSubmissionId = submissionId ? safeStr(submissionId) : null;
  let submission = null;
  try {
    const row = await SubModel.create({
      id: newId('msub'),
      tenant_key: t,
      form_id: form.id,
      lead_id: lead ? lead.id : null,
      external_submission_id: externalSubmissionId || null,
      data: payload,
      ip_address: ipAddress ? String(ipAddress).slice(0, 64) : null,
      user_agent: userAgent ? String(userAgent).slice(0, 4000) : null,
    });
    submission = row.toJSON ? row.toJSON() : row;
  } catch (err) {
    // Idempotência: unique (tenant, external_submission_id)
    const msg = String(err?.message || '');
    const pgCode = String(err?.original?.code || '');
    const unique = pgCode === '23505' || msg.includes('marketing_form_submissions_tenant_external_submission_uq');
    if (unique && externalSubmissionId) {
      const row = await SubModel.findOne({ where: { tenant_key: t, external_submission_id: externalSubmissionId } });
      submission = row ? (row.toJSON ? row.toJSON() : row) : null;
    } else {
      throw err;
    }
  }

  // Event ledger + scoring (best-effort)
  await recordMarketingEvent({
    tenantId: t,
    eventType: 'MarketingFormSubmitted',
    correlationId: externalSubmissionId || null,
    lead,
    payload: { formId: form.id, slug: form.slug, submissionId: externalSubmissionId || submission?.id || null },
  });
  if (lead && lead.id) {
    await applyScoring({ tenantId: t, leadId: lead.id, eventType: 'MarketingFormSubmitted', payload: { formId: form.id, slug: form.slug } }).catch(() => null);
  }

  return { ok: true, form, lead, submission };
}

async function listLeads({ tenantId, stage = null, minScore = null, limit = 200, offset = 0 } = {}) {
  if (!dbAvailable()) return { total: 0, items: [] };
  const Model = MarketingLead();
  const Op2 = Model.sequelize.constructor.Op;
  const where = { tenant_key: String(tenantId) };
  if (stage) where.stage = String(stage);
  if (minScore != null && Number.isFinite(Number(minScore))) where.score = { [Op2.gte]: Number(minScore) };

  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 2000);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const { count, rows } = await Model.findAndCountAll({
    where,
    order: [['updated_at', 'DESC']],
    limit: safeLimit,
    offset: safeOffset,
  });
  return { total: count, items: rows.map((r) => (r.toJSON ? r.toJSON() : r)), limit: safeLimit, offset: safeOffset };
}

async function getLeadStats({ tenantId }) {
  const sequelize = getSequelize();
  if (!sequelize) return { ok: false, error: 'db_unavailable' };
  const [rows] = await sequelize.query(
    `SELECT stage, COUNT(*)::int AS count, AVG(score)::float AS avg_score
     FROM marketing_leads
     WHERE tenant_key = :tenantKey
     GROUP BY stage
     ORDER BY stage ASC`,
    { replacements: { tenantKey: String(tenantId) } },
  );
  return { ok: true, items: Array.isArray(rows) ? rows : [] };
}

async function createEmailCampaign({ tenantId, name, subject, bodyText, bodyHtml = null, minScore = null }) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const Model = MarketingEmailCampaign();
  const t = String(tenantId || '').trim();
  const n = safeStr(name);
  const sub = safeStr(subject);
  const bt = bodyText != null ? String(bodyText) : '';
  if (!t) return { ok: false, error: 'tenant_required' };
  if (!n) return { ok: false, error: 'name_required' };
  if (!sub) return { ok: false, error: 'subject_required' };
  if (!bt.trim()) return { ok: false, error: 'body_text_required' };

  const row = await Model.create({
    id: newId('mec'),
    tenant_key: t,
    name: n,
    subject: sub,
    body_text: bt,
    body_html: bodyHtml != null ? String(bodyHtml) : null,
    status: 'draft',
    min_score: (minScore != null && Number.isFinite(Number(minScore))) ? Number(minScore) : null,
  });
  return { ok: true, campaign: row.toJSON ? row.toJSON() : row };
}

async function sendEmailCampaignNow({ tenantId, campaignId, limit = 2000 } = {}) {
  if (!dbAvailable()) return { ok: false, error: 'db_unavailable' };
  const CampModel = MarketingEmailCampaign();
  const SendModel = MarketingEmailSend();
  const LeadModel = MarketingLead();
  const t = String(tenantId || '').trim();
  const cid = String(campaignId || '').trim();
  if (!t) return { ok: false, error: 'tenant_required' };
  if (!cid) return { ok: false, error: 'campaign_id_required' };

  const campRow = await CampModel.findOne({ where: { tenant_key: t, id: cid } });
  if (!campRow) return { ok: false, error: 'campaign_not_found' };
  const camp = campRow.toJSON ? campRow.toJSON() : campRow;

  const Op2 = LeadModel.sequelize.constructor.Op;
  const where = {
    tenant_key: t,
    email: { [Op2.ne]: null },
  };
  if (camp.min_score != null) {
    where.score = { [Op2.gte]: Number(camp.min_score) || 0 };
  }
  const leads = await LeadModel.findAll({
    where,
    order: [['score', 'DESC'], ['updated_at', 'DESC']],
    limit: Math.min(Math.max(Number(limit) || 2000, 1), 5000),
  });

  let queued = 0;
  for (const lr of leads) {
    const lead = lr.toJSON ? lr.toJSON() : lr;
    const to = normalizeEmail(lead.email);
    if (!to) continue;
    // Cria send idempotente por (campaign, lead)
    let sendRow = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      sendRow = await SendModel.create({
        id: newId('mes'),
        tenant_key: t,
        campaign_id: cid,
        lead_id: lead.id,
        to_email: to,
        status: 'queued',
      });
    } catch (err) {
      // unique violation -> já existe
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await outboundQueueService.enqueueOutbound({
      tenantId: t,
      channelType: 'email',
      channelAccountId: null,
      conversationId: null,
      message: {
        to,
        type: 'text',
        body: {
          subject: camp.subject,
          text: camp.body_text,
          html: camp.body_html || null,
        },
        meta: {
          marketing: { campaignId: cid, leadId: lead.id, sendId: sendRow.id },
        },
      },
    }).catch(() => null);
    queued += 1;
  }

  try {
    await campRow.update({ status: 'sent', sent_at: new Date() });
  } catch (_) {}

  try {
    logger.info('[Marketing] campanha enfileirada', { tenantId: t, campaignId: cid, queued });
  } catch (_) {}

  return { ok: true, queued };
}

module.exports = {
  listForms,
  upsertForm,
  getFormBySlug,
  submitForm,
  listLeads,
  getLeadStats,
  listScoringRules,
  upsertScoringRule,
  upsertLead,
  recordMarketingEvent,
  applyScoring,
  createEmailCampaign,
  sendEmailCampaignNow,
};

