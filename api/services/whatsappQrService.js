/**
 * WhatsApp QR connections (v1).
 *
 * Armazena conexões via QR (WhatsApp Web / providers externos) em tenant_settings.
 */
'use strict';

const crypto = require('crypto');
const tenantSettingsService = require('./tenantSettingsService');

const SETTINGS_KEY = 'whatsapp_connections';
const memoryStoreByTenant = new Map();

function normalizeStore(value) {
  const obj = value && typeof value === 'object' ? value : {};
  return {
    connections: Array.isArray(obj.connections) ? obj.connections : [],
  };
}

function normalizeConnection(conn) {
  if (!conn || typeof conn !== 'object') return null;
  return {
    id: String(conn.id || ''),
    name: conn.name ? String(conn.name) : '',
    label: conn.label ? String(conn.label) : '',
    provider: conn.provider ? String(conn.provider) : 'whatsapp-qr',
    status: conn.status ? String(conn.status) : 'disconnected',
    createdAt: conn.createdAt || null,
    updatedAt: conn.updatedAt || null,
    lastQrAt: conn.lastQrAt || null,
    lastConnectedAt: conn.lastConnectedAt || null,
    lastDisconnectedAt: conn.lastDisconnectedAt || null,
    metadata: conn.metadata && typeof conn.metadata === 'object' ? conn.metadata : {},
    qr: conn.qr && typeof conn.qr === 'object' ? conn.qr : null,
  };
}

function isQrExpired(conn, now = new Date()) {
  const expiresAt = conn?.qr?.expiresAt;
  if (!expiresAt) return false;
  const t = new Date(expiresAt).getTime();
  if (!Number.isFinite(t)) return false;
  return t <= now.getTime();
}

function normalizeStatus(inputStatus) {
  const s = String(inputStatus || '').trim().toLowerCase();
  if (s === 'connected') return 'connected';
  if (s === 'pairing') return 'pairing';
  if (s === 'disconnected') return 'disconnected';
  if (s === 'error') return 'error';
  return null;
}

async function getStore(tenantId) {
  const out = await tenantSettingsService.getSetting({ tenantId, key: SETTINGS_KEY });
  if (!out.ok) {
    const mem = memoryStoreByTenant.get(String(tenantId)) || { connections: [] };
    return {
      ok: true,
      store: normalizeStore(mem),
      storage: 'memory',
      warning: out.error || 'settings_unavailable',
    };
  }
  const store = normalizeStore(out.value);
  return { ok: true, store, storage: 'db' };
}

async function saveStore(tenantId, store) {
  const payload = normalizeStore(store);
  const out = await tenantSettingsService.upsertSetting({ tenantId, key: SETTINGS_KEY, value: payload });
  if (!out.ok) {
    memoryStoreByTenant.set(String(tenantId), payload);
    return {
      ok: true,
      store: normalizeStore(payload),
      storage: 'memory',
      warning: out.error || 'settings_unavailable',
    };
  }
  const nextStore = normalizeStore(out.value);
  return { ok: true, store: nextStore, storage: 'db' };
}

async function listConnections(tenantId) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const now = new Date();
  const connections = out.store.connections.map(normalizeConnection).filter(Boolean).map((conn) => {
    if (conn.status === 'pairing' && isQrExpired(conn, now)) {
      return { ...conn, status: 'disconnected', qr: null };
    }
    return conn;
  });
  return { ok: true, connections };
}

