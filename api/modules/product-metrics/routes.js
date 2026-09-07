'use strict';

const express = require('express');

/**
 * Product Metrics Routes (P4.13).
 *
 * GET /api/product-metrics/summary?windowDays=30
 *   Métricas de produto do tenant: TTFV (tempo até o primeiro valor),
 *   TTFR (tempo até a primeira resposta), cliques por tarefa/superfície
 *   central e profundidade de navegação.
 *
 * Classificação PRODUCTION-safe: somente tempos e contagens de negócio —
 * nenhuma métrica técnica de QA/engenharia. Permissão: reports:read.
 */
function createProductMetricsRoutes({ buildDeps }) {
  const router = express.Router();

  router.get('/api/product-metrics/summary', async (req, res) => {
    const deps = buildDeps(req, res);
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }
    const permResult = deps.requirePermission(req, 'reports', 'read');
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }
    const tenantId = deps.requireTenant(req, res);
    if (!tenantId) return;

    try {
      const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
      const windowDays = urlObj.searchParams.get('windowDays');
      const summary = await deps.productMetricsService.getProductMetricsSummary({
        tenantId,
        windowDays: windowDays != null ? Number(windowDays) : 30,
      });
      deps.sendJson(res, 200, summary);
    } catch (err) {
      deps.logger.error('[ProductMetrics] Erro ao obter métricas de produto:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });

  return router;
}

module.exports = { createProductMetricsRoutes };
