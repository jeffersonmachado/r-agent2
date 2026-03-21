'use strict';

const express = require('express');

function createFrontendFallbackRoutes({ buildDeps }) {
  const router = express.Router();

  router.use(async (req, res, next) => {
    const pathname = new URL(req.originalUrl || req.url || '/', 'http://localhost').pathname;
    const deps = buildDeps(req, res);

    const isFrontendRoute = !pathname.startsWith('/api') &&
      !pathname.startsWith('/auth') &&
      !pathname.startsWith('/health') &&
      !pathname.startsWith('/version') &&
      !pathname.startsWith('/system') &&
      !pathname.startsWith('/metrics') &&
      !pathname.startsWith('/tickets') &&
      !pathname.startsWith('/queues') &&
      !pathname.startsWith('/flows') &&
      !pathname.startsWith('/replay') &&
      !pathname.startsWith('/templates') &&
      !pathname.startsWith('/server') &&
      !pathname.startsWith('/tests') &&
      !pathname.startsWith('/rpa') &&
      !pathname.startsWith('/web-scraping') &&
      !pathname.startsWith('/audit') &&
      !pathname.startsWith('/onboarding') &&
      !pathname.startsWith('/tenants') &&
      !pathname.startsWith('/super-admin') &&
      !pathname.startsWith('/conversations') &&
      !pathname.startsWith('/rag') &&
      !(pathname === '/config' && req.headers.accept && req.headers.accept.includes('application/json')) &&
      !(pathname.startsWith('/config/') && pathname !== '/config') &&
      !pathname.startsWith('/dev') &&
      !pathname.includes('.');

    if (!isFrontendRoute) {
      next();
      return;
    }

    if (req.method !== 'GET' && !(req.method === 'POST' && !req.headers['content-type']?.includes('application/json'))) {
      next();
      return;
    }

    try {
      const acceptHeader = req.headers.accept || '';
      const isDev = process.env.NODE_ENV !== 'production';
      const isHtmlNavigation = acceptHeader.includes('text/html');

      if (isDev && req.method === 'GET' && isHtmlNavigation) {
        const frontendPort = Number(process.env.FRONTEND_PORT || 5173);
        const location = `http://localhost:${frontendPort}${req.url || pathname || '/'}`;
        res.writeHead(302, { Location: location });
        res.end();
        return;
      }

      const frontendIndexPath = deps.path.join(__dirname, '..', '..', 'frontend', 'index.html');
      if (deps.fs.existsSync(frontendIndexPath)) {
        deps.logger.debug('[Server] Servindo index.html do frontend para rota:', pathname);
        const html = deps.fs.readFileSync(frontendIndexPath, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
        });
        res.end(html);
        return;
      }

      deps.logger.warn('[Server] index.html do frontend não encontrado em:', frontendIndexPath);
    } catch (err) {
      deps.logger.error('[Server] Erro ao servir index.html do frontend:', err);
    }

    next();
  });

  return router;
}

module.exports = {
  createFrontendFallbackRoutes,
};
