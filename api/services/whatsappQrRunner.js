// whatsappQrRunner.js - Gerencia sessões Baileys para WhatsApp QR (com reconexão + status syncing)
'use strict';

const path = require('path');
const fs = require('fs-extra');
const EventEmitter = require('events');
const { Boom } = require('@hapi/boom');
const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

const channelGatewayService = require('./channelGatewayService');
const { handleWhatsAppInbound } = require('./whatsappInboundService');
const channelNormalizationService = require('./channelNormalizationService');
const whatsappQrService = require('./whatsappQrService');
const logger = require('../utils/logger');

function jsonSafe(obj) {
  try {
    const s = JSON.stringify(obj);
    if (typeof s === 'string' && s.length > 5000) return s.slice(0, 5000) + '...[truncated]';
    return s;
  } catch (_) { return '[unserializable]'; }
}

function safeKeys(obj) {
  try { return obj && typeof obj === 'object' ? Object.keys(obj) : []; } catch (_) { return []; }
}

function logSockEvent(logger, baseCtx, eventName, payload, level = 'info') {
  const entry = {
    ...baseCtx,
    event: eventName,
    payloadKeys: safeKeys(payload),
    payload,
  };

  const line = `[WA_QR_EVT] ${jsonSafe(entry)}`;
  if (level === 'debug') return logger.debug(line);
  if (level === 'warn') return logger.warn(line);
  if (level === 'error') return logger.error(line);
  return logger.info(line);
}

function unwrapMessageContainer(messageObj) {
  // Baileys pode entregar mensagens embrulhadas (ephemeral/viewOnce/etc.)
  let m = messageObj || {};
  // ephemeral
  if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
  // view once
  if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
  if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
  if (m.viewOnceMessageV2Extension?.message) m = m.viewOnceMessageV2Extension.message;
  return m || {};
}

function extractTextFromBaileysMessage(messageObj) {
  const m = unwrapMessageContainer(messageObj);
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    // respostas de botões/listas (WhatsApp nativo)
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    m.listResponseMessage?.title ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    m.templateButtonReplyMessage?.selectedId ||
    // alguns cenários de mensagem interativa
    m.interactiveResponseMessage?.body?.text ||
    null
  );
}

class WhatsAppQrRunner extends EventEmitter {
  static MAX_QR_ATTEMPTS = 5; // Limite máximo antes de parar reconexões automáticas
  static CONFLICT_RESTART_COOLDOWN_MS = 15000; // Evita restart storm após conflitos em sequência
  static UNAUTHORIZED_RESTART_COOLDOWN_MS = 15000; // Evita loop agressivo quando WhatsApp devolve 401

  constructor({ sessionsDir, inboundDepsProvider = null }) {
    super();
    this.sessionsDir = sessionsDir;
    this.inboundDepsProvider = typeof inboundDepsProvider === 'function' ? inboundDepsProvider : null;
    this.sessions = new Map();    // key: tenantId:connectionId
    this.sessionMeta = new Map(); // key: tenantId:connectionId -> { status, ... }
    this.sessionTimers = new Map(); // key -> { reconnectTimer, promoteConnectedTimer }
    this.startingSessions = new Map(); // key -> Promise da inicialização em andamento
    // callbacks pendentes de QR (para atender múltiplas chamadas concorrentes ao endpoint /qr)
    this.qrWaiters = new Map(); // key -> Set<Function(qrText)>
    this.recentConflicts = new Map(); // key -> timestamp of last conflict (para diagnosticar erros de envio)
    this.recentUnauthorized = new Map(); // key -> timestamp of last 401 unauthorized

    // Log de boot do módulo para garantir visibilidade de carregamento
    try {
      logger.info('WA_QR_BOOT', 'WhatsAppQrRunner inicializado', {
        sessionsDir: this.sessionsDir,
        logFile: logger._getLogFilePath?.(),
        logToFile: logger._isLogToFileEnabled?.(),
        nodeEnv: process.env.NODE_ENV,
      });
    } catch (_) {}
  }

  setInboundDepsProvider(provider) {
    this.inboundDepsProvider = typeof provider === 'function' ? provider : null;
  }

