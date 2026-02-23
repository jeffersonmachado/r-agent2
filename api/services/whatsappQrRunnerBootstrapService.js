'use strict';

const logger = require('../utils/logger');
const { listTenants } = require('./tenantService');
const whatsappQrService = require('./whatsappQrService');
const qrRunner = require('./whatsappQrRunnerInstance');

function isRestoreEnabled() {
  return String(process.env.ENABLE_WHATSAPP_QR_RESTORE || 'true').toLowerCase() !== 'false';
}

function resolveRestoreTenants() {
  const raw = String(process.env.WHATSAPP_QR_RESTORE_TENANTS || '').trim();
  if (!raw) return null;
  const items = raw.split(',').map((x) => String(x || '').trim()).filter(Boolean);
  return items.length > 0 ? Array.from(new Set(items)) : null;
}

async function resolveTenantIds() {
  const forced = resolveRestoreTenants();
  if (forced && forced.length > 0) return forced;
  try {
    const tenants = await listTenants();
    const ids = (Array.isArray(tenants) ? tenants : [])
      .map((t) => t?.tenant_key || t?.id)
      .filter(Boolean)
      .map(String);
    if (ids.length > 0) return Array.from(new Set(ids));
  } catch (_) {}
  return ['system'];
}

function shouldRestoreConnection(connection) {
  if (!connection || !connection.id) return false;
  const provider = String(connection.provider || 'whatsapp-qr').toLowerCase();
  if (!provider.includes('whatsapp')) return false;
  const status = String(connection.status || 'disconnected').toLowerCase();
  return status === 'connected' || status === 'pairing';
}

async function restoreWhatsAppQrSessions() {
  if (!isRestoreEnabled()) {
    return { ok: false, skipped: true, reason: 'disabled' };
  }

  const tenantIds = await resolveTenantIds();
  let restoreCount = 0;

  for (const tenantId of tenantIds) {
    // eslint-disable-next-line no-await-in-loop
    const listed = await whatsappQrService.listConnections(tenantId).catch(() => null);
    if (!listed?.ok) continue;
    const connections = Array.isArray(listed.connections) ? listed.connections : [];

    for (const connection of connections) {
      if (!shouldRestoreConnection(connection)) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await qrRunner.ensureSession(tenantId, connection.id, null, { name: connection.name || null });
        restoreCount += 1;
      } catch (err) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await whatsappQrService.setConnectionStatus(tenantId, connection.id, {
            status: 'disconnected',
            metadata: {
              source: 'runner-bootstrap',
              restoreError: err?.message || String(err),
            },
          });
        } catch (_) {}
      }
    }
  }

  logger.info('[WhatsAppQR] Runner restore concluído', { restoreCount, tenants: tenantIds.length });
  return { ok: true, restoreCount, tenants: tenantIds.length };
}

module.exports = {
  restoreWhatsAppQrSessions,
};

