'use strict';

/**
 * @results/whatsapp-qr-bridge
 *
 * Núcleo de bridge WhatsApp via QR Code (whatsapp-web.js), generalizado a
 * partir do r-agent2 (api/services/whatsappQrBridgeService.js).
 *
 * O pacote NÃO toca banco de dados, tenant_settings, WebSocket ou tickets:
 * tudo isso é responsabilidade do consumidor, que reage aos eventos emitidos
 * (qr/status/ready/message/error) e persiste o que precisar.
 */

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const QR_CODE = require('qrcode');

const STATUS = Object.freeze(['pairing', 'connected', 'ready', 'disconnected', 'error']);

const DEFAULT_SYNC_INTERVAL_MS = 30000;
const DEFAULT_QR_EXPIRES_IN_MS = 2 * 60 * 1000;

/**
 * Workaround para o bug wwebjs#127084: a partir de 2026-06-20 os builds
 * 2.3000.1041xxx+ do WhatsApp Web quebram o whatsapp-web.js — `authenticated`
 * dispara, mas `ready` nunca (loading chega a 100% e trava). O remédio
 * validado é pinar um build anterior à quebra, servido de cache LOCAL (o
 * wa-version poda builds antigos, então `type: 'remote'` daria 404).
 * O HTML pinado fica em `wa-web/<versao>.html` dentro do próprio pacote.
 */
const PINNED_WEB_VERSION = '2.3000.1037753511-alpha';
const WA_WEB_CACHE_DIR = path.join(__dirname, '..', 'wa-web');

/**
 * Resolve as opções `webVersion`/`webVersionCache` para o Client do
 * whatsapp-web.js.
 *   - webVersion undefined        → pin default (PINNED_WEB_VERSION + cache
 *                                   local do pacote);
 *   - webVersion null/false/''    → sem pin (WA Web mais recente; comportamento
 *                                   nativo da lib);
 *   - webVersion '<versao>'       → pin custom; o arquivo `<versao>.html` deve
 *                                   existir em webVersionCacheDir (default:
 *                                   wa-web/ do pacote).
 */
function resolveWebVersionOptions({ webVersion, webVersionCacheDir } = {}) {
  if (webVersion === null || webVersion === false || webVersion === '') return {};
  const version = safeTrim(webVersion) || PINNED_WEB_VERSION;
  const cacheDir = path.resolve(safeTrim(webVersionCacheDir) || WA_WEB_CACHE_DIR);
  return { webVersion: version, webVersionCache: { type: 'local', path: cacheDir } };
}

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

/**
 * Normaliza o destino para o formato do WhatsApp Web: `<digits>@c.us`.
 * Se já contém '@', é devolvido como está (ex.: grupos `<id>@g.us`).
 */
function normalizeDestination(to) {
  const raw = safeTrim(to);
  if (!raw) return null;
  if (raw.includes('@')) return raw;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  return `${digits}@c.us`;
}