  getSessionKey(tenantId, connectionId) {
    return `${tenantId}:${connectionId}`;
  }

  getSessionPath(tenantId, connectionId) {
    return path.join(this.sessionsDir, tenantId, connectionId);
  }

  _clearTimers(sessionKey) {
    const timers = this.sessionTimers.get(sessionKey);
    if (!timers) return;
    if (timers.reconnectTimer) clearTimeout(timers.reconnectTimer);
    if (timers.promoteConnectedTimer) clearTimeout(timers.promoteConnectedTimer);
    this.sessionTimers.delete(sessionKey);
  }

  _addQrWaiter(sessionKey, cb) {
    if (!cb) return;
    const set = this.qrWaiters.get(sessionKey) || new Set();
    set.add(cb);
    this.qrWaiters.set(sessionKey, set);
  }

  _flushQrWaiters(sessionKey, qrText) {
    const set = this.qrWaiters.get(sessionKey);
    if (!set || set.size === 0) return;
    this.qrWaiters.delete(sessionKey);
    for (const cb of set) {
      try { cb(qrText); } catch (_) {}
    }
  }

  /**
   * Retorna o último QR em cache (se existir e estiver “fresco”).
   * Útil para evitar trabalho pesado quando o frontend chama /qr várias vezes.
   */
  getCachedQr(tenantId, connectionId, maxAgeMs = 15000) {
    const sessionKey = this.getSessionKey(tenantId, connectionId);
    const meta = this.sessionMeta.get(sessionKey);
    if (!meta?.lastQr) return null;
    const ts = meta.lastQrAt || meta.updatedAt || 0;
    if (!ts) return null;
    if (Date.now() - ts > maxAgeMs) return null;
    return meta.lastQr;
  }

