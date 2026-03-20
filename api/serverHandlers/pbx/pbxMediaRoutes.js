// PBX - Mídia (áudios) / Gravações / CDR
// Rotas: /api/pbx/audio-assets*, /api/pbx/recordings*, /api/pbx/cdr

const PBX_MEDIA_PATHS = new Set([
  '/api/pbx/audio-assets',
  '/api/pbx/audio-assets/upload',
  '/api/pbx/audio-assets/file',
  '/api/pbx/recordings',
  '/api/pbx/recordings/policy',
  '/api/pbx/recordings/scan',
  '/api/pbx/recordings/file',
  '/api/pbx/cdr',
]);

async function handlePbxMediaRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    badRequest,
    parseJsonBody,
    parseMultipartFormData,
    logger,
    buildApiError,
  } = deps;

  if (!PBX_MEDIA_PATHS.has(pathname)) {
    return false;
  }

  // GET /api/pbx/audio-assets?kind=...
  if (method === 'GET' && pathname === '/api/pbx/audio-assets') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return;

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const kind = urlObj.searchParams.get('kind');
      const pbxMedia = require('../../services/pbx/pbxMediaService');
      const items = await pbxMedia.listAudioAssets({ tenantKey, kind });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/audio-assets', err);
      sendJson(res, 500, buildApiError({
        code: 'pbx_audio_assets_list_error',
        message: err.message || 'Erro ao listar áudios',
        httpStatus: 500,
        retryable: true,
        details: null,
        req,
      }));
    }
    return true;
  }

  // POST /api/pbx/audio-assets/upload (multipart)
  if (method === 'POST' && pathname === '/api/pbx/audio-assets/upload') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return;

    try {
      const { fields, files } = await parseMultipartFormData(req);
      const kind = fields.kind || fields.dir || null; // legado usa ?dir=espera|sons
      const file = Array.isArray(files) ? files.find(f => f.fieldname === 'file') || files[0] : null;
      if (!file) {
        badRequest(res, 'Arquivo obrigatório (field "file")');
        return true;
      }
      // Limite: 25MB
      if (file.size > 25 * 1024 * 1024) {
        sendJson(res, 413, { error: 'payload_too_large', message: 'Arquivo maior que 25MB' });
        return true;
      }
      const pbxMedia = require('../../services/pbx/pbxMediaService');
      const actorUserId = req.user?.id || null;
      const item = await pbxMedia.createAudioAssetFromUpload({
        tenantKey,
        kind,
        filename: file.filename,
        mimeType: file.mimeType,
        buffer: file.buffer,
        actorUserId,
      });
      sendJson(res, 200, { ok: true, item });
    } catch (err) {
      const code = err.code || 'pbx_audio_upload_error';
      const httpStatus = ['audio_kind_required', 'audio_file_required'].includes(code) ? 400 : 500;
      logger.error('[PBX] Erro em POST /api/pbx/audio-assets/upload', err);
      sendJson(res, httpStatus, buildApiError({
        code,
        message: err.message || 'Erro ao fazer upload de áudio',
        httpStatus,
        retryable: httpStatus >= 500,
        details: null,
        req,
      }));
    }
    return true;
  }

  // GET /api/pbx/audio-assets/file?id=... (download)
  if (method === 'GET' && pathname === '/api/pbx/audio-assets/file') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return;

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const id = urlObj.searchParams.get('id');
      if (!id) {
        badRequest(res, 'id obrigatório');
        return true;
      }
      const { PbxAudioAsset } = require('../../db/models');
      const row = await PbxAudioAsset().findOne({ where: { id: String(id), tenantKey } });
      if (!row) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      const pbxMedia = require('../../services/pbx/pbxMediaService');
      const filePath = pbxMedia.resolveAudioFilePath(row.toJSON());
      if (!filePath) {
        sendJson(res, 404, { error: 'file_not_found' });
        return true;
      }
      // eslint-disable-next-line global-require
      const fs = require('fs');
      // eslint-disable-next-line global-require
      const p = require('path');
      const buf = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Disposition': `attachment; filename="${p.basename(filePath)}"`,
        'Content-Length': buf.length,
      });
      res.end(buf);
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/audio-assets/file', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao baixar áudio' });
    }
    return true;
  }

  // GET /api/pbx/recordings?limit=...
  if (method === 'GET' && pathname === '/api/pbx/recordings') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return;

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const limit = urlObj.searchParams.get('limit') || '200';
      const pbxRec = require('../../services/pbx/pbxRecordingsService');
      const items = await pbxRec.listRecordings({ tenantKey, limit });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/recordings', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar gravações' });
    }
    return true;
  }

  // GET /api/pbx/recordings/policy
  if (method === 'GET' && pathname === '/api/pbx/recordings/policy') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return;
    try {
      const policyService = require('../../services/pbx/pbxRecordingPolicyService');
      const out = await policyService.getRecordingPolicy({ tenantKey });
      if (!out.ok) {
        sendJson(res, 500, { error: 'internal_error', message: out.error || 'Erro ao obter política' });
        return true;
      }
      sendJson(res, 200, { ok: true, policy: out.policy });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/recordings/policy', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter política de gravação' });
    }
    return true;
  }

  // POST /api/pbx/recordings/policy
  if (method === 'POST' && pathname === '/api/pbx/recordings/policy') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return;
    try {
      const body = await parseJsonBody(req);
      const policyService = require('../../services/pbx/pbxRecordingPolicyService');
      const out = await policyService.setRecordingPolicy({ tenantKey, policy: body || {} });
      if (!out.ok) {
        sendJson(res, 500, { error: 'internal_error', message: out.error || 'Erro ao salvar política' });
        return true;
      }
      try {
        const { logAction } = require('../../services/auditService');
        const actorUserId = req.agent?.id || req.agent?.username || null;
        logAction({
          agentId: actorUserId,
          tenantId: tenantKey,
          action: 'pbx.recordings.policy.update',
          resource: 'pbx_recording_policy',
          resourceId: tenantKey,
          details: out.policy,
        });
      } catch (_) {}
      sendJson(res, 200, { ok: true, policy: out.policy });
    } catch (err) {
      logger.error('[PBX] Erro em POST /api/pbx/recordings/policy', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar política de gravação' });
    }
    return true;
  }

  // POST /api/pbx/recordings/scan
  if (method === 'POST' && pathname === '/api/pbx/recordings/scan') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return;
    try {
      const pbxRec = require('../../services/pbx/pbxRecordingsService');
      const result = await pbxRec.scanAndUpsertRecordings({ tenantKey });
      sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      logger.error('[PBX] Erro em POST /api/pbx/recordings/scan', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao varrer gravações' });
    }
    return true;
  }

  // GET /api/pbx/recordings/file?id=...
  if (method === 'GET' && pathname === '/api/pbx/recordings/file') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return;
    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const id = urlObj.searchParams.get('id');
      if (!id) {
        badRequest(res, 'id obrigatório');
        return true;
      }
      const pbxRec = require('../../services/pbx/pbxRecordingsService');
      const filePath = await pbxRec.getRecordingFilePath({ tenantKey, id: String(id) });
      if (!filePath) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      try {
        const { logAction } = require('../../services/auditService');
        const actorUserId = req.agent?.id || req.agent?.username || null;
        logAction({
          agentId: actorUserId,
          tenantId: tenantKey,
          action: 'pbx.recordings.download',
          resource: 'pbx_recording',
          resourceId: String(id),
          details: { id: String(id) },
        });
      } catch (_) {}
      // eslint-disable-next-line global-require
      const fs = require('fs');
      // eslint-disable-next-line global-require
      const p = require('path');
      const buf = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Disposition': `attachment; filename="${p.basename(filePath)}"`,
        'Content-Length': buf.length,
      });
      res.end(buf);
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/recordings/file', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao baixar gravação' });
    }
    return true;
  }

  // GET /api/pbx/cdr?limit=...&from=...&to=...&src=...&dst=...&uniqueid=...
  if (method === 'GET' && pathname === '/api/pbx/cdr') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return;
    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const pbxCdr = require('../../services/pbx/pbxCdrService');
      const items = await pbxCdr.listCdr({
        tenantKey,
        filters: {
          limit: urlObj.searchParams.get('limit') || null,
          from: urlObj.searchParams.get('from') || null,
          to: urlObj.searchParams.get('to') || null,
          src: urlObj.searchParams.get('src') || null,
          dst: urlObj.searchParams.get('dst') || null,
          uniqueid: urlObj.searchParams.get('uniqueid') || null,
        },
      });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/cdr', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar CDR' });
    }
    return true;
  }

  return false;
}

module.exports = { handlePbxMediaRoutes };
