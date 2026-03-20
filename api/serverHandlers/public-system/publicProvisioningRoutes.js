async function handlePublicProvisioningRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { sendJson, logger, setCorsHeaders } = deps;

  if (method !== 'GET' || !pathname.startsWith('/provision/')) {
    return false;
  }

  try {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length !== 4 && parts.length !== 5) {
      sendJson(res, 404, { error: 'not_found' });
      return true;
    }

    const provisioningToken = (process.env.PROVISIONING_PUBLIC_TOKEN || '').trim();
    const tenantKey = String(parts[1] || '').trim();

    let token = null;
    let vendor = null;
    let mac = null;
    if (parts.length === 4) {
      [vendor, mac] = [parts[2], parts[3]];
    } else {
      [token, vendor, mac] = [parts[2], parts[3], parts[4]];
    }

    if (!tenantKey) {
      sendJson(res, 400, { error: 'bad_request', code: 'tenant_required', message: 'tenantKey é obrigatório' });
      return true;
    }

    let tenantProvisioningToken = null;
    try {
      const { getProvisioningToken } = require('../../services/pbx/pbxProvisioningTokenService');
      const tokenResult = await getProvisioningToken({ tenantKey, includeToken: true });
      if (tokenResult && tokenResult.ok && tokenResult.token) {
        tenantProvisioningToken = String(tokenResult.token);
      }
    } catch (_) {}

    const tokenRequired = !!provisioningToken || !!tenantProvisioningToken;
    if (tokenRequired) {
      if (!token) {
        sendJson(res, 403, { error: 'forbidden', code: 'provisioning_token_required' });
        return true;
      }
      const ok = (provisioningToken && token === provisioningToken) || (tenantProvisioningToken && token === tenantProvisioningToken);
      if (!ok) {
        sendJson(res, 403, { error: 'forbidden', code: 'invalid_provisioning_token' });
        return true;
      }
    }

    const hostHeader = String(req.headers?.host || '').trim();
    const hostNoPort = hostHeader.includes(':') ? hostHeader.split(':')[0] : hostHeader;
    const serverHost = (process.env.PROVISIONING_SIP_HOST || '').trim() || hostNoPort || 'localhost';

    const { generateProvisioning } = require('../../services/pbx/pbxProvisioningService');
    const out = await generateProvisioning({ tenantKey, vendor, mac, serverHost });

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
    sendJson(res, httpStatus, { error: 'provisioning_error', code, message: err.message || 'Erro ao gerar provisionamento' });
  }
  return true;
}

module.exports = { handlePublicProvisioningRoutes };
