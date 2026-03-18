'use strict';

/**
 * Bridge opcional para provedores WhatsApp QR (ex.: whatsapp-web.js).
 *
 * Objetivo:
 * - Inicializar clientes por conexão cadastrada.
 * - Converter eventos do provider em eventos internos de conexão:
 *   qr/pairing, connected/ready, disconnected, error.
 * - Não quebrar boot quando a lib não estiver instalada.
 */

const logger = require('../utils/logger');
const { listConnections, ingestConnectionEvent } = require('./whatsappQrService');
const { listTenants } = require('./tenantService');

const activeClients = new Map();
let started = false;
let syncTimer = null;

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeTrim(value, fallback = '') {
  return safeToString(value, fallback).trim();
}

function safeErrorMessage(err, fallback = '') {
  try {
    const message = err && typeof err === 'object' ? err.message : null;
    return safeToString(message) || safeToString(err, fallback);
  } catch (_) {
    return safeToString(err, fallback);
  }
}

function isBridgeEnabled() {
  return safeToString(process.env.ENABLE_WHATSAPP_QR_BRIDGE || 'false', 'false').toLowerCase() === 'true';
}

function syncIntervalMs() {
  const n = Number(process.env.WHATSAPP_QR_BRIDGE_SYNC_MS || 30000);
  return Number.isFinite(n) && n >= 5000 ? n : 30000;
}

function resolveBridgeTenants() {
  const raw = safeTrim(process.env.WHATSAPP_QR_BRIDGE_TENANTS || '');
  if (!raw) return null;
  const items = raw.split(',').map((x) => safeTrim(x)).filter(Boolean);
  return items.length > 0 ? Array.from(new Set(items)) : null;
}

function clientKey(tenantId, connectionId) {
  return `${safeToString(tenantId)}:${safeToString(connectionId)}`;
}

