'use strict';

const accessControlService = require('./accessControlService');

function ensureAuthAndPermission(req, res, deps, action = 'read') {
  const { requireAuth, requirePermission, sendJson, requireTenant } = deps;
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }
  const tenantId = requireTenant(req, res);
  if (!tenantId) {
    return false;
  }
  const permResult = requirePermission(req, 'config', action);
  if (!permResult.allowed) {
    sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return false;
  }
  return true;
}

module.exports = { handleAccessControlCatalogRoutes };

async function handleAccessControlCatalogRoutes({ req, res, method, pathname, deps }) {
  const {
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    requireAuth,
    requirePermission,
    requireTenant,
    logAction,
  } = deps;

  const tenantId = () => req.tenantId || req.agent?.tenantId || null;
  const authDeps = { requireAuth, requirePermission, sendJson, requireTenant };

  if (method === 'GET' && pathname === '/api/access-control/devices') {
    if (!ensureAuthAndPermission(req, res, authDeps, 'read')) return true;
    sendJson(res, 200, { items: await accessControlService.listDevices({ tenantId: tenantId() }) });
    return true;
  }

  if (method === 'POST' && pathname === '/api/access-control/devices') {
    if (!ensureAuthAndPermission(req, res, authDeps, 'update')) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    const body = await parseJsonBody(req);
    const item = await accessControlService.createDevice({ tenantId: tenantId(), payload: body });
    logAction({ agentId: req.agent.id, username: req.agent.username, tenantId: tenantId(), action: 'access_control_device_create', resource: 'access_device', resourceId: item.id });
    sendJson(res, 201, { item });
    return true;
  }

  if (method === 'PATCH' && pathname.startsWith('/api/access-control/devices/')) {
    if (!ensureAuthAndPermission(req, res, authDeps, 'update')) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    const id = decodeURIComponent(pathname.slice('/api/access-control/devices/'.length));
    const body = await parseJsonBody(req);
    const item = await accessControlService.patchDevice({ tenantId: tenantId(), id, payload: body });
    if (!item) {
      sendJson(res, 404, { error: 'access_device_not_found' });
      return true;
    }
    sendJson(res, 200, { item });
    return true;
  }

  if (method === 'GET' && pathname === '/api/access-control/credentials') {
    if (!ensureAuthAndPermission(req, res, authDeps, 'read')) return true;
    sendJson(res, 200, { items: await accessControlService.listCredentials({ tenantId: tenantId() }) });
    return true;
  }

  if (method === 'POST' && pathname === '/api/access-control/credentials') {
    if (!ensureAuthAndPermission(req, res, authDeps, 'update')) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    const body = await parseJsonBody(req);
    const item = await accessControlService.createCredential({ tenantId: tenantId(), payload: body });
    sendJson(res, 201, { item });
    return true;
  }

  if (method === 'PATCH' && pathname.startsWith('/api/access-control/credentials/')) {
    if (!ensureAuthAndPermission(req, res, authDeps, 'update')) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    const id = decodeURIComponent(pathname.slice('/api/access-control/credentials/'.length));
    const body = await parseJsonBody(req);
    const item = await accessControlService.patchCredential({ tenantId: tenantId(), id, payload: body });
    if (!item) {
      sendJson(res, 404, { error: 'access_credential_not_found' });
      return true;
    }
    sendJson(res, 200, { item });
    return true;
  }

  if (method === 'GET' && pathname === '/api/access-control/policies') {
    if (!ensureAuthAndPermission(req, res, authDeps, 'read')) return true;
    sendJson(res, 200, { items: await accessControlService.listPolicies({ tenantId: tenantId() }) });
    return true;
  }

  if (method === 'POST' && pathname === '/api/access-control/policies') {
    if (!ensureAuthAndPermission(req, res, authDeps, 'update')) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    const body = await parseJsonBody(req);
    const item = await accessControlService.createPolicy({ tenantId: tenantId(), payload: body });
    sendJson(res, 201, { item });
    return true;
  }

  if (method === 'PATCH' && pathname.startsWith('/api/access-control/policies/')) {
    if (!ensureAuthAndPermission(req, res, authDeps, 'update')) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    const id = decodeURIComponent(pathname.slice('/api/access-control/policies/'.length));
    const body = await parseJsonBody(req);
    const item = await accessControlService.patchPolicy({ tenantId: tenantId(), id, payload: body });
    if (!item) {
      sendJson(res, 404, { error: 'access_policy_not_found' });
      return true;
    }
    sendJson(res, 200, { item });
    return true;
  }

  return false;
}
