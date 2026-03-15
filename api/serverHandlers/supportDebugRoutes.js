async function handleSupportDebugRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    sendJson,
    parseJsonBody,
    scheduleService,
    extractSemanticContext,
    logger,
    nlpExtractKeywords,
    nlpAnalyzeText,
  } = deps;

  if (method === 'GET' && pathname === '/api/schedules') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const urlObj = new URL(req.url, 'http://localhost');
    const contextType = urlObj.searchParams.get('contextType') || undefined;
    const contextId = urlObj.searchParams.get('contextId') || undefined;
    const limit = Math.min(parseInt(urlObj.searchParams.get('limit') || '50', 10), 200);
    const result = scheduleService.listSchedules({
      tenantId: req.tenantId || 'default',
      contextType,
      contextId,
      limit,
    });
    sendJson(res, 200, result);
    return true;
  }

  if (method === 'POST' && pathname === '/api/schedules') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const body = await parseJsonBody(req);
    const schedule = scheduleService.createSchedule({
      tenantId: req.tenantId || 'default',
      payload: body,
    });
    sendJson(res, 201, { schedule });
    return true;
  }

  if (method === 'GET' && pathname === '/api/schedules/availability') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    sendJson(res, 200, { available: true, slots: [] });
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/api/schedules/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const schedSeg = pathname.slice('/api/schedules/'.length);
    const slashIdx = schedSeg.indexOf('/');
    if (slashIdx !== -1) {
      const schedId = decodeURIComponent(schedSeg.slice(0, slashIdx));
      const action = schedSeg.slice(slashIdx + 1);
      let payload = {};
      if (action === 'reschedule') {
        payload = await parseJsonBody(req);
      }

      let sched = null;
      try {
        sched = scheduleService.updateScheduleStatus({
          tenantId: req.tenantId || 'default',
          scheduleId: schedId,
          action,
          payload,
        });
      } catch (err) {
        if (err && err.code === 'schedule_not_found') {
          sendJson(res, 404, { error: 'schedule_not_found' });
          return true;
        }
        if (err && err.code === 'schedule_action_not_found') {
          sendJson(res, 404, { error: 'action_not_found' });
          return true;
        }
        throw err;
      }

      if (!sched) {
        sendJson(res, 404, { error: 'schedule_not_found' });
        return true;
      }

      sendJson(res, 200, { schedule: sched });
      return true;
    }
  }

  if (method === 'POST' && pathname === '/api/debug/entities/extract') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const body = await parseJsonBody(req);
    const text = String(body.text || '');

    try {
      const result = await extractSemanticContext({
        rawText: text,
        tenantId: req.tenantId,
        channel: body.channel || 'whatsapp',
        dryRun: false,
      });
      sendJson(res, 200, result);
    } catch (err) {
      logger.warn('[API] /api/debug/entities/extract fallback to keywords', { error: err.message });
      const keywords = nlpExtractKeywords(text);
      sendJson(res, 200, { entities: keywords, keywords, error: null });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/api/support/tags/suggest') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const body = await parseJsonBody(req);
    const text = String(body.text || '');
    const keywords = nlpExtractKeywords(text);
    sendJson(res, 200, { tags: keywords.slice(0, 10), keywords });
    return true;
  }

  if (method === 'POST' && pathname === '/api/support/sentiment/suggest') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const body = await parseJsonBody(req);
    const text = String(body.text || '');

    try {
      const result = await nlpAnalyzeText(text);
      sendJson(res, 200, { sentiment: result.sentiment, intent: result.intent, result });
    } catch (err) {
      // Fallback: heuristic sentiment
      const lower = text.toLowerCase();
      const pos = /\b(obrigad|ótimo|excelente|perfeito|feliz|satisf|grato)/.test(lower);
      const neg = /\b(problema|erro|falha|ruim|péssim|horrív|insatisf|reclamaç)/.test(lower);
      const sentiment = pos && !neg ? 'positive' : neg && !pos ? 'negative' : 'neutral';
      sendJson(res, 200, { sentiment, intent: null, result: null });
    }
    return true;
  }

  return false;
}

module.exports = { handleSupportDebugRoutes };
