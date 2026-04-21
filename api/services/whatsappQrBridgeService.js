'use strict';

const fs = require('fs');
const path = require('path');

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
const { resolveOrCreateTicketFromIncomingMessage, appendTicketMessage } = require('./conversationTicketLinkService');
const { storeTicketMedia, getTicketMediaById } = require('./ticketMediaService');
const { emitEvent } = require('./websocketService');
const { resolveRuntimePath } = require('../utils/runtimePaths');

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

function resolveWwebjsAuthPath() {
  const explicit = safeTrim(process.env.WWEBJS_AUTH_PATH || '');
  if (explicit) return path.resolve(explicit);

  const runtimeDefault = '/var/lib/ragent2/whatsapp/auth';
  try {
    if (fs.existsSync('/var/lib/ragent2')) return path.resolve(runtimeDefault);
  } catch (_) {}

  return resolveRuntimePath('whatsapp', 'auth');
}

function sanitizeClientId(tenantId, connectionId) {
  return `ria_${safeToString(tenantId)}_${safeToString(connectionId)}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

function loadWhatsappWebJs() {
  try {
    // eslint-disable-next-line global-require,import/no-extraneous-dependencies
    const wa = require('whatsapp-web.js');
    if (!wa || typeof wa.Client !== 'function' || typeof wa.LocalAuth !== 'function') {
      throw new Error('whatsapp-web.js: Cliente ou LocalAuth não disponível');
    }
    return wa;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      '[WhatsAppQRBridge] whatsapp-web.js é obrigatório mas não foi instalado ou está corrompido.\n' +
      'Instale com: npm install whatsapp-web.js\n' +
      `Erro: ${msg}`
    );
  }
}

function resolveConfiguredExecutablePath() {
  const explicitPath = safeTrim(
    process.env.WHATSAPP_QR_PUPPETEER_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || ''
  );
  if (explicitPath) return explicitPath;

  try {
    // eslint-disable-next-line global-require,import/no-extraneous-dependencies
    const puppeteer = require('puppeteer');
    if (puppeteer && typeof puppeteer.executablePath === 'function') {
      const resolved = safeTrim(puppeteer.executablePath());
      if (resolved) return resolved;
    }
  } catch (_) {}

  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];

  return candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch (_) {
      return false;
    }
  }) || '';
}

function classifyInitializeFailure(err) {
  const message = safeErrorMessage(err);
  const normalized = safeToString(message).toLowerCase();

  if (normalized.includes('browser is already running') || normalized.includes('singletonlock')) {
    return {
      error: 'bridge_chrome_lock',
      message: 'Chrome lock file detectado — removendo na próxima tentativa.',
    };
  }

  if (
    normalized.includes('could not find chrome') ||
    normalized.includes('could not find chromium') ||
    normalized.includes('browser was not found')
  ) {
    return {
      error: 'bridge_browser_missing',
      message: 'Chrome do Puppeteer nao encontrado. Instale com: npx puppeteer browsers install chrome ou configure WHATSAPP_QR_PUPPETEER_EXECUTABLE_PATH.',
    };
  }

  return {
    error: 'bridge_initialize_failed',
    message,
  };
}

/**
 * Remove arquivos de lock do Chrome (SingletonLock, SingletonSocket) que ficam
 * quando o processo crasheia abruptamente, impedindo nova inicialização.
 */
function clearChromeLocks(clientId) {
  const wwebjsAuthDir = resolveWwebjsAuthPath();
  const sessionDir = path.join(wwebjsAuthDir, `session-${clientId}`);
  const locks = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort'];

  const removeIfPresent = (candidatePath) => {
    try {
      // lstat detecta caminho mesmo quando e symlink quebrado.
      fs.lstatSync(candidatePath);
      fs.unlinkSync(candidatePath);
      logger.info('[WhatsAppQRBridge] Lock Chrome removido', { lockPath: candidatePath });
    } catch (_) {}
  };

  for (const lockFile of locks) {
    removeIfPresent(path.join(sessionDir, lockFile));
    removeIfPresent(path.join(sessionDir, 'Default', lockFile));
  }
}

function buildPuppeteerOptions() {
  const noSandbox = safeToString(process.env.WHATSAPP_QR_PUPPETEER_NO_SANDBOX || 'true', 'true').toLowerCase() !== 'false';
  const options = {
    headless: true,
    args: noSandbox
      ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      : ['--disable-dev-shm-usage'],
  };

  const executablePath = resolveConfiguredExecutablePath();
  if (executablePath) {
    options.executablePath = executablePath;
  }

  return options;
}

function normalizeWhatsAppDestination(to) {
  const raw = safeTrim(to);
  if (!raw) return null;
  if (raw.includes('@')) return raw;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  return `${digits}@c.us`;
}

function normalizeInboundConversationId(from) {
  const raw = safeTrim(from);
  if (!raw) return null;
  return raw
    .replace(/@c\.us$/i, '')
    .replace(/@g\.us$/i, '')
    .replace(/@lid$/i, '')
    .replace(/@s\.whatsapp\.net$/i, '');
}

function normalizeInboundText(message) {
  const body = safeToString(message?.body || '').trim();
  if (body) return body;

  const type = safeTrim(message?.type || message?._data?.type || '').toLowerCase();
  const labels = {
    image: 'imagem',
    video: 'video',
    audio: 'audio',
    ptt: 'audio',
    document: 'documento',
    sticker: 'sticker',
    location: 'localizacao',
    contact_card: 'contato',
    contacts_array: 'contatos',
  };
  const mediaLabel = labels[type] || '';
  if (!mediaLabel) return null;
  return `[${mediaLabel}]`;
}

function extractInboundSenderName(message) {
  const candidates = [
    message?._data?.notifyName,
    message?._data?.pushname,
    message?.notifyName,
  ];
  for (const candidate of candidates) {
    const normalized = safeTrim(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function extractExternalMessageId(sent) {
  if (!sent || typeof sent !== 'object') return null;
  const candidate =
    sent?.id?._serialized
    || sent?.id?.id
    || sent?.id
    || sent?.ack
    || null;
  return candidate != null ? safeToString(candidate) : null;
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

async function processInboundMessage({ tenantId, connectionId, message, source = 'live' }) {
  try {
    logger.debug('[WhatsAppQRBridge] Mensagem recebida (raw)', {
      fromMe: message?.fromMe,
      from: message?.from,
      body: message?.body?.substring?.(0, 50),
      type: message?.type,
      source,
    });

    if (message?.fromMe) {
      logger.debug('[WhatsAppQRBridge] Mensagem ignorada (fromMe=true)');
      return { ok: true, skipped: 'from_me' };
    }

    const from = safeTrim(message?.from || '');
    const externalConversationId = normalizeInboundConversationId(from);
    if (!externalConversationId) {
      logger.warn('[WhatsAppQRBridge] Nao conseguiu extrair conversation ID de:', { from, source });
      return { ok: false, skipped: 'invalid_from' };
    }

    const text = normalizeInboundText(message);
    if (!text) {
      logger.debug('[WhatsAppQRBridge] Mensagem sem conteudo util, ignorando', {
        type: safeTrim(message?.type || message?._data?.type || '').toLowerCase(),
        from: externalConversationId,
        source,
      });
      return { ok: true, skipped: 'empty_or_unsupported_content' };
    }

    logger.info('[WhatsAppQRBridge] Processando mensagem inbound', {
      from: externalConversationId,
      text: text.substring(0, 100),
      tenantId,
      source,
    });

    const externalMessageId = safeToString(message?.id?._serialized || message?.id || '').trim() || null;
    const ts = Number(message?.timestamp);
    const timestamp = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString();

    const senderName = extractInboundSenderName(message);
    const link = await resolveOrCreateTicketFromIncomingMessage(
      tenantId,
      'whatsapp',
      externalConversationId,
      { phone: externalConversationId, name: senderName }
    ).catch((err) => {
      logger.warn('[WhatsAppQRBridge] Erro ao criar/resolver ticket', {
        from: externalConversationId,
        error: safeErrorMessage(err),
        source,
      });
      return null;
    });

    const ticket = link?.ticket || null;
    if (!ticket || !ticket.id) {
      logger.warn('[WhatsAppQRBridge] Ticket nao criado/resolvido', {
        from: externalConversationId,
        linkOk: link?.ok,
        source,
      });
      return { ok: false, skipped: 'ticket_not_found' };
    }

    // Tenta baixar e persistir mídia anexada (imagem, vídeo, áudio, documento)
    let mediaFields = null;
    const msgType = safeTrim(message?.type || message?._data?.type || '').toLowerCase();
    const hasDownloadableMedia = message?.hasMedia
      && ['image', 'video', 'audio', 'ptt', 'document', 'sticker'].includes(msgType);

    if (hasDownloadableMedia) {
      try {
        const media = await message.downloadMedia();
        if (media && media.data) {
          const buffer = Buffer.from(media.data, 'base64');
          const mimeType = media.mimetype || 'application/octet-stream';
          const fileName = media.filename || `${msgType}-${Date.now()}`;
          const stored = await storeTicketMedia({
            tenantId: ticket.tenantId,
            fileName,
            mimeType,
            sizeBytes: buffer.length,
            buffer,
            createdBy: 'whatsapp-bridge',
          });
          const frontendType = msgType === 'ptt' ? 'audio'
            : msgType === 'sticker' ? 'image'
            : msgType;
          mediaFields = {
            mediaUrl: `/tickets/media/${encodeURIComponent(stored.id)}`,
            mediaType: frontendType,
            mimeType: stored.mimeType,
            fileName: stored.fileName,
          };
          logger.info('[WhatsAppQRBridge] Mídia inbound armazenada', {
            mediaId: stored.id,
            mimeType: stored.mimeType,
            sizeBytes: stored.sizeBytes,
          });
        }
      } catch (mediaErr) {
        logger.warn('[WhatsAppQRBridge] Falha ao baixar mídia inbound, salvando apenas texto', {
          error: mediaErr?.message || String(mediaErr),
          msgType,
        });
      }
    }

    const updatedTicket = appendTicketMessage(ticket.id, {
      direction: 'in',
      text,
      externalMessageId,
      timestamp,
      ...(mediaFields || {}),
    }) || ticket;

    try {
      emitEvent('ticket.message.received', {
        ticketId: updatedTicket.id,
        message: text,
        sender: 'user',
        ticket: updatedTicket,
      }, { tenantId: updatedTicket.tenantId, agentId: updatedTicket.assignedTo });
    } catch (eventErr) {
      logger.warn('[WhatsAppQRBridge] Erro ao emitir evento', { error: safeErrorMessage(eventErr) });
    }

    return { ok: true, ticketId: updatedTicket.id, externalMessageId };
  } catch (err) {
    logger.warn('[WhatsAppQRBridge] Falha ao processar mensagem inbound', {
      tenantId,
      connectionId,
      error: safeErrorMessage(err),
      source,
    });
    return { ok: false, error: safeErrorMessage(err) };
  }
}

async function recoverRecentInboundMessages({ tenantId, connectionId, client }) {
  if (!client || typeof client.getChats !== 'function') return;

  let recovered = 0;
  try {
    const chats = await client.getChats();
    const unreadChats = (Array.isArray(chats) ? chats : [])
      .filter((chat) => Number(chat?.unreadCount || 0) > 0)
      .slice(0, 20);

    for (const chat of unreadChats) {
      if (!chat || typeof chat.fetchMessages !== 'function') continue;
      const unreadCount = Number(chat.unreadCount || 0);
      const limit = Math.min(Math.max(unreadCount, 1) + 5, 50);
      // eslint-disable-next-line no-await-in-loop
      const messages = await chat.fetchMessages({ limit }).catch(() => []);
      const ordered = (Array.isArray(messages) ? messages : [])
        .filter((msg) => !msg?.fromMe)
        .sort((a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0));

      for (const msg of ordered) {
        // eslint-disable-next-line no-await-in-loop
        const out = await processInboundMessage({ tenantId, connectionId, message: msg, source: 'ready_sync' });
        if (out?.ok) recovered += 1;
      }
    }

    if (recovered > 0) {
      logger.info('[WhatsAppQRBridge] Mensagens recuperadas no ready', {
        tenantId,
        connectionId,
        recovered,
      });
    }
  } catch (err) {
    logger.warn('[WhatsAppQRBridge] Falha na recuperacao de mensagens no ready', {
      tenantId,
      connectionId,
      error: safeErrorMessage(err),
    });
  }
}

async function ensureClient({ tenantId, connection }) {
  const key = clientKey(tenantId, connection.id);
  if (activeClients.has(key)) return { ok: true, alreadyActive: true };

  const wa = loadWhatsappWebJs(); // Lança erro se não instalada

  const { Client, LocalAuth } = wa;
  const clientId = sanitizeClientId(tenantId, connection.id);
  const authPath = resolveWwebjsAuthPath();
  try { fs.mkdirSync(authPath, { recursive: true }); } catch (_) {}
  const client = new Client({
    authStrategy: new LocalAuth({ clientId, dataPath: authPath }),
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
    const entry = activeClients.get(key);
    if (entry) entry.ready = true;
    try {
      await ingestConnectionEvent(tenantId, connection.id, {
        eventType: 'ready',
        metadata: { bridge: 'whatsapp-web.js' },
      });
    } catch (_) {}
    await recoverRecentInboundMessages({ tenantId, connectionId: connection.id, client });
  });

  client.on('authenticated', async () => {
    try {
      await ingestConnectionEvent(tenantId, connection.id, {
        eventType: 'connected',
        metadata: { bridge: 'whatsapp-web.js', phase: 'authenticated' },
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

  client.on('message', async (message) => {
    await processInboundMessage({ tenantId, connectionId: connection.id, message, source: 'live' });
  });

  // Registra antes de initialize() para que o handler de 'ready' consiga marcar ready=true.
  // O campo ready=false impede envios até o evento 'ready' disparar.
  activeClients.set(key, { tenantId, connectionId: connection.id, client, ready: false, createdAt: new Date().toISOString() });

  try {
    clearChromeLocks(clientId);
    await client.initialize();
    logger.info('[WhatsAppQRBridge] Cliente inicializado', { tenantId, connectionId: connection.id });
    return { ok: true, started: true };
  } catch (err) {
    const failure = classifyInitializeFailure(err);
    logger.error('[WhatsAppQRBridge] Falha ao inicializar cliente', {
      tenantId,
      connectionId: connection.id,
      error: failure.message,
      code: failure.error,
    });
    await ingestConnectionEvent(tenantId, connection.id, {
      eventType: 'error',
      metadata: { reason: failure.message, bridge: 'whatsapp-web.js', code: failure.error },
    }).catch(() => null);
    activeClients.delete(key);
    try { await client.destroy(); } catch (_) {}
    return { ok: false, error: failure.error, message: failure.message };
  }
}

async function requestConnectionQr(tenantId, connectionId) {
  const listed = await listConnections(tenantId);
  if (!listed.ok) {
    return { ok: false, error: listed.error || 'settings_unavailable' };
  }

  const connection = (Array.isArray(listed.connections) ? listed.connections : []).find((item) => (
    item && safeToString(item.id) === safeToString(connectionId)
  ));

  if (!connection) {
    return { ok: false, error: 'not_found' };
  }

  const provider = safeToString(connection.provider || 'whatsapp-qr', 'whatsapp-qr').toLowerCase();
  if (!provider.includes('whatsapp')) {
    return { ok: false, error: 'unsupported_provider' };
  }

  return ensureClient({ tenantId, connection });
}

async function sendTextViaConnection({ tenantId, to, text, connectionId = null } = {}) {
  const tenant = safeTrim(tenantId);
  if (!tenant) return { ok: false, error: 'invalid_tenant' };

  const destination = normalizeWhatsAppDestination(to);
  if (!destination) return { ok: false, error: 'invalid_destination' };

  const messageText = safeToString(text);
  if (!safeTrim(messageText)) return { ok: false, error: 'empty_message' };

  const listed = await listConnections(tenant);
  if (!listed.ok) {
    return { ok: false, error: listed.error || 'connections_unavailable' };
  }

  const allConnections = Array.isArray(listed.connections) ? listed.connections : [];
  const whatsappConnections = allConnections.filter((conn) => {
    const provider = safeToString(conn?.provider || 'whatsapp-qr', 'whatsapp-qr').toLowerCase();
    return provider.includes('whatsapp');
  });

  let connection = null;
  const explicitConnectionId = safeTrim(connectionId);
  if (explicitConnectionId) {
    connection = whatsappConnections.find((conn) => safeToString(conn?.id) === explicitConnectionId) || null;
    if (!connection) return { ok: false, error: 'connection_not_found' };
  } else {
    connection = whatsappConnections.find((conn) => safeToString(conn?.status).toLowerCase() === 'connected')
      || whatsappConnections[0]
      || null;
    if (!connection) return { ok: false, error: 'connection_not_found' };
  }

  const key = clientKey(tenant, connection.id);
  const ensured = await ensureClient({ tenantId: tenant, connection });
  if (!ensured?.ok) {
    return { ok: false, error: ensured?.error || 'bridge_not_ready', message: ensured?.message || null };
  }

  const entry = activeClients.get(key);
  const client = entry?.client;
  if (!client || typeof client.sendMessage !== 'function') {
    return { ok: false, error: 'client_not_ready' };
  }
  if (!entry.ready) {
    // Browser inicializado mas WhatsApp ainda não autenticou (ready ainda não disparou).
    return { ok: false, error: 'client_not_ready', message: 'Aguardando sessão WhatsApp ficar pronta' };
  }

  try {
    const sent = await client.sendMessage(destination, messageText);
    return {
      ok: true,
      connectionId: safeToString(connection.id),
      externalMessageId: extractExternalMessageId(sent),
    };
  } catch (err) {
    return {
      ok: false,
      error: 'qr_send_failed',
      message: safeErrorMessage(err, 'qr_send_failed'),
    };
  }
}

async function sendMediaViaConnection({ tenantId, to, mediaId, mimeType, fileName, caption = '', connectionId = null } = {}) {
  const tenant = safeTrim(tenantId);
  if (!tenant) return { ok: false, error: 'invalid_tenant' };

  const destination = normalizeWhatsAppDestination(to);
  if (!destination) return { ok: false, error: 'invalid_destination' };

  if (!safeTrim(safeToString(mediaId))) return { ok: false, error: 'invalid_media_id' };

  const listed = await listConnections(tenant);
  if (!listed.ok) {
    return { ok: false, error: listed.error || 'connections_unavailable' };
  }

  const allConnections = Array.isArray(listed.connections) ? listed.connections : [];
  const whatsappConnections = allConnections.filter((conn) => {
    const provider = safeToString(conn?.provider || 'whatsapp-qr', 'whatsapp-qr').toLowerCase();
    return provider.includes('whatsapp');
  });

  let connection = null;
  const explicitConnectionId = safeTrim(connectionId);
  if (explicitConnectionId) {
    connection = whatsappConnections.find((conn) => safeToString(conn?.id) === explicitConnectionId) || null;
    if (!connection) return { ok: false, error: 'connection_not_found' };
  } else {
    connection = whatsappConnections.find((conn) => safeToString(conn?.status).toLowerCase() === 'connected')
      || whatsappConnections[0]
      || null;
    if (!connection) return { ok: false, error: 'connection_not_found' };
  }

  const key = clientKey(tenant, connection.id);
  const ensured = await ensureClient({ tenantId: tenant, connection });
  if (!ensured?.ok) {
    return { ok: false, error: ensured?.error || 'bridge_not_ready', message: ensured?.message || null };
  }

  const entry = activeClients.get(key);
  const client = entry?.client;
  if (!client || typeof client.sendMessage !== 'function') {
    return { ok: false, error: 'client_not_ready' };
  }
  if (!entry.ready) {
    return { ok: false, error: 'client_not_ready', message: 'Aguardando sessão WhatsApp ficar pronta' };
  }

  try {
    // Lê blob da DB — null = sem filtro de tenant (bridge tem acesso cross-tenant)
    const mediaRecord = await getTicketMediaById(safeToString(mediaId), null);
    if (!mediaRecord?.data) return { ok: false, error: 'media_not_found' };

    const mime = safeTrim(mimeType) || safeToString(mediaRecord.mimeType) || 'application/octet-stream';
    const name = safeTrim(fileName) || safeToString(mediaRecord.fileName) || safeToString(mediaId);
    const b64 = Buffer.isBuffer(mediaRecord.data)
      ? mediaRecord.data.toString('base64')
      : Buffer.from(mediaRecord.data).toString('base64');

    const wa = loadWhatsappWebJs();
    const msgMedia = new wa.MessageMedia(mime, b64, name);

    const captionText = safeTrim(safeToString(caption));
    const sendOpts = captionText ? { caption: captionText } : undefined;

    const sent = await client.sendMessage(destination, msgMedia, sendOpts);
    return {
      ok: true,
      connectionId: safeToString(connection.id),
      externalMessageId: extractExternalMessageId(sent),
    };
  } catch (err) {
    return {
      ok: false,
      error: 'qr_send_failed',
      message: safeErrorMessage(err, 'qr_send_failed'),
    };
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
  logger.info('[WhatsAppQRBridge] Iniciando...');
  if (started) {
    logger.info('[WhatsAppQRBridge] Já estava iniciado');
    return { ok: true, alreadyStarted: true };
  }

  started = true;
  const tick = async () => {
    try {
      await syncConnections();
    } catch (err) {
      logger.warn('[WhatsAppQRBridge] Falha no sync (ignorado)', { error: safeErrorMessage(err) });
    }
  };
  try {
    logger.info('[WhatsAppQRBridge] Executando primeiro sync...');
    await tick();
    logger.info('[WhatsAppQRBridge] Primeiro sync completado');
  } catch (err) {
    logger.warn('[WhatsAppQRBridge] Erro no primeiro sync', { error: safeErrorMessage(err) });
  }
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
  requestConnectionQr,
  sendTextViaConnection,
  sendMediaViaConnection,
  startWhatsAppQrBridge,
  stopWhatsAppQrBridge,
  getWhatsAppQrBridgeStats,
};
