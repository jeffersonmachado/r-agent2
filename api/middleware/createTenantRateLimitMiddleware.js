'use strict';

function shouldRunTenantRateLimit(pathname, method) {
  const normalizedPathname = pathname.startsWith('/api/')
    ? pathname.slice('/api'.length)
    : pathname;
  const isAuthPath = (value) => value === '/auth' || value.startsWith('/auth/');

  const publicRoutes = [
    '/health',
    '/health/db',
    '/version',
    '/system/status',
    '/system/websocket',
    '/public',
    '/storefront/orders',
    '/physical/kiosk/tickets',
    '/physical/panel/state',
    '/public-tokens/resolve',
    '/physical/station',
  ];
  const providerWebhookRoutes = ['/webhooks/whatsapp', '/webhooks/messenger', '/webhooks/instagram', '/billing/webhook'];
  const isPublicRoute = publicRoutes.some(route => (
    pathname === route ||
    pathname.startsWith(`${route}/`) ||
    normalizedPathname === route ||
    normalizedPathname.startsWith(`${route}/`)
  ));
  const isAuthRoute = isAuthPath(pathname) || isAuthPath(normalizedPathname);
  const isProviderWebhookRoute = providerWebhookRoutes.some(route => (
    pathname === route ||
    pathname.startsWith(`${route}/`) ||
    normalizedPathname === route ||
    normalizedPathname.startsWith(`${route}/`)
  ));
  const isSuperAdminRoute = pathname.startsWith('/super-admin');

  return (
    !isPublicRoute &&
    !isAuthRoute &&
    !isProviderWebhookRoute &&
    !isSuperAdminRoute &&
    method !== 'OPTIONS'
  );
}

function createTenantRateLimitMiddleware({ config, logger, tenantRateLimitMiddleware, sendJson }) {
  return async function expressTenantRateLimitMiddleware(req, res, next) {
    const pathname = req.path || new URL(req.originalUrl || req.url || '/', 'http://localhost').pathname;
    const method = (req.method || 'GET').toUpperCase();

    if (!shouldRunTenantRateLimit(pathname, method)) {
      next();
      return;
    }

    const nodeEnv = config.get('nodeEnv', process.env.NODE_ENV || 'development');
    const isDevelopment = nodeEnv === 'development';

    if (isDevelopment) {
      logger.debug('[Server] Rate limit desativado em desenvolvimento', { pathname, method });
      next();
      return;
    }

    try {
      const allowed = await tenantRateLimitMiddleware(req, res, sendJson);
      if (!allowed || res.writableEnded) {
        return;
      }
      next();
    } catch (err) {
      logger.error('[Server] Erro no rate limiting por tenant', {
        pathname,
        method,
        error: err.message,
      });
      next();
    }
  };
}

module.exports = {
  createTenantRateLimitMiddleware,
};