  /**
   * Garante que há uma sessão rodando (não derruba socket existente).
   * Se já existe socket ativo, apenas registra o waiter do QR.
   */
  async ensureSession(tenantId, connectionId, onQr, options = {}) {
    const sessionKey = this.getSessionKey(tenantId, connectionId);
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      // Se já temos QR em cache, entrega imediatamente.
      const cached = this.getCachedQr(tenantId, connectionId, options.qrCacheMs ?? 15000);
      if (cached && onQr) {
        try { onQr(cached); } catch (_) {}
        return existing;
      }
      // Senão, registra waiter e retorna.
      this._addQrWaiter(sessionKey, onQr);
      return existing;
    }
    return this.startSession(tenantId, connectionId, onQr, options);
  }

  async startSession(tenantId, connectionId, onQr, options = {}) {
    const sessionKey = this.getSessionKey(tenantId, connectionId);
    const sessionPath = this.getSessionPath(tenantId, connectionId);

    const reset = options.reset === true;

    const inFlight = this.startingSessions.get(sessionKey);
    if (inFlight) {
      const cached = this.getCachedQr(tenantId, connectionId, options.qrCacheMs ?? 15000);
      if (cached && onQr) {
        try { onQr(cached); } catch (_) {}
      } else {
        this._addQrWaiter(sessionKey, onQr);
      }
      return inFlight;
    }

    const existing = this.sessions.get(sessionKey);
    if (existing && !reset) {
      const cached = this.getCachedQr(tenantId, connectionId, options.qrCacheMs ?? 15000);
      if (cached && onQr) {
        try { onQr(cached); } catch (_) {}
      } else {
        this._addQrWaiter(sessionKey, onQr);
      }
      return existing;
    }

    let resolveStart;
    let rejectStart;
    const startPromise = new Promise((resolve, reject) => {
      resolveStart = resolve;
      rejectStart = reject;
    });
    this.startingSessions.set(sessionKey, startPromise);
    // Mantém callback(s) de QR pendentes mesmo se a sessão for reiniciada internamente (ex.: reset após 401).
    this._addQrWaiter(sessionKey, onQr);

    try {

    // Log obrigatório: chamada do startSession
    try {
      logger.info('WA_QR_START', 'startSession chamado (MAX_ATTEMPTS=' + WhatsAppQrRunner.MAX_QR_ATTEMPTS + ')', {
        tenantId,
        connectionId,
        sessionKey,
        sessionPath,
        reset,
        maxAttemptsLimit: WhatsAppQrRunner.MAX_QR_ATTEMPTS,
        options: { ...options, onQr: !!onQr },
      });
    } catch (_) {}

    // Observação: NÃO derrubamos socket existente aqui.
    // startSession é usado para criar a sessão se ela não existir;
    // quem quer “resetar” deve passar { reset: true }.

    // Se reset explícito, remove credenciais para forçar QR novo
    if (reset) {
      try { await fs.remove(sessionPath); } catch (_) {}
    }
    await fs.ensureDir(sessionPath);

    // meta inicial
    const meta = this.sessionMeta.get(sessionKey) || {
      status: 'connecting',
      lastQr: null,
      lastQrAt: null,
      lastDisconnectCode: null,
      lastError: null,
      updatedAt: Date.now(),
	      name: null,
      user: null,
      reconnectAttempts: 0,
      lastConnectedAt: null,
    };
    if (options?.name) meta.name = options.name;
    meta.status = 'connecting';
    meta.updatedAt = Date.now();
    meta.reconnectAttempts = 0; // Reset contador ao iniciar nova sessão
    this.sessionMeta.set(sessionKey, meta);
    this._clearTimers(sessionKey);

    // ajuda o /status (store) refletir o estado real
    try {
      await whatsappQrService.ingestConnectionEvent(tenantId, connectionId, { eventType: 'connecting' });
    } catch (_) {}

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const connect = () => {
      let sock;
      try {
        sock = makeWASocket({
          version,
          auth: state,
          printQRInTerminal: false,
          browser: ['Ubuntu', 'Chrome', '120.0'],
          getMessage: async () => undefined,
        });
      } catch (err) {
        // Log melhorado: captura informações do erro de forma robusta
        const errorDetails = {
          tenantId,
          connectionId,
          sessionKey,
          baileysVersion: version,
          message: err?.message,
          code: err?.code,
          name: err?.name,
          stack: err?.stack,
          boomOutput: err?.output ? { statusCode: err.output.statusCode, payload: err.output.payload } : null,
          raw: String(err),
        };
        logger.error('WA_QR_SOCKET', 'Falha ao criar socket Baileys', errorDetails);
        throw err;
      }

      this.sessions.set(sessionKey, sock);

      // Confirmação de que o socket foi criado e listeners serão registrados
      try {
        logger.info('WA_QR_SOCKET', 'Socket Baileys criado', {
          tenantId,
          connectionId,
          sessionKey,
          baileysVersion: version,
        });
      } catch (_) {}

      // === LOG DE TODOS OS EVENTOS DO BAILEYS (QR) ===
      const baseCtx = { tenantId, connectionId, sessionKey };
      const allEvents = [
        'connection.update',
        'creds.update',
        'messaging-history.set',
        'messages.upsert',
        'messages.update',
        'messages.delete',
        'chats.set',
        'chats.upsert',
        'chats.update',
        'contacts.set',
        'contacts.upsert',
        'contacts.update',
        'presence.update',
        'groups.update',
        'group-participants.update',
        'blocklist.set',
        'blocklist.update',
        'call',
        'labels.association',
        'labels.edit',
      ];

      // Catch-all: processa QUALQUER evento emitido pelo Baileys (garantia)
      // Isso garante que, mesmo que surjam novos eventos, eles serão logados.
      // IMPORTANTE: Não usar ev.on + ev.process ao mesmo tempo para não duplicar eventos no log.
      try {
        sock.ev.process(async (events) => {
          try {
            for (const [eventName, evPayload] of Object.entries(events || {})) {
              logSockEvent(logger, baseCtx, eventName, evPayload, 'info');
            }
          } catch (_) {}
        });
        logger.info('WA_QR_LISTEN', 'Listeners do Baileys registrados (process)', {
          tenantId,
          connectionId,
          sessionKey,
          totalExplicit: allEvents.length,
        });
      } catch (err) {
        logger.error('WA_QR_LISTEN', 'Falha ao registrar sock.ev.process (catch-all)', {
          tenantId,
          connectionId,
          sessionKey,
          err,
        });
      }

      const persistCredsSafely = async () => {
        try {
          await saveCreds();
        } catch (err) {
          // Corrige corrida quando a pasta da sessão é removida durante shutdown/restart.
          if (err?.code === 'ENOENT') {
            try {
              await fs.ensureDir(sessionPath);
              await saveCreds();
              return;
            } catch (retryErr) {
              logger.warn('WA_QR_CREDS_SAVE_RETRY_FAILED', 'Falha ao persistir creds após recriar pasta da sessão', {
                tenantId,
                connectionId,
                sessionKey,
                message: retryErr?.message || String(retryErr),
                code: retryErr?.code || null,
              });
              return;
            }
          }

          logger.warn('WA_QR_CREDS_SAVE_FAILED', 'Falha ao persistir creds.update', {
            tenantId,
            connectionId,
            sessionKey,
            message: err?.message || String(err),
            code: err?.code || null,
          });
        }
      };
      sock.ev.on('creds.update', persistCredsSafely);

      // Quando o history sync terminar, promovemos para "connected"
      sock.ev.on('messaging-history.set', () => {
        const now = Date.now();
        const m = this.sessionMeta.get(sessionKey);
        if (!m) return;
        m.status = 'connected';
        m.updatedAt = now;
        m.user = sock.user || m.user || null;

        try {
          whatsappQrService.ingestConnectionEvent(tenantId, connectionId, {
            eventType: 'ready',
            metadata: { phase: 'history_sync_done' },
          });
        } catch (_) {}

        this.emit('status', { tenantId, connectionId, status: 'connected', user: m.user });
      });

      sock.ev.on('connection.update', async (update) => {
        const now = Date.now();
        const m = this.sessionMeta.get(sessionKey) || meta;

        // QR
        if (update.qr) {
          m.lastQr = update.qr;
          m.lastQrAt = now;
          m.status = 'qr';
          m.updatedAt = now;
          this.sessionMeta.set(sessionKey, m);

          try {
            whatsappQrService.ingestConnectionEvent(tenantId, connectionId, {
              eventType: 'qr',
              qr: {
                text: update.qr,
                expiresAt: new Date(now + 2 * 60 * 1000).toISOString(),
              },
            });
          } catch (_) {}

          // atende quaisquer waiters pendentes (várias requisições concorrentes)
          this._flushQrWaiters(sessionKey, update.qr);
        }

        if (update.connection === 'open') {
          // OPEN != pronto. Aqui entramos em "syncing" até terminar o history sync.
          m.status = 'syncing';
          m.lastQr = null;
          m.updatedAt = now;
          m.user = sock.user || null;
          m.lastConnectedAt = now;
          m.reconnectAttempts = 0;
          this.sessionMeta.set(sessionKey, m);

          try {
            whatsappQrService.ingestConnectionEvent(tenantId, connectionId, {
              eventType: 'syncing',
              metadata: { phase: 'awaiting_initial_sync' },
            });
          } catch (_) {}

          this.emit('status', { tenantId, connectionId, status: 'syncing', user: m.user });

          // fallback: se o evento messaging-history.set não vier (alguns cenários), promove após 25s
          const timers = this.sessionTimers.get(sessionKey) || {};
          if (timers.promoteConnectedTimer) clearTimeout(timers.promoteConnectedTimer);
          timers.promoteConnectedTimer = setTimeout(() => {
            const mm = this.sessionMeta.get(sessionKey);
            const s = this.sessions.get(sessionKey);
            if (!mm || !s) return;
            if (mm.status === 'syncing') {
              mm.status = 'connected';
              mm.updatedAt = Date.now();
              mm.user = s.user || mm.user || null;
              this.sessionMeta.set(sessionKey, mm);

              try {
                whatsappQrService.ingestConnectionEvent(tenantId, connectionId, {
                  eventType: 'ready',
                  metadata: { phase: 'timeout_promote_connected' },
                });
              } catch (_) {}

              this.emit('status', { tenantId, connectionId, status: 'connected', user: mm.user });
            }
          }, 25000);
          this.sessionTimers.set(sessionKey, timers);
        }

        if (update.connection === 'close') {
          const err = update?.lastDisconnect?.error;
          const code = err instanceof Boom ? err.output?.statusCode : err?.output?.statusCode;
          const reason = update?.lastDisconnect?.reason ?? null;
          const disconnectMessage =
            err?.output?.payload?.message ||
            err?.message ||
            reason ||
            null;

          m.status = 'disconnected';
          m.lastDisconnectCode = code ?? null;
          m.lastError = disconnectMessage;
          m.updatedAt = now;
          this.sessionMeta.set(sessionKey, m);

          this.emit('status', { tenantId, connectionId, status: 'disconnected', reason, code });

          try {
            whatsappQrService.ingestConnectionEvent(tenantId, connectionId, {
              eventType: 'disconnected',
              metadata: { code: code ?? null, reason: reason ?? null },
            });
          } catch (_) {}

          // unauthorized (401) -> credenciais locais inválidas/corrompidas; força reset do auth state e novo QR
          const isUnauthorized401 =
            code === 401 ||
            disconnectMessage?.includes?.('Unauthorized') ||
            disconnectMessage?.includes?.('Connection Failure');
          if (isUnauthorized401) {
            const unauthorizedAt = Date.now();
            const previousUnauthorizedAt = this.recentUnauthorized.get(sessionKey) || 0;
            const elapsedSincePreviousUnauthorized = unauthorizedAt - previousUnauthorizedAt;
            this.recentUnauthorized.set(sessionKey, unauthorizedAt);
            setTimeout(() => this.recentUnauthorized.delete(sessionKey), 5 * 60 * 1000);

            logger.warn('WA_QR_UNAUTHORIZED_RESET', '401 detectado no handshake; resetando auth state para gerar novo QR limpo', {
              tenantId,
              connectionId,
              sessionKey,
              code,
              reason,
              disconnectMessage,
              elapsedSincePreviousUnauthorized,
              timestamp: new Date().toISOString(),
            });

            this._clearTimers(sessionKey);
            this.sessions.delete(sessionKey);
            this.sessionMeta.delete(sessionKey);

            if (elapsedSincePreviousUnauthorized > 0 && elapsedSincePreviousUnauthorized < WhatsAppQrRunner.UNAUTHORIZED_RESTART_COOLDOWN_MS) {
              logger.warn('WA_QR_UNAUTHORIZED_COOLDOWN', '401 repetido em curto intervalo; suprimindo auto-restart para evitar loop', {
                tenantId,
                connectionId,
                sessionKey,
                elapsedSincePreviousUnauthorized,
                cooldownMs: WhatsAppQrRunner.UNAUTHORIZED_RESTART_COOLDOWN_MS,
              });
              return;
            }

            setTimeout(() => {
              try {
                this.startSession(tenantId, connectionId, null, { reset: true });
              } catch (restartErr) {
                logger.error('WA_QR_UNAUTHORIZED_RESTART_ERROR', 'Erro ao reiniciar sessão após 401', {
                  tenantId,
                  connectionId,
                  error: restartErr?.message || String(restartErr),
                });
              }
            }, 1000);
            return;
          }

          // loggedOut -> apaga credenciais e não reconecta
          if (code === DisconnectReason.loggedOut) {
            this._clearTimers(sessionKey);
            this.sessions.delete(sessionKey);
            this.sessionMeta.delete(sessionKey);
            return;
          }

          // conflict (440) -> conta conectada em outro local, limpa sessão e força novo login
          if (code === 440 || reason === 'conflict' || disconnectMessage?.includes?.('conflict')) {
            const conflictAt = Date.now();
            const previousConflictAt = this.recentConflicts.get(sessionKey) || 0;
            const elapsedSincePreviousConflict = conflictAt - previousConflictAt;

            logger.error('WA_QR_CONFLICT_DETECTED', 'DETECTADO: Sua conta WhatsApp está conectada em outro dispositivo/local. Gerando novo QR code para reconectar...', {
              tenantId,
              connectionId,
              sessionKey,
              code,
              reason,
              elapsedSincePreviousConflict,
              timestamp: new Date().toISOString(),
            });
            
            // Registra o conflito recente para diagnóstico
            this.recentConflicts.set(sessionKey, conflictAt);
            // Limpa registro de conflito após 5 minutos (para não bloquear indefinidamente)
            setTimeout(() => this.recentConflicts.delete(sessionKey), 5 * 60 * 1000);
            
            // Emite evento para UI saber que precisa novo QR
            this.emit('conflict', { tenantId, connectionId, message: 'Conta conectada em outro lugar. Novo QR code gerado.' });
            
            this._clearTimers(sessionKey);
            this.sessions.delete(sessionKey);
            this.sessionMeta.delete(sessionKey);

            if (elapsedSincePreviousConflict > 0 && elapsedSincePreviousConflict < WhatsAppQrRunner.CONFLICT_RESTART_COOLDOWN_MS) {
              logger.warn('WA_QR_CONFLICT_COOLDOWN', 'Conflito repetido em curto intervalo; suprimindo auto-restart para evitar loop', {
                tenantId,
                connectionId,
                sessionKey,
                elapsedSincePreviousConflict,
                cooldownMs: WhatsAppQrRunner.CONFLICT_RESTART_COOLDOWN_MS,
              });
              return;
            }
            
            // Força reconexão imediata com novo QR code
            setTimeout(() => {
              try {
                this.startSession(tenantId, connectionId, null, { reset: true });
              } catch (err) {
                logger.error('WA_QR_RESTART_ERROR', 'Erro ao reiniciar sessão após conflict', {
                  tenantId,
                  connectionId,
                  error: err.message,
                });
              }
            }, 1000);
            return;
          }

          // reconexão com backoff (inclui 515: restart required)
          this.sessions.delete(sessionKey);

          const attempts = (m.reconnectAttempts || 0) + 1;
          m.reconnectAttempts = attempts;
          this.sessionMeta.set(sessionKey, m);

          // ===== VERIFICAÇÃO: Limite máximo de tentativas ====
          if (attempts >= WhatsAppQrRunner.MAX_QR_ATTEMPTS) {
            m.status = 'failed_max_attempts';
            m.updatedAt = Date.now();
            this.sessionMeta.set(sessionKey, m);
            this._clearTimers(sessionKey);
            this.sessions.delete(sessionKey);

            // ===== DIAGNÓSTICO DETALHADO =====
            const diagnosis = {
              tenantId,
              connectionId,
              sessionKey,
              maxAttemptsReached: WhatsAppQrRunner.MAX_QR_ATTEMPTS,
              totalAttempts: attempts,
              lastError: m.lastError,
              lastErrorCode: code ?? null,
              accountInfo: sock?.user?.id ? { id: sock.user.id, name: sock.user?.name } : null,
              timestamp: new Date().toISOString(),
              qrFrequency: 'A cada ~20-30 segundos (timeout Baileys)',
              possibleCauses: [
                { cause: 'Conexão de rede lenta ou instável', indicator: 'Timeout 408 após múltiplas tentativas' },
                { cause: 'Conta WhatsApp logada em outro dispositivo', indicator: 'Erro 440 (conflict) observado' },
                { cause: 'Rate limiting do WhatsApp na sua conta/IP', indicator: 'Múltiplas 408 em sequência' },
                { cause: 'Versão Baileys desatualizada ou incompatível', indicator: 'Falha consistente no handshake' },
                { cause: 'Conta WhatsApp suspensa/verificação pendente', indicator: 'HandshakeMessage não validada' },
              ],
              recommendedActions: [
                '1. Verifique se conta está ativa: acesse WhatsApp Web (web.whatsapp.com)',
                '2. Feche outras sessões: WhatsApp Settings > Linked Devices',
                '3. Aguarde 2-5 minutos e tente novo emparelhamento QR',
                '4. Se persistir, use Provider Cloud (API credentials) como fallback',
                '5. Verifique logs completos em: logs/api/api.log',
              ],
            };

            logger.error('QR_MAX_ATTEMPTS_EXCEEDED', 'Emparelhamento QR falhou após 5 tentativas. Requer ação manual do usuário.', diagnosis);

            // ===== EMITIR EVENTO PARA FRONTEND =====
            this.emit('qr_failed', {
              tenantId,
              connectionId,
              attempts: attempts,
              maxAttempts: WhatsAppQrRunner.MAX_QR_ATTEMPTS,
              errorCode: code ?? null,
              errorMessage: m.lastError,
              userMessage: 'Falha no emparelhamento QR após ' + attempts + ' tentativas. Causas: (1) Conexão lenta, (2) Conta em outro dispositivo, (3) Rate limit. Tente novo QR em 5 min ou use Provider Cloud.',
              diagnosis,
            });

            try {
              await whatsappQrService.ingestConnectionEvent(tenantId, connectionId, {
                eventType: 'failed',
                metadata: { reason: 'max_attempts_exceeded', attempts, errorCode: code ?? null },
              });
            } catch (_) {}

            return; // PARA aqui, não reconecta mais
          }
          // ===== FIM DA VERIFICAÇÃO =====

          const delay = Math.min(30000, 1000 * Math.pow(2, Math.min(attempts, 5))); // 2s,4s,8s,16s,32s -> cap 30s
          const timers = this.sessionTimers.get(sessionKey) || {};
          if (timers.reconnectTimer) clearTimeout(timers.reconnectTimer);
          timers.reconnectTimer = setTimeout(() => connect(), delay);
          this.sessionTimers.set(sessionKey, timers);
        }
      });

	      sock.ev.on('messages.upsert', async (m) => {
	        try {
	          // Loga o upsert em si (mesmo que depois seja ignorado), para facilitar diagnóstico.
	          try {
	            const msgCount = Array.isArray(m?.messages) ? m.messages.length : 0;
	            logger.info(`[WA_QR_UPSERT] ${jsonSafe({ tenantId, connectionId, type: m?.type || null, messageCount: msgCount })}`);
	          } catch (_) {}

	          const sessionKeyLocal = sessionKey;
	          for (const msg of m.messages || []) {
	            const traceId = `${tenantId}:${connectionId}:${msg?.key?.id || Date.now()}`;
	            const isFromMe = !!msg?.key?.fromMe;
	            // Ignorar mensagens enviadas por nós
	            if (isFromMe) {
	              logger.debug(`[WA_QR_MSG_SKIP] fromMe traceId=${traceId} tenantId=${tenantId} connectionId=${connectionId} msgId=${msg?.key?.id || null}`);
	              continue;
	            }

	            // Ignorar grupos/broadcasts (a UI atual é 1:1)
	            const remoteJidRaw = msg?.key?.remoteJid || '';
	            const remoteJidAlt = msg?.key?.remoteJidAlt || '';

	            // Normalização importante (evitar abrir ticket novo por @lid):
	            // - Preferir @s.whatsapp.net quando disponível em remoteJidAlt
	            // - Usar @lid apenas como fallback (metadado)
	            const remoteJid = (
	              typeof remoteJidRaw === 'string' && remoteJidRaw.endsWith('@lid') &&
	              typeof remoteJidAlt === 'string' && remoteJidAlt.endsWith('@s.whatsapp.net')
	            ) ? remoteJidAlt : remoteJidRaw;

	            if (remoteJid.endsWith('@g.us') || remoteJid.includes('broadcast')) {
	              logger.debug(`[WA_QR_MSG_SKIP] group/broadcast traceId=${traceId} remoteJid=${remoteJid}`);
	              continue;
	            }

	            // Extrair número do contato (sempre preferindo s.whatsapp.net)
	            const from = remoteJid.includes('@') ? remoteJid.split('@')[0] : remoteJid;
	            if (!from) {
	              logger.debug(`[WA_QR_MSG_SKIP] no-from traceId=${traceId} remoteJid=${remoteJid} remoteJidRaw=${remoteJidRaw} remoteJidAlt=${remoteJidAlt}`);
	              continue;
	            }

	            // Extrair texto (mais completo: texto, legendas, respostas de lista/botão etc.)
	            const mmRaw = msg?.message || {};
	            const mm = unwrapMessageContainer(mmRaw);
	            const text = extractTextFromBaileysMessage(mmRaw);

	            // Mesmo quando não houver texto, logamos um resumo do tipo/estrutura pra diagnosticar
	            if (!text) {
	              const messageKeys = mm ? Object.keys(mm) : [];
	              logger.info(`[WA_QR_MSG_NO_TEXT] ${jsonSafe({ traceId, tenantId, connectionId, remoteJid, from, messageId: msg?.key?.id || null, messageKeys, hasStub: !!msg?.messageStubType, stubType: msg?.messageStubType || null })}`);
	              continue;
	            }

	            // Log explícito no arquivo da API (sem "[object Object]")
	            logger.info(`[WA_QR_MSG_TEXT] traceId=${traceId} ${jsonSafe({ tenantId, connectionId, from, remoteJid, remoteJidRaw, remoteJidAlt, messageId: msg?.key?.id || null, textPreview: String(text).slice(0, 300) })}`);

	            // Adaptar para o formato de webhook que o ChannelGateway já entende (whatsapp)
	            const payload = {
	              message: {
	                from,
	                id: msg?.key?.id,
	                type: 'text',
	                text: { body: text },
	                timestamp: msg?.messageTimestamp ? String(Number(msg.messageTimestamp)) : undefined,
	              },
	              value: {
	                metadata: {
	                  // ajuda a debugar/reconciliar com a conta no painel
                    phone_number_id: String(connectionId),
	                },
	              },
	              __qr: {
	                connectionId,
	                remoteJid,
	                remoteJidRaw,
	                remoteJidAlt,
	              },
	            };

	            // Normaliza como no webhook (para ticket/ledger)
	            const normalizedArr = channelNormalizationService.normalizeWhatsAppIncoming({
	              message: payload.message,
	              value: payload.value,
	              raw: payload,
	            });
	            const normalized = normalizedArr && normalizedArr[0] ? normalizedArr[0] : null;

	            // Pipeline completo (gateway -> ticket -> humano/bot)
              const inboundDeps = this.inboundDepsProvider ? this.inboundDepsProvider() : null;

              await handleWhatsAppInbound({
	              source: 'qr',
	              tenantId,
	              payload,
	              normalized,
              traceId,
              deps: inboundDeps,
            });
	          }
	        } catch (e) {
	          // mantém conexão viva, mas registra no meta
	          const meta = this.sessionMeta.get(sessionKey);
	          if (meta) {
	            meta.lastError = e?.message || String(e);
	            meta.updatedAt = Date.now();
	            this.sessionMeta.set(sessionKey, meta);
	          }
	          // Log sem "[object Object]" + stack completo
	          logger.error(`[WA_QR_MSG_ERROR] ${jsonSafe({ tenantId, connectionId, errMessage: e?.message || String(e), errName: e?.name || null, errStack: e?.stack || null })}`);
	        }
	      });

      return sock;
    };

    const sock = connect();
    resolveStart(sock);
    return sock;
    } catch (err) {
      rejectStart(err);
      throw err;
    } finally {
      if (this.startingSessions.get(sessionKey) === startPromise) {
        this.startingSessions.delete(sessionKey);
      }
    }
  }

  async stopSession(tenantId, connectionId) {
    const sessionKey = this.getSessionKey(tenantId, connectionId);
    const sock = this.sessions.get(sessionKey);
    const sessionPath = this.getSessionPath(tenantId, connectionId);

    this._clearTimers(sessionKey);

    try {
      if (sock) {
        try { await sock.logout(); } catch (_) {}
        try { sock.end?.(); } catch (_) {}
      }
    } finally {
      this.sessions.delete(sessionKey);
      this.sessionMeta.delete(sessionKey);
      // não remove credenciais automaticamente; quem quiser reset passa {reset:true} no startSession
      try {
        await whatsappQrService.ingestConnectionEvent(tenantId, connectionId, { eventType: 'stopped' });
      } catch (_) {}
    }

    // opcional: não apagar sessionPath aqui
    void sessionPath;
  }

  getStatus(tenantId, connectionId) {
    const sessionKey = this.getSessionKey(tenantId, connectionId);
    const sock = this.sessions.get(sessionKey);
    const meta = this.sessionMeta.get(sessionKey);

    if (!sock && !meta) return { status: 'disconnected' };

    // Estado em tempo real (se houver)
    if (meta?.status) {
      return {
        status: meta.status,
        user: meta.user || sock?.user || null,
        updatedAt: meta.updatedAt,
        lastDisconnectCode: meta.lastDisconnectCode,
        lastError: meta.lastError,
      };
    }

    return { status: 'disconnected' };
  }
}

module.exports = WhatsAppQrRunner;
