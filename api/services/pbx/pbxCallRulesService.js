const crypto = require('crypto');
const models = require('../../db/models');

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function ensurePbxTenantRow(tenantKey) {
  const PbxTenant = models.PbxTenant();
  const existing = await PbxTenant.findOne({ where: { tenantKey } });
  if (existing) return existing;
  return await PbxTenant.create({
    id: makeId('pbx_tenant'),
    tenantKey,
    name: tenantKey,
    status: 'active',
    settings: {},
  });
}

function normalizeCallRulePayload(payload) {
  const type = String(payload?.type || '').trim();
  if (!type) {
    const err = new Error('call_rule_type_required');
    err.code = 'call_rule_type_required';
    throw err;
  }
  const name = String(payload?.name || '').trim();
  if (!name) {
    const err = new Error('call_rule_name_required');
    err.code = 'call_rule_name_required';
    throw err;
  }
  const enabled = payload?.enabled === undefined ? true : Boolean(payload.enabled);
  const definition = payload?.definition && typeof payload.definition === 'object' ? payload.definition : {};
  return { type, name, enabled, definition };
}

async function listCallRules({ tenantKey, type = null }) {
  const PbxCallRule = models.PbxCallRule();
  const where = type ? { tenantKey, type: String(type) } : { tenantKey };
  const rows = await PbxCallRule.findAll({ where, order: [['type', 'ASC'], ['name', 'ASC']] });
  return rows.map(r => r.toJSON());
}

async function upsertCallRule({ tenantKey, payload, actorUserId = null }) {
  await ensurePbxTenantRow(tenantKey);
  const PbxCallRule = models.PbxCallRule();
  const data = normalizeCallRulePayload(payload);

  const existing = await PbxCallRule.findOne({ where: { tenantKey, type: data.type, name: data.name } });
  const row = existing
    ? await existing.update(data)
    : await PbxCallRule.create({ id: makeId('pbx_rule'), tenantKey, ...data });

  try {
    // eslint-disable-next-line global-require
    const { logAction } = require('../auditService');
    if (actorUserId) logAction({
      agentId: actorUserId,
      tenantId: tenantKey,
      action: 'pbx.callRules.upsert',
      resource: 'pbx_call_rule',
      resourceId: row.id,
      details: { tenantKey, type: data.type, name: data.name },
    });
  } catch {
    // ignore
  }

  return row.toJSON();
}

module.exports = {
  listCallRules,
  upsertCallRule,
};

