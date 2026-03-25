/**
 * WhatsApp QR connections (v1).
 *
 * Armazena conexões via QR (WhatsApp Web / providers externos) em tenant_settings.
 */
'use strict';

const crypto = require('crypto');
const tenantSettingsService = require('./tenantSettingsService');

const SETTINGS_KEY = 'whatsapp_connections';
let emitEventRef = null;

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try {
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function safeTrim(value, fallback = '') {
  const s = safeToString(value, fallback);
  try {
    return s.trim();
  } catch (_) {
    return fallback;
  }
}

function safeTrimLower(value, fallback = '') {
  return safeTrim(value, fallback).toLowerCase();
}

function safeIsoDate(value, fallbackIso) {
  if (!value) return fallbackIso;
  try {
    const d = value instanceof Date ? value : new Date(safeToString(value));
    if (Number.isNaN(d.getTime())) return fallbackIso;
    return d.toISOString();
  } catch (_) {
    return fallbackIso;
  }
}

function normalizeStore(value) {
  const obj = value && typeof value === 'object' ? value : {};
  return {
    connections: Array.isArray(obj.connections) ? obj.connections : [],
  };
}

function normalizeConnection(conn) {
  if (!conn || typeof conn !== 'object') return null;
  return {
    id: safeToString(conn.id || ''),
    name: conn.name ? safeToString(conn.name) : '',
    provider: conn.provider ? safeToString(conn.provider) : 'whatsapp-qr',
    status: conn.status ? safeToString(conn.status) : 'disconnected',
    botEnabled: conn.botEnabled === true,
    botFlowId: conn.botEnabled === true && conn.botFlowId ? safeToString(conn.botFlowId) : null,
    createdAt: conn.createdAt || null,
    updatedAt: conn.updatedAt || null,
    lastQrAt: conn.lastQrAt || null,
    lastConnectedAt: conn.lastConnectedAt || null,
    lastDisconnectedAt: conn.lastDisconnectedAt || null,
    metadata: conn.metadata && typeof conn.metadata === 'object' ? conn.metadata : {},
    qr: conn.qr && typeof conn.qr === 'object' ? conn.qr : null,
  };
}

function hasQrText(conn) {
  return Boolean(safeTrim(conn?.qr?.text || ''));
}

function isTestQrText(qrText) {
  return typeof qrText === 'string' && qrText.startsWith('test:');
}

function generateTestQrText(connectionId, token = '') {
  const t = safeTrim(token);
  const gen = crypto.randomBytes(8).toString('hex');
  return `test:${safeToString(connectionId)}:${t || gen}:${Date.now()}`;
}

function isQrExpired(conn, now = new Date()) {
  const expiresAt = conn?.qr?.expiresAt;
  if (!expiresAt) return false;
  const t = new Date(expiresAt).getTime();
  if (!Number.isFinite(t)) return false;
  return t <= now.getTime();
}

function normalizeStatus(inputStatus) {
  const s = safeTrimLower(inputStatus || '');
  if (s === 'connected') return 'connected';
  if (s === 'pairing') return 'pairing';
  if (s === 'disconnected') return 'disconnected';
  if (s === 'error') return 'error';
  return null;
}

function persistenceRequiredError(reason) {
  return {
    ok: false,
    error: 'persistence_required',
    details: safeToString(reason || 'settings_unavailable', 'settings_unavailable'),
  };
}

function getEmitEvent() {
  if (emitEventRef) return emitEventRef;
  try {
    // Lazy-load para evitar acoplamento de inicializacao e facilitar testes.
    // eslint-disable-next-line global-require
    const websocketService = require('./websocketService');
    emitEventRef = typeof websocketService.emitEvent === 'function' ? websocketService.emitEvent : null;
  } catch (_) {
    emitEventRef = null;
  }
  return emitEventRef;
}

function emitConnectionUpdated(tenantId, connection, context = {}) {
  const emitEvent = getEmitEvent();
  if (!emitEvent || !connection || !connection.id) return;
  try {
    emitEvent('whatsapp.connection.updated', {
      connection,
      context: {
        source: safeToString(context.source || 'whatsappQrService', 'whatsappQrService'),
        action: safeToString(context.action || 'update', 'update'),
        eventType: safeToString(context.eventType || '', ''),
      },
    }, {
      tenantId: safeToString(tenantId),
    });
  } catch (_) {
    // Best-effort: falha de websocket nao deve quebrar persistencia.
  }
}

async function getStore(tenantId) {
  const out = await tenantSettingsService.getSetting({ tenantId, key: SETTINGS_KEY });
  if (!out.ok) {
    return persistenceRequiredError(out.error || 'settings_unavailable');
  }
  if (out.warning) {
    return persistenceRequiredError(out.warning);
  }
  const store = normalizeStore(out.value);
  return { ok: true, store, storage: 'db' };
}

async function saveStore(tenantId, store) {
  const payload = normalizeStore(store);
  const out = await tenantSettingsService.upsertSetting({ tenantId, key: SETTINGS_KEY, value: payload });
  if (!out.ok) {
    return persistenceRequiredError(out.error || 'settings_unavailable');
  }
  if (out.warning) {
    return persistenceRequiredError(out.warning);
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
  const id = input?.id ? safeToString(input.id) : `waconn-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const next = normalizeConnection({
    id,
    name: input?.name ? safeTrim(input.name) : `WhatsApp QR ${out.store.connections.length + 1}`,
    provider: input?.provider ? safeTrim(input.provider) : 'whatsapp-qr',
    status: input?.status ? safeToString(input.status) : 'disconnected',
    botEnabled: input?.botEnabled === true,
    botFlowId: input?.botEnabled === true && input?.botFlowId ? safeToString(input.botFlowId) : null,
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
  emitConnectionUpdated(tenantId, next, { action: 'create' });
  return { ok: true, connection: next, connections: saved.store.connections.map(normalizeConnection).filter(Boolean) };
}

async function updateConnection(tenantId, connectionId, input) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const idx = out.store.connections.findIndex((c) => c && safeToString(c.id) === safeToString(connectionId));
  if (idx < 0) return { ok: false, error: 'not_found' };

  const prev = normalizeConnection(out.store.connections[idx]);
  const now = new Date().toISOString();
  const next = normalizeConnection({
    ...prev,
    name: input?.name != null ? safeTrim(input.name) : prev.name,
    provider: input?.provider != null ? safeTrim(input.provider) : prev.provider,
    botEnabled: input?.botEnabled === true,
    botFlowId: input?.botEnabled === true && input?.botFlowId ? safeToString(input.botFlowId) : null,
    updatedAt: now,
    metadata: input?.metadata && typeof input.metadata === 'object'
      ? { ...prev.metadata, ...input.metadata }
      : prev.metadata,
  });
  out.store.connections[idx] = next;
  const saved = await saveStore(tenantId, out.store);
  if (!saved.ok) return saved;
  emitConnectionUpdated(tenantId, next, { action: 'update' });
  return { ok: true, connection: next };
}

async function deleteConnection(tenantId, connectionId) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const idx = out.store.connections.findIndex((c) => c && safeToString(c.id) === safeToString(connectionId));
  if (idx < 0) return { ok: false, error: 'not_found' };
  out.store.connections.splice(idx, 1);
  const saved = await saveStore(tenantId, out.store);
  if (!saved.ok) return saved;
  return { ok: true };
}

async function generateQr(tenantId, connectionId) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const idx = out.store.connections.findIndex((c) => c && safeToString(c.id) === safeToString(connectionId));
  if (idx < 0) return { ok: false, error: 'not_found' };

  const prev = normalizeConnection(out.store.connections[idx]);
  const now = new Date();

  // Reuse existing valid provider QR (not a test QR) if still valid
  if (hasQrText(prev) && !isTestQrText(prev.qr.text) && !isQrExpired(prev, now)) {
    return {
      ok: true,
      connection: prev,
      qr: prev.qr,
      pending: false,
      isTestQr: false,
    };
  }

  // Set status to pairing so the bridge knows to generate a real QR
  const next = normalizeConnection({
    ...prev,
    status: 'pairing',
    updatedAt: now.toISOString(),
    lastQrAt: now.toISOString(),
    qr: null,
  });
  out.store.connections[idx] = next;
  const saved = await saveStore(tenantId, out.store);
  if (!saved.ok) return saved;
  emitConnectionUpdated(tenantId, next, { action: 'generate_qr' });
  return {
    ok: true,
    connection: next,
    qr: null,
    pending: true,
    isTestQr: false,
  };
}

async function disconnectConnection(tenantId, connectionId) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const idx = out.store.connections.findIndex((c) => c && safeToString(c.id) === safeToString(connectionId));
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
  emitConnectionUpdated(tenantId, next, { action: 'disconnect' });
  return { ok: true, connection: next };
}

async function setConnectionStatus(tenantId, connectionId, input = {}) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const idx = out.store.connections.findIndex((c) => c && safeToString(c.id) === safeToString(connectionId));
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
  const normalized = normalizeConnection(out.store.connections[idx]);
  emitConnectionUpdated(tenantId, normalized, { action: 'status', eventType: status });
  return { ok: true, connection: normalized };
}

async function ingestConnectionEvent(tenantId, connectionId, input = {}) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const idx = out.store.connections.findIndex((c) => c && safeToString(c.id) === safeToString(connectionId));
  if (idx < 0) return { ok: false, error: 'not_found' };

  const eventType = safeTrimLower(input?.eventType || input?.type || '');
  if (!eventType) return { ok: false, error: 'event_type_required' };

  const prev = normalizeConnection(out.store.connections[idx]) || {};
  const now = new Date();
  const nowIso = now.toISOString();
  const metadataPatch = input?.metadata && typeof input.metadata === 'object' ? input.metadata : {};
  const previousMetadata = prev.metadata && typeof prev.metadata === 'object' ? { ...prev.metadata } : {};

  // Limpa marcadores transitórios de fallback/erro quando o provider emite eventos normais.
  if (eventType === 'qr' || eventType === 'pairing' || eventType === 'connected' || eventType === 'ready' || eventType === 'disconnected' || eventType === 'logout' || eventType === 'closed') {
    delete previousMetadata.reason;
    delete previousMetadata.code;
    delete previousMetadata.phase;
    delete previousMetadata.errorCode;
  }

  const next = {
    ...prev,
    updatedAt: nowIso,
    metadata: {
      ...previousMetadata,
      ...metadataPatch,
      lastProviderEventType: eventType,
      lastProviderEventAt: nowIso,
    },
  };

  if (eventType === 'qr' || eventType === 'pairing') {
    const qrText = input?.qr?.text != null ? safeTrim(input.qr.text) : '';
    const token = input?.qr?.token != null ? safeTrim(input.qr.token) : '';
    const expiresAtRaw = input?.qr?.expiresAt || input?.qr?.expires_at || null;
    const expiresAt = safeIsoDate(expiresAtRaw, new Date(now.getTime() + 2 * 60 * 1000).toISOString());
    next.status = 'pairing';
    next.lastQrAt = nowIso;
    next.qr = {
      text: qrText || (prev.qr && prev.qr.text ? prev.qr.text : ''),
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
  const normalized = normalizeConnection(out.store.connections[idx]);
  emitConnectionUpdated(tenantId, normalized, { action: 'ingest_event', eventType });
  return { ok: true, connection: normalized };
}

async function getStatus(tenantId, connectionId) {
  const out = await getStore(tenantId);
  if (!out.ok) return out;
  const conn = out.store.connections.find((c) => c && safeToString(c.id) === safeToString(connectionId));
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

module.exports = {
  listConnections,
  createConnection,
  updateConnection,
  deleteConnection,
  generateQr,
  disconnectConnection,
  setConnectionStatus,
  ingestConnectionEvent,
  getStatus,
};
