const crypto = require('crypto');
const getTicketMediaModel = require('../db/models/TicketMedia');

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}
function safeTrim(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value).trim(); } catch (_) { return fallback; }
}

let ensureReadyPromise = null;

function normalizeTenant(tenantId) {
  const value = safeTrim(tenantId || '');
  return value || 'default';
}

async function ensureReady() {
  if (!ensureReadyPromise) {
    ensureReadyPromise = (async () => {
      const TicketMedia = getTicketMediaModel();
      await TicketMedia.sync();
      return TicketMedia;
    })().catch((err) => {
      ensureReadyPromise = null;
      throw err;
    });
  }
  return ensureReadyPromise;
}

function buildMediaId() {
  return `tm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toSize(value, fallback = null) {
  if (Number.isFinite(value)) return Number(value);
  const parsed = parseInt(safeToString(value || ''), 10);
  if (Number.isFinite(parsed)) return parsed;
  return fallback;
}

async function storeTicketMedia({ tenantId, fileName, mimeType, sizeBytes, buffer, createdBy = null }) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Arquivo de midia vazio ou invalido');
  }

  const TicketMedia = await ensureReady();
  const id = buildMediaId();
  const normalizedTenant = normalizeTenant(tenantId);
  const now = new Date();
  const safeMimeType = safeTrim(mimeType || '') || 'application/octet-stream';
  const safeFileName = safeTrim(fileName || '') || id;
  const finalSize = toSize(sizeBytes, buffer.length);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');

  await TicketMedia.create({
    id,
    tenantKey: normalizedTenant,
    fileName: safeFileName,
    mimeType: safeMimeType,
    sizeBytes: finalSize,
    sha256: hash,
    createdBy: createdBy ? safeToString(createdBy) : null,
    data: buffer,
    created_at: now,
    updated_at: now,
  });

  return {
    id,
    tenantId: normalizedTenant,
    fileName: safeFileName,
    mimeType: safeMimeType,
    sizeBytes: finalSize,
    sha256: hash,
  };
}

async function getTicketMediaById(id, tenantId) {
  const TicketMedia = await ensureReady();
  
  // Se tenantId for null, não filtrar por tenant (acesso cross-tenant, ex: super-admin)
  const query = { id: safeToString(id) };
  if (tenantId !== null) {
    const normalizedTenant = normalizeTenant(tenantId);
    query.tenantKey = normalizedTenant;
  }

  const row = await TicketMedia.findOne({ where: query });

  if (!row) return null;
  const base = typeof row.toJSON === 'function' ? row.toJSON() : row;
  return {
    id: base.id,
    tenantId: base.tenantKey,
    fileName: base.fileName || null,
    mimeType: base.mimeType || 'application/octet-stream',
    sizeBytes: toSize(base.sizeBytes, null),
    data: base.data,
  };
}

module.exports = {
  storeTicketMedia,
  getTicketMediaById,
};
