'use strict';

const express = require('express');

function requireAuthenticated(req, res, deps) {
  const authResult = deps.requireAuth(req);
  if (!authResult.valid) {
    deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }
  return true;
}

function createSupportDebugRoutes({ buildDeps }) {
  const router = express.Router();

  router.get('/api/schedules', (req, res) => {
    const deps = buildDeps(req, res);
    if (!requireAuthenticated(req, res, deps)) return;

    const urlObj = new URL(req.url, 'http://localhost');
    const contextType = urlObj.searchParams.get('contextType') || undefined;
    const contextId = urlObj.searchParams.get('contextId') || undefined;
    const limit = Math.min(parseInt(urlObj.searchParams.get('limit') || '50', 10), 200);
    const result = deps.scheduleService.listSchedules({
      tenantId: req.tenantId || 'default',
      contextType,
      contextId,
      limit,
    });
    deps.sendJson(res, 200, result);
  });

  router.post('/api/schedules', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!requireAuthenticated(req, res, deps)) return;

    const body = await deps.parseJsonBody(req);
    const schedule = deps.scheduleService.createSchedule({
      tenantId: req.tenantId || 'default',
      payload: body,
    });
    deps.sendJson(res, 201, { schedule });
  });

  router.get('/api/schedules/availability', (req, res) => {
    const deps = buildDeps(req, res);
    if (!requireAuthenticated(req, res, deps)) return;
    deps.sendJson(res, 200, { available: true, slots: [] });
  });

  router.post('/api/schedules/:scheduleId/:action', async (req, res, next) => {
    const deps = buildDeps(req, res);
    if (!requireAuthenticated(req, res, deps)) return;

    const { scheduleId, action } = req.params;
    if (!scheduleId || !action) {
      next();
      return;
    }

    let payload = {};
    if (action === 'reschedule') {
      payload = await deps.parseJsonBody(req);
    }

    try {
      const schedule = deps.scheduleService.updateScheduleStatus({
        tenantId: req.tenantId || 'default',
        scheduleId,
        action,
        payload,
      });
      deps.sendJson(res, 200, { schedule });
    } catch (err) {
      if (err?.code === 'schedule_not_found') {
        deps.sendJson(res, 404, { error: 'schedule_not_found' });
        return;
      }
      if (err?.code === 'schedule_action_not_found') {
        deps.sendJson(res, 404, { error: 'action_not_found' });
        return;
      }
      next(err);
    }
  });

  router.post('/api/debug/entities/extract', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!requireAuthenticated(req, res, deps)) return;

    const body = await deps.parseJsonBody(req);
    const text = String(body.text || '');

    try {
      const result = await deps.extractSemanticContext({
        rawText: text,
        tenantId: req.tenantId,
        channel: body.channel || 'whatsapp',
        dryRun: false,
      });
      deps.sendJson(res, 200, result);
    } catch (err) {
      deps.logger.warn('[API] /api/debug/entities/extract fallback to keywords', { error: err.message });
      const keywords = deps.nlpExtractKeywords(text);
      deps.sendJson(res, 200, { entities: keywords, keywords, error: null });
    }
  });

  router.post('/api/support/tags/suggest', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!requireAuthenticated(req, res, deps)) return;

    const body = await deps.parseJsonBody(req);
    const text = String(body.text || '');
    const keywords = deps.nlpExtractKeywords(text);
    deps.sendJson(res, 200, { tags: keywords.slice(0, 10), keywords });
  });

  router.post('/api/support/sentiment/suggest', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!requireAuthenticated(req, res, deps)) return;

    const body = await deps.parseJsonBody(req);
    const text = String(body.text || '');

    try {
      const result = await deps.nlpAnalyzeText(text);
      deps.sendJson(res, 200, { sentiment: result.sentiment, intent: result.intent, result });
    } catch (_) {
      const lower = text.toLowerCase();
      const pos = /\b(obrigad|ótimo|excelente|perfeito|feliz|satisf|grato)/.test(lower);
      const neg = /\b(problema|erro|falha|ruim|péssim|horrív|insatisf|reclamaç)/.test(lower);
      const sentiment = pos && !neg ? 'positive' : neg && !pos ? 'negative' : 'neutral';
      deps.sendJson(res, 200, { sentiment, intent: null, result: null });
    }
  });

  return router;
}

module.exports = {
  createSupportDebugRoutes,
};
