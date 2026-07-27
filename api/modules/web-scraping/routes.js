'use strict';

const express = require('express');

function createWebScrapingRoutes({ buildDeps }) {
  const router = express.Router();

  router.post('/web-scraping/scrape', async (req, res) => {
    const deps = buildDeps(req, res);
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }
    const permResult = deps.requirePermission(req, 'rag', 'create');
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    let body = null;
    try {
      body = await deps.parseJsonBody(req);
      if (!body.url) {
        deps.badRequest(res, 'URL é obrigatória');
        return;
      }
      const userId = req.agent?.id || req.agent?.username || 'anonymous';
      const executionId = body.executionId || `exec-${Date.now()}`;
      const result = await deps.scrapeUrl(body.url, {
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
      deps.logAction({
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
      deps.sendJson(res, 200, { ok: true, data: result, warnings, ...result });
    } catch (err) {
      if (err.code === 'RATE_LIMIT_EXCEEDED') {
        const retryAfter = (err.retryAfter && !isNaN(err.retryAfter) && err.retryAfter > 0) ? err.retryAfter : 60;
        deps.sendJson(res, 429, {
          error: 'rate_limit_exceeded',
          message: `Rate limit excedido. Tente novamente em ${retryAfter} segundos.`,
          retryAfter,
        });
        return;
      }
      deps.logger.error('Erro ao raspar URL:', err);
      const msg = err && err.message ? String(err.message) : 'Erro ao raspar URL';
      const isBadRequest = msg.toLowerCase().includes('url inválida') || msg.toLowerCase().includes('url invalida');
      deps.sendApiError(res, deps.buildApiError({
        code: 'SCRAPE_FAILED',
        message: msg || 'Falha ao raspar URL',
        httpStatus: isBadRequest ? 400 : 500,
        retryable: !isBadRequest,
        details: { tenantId: req.tenantId || null, url: body?.url || null },
        req,
      }), deps.setCorsHeaders);
    }
  });

  router.post('/web-scraping/scrape-batch', async (req, res) => {
    const deps = buildDeps(req, res);
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }
    const permResult = deps.requirePermission(req, 'rag', 'create');
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    let executionIdForWs = null;
    let pipelineWsForStage = null;
    try {
      const body = await deps.parseJsonBody(req);
      if (!body.urls || !Array.isArray(body.urls) || body.urls.length === 0) {
        deps.badRequest(res, 'URLs é obrigatório e deve ser um array não vazio');
        return;
      }
      const requestTenantId = req.tenantId || req.agent?.tenantId || null;
      const isSuperAdminUser = deps.isSuperAdmin(req.agent);
      if (!requestTenantId) {
        deps.sendJson(res, 403, { error: 'forbidden', message: 'tenantId é obrigatório' });
        return;
      }
      if (body && body.tenantId) {
        const bodyTenantId = String(body.tenantId).trim();
        if (bodyTenantId && bodyTenantId !== String(requestTenantId)) {
          deps.badRequest(res, 'tenantId no body não é permitido (use X-Tenant-Id).');
          return;
        }
      }

      const rawPersistTenantId = body?.persistTenantId || body?.targetTenantId || null;
      if (rawPersistTenantId && !isSuperAdminUser) {
        deps.sendJson(res, 403, { error: 'forbidden', message: 'persistTenantId é permitido apenas para super-admin' });
        return;
      }
      const persistTenantId = rawPersistTenantId ? String(rawPersistTenantId).trim() : null;
      const finalPersistTenantId = persistTenantId || requestTenantId;
      const isDryRun = body && body.dryRun === true;
      const executionId = deps.requireExecutionId(body, res, deps.badRequest);
      if (!executionId) return;
      executionIdForWs = executionId;

      const pipelineWs = deps.createPipelineWs({ tenantId: requestTenantId });
      pipelineWsForStage = pipelineWs;
      deps.emitPipelineStage(pipelineWs, executionId, {
        stage: 'scrape-batch',
        status: 'running',
        message: `Web scraping em execução (${Array.isArray(body.urls) ? body.urls.length : 0} URL(s))...`,
        meta: { dryRun: !!isDryRun },
      });

      let pipelineExecution = null;
      if (executionId) {
        try {
          pipelineExecution = deps.ensureExecutionContext({ executionId }, { tenantId: requestTenantId });
          deps.requireStages(pipelineExecution, ['webScraping']);
          pipelineExecution.stages.webScraping = false;
          deps.updateStatus(pipelineExecution, 'running', {
            currentStage: 'webScraping',
            stageStatus: 'in_progress',
            message: `Web scraping em execução (${Array.isArray(body.urls) ? body.urls.length : 0} URL(s))...`,
            source: '/web-scraping/scrape-batch',
          });
        } catch (_) {}
      }

      const results = await deps.scrapeUrls(body.urls, {
        contentSelector: body.contentSelector,
        removeSelectors: body.removeSelectors,
        timeout: body.timeout || 30000,
        concurrency: body.concurrency || 3,
        autoIndex: isDryRun ? false : (body.autoIndex !== false),
        source: body.source || 'web_scraping',
        category: body.category,
        tags: body.tags || [],
        tenantId: finalPersistTenantId,
      });

      const total = body.urls.length;
      const successCount = (Array.isArray(results) ? results : []).filter((r) => r && r.success).length;
      const failedCount = total - successCount;
      const duplicatesCount = (Array.isArray(results) ? results : []).filter((r) => r && r.success && r.isDuplicate).length;
      const newCount = successCount - duplicatesCount;

      if (successCount === 0 && executionId) {
        try {
          await deps.failGeneration({
            execution: pipelineExecution,
            reason: deps.GenerationFailureReasons.SCRAPING_EMPTY,
            error: new Error('Nenhuma URL foi raspada com sucesso'),
            extra: { urlsTotal: total, endpoint: '/web-scraping/scrape-batch', stage: 'webScraping' },
          });
        } catch (_) {}
        deps.emitPipelineStage(pipelineWs, executionId, {
          stage: 'scrape-batch',
          status: 'error',
          message: 'Nenhuma URL foi raspada com sucesso',
          meta: { code: 'SCRAPING_EMPTY', urlsTotal: total },
        });
        deps.sendApiError(res, deps.buildApiError({
          code: 'SCRAPING_EMPTY',
          message: 'Nenhuma URL foi raspada com sucesso',
          httpStatus: 409,
          retryable: false,
          details: { tenantId: req.tenantId || null, executionId, urlsTotal: total },
          req,
        }), deps.setCorsHeaders);
        return;
      }

      const errorSummary = (Array.isArray(results) ? results : [])
        .filter((r) => r && !r.success)
        .map((r) => {
          const err = (r.error && typeof r.error === 'object')
            ? r.error
            : { name: 'Error', message: r.error ? String(r.error) : 'Erro desconhecido' };
          return { url: r.url, name: err.name || 'Error', message: err.message || 'Erro desconhecido' };
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
      if (!isDryRun) {
        deps.logAction({
          agentId: req.agent.id,
          username: req.agent.username,
          action: 'web_scraping_batch',
          resource: 'web_scraping',
          details: { urlsCount: body.urls.length },
          ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
        });
      }
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
        const warningItems = (Array.isArray(payload.results) ? payload.results : []).flatMap((r) => (Array.isArray(r?.warnings) ? r.warnings : []));
        if (warningItems.length > 0) {
          warnings.push({
            code: 'EXTRACTION_WARNINGS',
            message: 'Algumas URLs retornaram avisos durante a extração.',
            details: { count: warningItems.length },
          });
        }
      } catch {}

      if (pipelineExecution && executionId) {
        try {
          deps.updateStage(pipelineExecution, 'webScraping', true);
          deps.updateStatus(pipelineExecution, pipelineExecution.status, {
            currentStage: 'webScraping',
            stageStatus: statusCode === 207 ? 'warning' : 'completed',
            message: successCount === 0 ? 'Web scraping falhou.' : `Web scraping concluído: ${successCount}/${total} URL(s)`,
            source: '/web-scraping/scrape-batch',
          });
        } catch (_) {}
      }

      deps.emitPipelineStage(pipelineWs, executionId, {
        stage: 'scrape-batch',
        status: statusCode === 207 ? 'warning' : 'success',
        message: successCount === 0 ? 'Web scraping falhou.' : `Web scraping concluído: ${successCount}/${total} URL(s)`,
        meta: { total, success: successCount, failed: failedCount, duplicates: duplicatesCount, new: newCount, dryRun: !!isDryRun },
      });

      deps.sendJson(res, statusCode, { ok: true, data: payload, warnings, ...payload });
    } catch (err) {
      deps.logger.error('Erro ao raspar URLs:', err);
      try {
        if (pipelineWsForStage && executionIdForWs) {
          deps.emitPipelineStage(pipelineWsForStage, executionIdForWs, {
            stage: 'scrape-batch',
            status: 'error',
            message: err?.message || 'Falha ao raspar URLs',
            meta: { code: 'SCRAPE_FAILED' },
          });
        }
      } catch (_) {}
      deps.sendApiError(res, deps.buildApiError({
        code: 'SCRAPE_FAILED',
        message: err.message || 'Falha ao raspar URLs',
        httpStatus: 500,
        retryable: true,
        details: { tenantId: req.tenantId || null },
        req,
      }), deps.setCorsHeaders);
    }
  });

  return router;
}

module.exports = {
  createWebScrapingRoutes,
};