function sanitizeClientId(tenantId, connectionId) {
  return `ria_${safeToString(tenantId)}_${safeToString(connectionId)}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

function loadWhatsappWebJs() {
  try {
    // Optional dependency: pode não estar instalada em todos ambientes.
    // eslint-disable-next-line global-require,import/no-extraneous-dependencies
    return require('whatsapp-web.js');
  } catch (err) {
    return null;
  }
}

function buildPuppeteerOptions() {
  const noSandbox = safeToString(process.env.WHATSAPP_QR_PUPPETEER_NO_SANDBOX || 'true', 'true').toLowerCase() !== 'false';
  return {
    headless: true,
    args: noSandbox
      ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      : ['--disable-dev-shm-usage'],
  };
}

async function destroyClient(key) {
  const entry = activeClients.get(key);
  if (!entry) return;
  activeClients.delete(key);
  try {
    if (entry.client && typeof entry.client.destroy === 'function') {
      await entry.client.destroy();
    }
  } catch (_) {}
}

async function ensureClient({ tenantId, connection }) {
  const key = clientKey(tenantId, connection.id);
  if (activeClients.has(key)) return;

  const wa = loadWhatsappWebJs();
  if (!wa || typeof wa.Client !== 'function' || typeof wa.LocalAuth !== 'function') {
    if (!activeClients.has('__missing_lib__')) {
      activeClients.set('__missing_lib__', { missingLib: true });
      logger.warn('[WhatsAppQRBridge] whatsapp-web.js não instalado. Bridge ficará inativo até instalar a lib.');
    }
    return;
  }

  const { Client, LocalAuth } = wa;
  const clientId = sanitizeClientId(tenantId, connection.id);
  const client = new Client({
    authStrategy: new LocalAuth({ clientId }),
    puppeteer: buildPuppeteerOptions(),
  });

  client.on('qr', async (qr) => {
    try {
      await ingestConnectionEvent(tenantId, connection.id, {
        eventType: 'qr',
        qr: {
          text: safeToString(qr),
          token: '',
          expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        },
        metadata: { bridge: 'whatsapp-web.js' },
      });
    } catch (_) {}
  });

  client.on('ready', async () => {
    try {
      await ingestConnectionEvent(tenantId, connection.id, {
        eventType: 'ready',
        metadata: { bridge: 'whatsapp-web.js' },
      });
    } catch (_) {}
  });

  client.on('disconnected', async (reason) => {
    try {
      await ingestConnectionEvent(tenantId, connection.id, {
        eventType: 'disconnected',
        metadata: { reason: reason ? safeToString(reason) : null, bridge: 'whatsapp-web.js' },
      });
    } catch (_) {}
    await destroyClient(key);
  });

  client.on('auth_failure', async (msg) => {
    try {
      await ingestConnectionEvent(tenantId, connection.id, {
        eventType: 'error',
        metadata: { reason: msg ? safeToString(msg) : 'auth_failure', bridge: 'whatsapp-web.js' },
      });
    } catch (_) {}
  });

  activeClients.set(key, { tenantId, connectionId: connection.id, client, createdAt: new Date().toISOString() });

  try {
    await client.initialize();
    logger.info('[WhatsAppQRBridge] Cliente inicializado', { tenantId, connectionId: connection.id });
  } catch (err) {
    logger.error('[WhatsAppQRBridge] Falha ao inicializar cliente', {
      tenantId,
      connectionId: connection.id,
      error: safeErrorMessage(err),
    });
    await ingestConnectionEvent(tenantId, connection.id, {
      eventType: 'error',
      metadata: { reason: safeErrorMessage(err), bridge: 'whatsapp-web.js' },
    }).catch(() => null);
    await destroyClient(key);
  }
}

async function resolveTenantIdsForSync() {
  const forced = resolveBridgeTenants();
  if (forced && forced.length) return forced;
  try {
    const tenants = await listTenants();
    const ids = (Array.isArray(tenants) ? tenants : [])
      .map((t) => t?.tenant_key || t?.id)
      .filter(Boolean)
      .map((value) => safeToString(value))
      .filter(Boolean);
    if (ids.length > 0) return Array.from(new Set(ids));
  } catch (_) {}
  return ['system'];
}

async function syncConnections() {
  const tenantIds = await resolveTenantIdsForSync();
  const desired = new Set();

  for (const tenantId of tenantIds) {
    // eslint-disable-next-line no-await-in-loop
    const listed = await listConnections(tenantId);
    if (!listed.ok) continue;
    const connections = Array.isArray(listed.connections) ? listed.connections : [];
    for (const conn of connections) {
      if (!conn || !conn.id) continue;
      const provider = safeToString(conn.provider || 'whatsapp-qr', 'whatsapp-qr').toLowerCase();
      if (!provider.includes('whatsapp')) continue;
      const key = clientKey(tenantId, conn.id);
      desired.add(key);
      if (safeToString(conn.status).toLowerCase() === 'disconnected') {
        // Quando desconectado no painel, garantimos stop do client local.
        // eslint-disable-next-line no-await-in-loop
        await destroyClient(key);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await ensureClient({ tenantId, connection: conn });
    }
  }

  for (const key of Array.from(activeClients.keys())) {
    if (key === '__missing_lib__') continue;
    if (!desired.has(key)) {
      // eslint-disable-next-line no-await-in-loop
      await destroyClient(key);
    }
  }
}

async function startWhatsAppQrBridge() {
  if (started) return { ok: true, alreadyStarted: true };
  if (!isBridgeEnabled()) return { ok: false, skipped: true, reason: 'disabled' };

  started = true;
  const tick = async () => {
    try {
      await syncConnections();
    } catch (err) {
      logger.warn('[WhatsAppQRBridge] Falha no sync (ignorado)', { error: safeErrorMessage(err) });
    }
  };
  await tick();
  syncTimer = setInterval(tick, syncIntervalMs());
  logger.info('[WhatsAppQRBridge] Iniciado', { intervalMs: syncIntervalMs() });
  return { ok: true, started: true };
}

async function stopWhatsAppQrBridge() {
  started = false;
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  for (const key of Array.from(activeClients.keys())) {
    if (key === '__missing_lib__') continue;
    // eslint-disable-next-line no-await-in-loop
    await destroyClient(key);
  }
  activeClients.delete('__missing_lib__');
  return { ok: true };
}

function getWhatsAppQrBridgeStats() {
  return {
    started,
    totalClients: Array.from(activeClients.keys()).filter((k) => k !== '__missing_lib__').length,
    missingLibrary: activeClients.has('__missing_lib__'),
  };
}

module.exports = {
  startWhatsAppQrBridge,
  stopWhatsAppQrBridge,
  getWhatsAppQrBridgeStats,
};
