async function resolveStorefrontToken(req, deps) {
  const { sendJson } = deps;

  const urlObj = new URL(req.url || '/', 'http://localhost');
  const token = urlObj.searchParams.get('token');
  if (!token) {
    sendJson(deps.res, 401, { error: 'unauthorized', message: 'Token obrigatório' });
    return null;
  }

  const { resolvePublicToken } = require('../../services/publicAccessTokenService');
  const resolved = await resolvePublicToken({ token, allowedKinds: ['storefront'] });
  if (!resolved.ok) {
    sendJson(deps.res, 401, { error: 'unauthorized', message: 'Token inválido' });
    return null;
  }

  return resolved;
}

async function checkStorefrontRateLimit(resolved, req, res, deps) {
  const { sendJson, checkRateLimit } = deps;

  const rl = await checkRateLimit({
    userId: `publicToken:${resolved.tokenId}`,
    operationType: 'PUBLIC_TOKEN_STOREFRONT',
  });
  if (!rl.allowed) {
    res.setHeader('Retry-After', rl.retryAfter || 60);
    sendJson(res, 429, {
      error: 'rate_limit_exceeded',
      message: `Limite de requisições excedido. Tente novamente em ${rl.retryAfter || 60} segundos.`,
      retryAfter: rl.retryAfter || 60,
    });
    return false;
  }

  return true;
}

async function handleStorefrontRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    checkRateLimit,
  } = deps;

  if (method === 'POST' && pathname === '/storefront/orders') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const resolved = await resolveStorefrontToken(req, {
        sendJson,
        res,
      });
      if (!resolved) return true;

      const allowed = await checkStorefrontRateLimit(resolved, req, res, {
        sendJson,
        checkRateLimit,
      });
      if (!allowed) return true;

      const body = await parseJsonBody(req);
      const customerName = body && body.customerName ? String(body.customerName).trim() : null;
      const customerPhone = body && body.customerPhone ? String(body.customerPhone).trim() : null;
      const notes = body && body.notes ? String(body.notes).trim() : null;
      const items = body && Array.isArray(body.items) ? body.items : [];
      const idempotencyKey = body && body.idempotencyKey ? String(body.idempotencyKey).trim() : null;
      const deliveryType = body && body.deliveryType ? String(body.deliveryType).trim() : 'delivery';
      const deliveryAddress = body && typeof body.deliveryAddress === 'object' && body.deliveryAddress ? body.deliveryAddress : {};
      const rawAttribution = body && typeof body.attribution === 'object' && body.attribution ? body.attribution : null;

      const { createOrder } = require('../../services/orderService');
      const vertical = body && body.vertical ? String(body.vertical).trim() : null;
      const order = await createOrder({
        tenantId: resolved.tenantId,
        source: 'storefront',
        locationId: resolved.locationId,
        customerName,
        customerPhone,
        items,
        notes,
        deliveryType,
        deliveryAddress,
        // só repassa vertical quando o canal a informa — ausente, o serviço aplica seu default
        ...(vertical ? { vertical } : {}),
        context: { publicTokenId: resolved.tokenId, idempotencyKey: idempotencyKey || null, ...(rawAttribution ? { marketingAttribution: rawAttribution } : {}) },
      });

      let delivery = null;
      if (deliveryType === 'delivery') {
        try {
          const { createDeliveryForOrder } = require('../../services/deliveryService');
          delivery = await createDeliveryForOrder({
            tenantId: resolved.tenantId,
            orderId: order.id,
            deliveryAddress,
            context: {
              publicTokenId: resolved.tokenId,
              correlationId: order?.context?.correlationId || null,
              idempotencyKey: idempotencyKey ? `${idempotencyKey}:delivery` : null,
            },
          });
        } catch (_) {
          // best-effort: nao bloqueia criacao do pedido
        }
      }

      sendJson(res, 201, { ok: true, order, delivery });
    } catch (err) {
      logger.error('[Storefront] Erro ao criar pedido:', err);
      const code = err && err.code ? String(err.code) : null;
      if (code === 'order_items_required') {
        sendJson(res, 400, { error: 'bad_request', message: 'Itens do pedido são obrigatórios' });
        return true;
      }
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao criar pedido' });
    }

    return true;
  }

  if (method === 'GET' && pathname.startsWith('/storefront/orders/')) {
    try {
      const resolved = await resolveStorefrontToken(req, {
        sendJson,
        res,
      });
      if (!resolved) return true;

      const allowed = await checkStorefrontRateLimit(resolved, req, res, {
        sendJson,
        checkRateLimit,
      });
      if (!allowed) return true;

      const orderId = decodeURIComponent(pathname.slice('/storefront/orders/'.length));
      const { getOrderById } = require('../../services/orderService');
      const order = await getOrderById({ tenantId: resolved.tenantId, orderId });
      if (!order) {
        sendJson(res, 404, { error: 'order_not_found', message: 'Pedido não encontrado' });
        return true;
      }

      const { getDeliveryByOrderId } = require('../../services/deliveryService');
      const delivery = await getDeliveryByOrderId({ tenantId: resolved.tenantId, orderId });
      sendJson(res, 200, { ok: true, order, delivery });
    } catch (err) {
      logger.error('[Storefront] Erro ao obter status do pedido:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter status do pedido' });
    }

    return true;
  }

  return false;
}

module.exports = {
  handleStorefrontRoutes,
};
