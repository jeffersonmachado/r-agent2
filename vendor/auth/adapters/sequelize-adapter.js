'use strict';

/**
 * Sequelize Adapter para @results/auth
 *
 * Implementa a interface de persistência usando Sequelize + PostgreSQL.
 * Isola completamente o token-service dos detalhes do ORM.
 */

class SequelizeAdapter {
  /**
   * @param {object} deps
   * @param {object} deps.sequelize - instância Sequelize conectada
   * @param {object} deps.User - model User (lazy getter ou instância)
   * @param {object} deps.Session - model Session (lazy getter ou instância)
   * @param {object} [deps.logger] - logger opcional
   */
  constructor({ sequelize, User, Session, logger }) {
    this.sequelize = sequelize;
    this._User = User;
    this._Session = Session;
    this.logger = logger || { info: () => {}, warn: () => {}, error: () => {} };
  }

  get UserModel() {
    return typeof this._User === 'function' ? this._User() : this._User;
  }

  get SessionModel() {
    return typeof this._Session === 'function' ? this._Session() : this._Session;
  }

  // ── Interface obrigatória ──────────────────────────────────────────────────

  async findUserByUsername(username) {
    const UserModel = this.UserModel;
    const sequelize = UserModel.sequelize || this.sequelize;
    const Op = sequelize.constructor.Op;
    const usernameLower = String(username || '').toLowerCase();

    const row = await UserModel.findOne({
      where: {
        [Op.or]: [
          sequelize.where(sequelize.fn('lower', sequelize.col('username')), usernameLower),
          sequelize.where(sequelize.fn('lower', sequelize.col('email')), usernameLower),
        ],
      },
    });

    if (!row) return null;

    return {
      id: row.id,
      username: row.username,
      email: row.email || null,
      role: row.role || 'operator',
      active: row.active !== false,
      tenantId: row.tenant_id || row.tenant_key || row.tenantId || null,
      _passwordHash: row.password_hash,
      metadata: row.metadata || {},
    };
  }

  async verifyPassword(user, password) {
    const { verifyPassword } = require('./password');
    return verifyPassword(password, user._passwordHash);
  }

  async createSession(session) {
    const SessionModel = this.SessionModel;
    await SessionModel.create({
      token: session.token,
      user_id: session.userId,
      tenant_key: session.userSnapshot?.tenantId || null,
      ip_address: session.ipAddress,
      user_agent: session.userAgent,
      agent_snapshot: session.userSnapshot,
      expires_at: session.expiresAt,
      last_activity_at: session.lastActivityAt,
    });
  }

  async destroySession(token) {
    const SessionModel = this.SessionModel;
    await SessionModel.destroy({ where: { token } });
  }

  async updateLastLogin(userId, now) {
    const UserModel = this.UserModel;
    await UserModel.update(
      { last_login_at: now },
      { where: { id: userId } }
    );
  }

  async updateLastActivity(token, now) {
    const SessionModel = this.SessionModel;
    await SessionModel.update(
      { last_activity_at: now },
      { where: { token } }
    );
  }

  // ── Inicialização ──────────────────────────────────────────────────────────

  async loadAllSessions() {
    const SessionModel = this.SessionModel;
    const rows = await SessionModel.findAll({
      where: {
        expires_at: { [this.sequelize.constructor.Op.gt]: new Date() },
      },
    });

    return rows.map(row => ({
      token: row.token,
      userId: row.user_id,
      username: row.agent_snapshot?.username || null,
      createdAt: row.created_at?.toISOString?.() || row.created_at,
      expiresAt: row.expires_at?.toISOString?.() || row.expires_at,
      lastActivityAt: row.last_activity_at?.toISOString?.() || row.last_activity_at,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      userSnapshot: row.agent_snapshot || {},
    }));
  }

  async initialize() {
    this.logger.info('[SequelizeAdapter] Inicializado');
  }
}

module.exports = { SequelizeAdapter };
