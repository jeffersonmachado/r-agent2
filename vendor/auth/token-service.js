'use strict';

/**
 * Token Service — núcleo do @results/auth
 *
 * Geração, validação, login e logout de tokens de sessão opacos.
 * Totalmente isolado de framework HTTP e banco de dados.
 * Persistência injetada via adapter.
 */

const crypto = require('crypto');

// ─── Configurações padrão ────────────────────────────────────────────────────
const DEFAULTS = {
  tokenLength: 64,            // hex length (32 bytes)
  tokenExpirationHours: 24,
  inactivityTimeoutMinutes: 30,
  maxSessionsPerAgent: 3,
};

// ─── Token Service Factory ────────────────────────────────────────────────────

function createTokenService(options = {}) {
  const config = {
    tokenLength: options.tokenLength ?? DEFAULTS.tokenLength,
    tokenExpirationHours: options.tokenExpirationHours ?? DEFAULTS.tokenExpirationHours,
    inactivityTimeoutMinutes: options.inactivityTimeoutMinutes ?? DEFAULTS.inactivityTimeoutMinutes,
    maxSessionsPerAgent: options.maxSessionsPerAgent ?? DEFAULTS.maxSessionsPerAgent,
  };
  const adapter = options.adapter || null;
  const sessionStore = options.sessionStore || createMemorySessionStore();

  // Validação mínima
  if (!adapter || typeof adapter.findUserByUsername !== 'function') {
    throw new Error('Adapter é obrigatório e deve implementar findUserByUsername');
  }

  // ── Geração de token ──────────────────────────────────────────────────────
  function generateToken() {
    return crypto.randomBytes(config.tokenLength / 2).toString('hex');
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  async function login({ username, password, ipAddress, userAgent }) {
    if (!username || !password) {
      return { success: false, error: 'Username e senha são obrigatórios' };
    }

    const user = await adapter.findUserByUsername(username);
    if (!user) return { success: false, error: 'Credenciais inválidas' };
    if (user.active === false) return { success: false, error: 'Usuário inativo' };

    const passwordOk = await adapter.verifyPassword(user, password);
    if (!passwordOk) return { success: false, error: 'Credenciais inválidas' };

    // Limpa sessões antigas
    await cleanupOldSessions(user.id, config.maxSessionsPerAgent - 1);

    const token = generateToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.tokenExpirationHours * 60 * 60 * 1000);

    const session = {
      token,
      userId: user.id,
      username: user.username,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      lastActivityAt: now.toISOString(),
      ipAddress: ipAddress || 'unknown',
      userAgent: userAgent || 'unknown',
      userSnapshot: sanitizeUser(user),
      _seq: ++_seq,
    };

    sessionStore.set(token, session);

    // Persiste no adapter (best-effort)
    try { await adapter.createSession(session); } catch (_) { /* non-blocking */ }
    try { await adapter.updateLastLogin(user.id, now); } catch (_) { /* non-blocking */ }

    return { success: true, token, user: sanitizeUser(user) };
  }

  // ── Validação de token (SÍNCRONA) ─────────────────────────────────────────
  function validateToken(token) {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Token inválido' };
    }

    const session = sessionStore.get(token);
    if (!session) {
      return { valid: false, error: 'Sessão não encontrada' };
    }

    const now = new Date();
    const expiresAt = new Date(session.expiresAt);
    if (expiresAt <= now) {
      sessionStore.delete(token);
      try { adapter.destroySession?.(token); } catch (_) { /* non-blocking */ }
      return { valid: false, error: 'Sessão expirada' };
    }

    const lastActivity = new Date(session.lastActivityAt);
    const inactiveMs = now.getTime() - lastActivity.getTime();
    const timeoutMs = config.inactivityTimeoutMinutes * 60 * 1000;
    if (inactiveMs > timeoutMs) {
      sessionStore.delete(token);
      try { adapter.destroySession?.(token); } catch (_) { /* non-blocking */ }
      return { valid: false, error: 'Sessão expirada por inatividade' };
    }

    // Atualiza lastActivityAt
    session.lastActivityAt = now.toISOString();
    sessionStore.set(token, session);
    setImmediate(() => adapter.updateLastActivity?.(token, now).catch(() => {}));

    return { valid: true, user: session.userSnapshot, session };
  }

  // ── Logout ────────────────────────────────────────────────────────────────
  async function logout(token) {
    if (!token) return { success: false, error: 'Token é obrigatório' };
    sessionStore.delete(token);
    try { await adapter.destroySession(token); } catch (_) { /* non-blocking */ }
    return { success: true };
  }

  // ── Inicialização ──────────────────────────────────────────────────────────
  async function initialize() {
    if (!adapter) throw new Error('Adapter não configurado');
    if (typeof adapter.loadAllSessions === 'function') {
      const sessions = await adapter.loadAllSessions();
      for (const s of sessions) {
        sessionStore.set(s.token, s);
      }
    }
    if (typeof adapter.initialize === 'function') {
      await adapter.initialize();
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function sanitizeUser(user) {
    if (!user) return null;
    const { passwordHash, _passwordHash, salt, invitationToken, passwordResetToken, ...safe } = user;
    return safe;
  }

  let _seq = 0; // contador de inserção para tiebreaker de createdAt

  async function cleanupOldSessions(userId, maxKeep) {
    const userSessions = sessionStore
      .values()
      .filter(s => s.userId === userId)
      .sort((a, b) => {
        const dateDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        if (dateDiff !== 0) return dateDiff;
        // Mesmo createdAt: mais recente (seq maior) primeiro
        return (b._seq || 0) - (a._seq || 0);
      });

    const toRemove = userSessions.slice(maxKeep);
    for (const s of toRemove) {
      sessionStore.delete(s.token);
      try { await adapter.destroySession?.(s.token); } catch (_) { /* non-blocking */ }
    }
  }

  return {
    generateToken,
    login,
    validateToken,
    logout,
    initialize,
    sessionStore,
  };
}

// ─── Memory Session Store ────────────────────────────────────────────────────

function createMemorySessionStore() {
  const sessions = new Map();

  return {
    get(token) { return sessions.get(token) || null; },
    set(token, session) { sessions.set(token, session); },
    delete(token) { sessions.delete(token); },
    has(token) { return sessions.has(token); },
    size() { return sessions.size; },
    values() { return Array.from(sessions.values()); },
    clear() { sessions.clear(); },
  };
}

module.exports = { createTokenService, createMemorySessionStore, DEFAULTS };
