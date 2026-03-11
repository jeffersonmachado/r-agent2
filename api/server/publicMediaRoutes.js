'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../utils/config');
const logger = require('../utils/logger');
const {
  sanitizeMediaPathSegment,
  getSupportMediaByPath,
} = require('../services/supportMediaService');
const { isWhitelistedWhatsAppMediaHost } = require('./mediaHelpers');

const SUPPORT_MEDIA_DIR = path.join(__dirname, '..', 'storage', 'support-media');

function buildInlineDisposition(filename) {
  return `inline; filename="${String(filename || 'arquivo').replace(/"/g, '_')}"`;
}

function resolveMimeByExtension(fullPath) {
  const ext = path.extname(fullPath).toLowerCase();
  const mimeByExt = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.pdf': 'application/pdf',
  };
  return mimeByExt[ext] || 'application/octet-stream';
}

async function handleSupportMediaRoute({ pathname, res, sendJson }) {
  try {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length < 4) {
      sendJson(res, 404, { error: 'not_found' });
      return true;
    }

    const tenantSegment = sanitizeMediaPathSegment(decodeURIComponent(parts[2] || ''), '');
    const fileSegment = sanitizeMediaPathSegment(decodeURIComponent(parts.slice(3).join('/')), '');
    if (!tenantSegment || !fileSegment) {
      sendJson(res, 404, { error: 'not_found' });
      return true;
    }

    const dbAsset = await getSupportMediaByPath(tenantSegment, fileSegment);
    if (dbAsset?.data) {
      res.writeHead(200, {
        'Content-Type': dbAsset.mimeType || 'application/octet-stream',
        'Content-Length': String(dbAsset.data.length),
        'Cache-Control': 'public, max-age=3600',
        'Content-Disposition': buildInlineDisposition(dbAsset.originalName || dbAsset.storageName || 'arquivo'),
      });
      res.end(dbAsset.data);
      return true;
    }

    const baseTenantDir = path.join(SUPPORT_MEDIA_DIR, tenantSegment);
    const fullPath = path.join(baseTenantDir, fileSegment);
    if (!fullPath.startsWith(baseTenantDir)) {
      sendJson(res, 403, { error: 'forbidden' });
      return true;
    }
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      sendJson(res, 404, { error: 'file_not_found' });
      return true;
    }

    const data = fs.readFileSync(fullPath);
    res.writeHead(200, {
      'Content-Type': resolveMimeByExtension(fullPath),
      'Content-Length': String(data.length),
      'Cache-Control': 'public, max-age=3600',
      'Content-Disposition': buildInlineDisposition(path.basename(fullPath)),
    });
    res.end(data);
    return true;
  } catch (err) {
    logger.error('[SupportMedia] Erro ao servir arquivo público', err);
    sendJson(res, 500, { error: 'internal_error', message: 'Erro ao servir arquivo' });
    return true;
  }
}

async function handleWhatsAppMediaProxyRoute({ req, res, sendJson, badRequest, fetchImpl = fetch }) {
  try {
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const targetRaw = String(urlObj.searchParams.get('url') || '').trim();
    if (!targetRaw) {
      badRequest(res, 'Parâmetro "url" é obrigatório');
      return true;
    }

    let targetUrl;
    try {
      targetUrl = new URL(targetRaw);
    } catch (_) {
      badRequest(res, 'URL de mídia inválida');
      return true;
    }

    if (!/^https?:$/i.test(targetUrl.protocol) || !isWhitelistedWhatsAppMediaHost(targetUrl.hostname)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Host de mídia não permitido' });
      return true;
    }

    const accessToken = String(config.get('whatsapp.accessToken', '') || '').trim();
    if (!accessToken) {
      sendJson(res, 503, { error: 'service_unavailable', message: 'Token WhatsApp não configurado' });
      return true;
    }

    const upstream = await fetchImpl(targetUrl.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!upstream.ok) {
      sendJson(res, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, {
        error: 'upstream_error',
        message: `Falha ao obter mídia do WhatsApp (${upstream.status})`,
      });
      return true;
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const contentLength = upstream.headers.get('content-length');
    const contentDisposition = upstream.headers.get('content-disposition') || 'inline';
    const data = Buffer.from(await upstream.arrayBuffer());

    res.writeHead(200, {
      'Content-Type': contentType,
      ...(contentLength ? { 'Content-Length': contentLength } : {}),
      'Cache-Control': 'private, max-age=60',
      'Content-Disposition': contentDisposition,
    });
    res.end(data);
    return true;
  } catch (err) {
    logger.error('[WhatsAppMediaProxy] Erro ao servir mídia', err);
    sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter mídia do WhatsApp' });
    return true;
  }
}

async function handlePublicMediaRoutes({ req, res, method, pathname, sendJson, badRequest, fetchImpl }) {
  if (method === 'GET' && pathname.startsWith('/public/support-media/')) {
    return handleSupportMediaRoute({ pathname, res, sendJson });
  }

  if (method === 'GET' && pathname === '/public/whatsapp-media') {
    return handleWhatsAppMediaProxyRoute({ req, res, sendJson, badRequest, fetchImpl });
  }

  return false;
}

module.exports = {
  handlePublicMediaRoutes,
  _internal: {
    handleSupportMediaRoute,
    handleWhatsAppMediaProxyRoute,
    resolveMimeByExtension,
    buildInlineDisposition,
  },
};
