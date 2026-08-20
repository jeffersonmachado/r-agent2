'use strict';

const express = require('express');

// Cache em memória do index.html (lazy). Releitura só ocorre quando o mtime
// muda; o stat assíncrono é feito no máximo 1x por TTL por path.
const INDEX_HTML_STAT_TTL_MS = 5000;
/** @type {Map<string, { html: string, mtimeMs: number, checkedAt: number }>} */
const indexHtmlCache = new Map();

async function loadIndexHtml(deps, frontendIndexPath) {
  const now = Date.now();
  const cached = indexHtmlCache.get(frontendIndexPath);
  if (cached && (now - cached.checkedAt) < INDEX_HTML_STAT_TTL_MS) {
    return cached.html;
  }

  let stat = null;
  try {
    stat = await deps.fs.promises.stat(frontendIndexPath);
  } catch (_) {
    stat = null;
  }
  if (!stat || !stat.isFile()) {
    indexHtmlCache.delete(frontendIndexPath);
    return null;
  }

  if (!cached || cached.mtimeMs !== stat.mtimeMs) {
    const html = await deps.fs.promises.readFile(frontendIndexPath, 'utf8');
    indexHtmlCache.set(frontendIndexPath, { html, mtimeMs: stat.mtimeMs, checkedAt: now });
    return html;
  }

  cached.checkedAt = now;
  return cached.html;
}

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
        // Bundle probe requests (__bundle_probe__) são fetch internos do
        // BundleVersionGuard — não devem ser redirecionados (criaria loop
        // infinito: API → Vite preview → API → ...). Retorna 204 para que
        // o guard entenda que não há bundle novo e siga sem recarregar.
        if ((req.url || '').includes('__bundle_probe__')) {
          res.writeHead(204);
          res.end();
          return;
        }
        const frontendPort = Number(process.env.FRONTEND_PORT || 5173);
        const location = `http://localhost:${frontendPort}${req.url || pathname || '/'}`;
        res.writeHead(302, { Location: location });
        res.end();
        return;
      }

      const frontendIndexPath = deps.path.join(__dirname, '..', '..', 'frontend', 'index.html');
      const html = await loadIndexHtml(deps, frontendIndexPath);
      if (html !== null) {
        deps.logger.debug('[Server] Servindo index.html do frontend para rota:', pathname);
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
  // Funções internas para testes
  _internal: {
    clearIndexHtmlCache: () => indexHtmlCache.clear(),
  },
};
