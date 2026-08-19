const {
  ensureSupportAccess,
  ensureRpaDevelopmentAccess,
  getPathSuffix,
  resolveRequestTenant,
} = require('./rpaRouteUtils');

async function handleRpaRecordingsRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    listRecordings,
    deleteRecording,
    startManualRecording,
    stopManualRecording,
    getRecordingStatus,
  } = deps;

  if (method === 'GET' && pathname === '/rpa/recordings') {
    if (!ensureSupportAccess(req, res, requireAuth, sendJson)) return true;
    const tenantId = resolveRequestTenant(req, res, sendJson);
    if (!tenantId) return true;

    try {
      const recordings = listRecordings(tenantId);
      sendJson(res, 200, { recordings });
    } catch (error) {
      logger.error('Erro ao listar gravações RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar gravações RPA' });
    }
    return true;
  }

  if (method === 'DELETE' && pathname.startsWith('/rpa/recordings/')) {
    if (!ensureSupportAccess(req, res, requireAuth, sendJson)) return true;
    const tenantId = resolveRequestTenant(req, res, sendJson);
    if (!tenantId) return true;

    try {
      let recordingId = decodeURIComponent(pathname.slice('/rpa/recordings/'.length));
      if (recordingId.endsWith('.json')) {
        recordingId = recordingId.slice(0, -'.json'.length);
      }

      if (!recordingId || recordingId.trim() === '') {
        badRequest(res, 'ID da gravação é obrigatório');
        return true;
      }

      const result = deleteRecording(recordingId, tenantId);
      if (!result.success) {
        if (result.message.includes('não encontrada')) {
          sendJson(res, 404, { error: 'not_found', message: result.message });
        } else {
          sendJson(res, 500, { error: 'internal_error', message: result.message });
        }
        return true;
      }

      logger.debug(`Gravação removida: ${recordingId}`);
      sendJson(res, 200, {
        success: true,
        deletedId: result.deletedId,
        message: result.message,
      });
    } catch (err) {
      logger.error('Erro ao remover gravação', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: 'Erro interno ao remover gravação',
      });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/rpa/record/start') {
    if (!ensureRpaDevelopmentAccess(req, res, requireAuth, sendJson)) return true;
    const tenantId = resolveRequestTenant(req, res, sendJson);
    if (!tenantId) return true;

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const seedName = body.seedName || body.name;
      const initialUrl = body.initialUrl || body.url;

      if (!seedName || seedName.trim() === '') {
        badRequest(res, 'Nome do seed (seedName) é obrigatório');
        return true;
      }

      const result = await startManualRecording(seedName, initialUrl, tenantId);
      if (!result.success) {
        sendJson(res, 400, result);
        return true;
      }

      sendJson(res, 200, result);
    } catch (error) {
      logger.error('Erro ao iniciar gravação manual', error);
      sendJson(res, 500, {
        error: 'internal_error',
        message: error.message || 'Erro ao iniciar gravação manual',
      });
    }
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/rpa/record/stop/')) {
    if (!ensureRpaDevelopmentAccess(req, res, requireAuth, sendJson)) return true;
    const tenantId = resolveRequestTenant(req, res, sendJson);
    if (!tenantId) return true;

    try {
      const recordingId = getPathSuffix(pathname, '/rpa/record/stop/');
      if (!recordingId) {
        badRequest(res, 'ID da gravação é obrigatório');
        return true;
      }

      const result = await stopManualRecording(recordingId, tenantId);
      if (!result.success) {
        sendJson(res, 400, result);
        return true;
      }

      sendJson(res, 200, result);
    } catch (error) {
      logger.error('Erro ao parar gravação manual', error);
      sendJson(res, 500, {
        error: 'internal_error',
        message: error.message || 'Erro ao parar gravação manual',
      });
    }
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/rpa/record/status/')) {
    if (!ensureRpaDevelopmentAccess(req, res, requireAuth, sendJson)) return true;
    const tenantId = resolveRequestTenant(req, res, sendJson);
    if (!tenantId) return true;

    try {
      const recordingId = getPathSuffix(pathname, '/rpa/record/status/');
      if (!recordingId) {
        badRequest(res, 'ID da gravação é obrigatório');
        return true;
      }

      const result = getRecordingStatus(recordingId, tenantId);
      if (!result.success) {
        sendJson(res, 404, result);
        return true;
      }

      sendJson(res, 200, result);
    } catch (error) {
      logger.error('Erro ao obter status da gravação', error);
      sendJson(res, 500, {
        error: 'internal_error',
        message: error.message || 'Erro ao obter status da gravação',
      });
    }
    return true;
  }

  return false;
}

module.exports = { handleRpaRecordingsRoutes };