function sanitizeClientId(connectionId) {
  return `waqr_${safeToString(connectionId)}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

function extractExternalMessageId(sent) {
  if (!sent || typeof sent !== 'object') return null;
  const candidate = sent?.id?._serialized || sent?.id?.id || sent?.id || null;
  return candidate != null ? safeToString(candidate) : null;
}

/**
 * Remove arquivos de lock do Chrome (SingletonLock etc.) que ficam quando o
 * processo morre abruptamente e impedem nova inicialização do Puppeteer.
 */
function clearChromeLocks(dataPath, clientId, logger) {
  const sessionDir = path.join(dataPath, `session-${clientId}`);
  const locks = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort'];

  const removeIfPresent = (candidatePath) => {
    try {
      // lstat detecta o caminho mesmo quando é symlink quebrado.
      fs.lstatSync(candidatePath);
      fs.unlinkSync(candidatePath);
      logger.info('[whatsapp-qr-bridge] Lock do Chrome removido', { lockPath: candidatePath });
    } catch (_) {}
  };

  for (const lockFile of locks) {
    removeIfPresent(path.join(sessionDir, lockFile));
    removeIfPresent(path.join(sessionDir, 'Default', lockFile));
  }
}

function loadWhatsappWebJs() {
  try {
    // eslint-disable-next-line global-require
    const wa = require('whatsapp-web.js');
    if (!wa || typeof wa.Client !== 'function' || typeof wa.LocalAuth !== 'function') {
      throw new Error('whatsapp-web.js: Client ou LocalAuth não disponível');
    }
    return wa;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      '[whatsapp-qr-bridge] whatsapp-web.js é obrigatório em runtime, mas não foi instalado.\n' +
      'Instale no projeto consumidor com: npm install whatsapp-web.js\n' +
      `Erro: ${msg}`
    );
  }
}

function noopLogger() {
  const noop = () => {};
  return { info: noop, warn: noop, error: noop, debug: noop };
}

function normalizeLogger(logger) {
  const base = noopLogger();
  if (!logger || typeof logger !== 'object') return base;
  for (const level of ['info', 'warn', 'error', 'debug']) {
    if (typeof logger[level] === 'function') base[level] = logger[level].bind(logger);
  }
  return base;
}

/**
 * Factory padrão: cria `new Client` do whatsapp-web.js com LocalAuth.
 * O require é lazy para que testes (com clientFactory injetado) não puxem
 * puppeteer/Chrome.
 */
function defaultClientFactory({ clientId, dataPath, puppeteer, webVersion, webVersionCacheDir }) {
  const wa = loadWhatsappWebJs();
  const { Client, LocalAuth } = wa;
  return new Client({
    authStrategy: new LocalAuth({ clientId, dataPath }),
    puppeteer: puppeteer || {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
    ...resolveWebVersionOptions({ webVersion, webVersionCacheDir }),
  });
}

function createBridge(options = {}) {
  const logger = normalizeLogger(options.logger);
  const authDataPath = path.resolve(safeTrim(options.authDataPath) || '.wwebjs_auth');
  const clientFactory = typeof options.clientFactory === 'function' ? options.clientFactory : defaultClientFactory;
  const qrExpiresInMs = Number.isFinite(Number(options.qrExpiresInMs)) && Number(options.qrExpiresInMs) > 0
    ? Number(options.qrExpiresInMs)
    : DEFAULT_QR_EXPIRES_IN_MS;

  let syncIntervalMs = DEFAULT_SYNC_INTERVAL_MS;
  if (options.syncIntervalMs != null) {
    const n = Number(options.syncIntervalMs);
    syncIntervalMs = Number.isFinite(n) && n >= 0 ? n : DEFAULT_SYNC_INTERVAL_MS;
  }

  const emitter = new EventEmitter();
  // Map<connectionId, entry>
  // entry: { id, sessionPath, clientId, status, client, ready, desiredActive, createdAt, updatedAt }
  const connections = new Map();
  let syncTimer = null;
  let starting = null; // Map<connectionId, Promise> — evita inicializações concorrentes

  function setStatus(entry, status, extra = {}) {
    if (!STATUS.includes(status)) return;
    entry.status = status;
    entry.updatedAt = new Date().toISOString();
    emitter.emit('status', { connectionId: entry.id, status, ...extra });
  }

  function snapshot(entry) {
    return {
      id: entry.id,
      clientId: entry.clientId,
      status: entry.status,
      ready: entry.ready === true,
      sessionPath: entry.sessionPath,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  async function destroyClient(entry) {
    const client = entry.client;
    entry.client = null;
    entry.ready = false;
    if (client && typeof client.destroy === 'function') {
      try { await client.destroy(); } catch (_) {}
    }
  }

  function wireClientEvents(entry, client) {
    client.on('qr', async (qrText) => {
      setStatus(entry, 'pairing');
      let qrDataUrl = null;
      try {
        qrDataUrl = await QR_CODE.toDataURL(safeToString(qrText));
      } catch (err) {
        logger.warn('[whatsapp-qr-bridge] Falha ao gerar data URL do QR', { error: safeErrorMessage(err) });
      }
      emitter.emit('qr', {
        connectionId: entry.id,
        qrText: safeToString(qrText),
        qrDataUrl,
        expiresAt: new Date(Date.now() + qrExpiresInMs).toISOString(),
      });
    });

    client.on('authenticated', () => {
      setStatus(entry, 'connected');
    });

    client.on('ready', () => {
      entry.ready = true;
      setStatus(entry, 'ready');
      // Recuperação de não-lidas é acoplada a tickets e fica fora do núcleo:
      // o consumidor decide o que fazer ao receber este evento.
      emitter.emit('ready', { connectionId: entry.id });
    });

    client.on('disconnected', async (reason) => {
      setStatus(entry, 'disconnected', { reason: reason ? safeToString(reason) : null });
      await destroyClient(entry);
    });

    client.on('auth_failure', (msg) => {
      const error = msg ? safeToString(msg) : 'auth_failure';
      setStatus(entry, 'error', { reason: error });
      emitter.emit('error', { connectionId: entry.id, error });
    });

    client.on('message', (message) => {
      if (message?.fromMe) return;
      emitter.emit('message', {
        connectionId: entry.id,
        from: safeTrim(message?.from || ''),
        body: safeToString(message?.body || ''),
        hasMedia: message?.hasMedia === true,
        raw: message,
      });
    });
  }

  async function startClient(entry) {
    if (entry.client) return { ok: true, alreadyActive: true };
    if (starting && starting.has(entry.id)) return starting.get(entry.id);

    const promise = (async () => {
      const dataPath = path.resolve(entry.sessionPath || authDataPath);
      try { fs.mkdirSync(dataPath, { recursive: true }); } catch (_) {}

      let client;
      try {
        client = clientFactory({
          clientId: entry.clientId,
          dataPath,
          connectionId: entry.id,
          puppeteer: options.puppeteer,
          webVersion: options.webVersion,
          webVersionCacheDir: options.webVersionCacheDir,
        });
      } catch (err) {
        const message = safeErrorMessage(err, 'client_factory_failed');
        setStatus(entry, 'error', { reason: message });
        emitter.emit('error', { connectionId: entry.id, error: message });
        return { ok: false, error: 'client_factory_failed', message };
      }

      wireClientEvents(entry, client);
      // Registra antes do initialize() para que o handler de 'ready' marque ready=true.
      entry.client = client;
      entry.ready = false;
      if (!STATUS.includes(entry.status) || entry.status === 'disconnected' || entry.status === 'error') {
        setStatus(entry, 'pairing');
      }

      try {
        clearChromeLocks(dataPath, entry.clientId, logger);
        await client.initialize();
        logger.info('[whatsapp-qr-bridge] Cliente inicializado', { connectionId: entry.id });
        return { ok: true, started: true };
      } catch (err) {
        const message = safeErrorMessage(err, 'initialize_failed');
        logger.error('[whatsapp-qr-bridge] Falha ao inicializar cliente', { connectionId: entry.id, error: message });
        setStatus(entry, 'error', { reason: message });
        emitter.emit('error', { connectionId: entry.id, error: message });
        await destroyClient(entry);
        return { ok: false, error: 'initialize_failed', message };
      }
    })();

    if (!starting) starting = new Map();
    starting.set(entry.id, promise);
    try {
      return await promise;
    } finally {
      starting.delete(entry.id);
    }
  }

  function requireConnection(id) {
    const connectionId = safeTrim(id);
    const entry = connectionId ? connections.get(connectionId) : null;
    if (!entry) return { ok: false, error: 'not_found' };
    return { ok: true, entry };
  }

  function requireReadyClient(id) {
    const found = requireConnection(id);
    if (!found.ok) return found;
    const { entry } = found;
    if (!entry.client || typeof entry.client.sendMessage !== 'function' || !entry.ready) {
      return { ok: false, error: 'client_not_ready', message: 'Aguardando sessão WhatsApp ficar pronta' };
    }
    return { ok: true, entry, client: entry.client };
  }

  async function syncConnections() {
    for (const entry of connections.values()) {
      if (entry.desiredActive && !entry.client && !(starting && starting.has(entry.id))) {
        // eslint-disable-next-line no-await-in-loop
        await startClient(entry).catch((err) => {
          logger.warn('[whatsapp-qr-bridge] Falha no sync (ignorado)', {
            connectionId: entry.id,
            error: safeErrorMessage(err),
          });
        });
      }
    }
  }

  function ensureSyncTimer() {
    if (syncIntervalMs <= 0 || syncTimer) return;
    syncTimer = setInterval(() => {
      syncConnections().catch((err) => {
        logger.warn('[whatsapp-qr-bridge] Falha no sync (ignorado)', { error: safeErrorMessage(err) });
      });
    }, syncIntervalMs);
    if (typeof syncTimer.unref === 'function') syncTimer.unref();
  }

  const bridge = {
    // Expõe o EventEmitter para o consumidor assinar os eventos.
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    off: emitter.off.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),

    /**
     * Registra uma conexão e inicia o cliente WhatsApp (QR chega via evento 'qr').
     */
    async addConnection({ id, sessionPath } = {}) {
      const connectionId = safeTrim(id);
      if (!connectionId) return { ok: false, error: 'invalid_id' };

      let entry = connections.get(connectionId);
      if (entry) {
        if (sessionPath) entry.sessionPath = path.resolve(safeTrim(sessionPath));
        entry.desiredActive = true;
        const started = await startClient(entry);
        ensureSyncTimer();
        return { ok: started.ok, alreadyRegistered: true, connection: snapshot(entry), ...(started.ok ? {} : { error: started.error, message: started.message }) };
      }

      const now = new Date().toISOString();
      entry = {
        id: connectionId,
        sessionPath: sessionPath ? path.resolve(safeTrim(sessionPath)) : null,
        clientId: sanitizeClientId(connectionId),
        status: 'pairing',
        client: null,
        ready: false,
        desiredActive: true,
        createdAt: now,
        updatedAt: now,
      };
      connections.set(connectionId, entry);
      setStatus(entry, 'pairing');

      const started = await startClient(entry);
      ensureSyncTimer();
      if (!started.ok) {
        return { ok: false, error: started.error, message: started.message, connection: snapshot(entry) };
      }
      return { ok: true, connection: snapshot(entry) };
    },

    /**
     * Remove a conexão do bridge, destruindo o cliente associado.
     */
    async removeConnection(id) {
      const found = requireConnection(id);
      if (!found.ok) return found;
      const { entry } = found;
      entry.desiredActive = false;
      connections.delete(entry.id);
      await destroyClient(entry);
      return { ok: true };
    },

    listConnections() {
      return Array.from(connections.values()).map(snapshot);
    },

    getStatus(id) {
      const found = requireConnection(id);
      if (!found.ok) return found;
      const { entry } = found;
      return {
        ok: true,
        connectionId: entry.id,
        status: entry.status,
        ready: entry.ready === true,
        updatedAt: entry.updatedAt,
      };
    },

    /**
     * Força (re)geração de QR: destrói o cliente atual (se houver) e inicia um
     * novo, o que dispara um novo evento 'qr' do whatsapp-web.js.
     */
    async requestQr(id) {
      const found = requireConnection(id);
      if (!found.ok) return found;
      const { entry } = found;
      entry.desiredActive = true;
      await destroyClient(entry);
      setStatus(entry, 'pairing');
      const started = await startClient(entry);
      ensureSyncTimer();
      if (!started.ok) return { ok: false, error: started.error, message: started.message };
      return { ok: true, pending: true };
    },

    async sendText(id, to, text) {
      const destination = normalizeDestination(to);
      if (!destination) return { ok: false, error: 'invalid_destination' };
      const messageText = safeToString(text);
      if (!safeTrim(messageText)) return { ok: false, error: 'empty_message' };

      const ready = requireReadyClient(id);
      if (!ready.ok) return ready;

      try {
        const sent = await ready.client.sendMessage(destination, messageText);
        return { ok: true, connectionId: ready.entry.id, externalMessageId: extractExternalMessageId(sent) };
      } catch (err) {
        return { ok: false, error: 'qr_send_failed', message: safeErrorMessage(err, 'qr_send_failed') };
      }
    },

    /**
     * Envia mídia. `data` é base64 (string) ou Buffer.
     */
    async sendMedia(id, to, { data, mimeType, fileName, caption } = {}) {
      const destination = normalizeDestination(to);
      if (!destination) return { ok: false, error: 'invalid_destination' };

      const b64 = Buffer.isBuffer(data) ? data.toString('base64') : safeTrim(data);
      if (!b64) return { ok: false, error: 'invalid_media' };
      const mime = safeTrim(mimeType) || 'application/octet-stream';
      const name = safeTrim(fileName) || `media-${Date.now()}`;

      const ready = requireReadyClient(id);
      if (!ready.ok) return ready;

      // Usa MessageMedia do whatsapp-web.js quando disponível; com clientFactory
      // injetado (testes), cai num objeto simples equivalente.
      let media;
      try {
        const wa = loadWhatsappWebJs();
        media = new wa.MessageMedia(mime, b64, name);
      } catch (_) {
        media = { mimetype: mime, data: b64, filename: name };
      }

      const captionText = safeTrim(safeToString(caption));
      const sendOpts = captionText ? { caption: captionText } : undefined;

      try {
        const sent = await ready.client.sendMessage(destination, media, sendOpts);
        return { ok: true, connectionId: ready.entry.id, externalMessageId: extractExternalMessageId(sent) };
      } catch (err) {
        return { ok: false, error: 'qr_send_failed', message: safeErrorMessage(err, 'qr_send_failed') };
      }
    },

    /**
     * Logout + destroy do cliente. A conexão permanece registrada, mas
     * marcada como inativa (o sync periódico não a reinicia).
     */
    async disconnect(id) {
      const found = requireConnection(id);
      if (!found.ok) return found;
      const { entry } = found;
      entry.desiredActive = false;
      const client = entry.client;
      if (client && typeof client.logout === 'function') {
        try { await client.logout(); } catch (_) {}
      }
      await destroyClient(entry);
      setStatus(entry, 'disconnected');
      return { ok: true };
    },

    /**
     * Para o sync periódico e destrói todos os clientes ativos.
     */
    async stop() {
      if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = null;
      }
      for (const entry of connections.values()) {
        entry.desiredActive = false;
        // eslint-disable-next-line no-await-in-loop
        await destroyClient(entry);
      }
      return { ok: true };
    },
  };

  return bridge;
}

module.exports = {
  createBridge,
  normalizeDestination,
  sanitizeClientId,
  resolveWebVersionOptions,
  PINNED_WEB_VERSION,
  WA_WEB_CACHE_DIR,
  STATUS,
};
