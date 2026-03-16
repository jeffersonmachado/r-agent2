async function handleFrontendFallbackRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    fs,
    path,
    logger,
  } = deps;

  // Para requisições GET que não são de API, serve o frontend (SPA routing)
  // Isso permite que rotas como /login, /support, etc. funcionem corretamente
  // IMPORTANTE: Também serve para POST/PUT/DELETE de rotas do frontend que não são de API
  // para evitar que formulários HTML padrão causem 404
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
      // /config pode ser rota do frontend ou API
      // Se for GET /config com Accept: application/json, já foi tratado pela rota de API acima
      // Se for GET /config com Accept: text/html (navegação), serve o frontend
      !(pathname === '/config' && req.headers.accept && req.headers.accept.includes('application/json')) &&
      !(pathname.startsWith('/config/') && pathname !== '/config') && // Exclui subcaminhos de /config (como /config/validate-*)
      !pathname.startsWith('/dev') &&
      !pathname.includes('.'); // Não serve HTML para arquivos estáticos (que têm extensão)

  if (!isFrontendRoute) {
    return false;
  }

  // Para GET, sempre serve o index.html (SPA routing)
  // Para POST sem JSON, também serve o index.html para evitar 404
  if (method === 'GET' || (method === 'POST' && !req.headers['content-type']?.includes('application/json'))) {
    try {
      // DEV: não servir index.html cru do filesystem para navegação HTML,
      // redirecionar para o Vite com preamble do React Refresh.
      const acceptHeader = req.headers.accept || '';
      const isDev = process.env.NODE_ENV !== 'production';
      const isHtmlNavigation = acceptHeader.includes('text/html');

      if (isDev && method === 'GET' && isHtmlNavigation) {
        const frontendPort = Number(process.env.FRONTEND_PORT || 5173);
        const location = `http://localhost:${frontendPort}${req.url || pathname || '/'}`;
        res.writeHead(302, { Location: location });
        res.end();
        return true;
      }

      const frontendIndexPath = path.join(__dirname, '..', '..', 'frontend', 'index.html');

      // Verifica se o arquivo existe
      if (fs.existsSync(frontendIndexPath)) {
        logger.debug('[Server] Servindo index.html do frontend para rota:', pathname);
        const html = fs.readFileSync(frontendIndexPath, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
        });
        res.end(html);
        return true;
      }

      logger.warn('[Server] index.html do frontend não encontrado em:', frontendIndexPath);
    } catch (err) {
      logger.error('[Server] Erro ao servir index.html do frontend:', err);
    }
  }

  return false;
}

module.exports = { handleFrontendFallbackRoutes };