async function createConnection(tenantId, input) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const now = new Date().toISOString();
  const id = input?.id ? String(input.id) : `waqr-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const next = normalizeConnection({
    id,
    name: input?.name ? String(input.name).trim() : `WhatsApp QR ${out.store.connections.length + 1}`,
    label: input?.label ? String(input.label).trim() : '',
    provider: input?.provider ? String(input.provider).trim() : 'whatsapp-qr',
    status: input?.status ? String(input.status) : 'disconnected',
    createdAt: now,
    updatedAt: now,
    metadata: input?.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  });
  const existingIndex = out.store.connections.findIndex((c) => c && c.id === id);
  if (existingIndex >= 0) {
    out.store.connections[existingIndex] = { ...out.store.connections[existingIndex], ...next };
  } else {
    out.store.connections.push(next);
  }
  const saved = await saveStore(tenantId, out.store);
  if (!saved.ok) return saved;
  return { ok: true, connection: next, connections: saved.store.connections.map(normalizeConnection).filter(Boolean) };
}

async function generateQr(tenantId, connectionId) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const idx = out.store.connections.findIndex((c) => c && String(c.id) === String(connectionId));
  if (idx < 0) return { ok: false, error: 'not_found' };
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60 * 1000).toISOString();
  const token = crypto.randomBytes(12).toString('hex');
  const qrText = `waqr:${connectionId}:${token}`;
  const next = normalizeConnection({
    ...out.store.connections[idx],
    status: 'pairing',
    updatedAt: now.toISOString(),
    lastQrAt: now.toISOString(),
    qr: {
      text: qrText,
      token,
      expiresAt,
    },
  });
  out.store.connections[idx] = next;
  const saved = await saveStore(tenantId, out.store);
  if (!saved.ok) return saved;
  return { ok: true, connection: next, qr: next.qr };
}

async function disconnectConnection(tenantId, connectionId) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const idx = out.store.connections.findIndex((c) => c && String(c.id) === String(connectionId));
  if (idx < 0) return { ok: false, error: 'not_found' };
  const now = new Date().toISOString();
  const next = normalizeConnection({
    ...out.store.connections[idx],
    status: 'disconnected',
    updatedAt: now,
    lastDisconnectedAt: now,
    qr: null,
  });
  out.store.connections[idx] = next;
  const saved = await saveStore(tenantId, out.store);
  if (!saved.ok) return saved;
  return { ok: true, connection: next };
}

async function setConnectionStatus(tenantId, connectionId, input = {}) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const idx = out.store.connections.findIndex((c) => c && String(c.id) === String(connectionId));
  if (idx < 0) return { ok: false, error: 'not_found' };

  const status = normalizeStatus(input?.status);
  if (!status) return { ok: false, error: 'invalid_status' };

  const prev = normalizeConnection(out.store.connections[idx]) || {};
  const nowIso = new Date().toISOString();
  const next = {
    ...prev,
    status,
    updatedAt: nowIso,
    metadata: {
      ...(prev.metadata || {}),
      ...(input?.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
    },
  };
  if (status === 'connected') {
    next.lastConnectedAt = nowIso;
    next.qr = null;
  } else if (status === 'disconnected') {
    next.lastDisconnectedAt = nowIso;
    next.qr = null;
  }
  out.store.connections[idx] = normalizeConnection(next);
  const saved = await saveStore(tenantId, out.store);
  if (!saved.ok) return saved;

  const connection = normalizeConnection(out.store.connections[idx]);

  // Notifica o frontend em tempo real (evita precisar dar refresh na página)
  // Import aqui para minimizar risco de dependência circular.
  try {
    // eslint-disable-next-line global-require
    const WebSocketService = require('./websocketService');
    WebSocketService.emitEvent(tenantId, 'whatsapp.connection.updated', { connection });
  } catch (e) {
    // Não quebra o fluxo se websocket não estiver ativo
  }

  return { ok: true, connection };
}

async function ingestConnectionEvent(tenantId, connectionId, input = {}) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const idx = out.store.connections.findIndex((c) => c && String(c.id) === String(connectionId));
  if (idx < 0) return { ok: false, error: 'not_found' };

  const eventType = String(input?.eventType || input?.type || '').trim().toLowerCase();
  if (!eventType) return { ok: false, error: 'event_type_required' };

  const prev = normalizeConnection(out.store.connections[idx]) || {};
  const now = new Date();
  const nowIso = now.toISOString();
  const metadataPatch = input?.metadata && typeof input.metadata === 'object' ? input.metadata : {};
  const next = {
    ...prev,
    updatedAt: nowIso,
    metadata: {
      ...(prev.metadata || {}),
      ...metadataPatch,
      lastProviderEventType: eventType,
      lastProviderEventAt: nowIso,
    },
  };

  if (eventType === 'qr' || eventType === 'pairing') {
    const qrText = input?.qr?.text != null ? String(input.qr.text).trim() : '';
    const token = input?.qr?.token != null ? String(input.qr.token).trim() : '';
    const expiresAtRaw = input?.qr?.expiresAt || input?.qr?.expires_at || null;
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw).toISOString() : new Date(now.getTime() + 2 * 60 * 1000).toISOString();
    next.status = 'pairing';
    next.lastQrAt = nowIso;
    next.qr = {
      text: qrText || (prev.qr && prev.qr.text ? prev.qr.text : `waqr:${connectionId}:${token || now.getTime()}`),
      token: token || (prev.qr && prev.qr.token ? prev.qr.token : ''),
      expiresAt,
    };
  } else if (eventType === 'connected' || eventType === 'ready') {
    next.status = 'connected';
    next.lastConnectedAt = nowIso;
    next.qr = null;
  } else if (eventType === 'disconnected' || eventType === 'logout' || eventType === 'closed') {
    next.status = 'disconnected';
    next.lastDisconnectedAt = nowIso;
    next.qr = null;
  } else if (eventType === 'error' || eventType === 'failed') {
    next.status = 'error';
    next.qr = null;
  } else {
    return { ok: false, error: 'invalid_event_type' };
  }

  out.store.connections[idx] = normalizeConnection(next);
  const saved = await saveStore(tenantId, out.store);
  if (!saved.ok) return saved;
  const connection = normalizeConnection(out.store.connections[idx]);

  // Notifica o frontend em tempo real (ex.: página de conexões QR)
  try {
    // eslint-disable-next-line global-require
    const WebSocketService = require('./websocketService');
    WebSocketService.emitEvent('whatsapp.connection.updated', { connection }, { tenantId });
  } catch (e) {
    // Não deve quebrar o fluxo se websocket não estiver ativo
  }

  return { ok: true, connection };
}

async function getStatus(tenantId, connectionId) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const conn = out.store.connections.find((c) => c && String(c.id) === String(connectionId));
  if (!conn) return { ok: false, error: 'not_found' };
  const normalized = normalizeConnection(conn);
  const expired = normalized.status === 'pairing' && isQrExpired(normalized);
  const effectiveStatus = expired ? 'disconnected' : normalized.status;
  return {
    ok: true,
    status: effectiveStatus,
    connectionId: normalized.id,
    updatedAt: normalized.updatedAt,
    lastQrAt: normalized.lastQrAt,
    lastConnectedAt: normalized.lastConnectedAt,
    lastDisconnectedAt: normalized.lastDisconnectedAt,
    qr: normalized.qr && !expired ? { expiresAt: normalized.qr.expiresAt } : null,
  };
}

async function removeConnection(tenantId, connectionId) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const idx = out.store.connections.findIndex((c) => c && String(c.id) === String(connectionId));
  if (idx < 0) return { ok: false, error: 'not_found' };
  out.store.connections.splice(idx, 1);
  const saved = await saveStore(tenantId, out.store);
  if (!saved.ok) return saved;
  return { ok: true };
}

module.exports = {
  listConnections,
  createConnection,
  generateQr,
  disconnectConnection,
  setConnectionStatus,
  ingestConnectionEvent,
  getStatus,
  removeConnection,
};
