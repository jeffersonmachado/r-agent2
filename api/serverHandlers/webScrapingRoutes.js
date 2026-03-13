// Web Scraping Routes - Raspa de URLs unitárias e em lote
async function handleWebScrapingRoutes({
  req, res, method, pathname,
  deps: {
    requireAuth, requirePermission, sendJson, badRequest, sendApiError, buildApiError, setCorsHeaders,
    hasJsonContentType, parseJsonBody, isSuperAdmin, logAction, logger,
    scrapeUrl, scrapeUrls, requireExecutionId, createPipelineWs, emitPipelineStage,
    ensureExecutionContext, requireStages, updateStage, updateStatus, failGeneration,
    GenerationFailureReasons,
  }
}) {
  // POST /web-scraping/scrape - Raspa uma URL
  if (method === 'POST' && pathname === '/web-scraping/scrape') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'rag', 'create');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      if (!body.url) {
        badRequest(res, 'URL é obrigatória');
        return true;
      }
      const userId = req.agent?.id || req.agent?.username || 'anonymous';
      const executionId = body.executionId || `exec-${Date.now()}`;
      
      const result = await scrapeUrl(body.url, {
        contentSelector: body.contentSelector,
        removeSelectors: body.removeSelectors,
        timeout: body.timeout || 30000,
        autoIndex: body.autoIndex !== false,
        source: body.source || 'web_scraping',
        category: body.category,
        tags: body.tags || [],
        tenantId: req.tenantId,
        userId,
        executionId,
      });
      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'web_scraping',
        resource: 'web_scraping',
        resourceId: result.documentId,
        details: { url: body.url },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });
      const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
      sendJson(res, 200, { ok: true, data: result, warnings, ...result });
    } catch (err) {
      // Trata erro de rate limit
      if (err.code === 'RATE_LIMIT_EXCEEDED') {
        // Garante que retryAfter é um número válido
        const retryAfter = (err.retryAfter && !isNaN(err.retryAfter) && err.retryAfter > 0)
          ? err.retryAfter
          : 60; // Fallback padrão de 60 segundos
        
        sendJson(res, 429, {
          error: 'rate_limit_exceeded',
          message: `Rate limit excedido. Tente novamente em ${retryAfter} segundos.`,
          retryAfter: retryAfter,
        });
        return true;
      }
      logger.error('Erro ao raspar URL:', err);
      // Erros de validação devem ser 400
      const msg = (err && err.message) ? String(err.message) : 'Erro ao raspar URL';
      const isBadRequest = msg.toLowerCase().includes('url inválida') || msg.toLowerCase().includes('url invalida');
      sendApiError(res, buildApiError({
        code: 'SCRAPE_FAILED',
        message: msg || 'Falha ao raspar URL',
        httpStatus: isBadRequest ? 400 : 500,
        retryable: !isBadRequest,
        details: { tenantId: req.tenantId || null, url: body?.url || null },
        req,
      }), setCorsHeaders);
    }
    return true;
  }

  // POST /web-scraping/scrape-batch - Raspa múltiplas URLs
  if (method === 'POST' && pathname === '/web-scraping/scrape-batch') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'rag', 'create');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    let executionIdForWs = null;
    let pipelineWsForStage = null;
    try {
      const body = await parseJsonBody(req);
      if (!body.urls || !Array.isArray(body.urls) || body.urls.length === 0) {
        badRequest(res, 'URLs é obrigatório e deve ser um array não vazio');
        return true;
      }
      const requestTenantId = req.tenantId || req.agent?.tenantId || null;
      const isSuperAdminUser = isSuperAdmin(req.agent);
      if (!requestTenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'tenantId é obrigatório' });
        return true;
      }

      // Hardening: tenantId no body não define tenant efetivo (compat: aceita se igual)
      if (body && body.tenantId) {
        const bodyTenantId = String(body.tenantId).trim();
        if (bodyTenantId && bodyTenantId !== String(requestTenantId)) {
          badRequest(res, 'tenantId no body não é permitido (use X-Tenant-Id).');
          return true;
        }
      }

      const rawPersistTenantId = body?.persistTenantId || body?.targetTenantId || null;
      if (rawPersistTenantId && !isSuperAdminUser) {
        sendJson(res, 403, { error: 'forbidden', message: 'persistTenantId é permitido apenas para super-admin' });
        return true;
      }
      const persistTenantId = rawPersistTenantId ? String(rawPersistTenantId).trim() : null;
      const finalPersistTenantId = persistTenantId || requestTenantId;

      const isDryRun = body && body.dryRun === true;
      const executionId = requireExecutionId(body, res, badRequest);
      if (!executionId) return true;
      executionIdForWs = executionId;

      // WS/execução seguem o tenant do request (token/header), não o tenant de persistência.
      const pipelineWs = createPipelineWs({ tenantId: requestTenantId });
      pipelineWsForStage = pipelineWs;

      emitPipelineStage(pipelineWs, executionId, {
        stage: 'scrape-batch',
        status: 'running',
        message: `Web scraping em execução (${Array.isArray(body.urls) ? body.urls.length : 0} URL(s))...`,
        meta: { dryRun: !!isDryRun },
      });

      // Pipeline (backend-only): etapa explícita para o card "Web scraping"
      let pipelineExecution = null;
      if (executionId) {
        try {
          pipelineExecution = ensureExecutionContext({ executionId }, { tenantId: requestTenantId });
          requireStages(pipelineExecution, ['webScraping']);
          pipelineExecution.stages.webScraping = false;
          updateStatus(pipelineExecution, 'running', {
            currentStage: 'webScraping',
            stageStatus: 'in_progress',
            message: `Web scraping em execução (${Array.isArray(body.urls) ? body.urls.length : 0} URL(s))...`,
            source: '/web-scraping/scrape-batch',
          });
        } catch (_) {
          // best-effort
        }
      }

      const results = await scrapeUrls(body.urls, {
        contentSelector: body.contentSelector,
        removeSelectors: body.removeSelectors,
        timeout: body.timeout || 30000,
        concurrency: body.concurrency || 3,
        // DRY-RUN: nunca indexa (evita side effects no RAG/BD)
        autoIndex: isDryRun ? false : (body.autoIndex !== false),
        source: body.source || 'web_scraping',
        category: body.category,
        tags: body.tags || [],
        tenantId: finalPersistTenantId,
      });

      const total = body.urls.length;
      const successCount = (Array.isArray(results) ? results : []).filter(r => r && r.success).length;
      const failedCount = total - successCount;
      const duplicatesCount = (Array.isArray(results) ? results : []).filter(r => r && r.success && r.isDuplicate).length;
      const newCount = successCount - duplicatesCount;

      // Gate terminal (quando usado como pipeline de geração): scraping sem sucesso => falha
      if (successCount === 0 && executionId) {
        try {
          await failGeneration({
            execution: pipelineExecution,
            reason: GenerationFailureReasons.SCRAPING_EMPTY,
            error: new Error('Nenhuma URL foi raspada com sucesso'),
            extra: { urlsTotal: total, endpoint: '/web-scraping/scrape-batch', stage: 'webScraping' },
          });
        } catch (_) {
          // failGeneration relança por contrato; ignoramos aqui para responder HTTP.
        }
        emitPipelineStage(pipelineWs, executionId, {
          stage: 'scrape-batch',
          status: 'error',
          message: 'Nenhuma URL foi raspada com sucesso',
          meta: { code: 'SCRAPING_EMPTY', urlsTotal: total },
        });
        sendApiError(res, buildApiError({
          code: 'SCRAPING_EMPTY',
          message: 'Nenhuma URL foi raspada com sucesso',
          httpStatus: 409,
          retryable: false,
          details: { tenantId: req.tenantId || null, executionId, urlsTotal: total },
          req,
        }), setCorsHeaders);
        return true;
      }

      const errorSummary = (Array.isArray(results) ? results : [])
        .filter(r => r && !r.success)
        .map((r) => {
          const err = (r.error && typeof r.error === 'object')
            ? r.error
            : { name: 'Error', message: r.error ? String(r.error) : 'Erro desconhecido' };
          return {
            url: r.url,
            name: err.name || 'Error',
            message: err.message || 'Erro desconhecido',
          };
        });

      const payload = {
        total,
        success: successCount,
        failed: failedCount,
        new: Math.max(0, newCount),
        duplicates: Math.max(0, duplicatesCount),
        results: Array.isArray(results) ? results : [],
        errorSummary: Array.isArray(errorSummary) ? errorSummary : [],
        dryRun: isDryRun,
      };
      // DRY-RUN: não grava auditoria no BD.
      if (!isDryRun) {
        logAction({
          agentId: req.agent.id,
          username: req.agent.username,
          action: 'web_scraping_batch',
          resource: 'web_scraping',
          details: { urlsCount: body.urls.length },
          ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
        });
      }
      // Status code: 200 se 100% sucesso, 207 se houve qualquer falha (inclui 0 sucesso)
      const statusCode = successCount === total ? 200 : 207;
      const warnings = [];
      if (statusCode === 207) {
        warnings.push({
          code: 'PARTIAL_SUCCESS',
          message: 'Extração parcial: usamos fallback quando necessário e continuamos com o melhor conteúdo disponível.',
        });
      }
      if (isDryRun) {
        warnings.push({
          code: 'DRY_RUN_NO_INDEX',
          message: 'DRY-RUN: scraping executado sem indexação/persistência.',
        });
      }
      try {
        const warningItems = (Array.isArray(payload.results) ? payload.results : [])
          .flatMap((r) => (Array.isArray(r?.warnings) ? r.warnings : []));
        if (warningItems.length > 0) {
          warnings.push({
            code: 'EXTRACTION_WARNINGS',
            message: 'Algumas URLs retornaram avisos durante a extração.',
            details: { count: warningItems.length },
          });
        }
      } catch {
        // ignora
      }
      // Pipeline (backend-only): conclui etapa
      if (pipelineExecution && executionId) {
        try {
          updateStage(pipelineExecution, 'webScraping', true);
          updateStatus(pipelineExecution, pipelineExecution.status, {
            currentStage: 'webScraping',
            stageStatus: statusCode === 207 ? 'warning' : 'completed',
            message: successCount === 0
              ? 'Web scraping falhou.'
              : `Web scraping concluído: ${successCount}/${total} URL(s)`,
            source: '/web-scraping/scrape-batch',
          });
        } catch (_) {
          // best-effort
        }
      }

      emitPipelineStage(pipelineWs, executionId, {
        stage: 'scrape-batch',
        status: statusCode === 207 ? 'warning' : 'success',
        message: successCount === 0
          ? 'Web scraping falhou.'
          : `Web scraping concluído: ${successCount}/${total} URL(s)`,
        meta: { total, success: successCount, failed: failedCount, duplicates: duplicatesCount, new: newCount, dryRun: !!isDryRun },
      });

      sendJson(res, statusCode, { ok: true, data: payload, warnings, ...payload });
    } catch (err) {
      logger.error('Erro ao raspar URLs:', err);
      try {
        if (pipelineWsForStage && executionIdForWs) {
          emitPipelineStage(pipelineWsForStage, executionIdForWs, {
            stage: 'scrape-batch',
            status: 'error',
            message: err?.message || 'Falha ao raspar URLs',
            meta: { code: 'SCRAPE_FAILED' },
          });
        }
      } catch (_) {
        // best-effort
      }
      sendApiError(res, buildApiError({
        code: 'SCRAPE_FAILED',
        message: err.message || 'Falha ao raspar URLs',
        httpStatus: 500,
        retryable: true,
        details: { tenantId: req.tenantId || null },
        req,
      }), setCorsHeaders);
    }
    return true;
  }

  return false;
}

module.exports = { handleWebScrapingRoutes };
