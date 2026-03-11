'use strict';

const fs = require('fs');
const path = require('path');

const logger = require('../utils/logger');
const { logAction } = require('../services/auditService');

function ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action }) {
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }
  const permResult = requirePermission(req, 'config', action);
  if (!permResult.allowed) {
    sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return false;
  }
  return true;
}

async function handlePbxMediaRoutes({
  req,
  res,
  method,
  pathname,
  sendJson,
  badRequest,
  parseJsonBody,
  parseMultipartFormData,
  requireAuth,
  requirePermission,
  requireTenant,
  buildApiError,
}) {
  if (!(
    pathname === '/api/pbx/audio-assets'
    || pathname === '/api/pbx/audio-assets/upload'
    || pathname === '/api/pbx/audio-assets/file'
    || pathname === '/api/pbx/recordings'
    || pathname === '/api/pbx/recordings/policy'
    || pathname === '/api/pbx/recordings/scan'
    || pathname === '/api/pbx/recordings/file'
    || pathname === '/api/pbx/cdr'
  )) {
    return false;
  }

  if (method === 'GET' && pathname === '/api/pbx/audio-assets') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'read' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const kind = new URL(req.url || '/', 'http://localhost').searchParams.get('kind');
      const pbxMedia = require('../services/pbx/pbxMediaService');
      sendJson(res, 200, { items: await pbxMedia.listAudioAssets({ tenantKey, kind }) });
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

  if (method === 'POST' && pathname === '/api/pbx/audio-assets/upload') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'update' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const { fields, files } = await parseMultipartFormData(req);
      const kind = fields.kind || fields.dir || null;
      const file = Array.isArray(files) ? files.find((f) => f.fieldname === 'file') || files[0] : null;
      if (!file) {
        badRequest(res, 'Arquivo obrigatório (field "file")');
        return true;
      }
      if (file.size > 25 * 1024 * 1024) {
        sendJson(res, 413, { error: 'payload_too_large', message: 'Arquivo maior que 25MB' });
        return true;
      }
      const pbxMedia = require('../services/pbx/pbxMediaService');
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

  if (method === 'GET' && pathname === '/api/pbx/audio-assets/file') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'read' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const id = new URL(req.url || '/', 'http://localhost').searchParams.get('id');
      if (!id) {
        badRequest(res, 'id obrigatório');
        return true;
      }
      const { PbxAudioAsset } = require('../db/models');
      const row = await PbxAudioAsset().findOne({ where: { id: String(id), tenantKey } });
      if (!row) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      const pbxMedia = require('../services/pbx/pbxMediaService');
      const filePath = pbxMedia.resolveAudioFilePath(row.toJSON());
      if (!filePath) {
        sendJson(res, 404, { error: 'file_not_found' });
        return true;
      }
      const buf = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Disposition': `attachment; filename="${path.basename(filePath)}"`,
        'Content-Length': buf.length,
      });
      res.end(buf);
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/audio-assets/file', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao baixar áudio' });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/pbx/recordings') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'read' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const limit = new URL(req.url || '/', 'http://localhost').searchParams.get('limit') || '200';
      const pbxRec = require('../services/pbx/pbxRecordingsService');
      sendJson(res, 200, { items: await pbxRec.listRecordings({ tenantKey, limit }) });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/recordings', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar gravações' });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/pbx/recordings/policy') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'read' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const policyService = require('../services/pbx/pbxRecordingPolicyService');
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

  if (method === 'POST' && pathname === '/api/pbx/recordings/policy') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'update' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const body = await parseJsonBody(req);
      const policyService = require('../services/pbx/pbxRecordingPolicyService');
      const out = await policyService.setRecordingPolicy({ tenantKey, policy: body || {} });
      if (!out.ok) {
        sendJson(res, 500, { error: 'internal_error', message: out.error || 'Erro ao salvar política' });
        return true;
      }
      try {
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

  if (method === 'POST' && pathname === '/api/pbx/recordings/scan') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'update' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const pbxRec = require('../services/pbx/pbxRecordingsService');
      sendJson(res, 200, { ok: true, ...(await pbxRec.scanAndUpsertRecordings({ tenantKey })) });
    } catch (err) {
      logger.error('[PBX] Erro em POST /api/pbx/recordings/scan', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao varrer gravações' });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/pbx/recordings/file') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'read' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const id = new URL(req.url || '/', 'http://localhost').searchParams.get('id');
      if (!id) {
        badRequest(res, 'id obrigatório');
        return true;
      }
      const pbxRec = require('../services/pbx/pbxRecordingsService');
      const filePath = await pbxRec.getRecordingFilePath({ tenantKey, id: String(id) });
      if (!filePath) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      try {
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
      const buf = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Disposition': `attachment; filename="${path.basename(filePath)}"`,
        'Content-Length': buf.length,
      });
      res.end(buf);
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/recordings/file', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao baixar gravação' });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/pbx/cdr') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'read' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const pbxCdr = require('../services/pbx/pbxCdrService');
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

module.exports = {
  handlePbxMediaRoutes,
};
