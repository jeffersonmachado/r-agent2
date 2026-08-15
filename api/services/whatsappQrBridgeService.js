'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Bridge opcional para provedores WhatsApp QR (ex.: whatsapp-web.js).
 *
 * Adaptador fino sobre o pacote compartilhado `@results/whatsapp-qr-bridge`
 * (../../packages/whatsapp-qr-bridge): o pacote gerencia o ciclo de vida dos
 * clientes whatsapp-web.js (multi-conexão, QR, status, envio de texto, sync de
 * locks); este serviço mantém tudo que é específico do r-agent2:
 * - persistência em tenant_settings (via whatsappQrService.ingestConnectionEvent);
 * - inbound → tickets/mídia/WebSocket;
 * - recuperação de mensagens não-lidas no ready;
 * - reconciliação periódica contra tenant_settings (sync do pacote desligado);
 * - resolução de Chrome/puppeteer e clientId/sessão no formato legado.
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

// Instância do bridge do pacote (criada lazy, no primeiro uso).
let bridgeRef = null;
// key (`tenantId:connectionId`) → { tenantId, connectionId, client, ready, createdAt }
const activeClients = new Map();
// key → { tenantId, connectionId } — resolve o connectionId plano do pacote
// de volta para o par tenant/conexão do r-agent2.
const connectionRefs = new Map();
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
      // puppeteer.executablePath() pode apontar para um Chrome nunca baixado
      // (ex.: npm ci sem download de browser). Só aceitar se o binário existir,
      // senão cair nos candidatos do sistema.
      if (resolved && fs.existsSync(resolved)) return resolved;
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
function clearChromeLocks(clientId, dataPath) {
  const wwebjsAuthDir = dataPath || resolveWwebjsAuthPath();
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
  activeClients.delete(key);
  if (!bridgeRef) return;
  try {
    // removeConnection faz destroy sem logout — mesmo efeito do destroy local
    // que o adaptador sempre fez; o pacote não a reinicia (sync dele desligado).
    await bridgeRef.removeConnection(key);
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

/**
 * clientFactory injetada no pacote: o require('whatsapp-web.js') precisa
 * resolver a partir do node_modules do r-agent2 (o path real do pacote
 * instalado via file: fica fora do node_modules e não acharia a lib), e o
 * clientId/dataPath precisam manter o formato legado (`ria_<tenant>_<conn>`)
 * para reutilizar as sessões já pareadas em disco.
 */
function bridgeClientFactory({ dataPath, connectionId, webVersion, webVersionCacheDir, userAgent }) {
  const wa = loadWhatsappWebJs();
  const { Client, LocalAuth } = wa;
  // eslint-disable-next-line global-require
  const { resolveWebVersionOptions } = require('@results/whatsapp-qr-bridge');
  const ref = connectionRefs.get(connectionId) || {};
  const clientId = sanitizeClientId(ref.tenantId, ref.connectionId);
  clearChromeLocks(clientId, dataPath);
  const client = new Client({
    authStrategy: new LocalAuth({ clientId, dataPath }),
    // O default do whatsapp-web.js é 30s (authTimeoutMs): em container com
    // CPU limitada o boot+injeção do WA Web passa disso e o pareamento morre
    // em "auth timeout" antes de gerar o QR.
    authTimeoutMs: 120000,
    // userAgent resolvido pelo bridge (default: UA real do Chrome — o spoof
    // nativo da lib, Chrome 101/macOS 10.14, derruba a sessão minutos após
    // o pareamento desde o endurecimento anti-automação da Meta).
    ...(userAgent !== undefined ? { userAgent } : {}),
    puppeteer: buildPuppeteerOptions(),
    // Pin do build do WA Web (workaround wwebjs#127084): undefined → default
    // do pacote; null → latest. Configurável via WHATSAPP_QR_WEB_VERSION.
    ...resolveWebVersionOptions({ webVersion, webVersionCacheDir, dataPath }),
  });
  activeClients.set(connectionId, {
    tenantId: ref.tenantId,
    connectionId: ref.connectionId,
    client,
    ready: false,
    createdAt: new Date().toISOString(),
  });
  return client;
}

// Handlers de eventos do pacote → ingest em tenant_settings (mesmos payloads
// de antes; `dataUrl` é aditivo no evento de QR).
async function handleBridgeQr({ connectionId, qrText, qrDataUrl, expiresAt }) {
  const ref = connectionRefs.get(connectionId);
  if (!ref) return;
  try {
    await ingestConnectionEvent(ref.tenantId, ref.connectionId, {
      eventType: 'qr',
      qr: {
        text: safeToString(qrText),
        token: '',
        expiresAt: safeTrim(expiresAt) || new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        dataUrl: safeToString(qrDataUrl),
      },
      metadata: { bridge: 'whatsapp-web.js' },
    });
  } catch (_) {}
}

async function handleBridgeStatus({ connectionId, status, reason }) {
  const ref = connectionRefs.get(connectionId);
  if (!ref) return;
  // 'ready' e 'error' têm eventos próprios no pacote (ingeridos lá); 'pairing'
  // é coberto pelo evento 'qr'. Aqui só connected/disconnected, para não
  // duplicar ingest.
  try {
    if (status === 'connected') {
      await ingestConnectionEvent(ref.tenantId, ref.connectionId, {
        eventType: 'connected',
        metadata: { bridge: 'whatsapp-web.js', phase: 'authenticated' },
      });
    } else if (status === 'disconnected') {
      try {
        await ingestConnectionEvent(ref.tenantId, ref.connectionId, {
          eventType: 'disconnected',
          metadata: { reason: reason ? safeToString(reason) : null, bridge: 'whatsapp-web.js' },
        });
      } catch (_) {}
      activeClients.delete(connectionId);
    }
  } catch (_) {}
}

async function handleBridgeReady({ connectionId }) {
  const ref = connectionRefs.get(connectionId);
  if (!ref) return;
  const entry = activeClients.get(connectionId);
  if (entry) entry.ready = true;
  try {
    await ingestConnectionEvent(ref.tenantId, ref.connectionId, {
      eventType: 'ready',
      metadata: { bridge: 'whatsapp-web.js' },
    });
  } catch (_) {}
  await recoverRecentInboundMessages({ tenantId: ref.tenantId, connectionId: ref.connectionId, client: entry?.client });
}

async function handleBridgeMessage({ connectionId, raw }) {
  const ref = connectionRefs.get(connectionId);
  if (!ref || !raw) return;
  await processInboundMessage({ tenantId: ref.tenantId, connectionId: ref.connectionId, message: raw, source: 'live' });
}

async function handleBridgeError({ connectionId, error }) {
  const ref = connectionRefs.get(connectionId);
  if (!ref) return;
  const failure = classifyInitializeFailure(error);
  try {
    await ingestConnectionEvent(ref.tenantId, ref.connectionId, {
      eventType: 'error',
      metadata: { reason: failure.message, bridge: 'whatsapp-web.js', code: failure.error },
    });
  } catch (_) {}
}

function getBridge() {
  if (bridgeRef) return bridgeRef;
  // Lazy: o pacote exige `qrcode` no carregamento; adiar o require evita
  // quebrar o boot/módulos consumidores se a dependência faltar.
  // eslint-disable-next-line global-require
  const { createBridge } = require('@results/whatsapp-qr-bridge');
  const bridge = createBridge({
    authDataPath: resolveWwebjsAuthPath(),
    // Reconciliação contra tenant_settings fica no adaptador (syncConnections);
    // o sync interno do pacote fica desligado para não haver dois reconciliadores.
    syncIntervalMs: 0,
    clientFactory: bridgeClientFactory,
    // undefined → pin default do pacote; 'latest' → null (sem pin).
    webVersion: (() => {
      const raw = safeTrim(process.env.WHATSAPP_QR_WEB_VERSION || '');
      if (!raw) return undefined;
      return raw.toLowerCase() === 'latest' ? null : raw;
    })(),
    // undefined/'auto' → UA real do Chrome (resolvido no pacote);
    // 'default' → spoof nativo da lib; outra string → usada como está.
    userAgent: safeTrim(process.env.WHATSAPP_QR_USER_AGENT || '') || undefined,
    logger: {
      info: (msg, extra) => logger.info(msg, extra),
      warn: (msg, extra) => logger.warn(msg, extra),
      error: (msg, extra) => logger.error(msg, extra),
      debug: (msg, extra) => logger.debug(msg, extra),
    },
  });
  // Listeners síncronos que despacham handlers async — nunca propagam exceção
  // para o EventEmitter do pacote.
  bridge.on('qr', (evt) => { handleBridgeQr(evt).catch(() => {}); });
  bridge.on('status', (evt) => { handleBridgeStatus(evt).catch(() => {}); });
  bridge.on('ready', (evt) => { handleBridgeReady(evt).catch(() => {}); });
  bridge.on('message', (evt) => { handleBridgeMessage(evt).catch(() => {}); });
  bridge.on('error', (evt) => { handleBridgeError(evt).catch(() => {}); });
  bridgeRef = bridge;
  return bridge;
}

async function ensureClient({ tenantId, connection }) {
  const key = clientKey(tenantId, connection.id);
  connectionRefs.set(key, { tenantId: safeToString(tenantId), connectionId: safeToString(connection.id) });

  const existing = activeClients.get(key);
  if (existing && existing.client) return { ok: true, alreadyActive: true };

  loadWhatsappWebJs(); // Lança erro se não instalada

  const added = await getBridge().addConnection({ id: key });
  if (!added?.ok) {
    const failure = classifyInitializeFailure(added?.message || added?.error);
    logger.error('[WhatsAppQRBridge] Falha ao inicializar cliente', {
      tenantId,
      connectionId: connection.id,
      error: failure.message,
      code: failure.error,
    });
    // O pacote já destruiu o cliente; limpa o registro local (o evento 'error'
    // do pacote já foi ingerido pelo listener).
    activeClients.delete(key);
    return { ok: false, error: failure.error, message: failure.message };
  }

  logger.info('[WhatsAppQRBridge] Cliente inicializado', { tenantId, connectionId: connection.id });
  return { ok: true, started: true };
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

  const sent = await getBridge().sendText(key, destination, messageText);
  if (!sent?.ok) {
    return {
      ok: false,
      error: sent?.error || 'qr_send_failed',
      message: sent?.message || null,
    };
  }
  return {
    ok: true,
    connectionId: safeToString(connection.id),
    externalMessageId: sent.externalMessageId || null,
  };
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

    // MessageMedia construído aqui (não via pacote): o require('whatsapp-web.js')
    // do pacote falha em instalação file: (path real fora do node_modules) e o
    // fallback de objeto simples não é reconhecido como mídia pelo Client.
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

  const knownKeys = new Set(activeClients.keys());
  if (bridgeRef) {
    for (const conn of bridgeRef.listConnections()) knownKeys.add(conn.id);
  }
  for (const key of Array.from(knownKeys)) {
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
  if (bridgeRef) {
    try { await bridgeRef.stop(); } catch (_) {}
    bridgeRef = null;
  }
  activeClients.clear();
  connectionRefs.clear();
  return { ok: true };
}

function getWhatsAppQrBridgeStats() {
  return {
    started,
    totalClients: activeClients.size,
    missingLibrary: false,
  };
}

module.exports = {
  requestConnectionQr,
  sendTextViaConnection,
  sendMediaViaConnection,
  startWhatsAppQrBridge,
  stopWhatsAppQrBridge,
  getWhatsAppQrBridgeStats,
  resolveConfiguredExecutablePath,
};
