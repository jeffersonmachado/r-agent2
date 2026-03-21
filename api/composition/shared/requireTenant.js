'use strict';

const { sendJson } = require('../../express/httpHelpers');
const { isSuperAdmin } = require('../../services/superAdminService');

function requireTenant(req, res) {
  const superAdmin = req?.agent ? isSuperAdmin(req.agent) : false;
  const tenantIdRaw = superAdmin
    ? (req?.tenantId || null)
    : (req?.tenantId || req?.agent?.tenantId || null);
  const tenantId = typeof tenantIdRaw === 'string' ? tenantIdRaw.trim() : null;
  if (!tenantId) {
    sendJson(res, 403, { error: 'tenant_required' });
    return null;
  }
  return tenantId;
}

module.exports = {
  requireTenant,
};
