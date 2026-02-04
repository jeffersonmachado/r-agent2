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

function normalizeRoutePayload(payload) {
  const direction = String(payload?.direction || '').trim();
  if (!direction || !['inbound', 'outbound'].includes(direction)) {
    const err = new Error('route_direction_invalid');
    err.code = 'route_direction_invalid';
    throw err;
  }
  const name = String(payload?.name || '').trim();
  if (!name) {
    const err = new Error('route_name_required');
    err.code = 'route_name_required';
    throw err;
  }

  const enabled = payload?.enabled === undefined ? true : Boolean(payload.enabled);
  const priority = payload?.priority === undefined ? 100 : Number(payload.priority);
  const match = payload?.match && typeof payload.match === 'object' ? payload.match : {};
  const actions = Array.isArray(payload?.actions) ? payload.actions : [];

  return { direction, name, enabled, priority, match, actions };
}

async function listRoutes({ tenantKey, direction = null }) {
  const PbxRoute = models.PbxRoute();
  const where = direction ? { tenantKey, direction } : { tenantKey };
  const items = await PbxRoute.findAll({ where, order: [['priority', 'ASC'], ['name', 'ASC']] });
  return items.map(r => r.toJSON());
}

async function upsertRoute({ tenantKey, payload, actorUserId = null }) {
  await ensurePbxTenantRow(tenantKey);
  const PbxRoute = models.PbxRoute();
  const data = normalizeRoutePayload(payload);

  const existing = await PbxRoute.findOne({ where: { tenantKey, direction: data.direction, name: data.name } });
  const row = existing
    ? await existing.update(data)
    : await PbxRoute.create({ id: makeId('pbx_route'), tenantKey, ...data });

  // Best-effort audit event (optional)
  try {
    // eslint-disable-next-line global-require
    const { logAction } = require('../auditService');
    if (actorUserId) logAction({
      agentId: actorUserId,
      tenantId: tenantKey,
      action: 'pbx.routes.upsert',
      resource: 'pbx_route',
      resourceId: row.id,
      details: { tenantKey, direction: data.direction, name: data.name },
    });
  } catch {
    // ignore
  }

  return row.toJSON();
}

module.exports = {
  listRoutes,
  upsertRoute,
};

