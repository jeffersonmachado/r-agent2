'use strict';

/**
 * Memory Adapter para @results/auth
 *
 * Persistência em memória — ideal para testes unitários.
 * Não requer banco de dados.
 */

const { hashPassword, verifyPassword } = require('../password');

class MemoryAdapter {
  constructor() {
    this.users = new Map();
    this.sessions = new Map();
  }

  // ── Seed helpers para testes ────────────────────────────────────────────────
  async seedUser(userData) {
    const passwordHash = userData._passwordHash || await hashPassword(userData.password || 'test123');
    const user = {
      id: userData.id || `user-${Date.now()}`,
      username: userData.username || 'testuser',
      email: userData.email || null,
      role: userData.role || 'operator',
      active: userData.active !== false,
      tenantId: userData.tenantId || 'system',
      _passwordHash: passwordHash,
      metadata: userData.metadata || {},
    };
    this.users.set(user.username.toLowerCase(), user);
    this.users.set(user.id, user);
    return user;
  }

  // ── Interface obrigatória ──────────────────────────────────────────────────

  async findUserByUsername(username) {
    const key = String(username || '').toLowerCase();
    const byUsername = this.users.get(key);
    if (byUsername) return byUsername;

    // Search by email
    for (const user of this.users.values()) {
      if (user.email && user.email.toLowerCase() === key) return user;
    }
    return null;
  }

  async verifyPassword(user, password) {
    return verifyPassword(password, user._passwordHash);
  }

  async createSession(session) {
    this.sessions.set(session.token, session);
  }

  async destroySession(token) {
    this.sessions.delete(token);
  }

  async updateLastLogin(userId, now) {
    const user = this.users.get(userId);
    if (user) user.lastLoginAt = now.toISOString();
  }

  async updateLastActivity(token, now) {
    const session = this.sessions.get(token);
    if (session) session.lastActivityAt = now.toISOString();
  }

  // ── Inicialização ──────────────────────────────────────────────────────────

  async loadAllSessions() {
    return Array.from(this.sessions.values());
  }

  async initialize() {
    // No-op
  }

  clear() {
    this.users.clear();
    this.sessions.clear();
  }
}

module.exports = { MemoryAdapter };
