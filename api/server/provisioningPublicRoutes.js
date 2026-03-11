'use strict';

const logger = require('../utils/logger');

function buildServerHost(req) {
  const hostHeader = String(req.headers?.host || '').trim();
  const hostNoPort = hostHeader.includes(':') ? hostHeader.split(':')[0] : hostHeader;
  return (process.env.PROVISIONING_SIP_HOST || '').trim() || hostNoPort || 'localhost';
}

function resolveProvisioningRouteParts(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  if (parts.length !== 4 && parts.length !== 5) return null;

  const tenantKey = String(parts[1] || '').trim();
  let token = null;
  let vendor = null;
  let mac = null;

  if (parts.length === 4) {
    [vendor, mac] = [parts[2], parts[3]];
  } else {
    [token, vendor, mac] = [parts[2], parts[3], parts[4]];
  }

  return {
    tenantKey,
    token,
    vendor,
    mac,
  };
}

async function handleProvisioningPublicRoutes({ req, res, method, pathname, sendJson, setCorsHeaders, logAction }) {
  if (!(method === 'GET' && pathname.startsWith('/provision/'))) {
    return false;
  }

  try {
    const parsed = resolveProvisioningRouteParts(pathname);
    if (!parsed) {
      sendJson(res, 404, { error: 'not_found' });
      return true;
    }

    const { tenantKey, token, vendor, mac } = parsed;
    if (!tenantKey) {
      sendJson(res, 400, { error: 'bad_request', code: 'tenant_required', message: 'tenantKey é obrigatório' });
      return true;
    }

    const provisioningToken = (process.env.PROVISIONING_PUBLIC_TOKEN || '').trim();
    let tenantProvisioningToken = null;
    try {
      const { getProvisioningToken } = require('../services/pbx/pbxProvisioningTokenService');
      const current = await getProvisioningToken({ tenantKey, includeToken: true });
      if (current && current.ok && current.token) tenantProvisioningToken = String(current.token);
    } catch (_) {}

    const tokenRequired = !!provisioningToken || !!tenantProvisioningToken;
    if (tokenRequired) {
      if (!token) {
        sendJson(res, 403, { error: 'forbidden', code: 'provisioning_token_required' });
        return true;
      }
      const allowed = (provisioningToken && token === provisioningToken)
        || (tenantProvisioningToken && token === tenantProvisioningToken);
      if (!allowed) {
        sendJson(res, 403, { error: 'forbidden', code: 'invalid_provisioning_token' });
        return true;
      }
    }

    const serverHost = buildServerHost(req);
    const { generateProvisioning } = require('../services/pbx/pbxProvisioningService');
    const out = await generateProvisioning({ tenantKey, vendor, mac, serverHost });

    try {
      logAction({
        agentId: 'public',
        username: 'public',
        tenantId: tenantKey,
        action: 'pbx.provisioning.fetch',
        resource: 'pbx_provisioning',
        resourceId: `${String(vendor || '')}:${String(mac || '')}`,
        details: { vendor: String(vendor || ''), mac: String(mac || ''), serverHost },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });
    } catch (_) {}

    setCorsHeaders(res);
    res.writeHead(200, {
      'Content-Type': out.contentType || 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(out.body || '');
  } catch (err) {
    const code = err.code || 'provisioning_error';
    const httpStatus = ['invalid_mac', 'invalid_provisioning_vendor', 'invalid_provisioning_template'].includes(code)
      ? 400
      : code === 'extension_not_found_for_mac'
        ? 404
        : 500;
    logger.error('[Provisioning] Erro em GET /provision', err);
    sendJson(res, httpStatus, {
      error: 'provisioning_error',
      code,
      message: err.message || 'Erro ao gerar provisionamento',
    });
  }

  return true;
}

module.exports = {
  handleProvisioningPublicRoutes,
  _internal: {
    buildServerHost,
    resolveProvisioningRouteParts,
  },
};
