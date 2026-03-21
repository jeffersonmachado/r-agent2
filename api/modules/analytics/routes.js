'use strict';

const express = require('express');

function createAnalyticsRoutes({ buildDeps }) {
  const router = express.Router();

  async function withReportsRead(req, res) {
    const deps = buildDeps(req, res);
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return null;
    }

    const permResult = deps.requirePermission(req, 'reports', 'read');
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return null;
    }

    return deps;
  }

  router.get('/analytics/metrics', async (req, res) => {
    const deps = await withReportsRead(req, res);
    if (!deps) return;

    try {
      const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
      const options = {
        tenantId: deps.requireTenant(req, res),
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
      };
      if (!options.tenantId) return;

      const metrics = await deps.getAllMetrics(options);
      deps.sendJson(res, 200, metrics);
    } catch (err) {
      deps.logger.error('Erro ao obter métricas:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });

  router.get('/analytics/roi', async (req, res) => {
    const deps = await withReportsRead(req, res);
    if (!deps) return;

    try {
      const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
      const windowDays = urlObj.searchParams.get('windowDays');
      const { getRoiSummary } = require('../../services/roiService');
      const out = await getRoiSummary({
        tenantId: req.tenantId,
        windowDays: windowDays != null ? Number(windowDays) : null,
      });
      if (!out.ok) {
        deps.sendJson(res, 400, { ok: false, error: out.error || 'roi_unavailable' });
        return;
      }
      deps.sendJson(res, 200, out);
    } catch (err) {
      deps.logger.error('Erro ao obter ROI:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });

  router.get('/analytics/funnel', async (req, res) => {
    const deps = await withReportsRead(req, res);
    if (!deps) return;

    try {
      const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
      const windowDays = urlObj.searchParams.get('windowDays');
      const { getFunnelMetrics } = require('../../services/roiService');
      const out = await getFunnelMetrics({
        tenantId: req.tenantId,
        windowDays: windowDays != null ? Number(windowDays) : null,
      });
      if (!out.ok) {
        deps.sendJson(res, 400, { ok: false, error: out.error || 'funnel_unavailable' });
        return;
      }
      deps.sendJson(res, 200, out);
    } catch (err) {
      deps.logger.error('Erro ao obter funil:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });

  router.get('/analytics/general', async (req, res) => {
    const deps = await withReportsRead(req, res);
    if (!deps) return;

    try {
      const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
      const options = {
        tenantId: req.tenantId,
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
      };
      const metrics = await deps.getGeneralMetrics(options);
      deps.sendJson(res, 200, metrics);
    } catch (err) {
      deps.logger.error('Erro ao obter métricas gerais:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });

  router.get('/analytics/agents', async (req, res) => {
    const deps = await withReportsRead(req, res);
    if (!deps) return;

    try {
      const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
      const options = {
        tenantId: req.tenantId,
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
      };
      const metrics = await deps.getAgentMetrics(options);
      deps.sendJson(res, 200, { agents: metrics });
    } catch (err) {
      deps.logger.error('Erro ao obter métricas de agentes:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });

  router.get('/analytics/departments', async (req, res) => {
    const deps = await withReportsRead(req, res);
    if (!deps) return;

    try {
      const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
      const options = {
        tenantId: req.tenantId,
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
      };
      const metrics = deps.getDepartmentMetrics(options);
      deps.sendJson(res, 200, { departments: metrics });
    } catch (err) {
      deps.logger.error('Erro ao obter métricas de departamentos:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });

  router.get('/analytics/queues', async (req, res) => {
    const deps = await withReportsRead(req, res);
    if (!deps) return;

    try {
      const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
      const options = {
        tenantId: req.tenantId,
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
      };
      const metrics = deps.getQueueMetrics(options);
      deps.sendJson(res, 200, { queues: metrics });
    } catch (err) {
      deps.logger.error('Erro ao obter métricas de filas:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });

  router.get('/analytics/trends', async (req, res) => {
    const deps = await withReportsRead(req, res);
    if (!deps) return;

    try {
      const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
      const options = {
        tenantId: req.tenantId,
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
        groupBy: urlObj.searchParams.get('groupBy') || 'day',
      };
      const metrics = deps.getTrendMetrics(options);
      deps.sendJson(res, 200, { trends: metrics });
    } catch (err) {
      deps.logger.error('Erro ao obter métricas de tendência:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
  });

  return router;
}

module.exports = {
  createAnalyticsRoutes,
};
