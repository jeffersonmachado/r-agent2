'use strict';

const logger = require('../utils/logger');
const { Op } = require('sequelize');
const { Tenant } = require('../db/models');
const operationalMetricsService = require('../services/operationalMetricsService');

async function run({ tenantId = null } = {}) {
  const tenants = tenantId
    ? [{ tenant_key: String(tenantId) }]
    : (await Tenant().findAll({ where: { status: { [Op.in]: ['trial', 'active'] } }, limit: 200 })).map((row) => row.toJSON ? row.toJSON() : row);

  const items = [];
  for (const tenant of tenants) {
    try {
      const out = await operationalMetricsService.storeTenantSnapshot({ tenantId: tenant.tenant_key });
      items.push({ tenantId: tenant.tenant_key, ok: true, snapshotAt: out.item?.created_at || out.item?.createdAt || null });
    } catch (err) {
      logger.warn('[CollectOperationalMetricsJob] falha ao coletar snapshot', {
        tenantId: tenant.tenant_key,
        error: err?.message || String(err || 'unknown_error'),
      });
      items.push({ tenantId: tenant.tenant_key, ok: false, error: err?.message || 'unknown_error' });
    }
  }

  return { ok: true, items };
}

module.exports = {
  run,
};
