'use strict';

const crypto = require('crypto');
const path = require('path');
const getSupportMediaAssetModel = require('../db/models/SupportMediaAsset');
const logger = require('../utils/logger');

function sanitizeMediaPathSegment(input, fallback = 'file') {
  const base = String(input || fallback)
    .normalize('NFKD')
    .replace(/[^\w.\-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || fallback;
}

function inferExtensionFromMime(mimeType, fallback = 'bin') {
  const mime = String(mimeType || '').toLowerCase();
  if (!mime) return fallback;
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('zip')) return 'zip';
  if (mime.includes('json')) return 'json';
  return fallback;
}

function buildStorageName({ fileName, mimeType, fallbackPrefix = 'arquivo' }) {
  const safeOriginal = sanitizeMediaPathSegment(fileName || fallbackPrefix, fallbackPrefix);
  const ext = path.extname(safeOriginal).replace(/^\./, '').toLowerCase();
  const withExt = ext
    ? safeOriginal
    : `${safeOriginal}.${inferExtensionFromMime(mimeType, 'bin')}`;
  return `${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${withExt}`;
}

function normalizeBlobToBuffer(blobLike) {
  if (!blobLike) return null;
  if (Buffer.isBuffer(blobLike)) return blobLike;
  if (blobLike?.type === 'Buffer' && Array.isArray(blobLike?.data)) {
    return Buffer.from(blobLike.data);
  }
  if (Array.isArray(blobLike)) return Buffer.from(blobLike);
  return null;
}

async function saveSupportMedia({
  tenantId,
  fileName,
  mimeType,
  buffer,
  source = 'support_upload',
  fallbackPrefix = 'arquivo',
}) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('media_buffer_required');
  }
  const tenantSegment = sanitizeMediaPathSegment(String(tenantId || 'system'), 'system');
  const storageName = buildStorageName({ fileName, mimeType, fallbackPrefix });
  const model = getSupportMediaAssetModel();
  const id = `sma_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

  await model.create({
    id,
    tenant_id: tenantSegment,
    storage_name: storageName,
    original_name: fileName ? String(fileName) : null,
    mime_type: mimeType ? String(mimeType) : 'application/octet-stream',
    size_bytes: buffer.length,
    source: source ? String(source) : null,
    data: buffer,
  });

  return {
    id,
    tenantId: tenantSegment,
    storageName,
    url: `/public/support-media/${encodeURIComponent(tenantSegment)}/${encodeURIComponent(storageName)}`,
    mimeType: mimeType ? String(mimeType) : 'application/octet-stream',
    sizeBytes: buffer.length,
    originalName: fileName ? String(fileName) : null,
  };
}

async function getSupportMediaByPath(tenantId, fileName) {
  const tenantSegment = sanitizeMediaPathSegment(String(tenantId || ''), '');
  const storageName = sanitizeMediaPathSegment(String(fileName || ''), '');
  if (!tenantSegment || !storageName) return null;

  try {
    const model = getSupportMediaAssetModel();
    const row = await model.findOne({
      where: { tenant_id: tenantSegment, storage_name: storageName },
      attributes: ['tenant_id', 'storage_name', 'original_name', 'mime_type', 'size_bytes', 'data'],
    });
    if (!row) return null;

    const data = normalizeBlobToBuffer(row.data);
    if (!data || data.length === 0) return null;

    return {
      tenantId: row.tenant_id,
      storageName: row.storage_name,
      originalName: row.original_name || row.storage_name,
      mimeType: row.mime_type || 'application/octet-stream',
      sizeBytes: Number(row.size_bytes || data.length),
      data,
    };
  } catch (err) {
    logger.error('[SupportMedia] Erro ao consultar mídia no banco', err);
    return null;
  }
}

module.exports = {
  sanitizeMediaPathSegment,
  saveSupportMedia,
  getSupportMediaByPath,
};

