/**
 * Serviço de autenticação de agentes (PostgreSQL-first).
 *
 * Objetivo:
 * - Remover dependência de arquivos JSON (DB-only)
 * - Persistir usuários e sessões no PostgreSQL
 * - Manter `validateToken()` síncrono via cache em memória (necessário pelo middleware)
 *
 * Observação:
 * - `initialize()` deve ser chamado após conectar/migrar o banco (server.js já faz init global).
 */

'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../utils/config');
const { cacheTenantContext, invalidateTenantCache } = require('./tenantService');

const { getSequelize } = require('../db/sequelize');
const { User, Session, Tenant, TenantContext } = require('../db/models');
const { checkLimit } = require('./planLimitsService');
const { getClassificationForAgent } = require('../modules/agent-os/experience-segregation');

// ---------------------------------------------------------------------------
// Configurações
// ---------------------------------------------------------------------------

const TOKEN_EXPIRATION_HOURS = config.get('auth.tokenExpirationHours', 24);
const TOKEN_LENGTH = 64; // hex length
const MAX_SESSIONS_PER_AGENT = config.get('auth.maxSessionsPerAgent', 3);
const INACTIVITY_TIMEOUT_MINUTES = config.get('auth.inactivityTimeoutMinutes', 30);
// Throttle da persistência de last_activity_at no DB (por sessão).
// O cache em memória continua atualizado a cada validateToken (timeout de
// inatividade intacto); apenas o write no Postgres é limitado a 1x/minuto.
const ACTIVITY_PERSIST_INTERVAL_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// Cache em memória (para validateToken síncrono)
// ---------------------------------------------------------------------------

/** @type {Map<string, any>} */
const agents = new Map(); // userId -> { ...agent, _passwordHash }

/** @type {Map<string, any>} */
const sessions = new Map(); // token -> { token, agentId, expiresAt, lastActivityAt, agentSnapshot, ... }

let initialized = false;
let initializingPromise = null;

function dbAvailable() {
  return !!getSequelize();
}

// ---------------------------------------------------------------------------
// Sweeper de sessões expiradas (tokens abandonados nunca passam por
// validateToken, então precisam de limpeza periódica para sair do Map).
// ---------------------------------------------------------------------------
const SESSION_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1h

function sweepExpiredSessions(now = new Date()) {
  let removed = 0;
  for (const [token, session] of sessions.entries()) {
    const expiresAt = new Date(session.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt > now) continue;

    sessions.delete(token);
    removed += 1;

    if (dbAvailable()) {
      const SessionModel = typeof Session === 'function' ? Session() : Session;
      setImmediate(() => SessionModel.destroy({ where: { token } }).catch(() => {}));
    }
  }

  if (removed > 0) {
    logger.debug('[AuthService] Sweeper: sessões expiradas removidas do cache', { removed });
  }
  return removed;
}

const sessionSweepTimer = setInterval(sweepExpiredSessions, SESSION_SWEEP_INTERVAL_MS);
if (typeof sessionSweepTimer.unref === 'function') {
  sessionSweepTimer.unref();
}

// ── defensive helpers ────────────────────────────────────────────────────────
function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeGet(obj, path, fallback = null) {
  if (!obj || typeof obj !== 'object') return fallback;
  try {
    const parts = path.split('.');
    let v = obj;
    for (const part of parts) {
      v = v?.[part];
      if (v === undefined) return fallback;
    }
    return v ?? fallback;
  } catch (_) { return fallback; }
}

function safeTrimLower(value, fallback = '') {
  const str = safeToString(value, fallback);
  try { return str.trim().toLowerCase(); } catch (_) { return fallback; }
}

function safeErrorMessage(err, fallback = '') {
  try {
    const message = err && typeof err === 'object' ? err.message : null;
    return safeToString(message) || safeToString(err, fallback);
  } catch (_) {
    return safeToString(err, fallback);
  }
}
// ─────────────────────────────────────────────────────────────────────────────

function sha256Hex(value) {
  return crypto.createHash('sha256').update(safeToString(value)).digest('hex');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = sha256Hex(password + salt);
  return `sha256:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;

  // Formato preferido: sha256:<salt>:<hash>
  if (stored.startsWith('sha256:')) {
    const parts = stored.split(':');
    if (parts.length !== 3) return false;
    const salt = parts[1];
    const expected = parts[2];
    return sha256Hex(password + salt) === expected;
  }

  // Compatibilidade: seed legado armazenava sha256(password) sem salt
  if (/^[a-f0-9]{64}$/i.test(stored)) {
    return sha256Hex(password) === stored.toLowerCase();
  }

  return false;
}

function generateToken() {
  return crypto.randomBytes(TOKEN_LENGTH / 2).toString('hex');
}

function normalizeRole(role) {
  if (!role) return 'operator';
  const r = safeTrimLower(role);
  if (r === 'agent') return 'operator';
  if (r === 'supervisor') return 'manager';
  if (r === 'superadmin') return 'super_admin';
  return r;
}

function toAgentSafe(agent) {
  if (!agent) return null;
  // Nunca retorna password_hash, invitation/password reset tokens
  const {
    _passwordHash,
    passwordHash,
    salt,
    invitationToken,
    invitationExpiresAt,
    passwordResetToken,
    passwordResetExpiresAt,
    ...safe
  } = agent;
  return safe;
}

function buildAgentFromUserRow(userRow) {
  if (!userRow || typeof userRow !== 'object') return null;
  try {
    const isSuper = !!safeGet(userRow, 'is_superadmin');
    const role = isSuper ? 'super_admin' : normalizeRole(safeGet(userRow, 'role'));
    const email = safeGet(userRow, 'email', '');
    const username = safeGet(userRow, 'username') || (email ? email.split('@')[0] : null);
    const platformRole = safeGet(userRow, 'platform_role', null) || null;

    const agent = {
    id: safeGet(userRow, 'id'),
    tenantId: safeGet(userRow, 'tenant_key', null),
    username,
    email,
    role,
    platformRole,
    name: safeGet(userRow, 'name'),
    active: safeGet(userRow, 'is_active', true) !== false,
    status: safeGet(userRow, 'status', 'active'),
    mfaEnabled: !!safeGet(userRow, 'mfa_enabled'),
    createdAt: safeGet(userRow, 'created_at') ? new Date(safeGet(userRow, 'created_at')).toISOString() : (safeGet(userRow, 'createdAt')?.toISOString?.() || null),
    updatedAt: safeGet(userRow, 'updated_at') ? new Date(safeGet(userRow, 'updated_at')).toISOString() : (safeGet(userRow, 'updatedAt')?.toISOString?.() || null),
    lastLoginAt: safeGet(userRow, 'last_login_at') ? new Date(safeGet(userRow, 'last_login_at')).toISOString() : (safeGet(userRow, 'lastLoginAt')?.toISOString?.() || null),
    };
    // Classificação de plataforma derivada de fonte server-side (platformRole),
    // nunca do tenant role. Entra no agent_snapshot da sessão.
    agent.platformClassification = getClassificationForAgent(agent);
    return agent;
  } catch (_) { return null; }
}

async function ensureDefaultAdminIfEmpty() {
  const UserModel = typeof User === 'function' ? User() : User;

  const count = await UserModel.count();
  if (count > 0) return;

  // Blindagem produção: não cria usuário/admin default automaticamente.
  logger.warn('[AuthService] Nenhum usuário encontrado. Seed/bootstrapping deve criar usuários explicitamente.');
}

async function loadCachesFromDb() {
  const UserModel = typeof User === 'function' ? User() : User;
  const SessionModel = typeof Session === 'function' ? Session() : Session;

  agents.clear();
  sessions.clear();

  const users = await UserModel.findAll();
  for (const u of users) {
    const agentSafe = buildAgentFromUserRow(u);
    agents.set(u.id, {
      ...agentSafe,
      // Campos internos
      _passwordHash: u.password_hash,
      // Campos de convite/reset (não expor)
      invitationToken: u.invitation_token || null,
      invitationExpiresAt: u.invitation_expires_at ? new Date(u.invitation_expires_at).toISOString() : null,
      passwordResetToken: u.password_reset_token || null,
      passwordResetExpiresAt: u.password_reset_expires_at ? new Date(u.password_reset_expires_at).toISOString() : null,
    });
  }

  const now = new Date();
  const activeSessions = await SessionModel.findAll();
  for (const s of activeSessions) {
    const expiresAt = new Date(s.expires_at);
    if (expiresAt <= now) continue;

    sessions.set(s.token, {
      token: s.token,
      agentId: s.user_id,
      username: s.agent_snapshot?.username || null,
      createdAt: s.created_at ? new Date(s.created_at).toISOString() : (s.createdAt?.toISOString?.() || null),
      expiresAt: expiresAt.toISOString(),
      lastActivityAt: new Date(s.last_activity_at).toISOString(),
      lastActivityPersistedAt: new Date(s.last_activity_at).toISOString(),
      ipAddress: s.ip_address || 'unknown',
      userAgent: s.user_agent || 'unknown',
      tenantKey: s.tenant_key || null,
      agentSnapshot: s.agent_snapshot || {},
    });
  }
}

/**
 * Inicializa o AuthService carregando cache do PostgreSQL.
 * Deve ser chamado após connect+migrations.
 */
async function initialize() {
  if (initialized) return;
  if (initializingPromise) return initializingPromise;

  initializingPromise = (async () => {
    if (!dbAvailable()) {
      throw new Error('PostgreSQL é obrigatório para o serviço de autenticação. Configure a conexão com o banco de dados.');
    }

    await ensureDefaultAdminIfEmpty();
    await loadCachesFromDb();

    initialized = true;
    logger.info('[AuthService] ✅ Cache carregado do PostgreSQL', {
      agents: agents.size,
      sessions: sessions.size,
    });
  })();

  return initializingPromise;
}

// ---------------------------------------------------------------------------
// API: Agents (DB-first)
// ---------------------------------------------------------------------------

async function createAgent({ tenantId, username, email, password, role, name }) {
  if (!tenantId || typeof tenantId !== 'string') {
    return { success: false, error: 'tenantId é obrigatório' };
  }
  if (!username || typeof username !== 'string') {
    return { success: false, error: 'Username é obrigatório' };
  }
  if (!email || typeof email !== 'string') {
    return { success: false, error: 'Email é obrigatório' };
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return { success: false, error: 'Senha deve ter pelo menos 6 caracteres' };
  }

  const normalizedRole = normalizeRole(role || 'operator');

  await initialize();

  // Plan limits: max_agentes (best-effort)
  try {
    const limitCheck = await checkLimit(tenantId, 'max_agentes', 1);
    if (!limitCheck.allowed) {
      return { success: false, error: limitCheck.error || 'Limite de agentes excedido' };
    }
  } catch (e) {
    // não bloqueia se houver falha no cálculo de uso
    logger.warn('[AuthService] Falha ao checar limite de agentes (ignorado)', { tenantId, error: safeErrorMessage(e) });
  }

  if (!dbAvailable()) {
    return { success: false, error: 'PostgreSQL é obrigatório para criar agentes' };
  }

  const UserModel = typeof User === 'function' ? User() : User;

  // Evita duplicação: se username já existe globalmente, usa username@tenantId
  const trimmedUsername = username.trim();
  const trimmedEmail = email.trim();
  
  const existingUsername = await UserModel.findOne({
    where: UserModel.sequelize.where(
      UserModel.sequelize.fn('lower', UserModel.sequelize.col('username')),
      trimmedUsername.toLowerCase()
    ),
  }).catch(() => null);

  const existingEmail = await UserModel.findOne({
    where: UserModel.sequelize.where(
      UserModel.sequelize.fn('lower', UserModel.sequelize.col('email')),
      trimmedEmail.toLowerCase()
    ),
  }).catch(() => null);

  if (existingEmail) {
    return { success: false, error: 'Email já cadastrado' };
  }

  // Se username já existe em OUTRO tenant, aplica sufixo @tenantId
  const finalUsername = existingUsername
    ? `${trimmedUsername}@${tenantId}`
    : trimmedUsername;

  const passwordHash = hashPassword(password);
  const created = await UserModel.create({
    tenant_key: tenantId,
    username: finalUsername,
    email: trimmedEmail,
    name: name || username.trim(),
    password_hash: passwordHash,
    role: normalizedRole,
    is_active: true,
    status: 'active',
    is_superadmin: false,
    mfa_enabled: false,
  });

  const agent = {
    ...buildAgentFromUserRow(created),
    _passwordHash: created.password_hash,
    invitationToken: null,
    invitationExpiresAt: null,
    passwordResetToken: null,
    passwordResetExpiresAt: null,
  };
  agents.set(created.id, agent);

  return { success: true, agent: toAgentSafe(agent) };
}

function toTenantKey(input) {
  const base = safeToString(input, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || `tenant-${Date.now()}`;
}

function toUsernameFromEmail(email) {
  const local = safeToString(email, '').split('@')[0] || '';
  const normalized = local
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return normalized || `user-${Date.now()}`;
}

async function createSaasSignupAccount({ name, company, email, password }) {
  const safeName = safeToString(name, '').trim();
  const safeCompany = safeToString(company, '').trim();
  const safeEmail = safeToString(email, '').trim().toLowerCase();
  const safePassword = safeToString(password, '');

  if (!safeName) return { success: false, error: 'Nome é obrigatório' };
  if (!safeCompany) return { success: false, error: 'Empresa é obrigatória' };
  if (!safeEmail || !safeEmail.includes('@')) return { success: false, error: 'Email corporativo inválido' };
  if (!safePassword || safePassword.length < 8) {
    return { success: false, error: 'Senha deve ter pelo menos 8 caracteres' };
  }

  await initialize();
  if (!dbAvailable()) {
    return { success: false, error: 'PostgreSQL é obrigatório para cadastro SaaS' };
  }

  const UserModel = typeof User === 'function' ? User() : User;
  const TenantModel = typeof Tenant === 'function' ? Tenant() : Tenant;
  const TenantContextModel = typeof TenantContext === 'function' ? TenantContext() : TenantContext;
  const sequelize = UserModel.sequelize;

  const existingEmail = await UserModel.findOne({
    where: sequelize.where(sequelize.fn('lower', sequelize.col('email')), safeEmail),
  });
  if (existingEmail) {
    return { success: false, error: 'Já existe conta com este e-mail' };
  }

  const baseTenantKey = toTenantKey(safeCompany);
  let tenantKey = baseTenantKey;
  let tenantIndex = 1;

  while (true) {
    const tenantExists = await TenantModel.findOne({ where: { tenant_key: tenantKey } });
    if (!tenantExists) break;
    tenantIndex += 1;
    tenantKey = `${baseTenantKey}-${tenantIndex}`;
  }

  const baseUsername = toUsernameFromEmail(safeEmail);
  let username = baseUsername;
  // Verifica se username já existe globalmente
  const usernameExists = await UserModel.findOne({
    where: sequelize.where(sequelize.fn('lower', sequelize.col('username')), username.toLowerCase()),
  });
  // Se existir, usa formato username@tenantKey (único por tenant)
  if (usernameExists) {
    username = `${baseUsername}@${tenantKey}`;
  }

  const result = await sequelize.transaction(async (transaction) => {
    const now = new Date();
    const trialExpiresAt = new Date(now.getTime() + (14 * 24 * 60 * 60 * 1000));

    const tenant = await TenantModel.create({
      tenant_key: tenantKey,
      name: safeCompany,
      site: '',
      ramo_atividade: 'SaaS',
      objetivo: 'Onboarding inicial da conta criada via landing pública',
      status: 'trial',
      plan: 'trial',
      limits: {},
      settings: {},
      branding: {},
      trial_expires_at: trialExpiresAt,
    }, { transaction });

    // Invalida cache de getTenant para a nova chave (defesa contra reuso de chave)
    invalidateTenantCache(tenantKey);

    await TenantContextModel.create({
      tenant_key: tenantKey,
      ramo_atividade: 'SaaS',
      objetivo: 'Configurar integrações obrigatórias no onboarding',
      site_oficial: '',
      prioridade: 'HIGH',
      escopo: ['rag', 'chatbot', 'classificacao_intencao'],
    }, { transaction });

    const user = await UserModel.create({
      tenant_key: tenantKey,
      username,
      email: safeEmail,
      name: safeName,
      password_hash: hashPassword(safePassword),
      role: 'admin',
      is_active: true,
      status: 'active',
      is_superadmin: false,
      mfa_enabled: false,
    }, { transaction });

    const agent = {
      ...buildAgentFromUserRow(user),
      _passwordHash: user.password_hash,
      invitationToken: null,
      invitationExpiresAt: null,
      passwordResetToken: null,
      passwordResetExpiresAt: null,
    };
    agents.set(user.id, agent);

    return {
      tenant,
      user,
      agent: toAgentSafe(agent),
    };
  });

  // Mantem cache em memoria do tenant_context sincronizado para leituras imediatas.
  try {
    cacheTenantContext(
      result.tenant.tenant_key,
      'SaaS',
      'Configurar integrações obrigatórias no onboarding',
      '',
    );
  } catch (err) {
    logger.warn('[AuthService] Falha ao sincronizar cache de tenant_context após signup', {
      tenantKey: result.tenant.tenant_key,
      error: safeErrorMessage(err),
    });
  }

  return {
    success: true,
    tenant: {
      id: result.tenant.id,
      tenantKey: result.tenant.tenant_key,
      name: result.tenant.name,
      plan: result.tenant.plan,
      status: result.tenant.status,
    },
    agent: result.agent,
    credentials: {
      username,
      email: safeEmail,
    },
  };
}

async function listAgents(tenantId = null) {
  await initialize();

  if (!dbAvailable()) {
    let list = Array.from(agents.values()).map(toAgentSafe);
    if (tenantId) list = list.filter(a => a.tenantId === tenantId);
    return list;
  }

  const UserModel = typeof User === 'function' ? User() : User;
  const where = tenantId ? { tenant_key: tenantId } : {};
  const rows = await UserModel.findAll({ where });
  return rows.map(buildAgentFromUserRow);
}

async function getAgent(agentId) {
  await initialize();
  if (!agentId) return null;

  if (!dbAvailable()) {
    const a = agents.get(agentId);
    return a ? toAgentSafe(a) : null;
  }

  const UserModel = typeof User === 'function' ? User() : User;
  const row = await UserModel.findByPk(agentId);
  return row ? buildAgentFromUserRow(row) : null;
}

async function updateAgent(agentId, updates = {}) {
  if (!agentId) return { success: false, error: 'agentId é obrigatório' };
  await initialize();

  if (!dbAvailable()) {
    const current = agents.get(agentId);
    if (!current) return { success: false, error: 'Agente não encontrado' };
    const next = { ...current, ...updates, updatedAt: new Date().toISOString() };
    agents.set(agentId, next);
    return { success: true, agent: toAgentSafe(next) };
  }

  const UserModel = typeof User === 'function' ? User() : User;
  const row = await UserModel.findByPk(agentId);
  if (!row) return { success: false, error: 'Agente não encontrado' };

  const allowed = {};
  if (typeof updates.name === 'string') allowed.name = updates.name;
  if (typeof updates.email === 'string') allowed.email = updates.email;
  if (typeof updates.username === 'string') allowed.username = updates.username;
  if (typeof updates.role === 'string') allowed.role = normalizeRole(updates.role);
  if (typeof updates.active === 'boolean') allowed.is_active = updates.active;
  if (typeof updates.status === 'string') allowed.status = updates.status;
  if (typeof updates.tenantId === 'string') allowed.tenant_key = updates.tenantId;

  await row.update(allowed);

  // Atualiza cache
  const agent = {
    ...buildAgentFromUserRow(row),
    _passwordHash: row.password_hash,
    invitationToken: row.invitation_token || null,
    invitationExpiresAt: row.invitation_expires_at ? new Date(row.invitation_expires_at).toISOString() : null,
    passwordResetToken: row.password_reset_token || null,
    passwordResetExpiresAt: row.password_reset_expires_at ? new Date(row.password_reset_expires_at).toISOString() : null,
  };
  agents.set(row.id, agent);

  return { success: true, agent: toAgentSafe(agent) };
}

async function deleteAgent(agentId) {
  if (!agentId) return { success: false, error: 'agentId é obrigatório' };
  await initialize();

  if (!dbAvailable()) {
    agents.delete(agentId);
    return { success: true };
  }

  const UserModel = typeof User === 'function' ? User() : User;
  const deleted = await UserModel.destroy({ where: { id: agentId } });
  agents.delete(agentId);

  // Remove sessões do cache (e DB via cascade de sessions.user_id)
  for (const [token, sess] of sessions.entries()) {
    if (sess.agentId === agentId) sessions.delete(token);
  }

  return deleted ? { success: true } : { success: false, error: 'Agente não encontrado' };
}

// ---------------------------------------------------------------------------
// API: Sessões
// ---------------------------------------------------------------------------

async function cleanupOldSessions(agentId, maxSessionsToKeep) {
  if (!dbAvailable()) return;
  const SessionModel = typeof Session === 'function' ? Session() : Session;

  const all = await SessionModel.findAll({
    where: { user_id: agentId },
    order: [['created_at', 'DESC']],
  });

  if (all.length <= maxSessionsToKeep) return;

  const toDelete = all.slice(maxSessionsToKeep);
  const tokens = toDelete.map(s => s.token);
  await SessionModel.destroy({ where: { token: tokens } });
  tokens.forEach(t => sessions.delete(t));
}

async function login(username, password, ipAddress = 'unknown', userAgent = 'unknown') {
  if (!username || !password) {
    return { success: false, error: 'Username e senha são obrigatórios' };
  }

  await initialize();

  const usernameLower = safeTrimLower(username);

  // Busca usuário no cache para validação rápida
  let agent = null;
  for (const a of agents.values()) {
    try {
      const aUsername = safeGet(a, 'username', '');
      const aEmail = safeGet(a, 'email', '');
      if (aUsername && aUsername.toLowerCase() === usernameLower) {
        agent = a;
        break;
      }
      if (aEmail && aEmail.toLowerCase() === usernameLower) {
        agent = a;
        break;
      }
    } catch (_) { /* skip poisoned entry */ }
  }

  // Se DB está disponível, confirma no DB (fonte de verdade)
  if (dbAvailable()) {
    const UserModel = typeof User === 'function' ? User() : User;
    const sequelize = UserModel.sequelize;
    const Op = sequelize.constructor.Op;

    const row = await UserModel.findOne({
      where: {
        [Op.or]: [
          sequelize.where(sequelize.fn('lower', sequelize.col('username')), usernameLower),
          sequelize.where(sequelize.fn('lower', sequelize.col('email')), usernameLower),
        ],
      },
    });

    if (!row) return { success: false, error: 'Credenciais inválidas' };

    agent = {
      ...buildAgentFromUserRow(row),
      _passwordHash: row.password_hash,
      invitationToken: row.invitation_token || null,
      invitationExpiresAt: row.invitation_expires_at ? new Date(row.invitation_expires_at).toISOString() : null,
      passwordResetToken: row.password_reset_token || null,
      passwordResetExpiresAt: row.password_reset_expires_at ? new Date(row.password_reset_expires_at).toISOString() : null,
    };

    // Atualiza cache do usuário
    agents.set(row.id, agent);
  }

  if (!agent) return { success: false, error: 'Credenciais inválidas' };
  if (!agent.active) return { success: false, error: 'Agente inativo' };

  if (!verifyPassword(password, agent._passwordHash)) {
    return { success: false, error: 'Credenciais inválidas' };
  }

  // Hardening multi-tenant: usuário não-super-admin deve ter tenant associado.
  // (Não existe fallback para tenant-demo em runtime.)
  if (!agent.tenantId && agent.role !== 'super_admin') {
    logger.warn('[AuthService] Login bloqueado: usuário sem tenant', { username: agent.username, agentId: agent.id });
    return { success: false, error: 'tenant_required' };
  }

  // Remove sessões antigas antes de criar a nova
  if (dbAvailable()) {
    await cleanupOldSessions(agent.id, Math.max(1, MAX_SESSIONS_PER_AGENT - 1));
  }

  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_EXPIRATION_HOURS * 60 * 60 * 1000);

  const agentSafe = toAgentSafe(agent);
  const sessionObj = {
    token,
    agentId: agent.id,
    username: agent.username,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    lastActivityAt: now.toISOString(),
    lastActivityPersistedAt: now.toISOString(),
    ipAddress,
    userAgent,
    tenantKey: agent.tenantId,
    agentSnapshot: agentSafe,
  };

  sessions.set(token, sessionObj);

  if (dbAvailable()) {
    const SessionModel = typeof Session === 'function' ? Session() : Session;
    await SessionModel.create({
      token,
      user_id: agent.id,
      tenant_key: agent.tenantId,
      ip_address: ipAddress,
      user_agent: userAgent,
      agent_snapshot: agentSafe,
      expires_at: expiresAt,
      last_activity_at: now,
    });

    // Atualiza last_login_at no usuário
    const UserModel = typeof User === 'function' ? User() : User;
    await UserModel.update(
      { last_login_at: now },
      { where: { id: agent.id } }
    );
  }

  logger.info('[AuthService] Login realizado', { username: agent.username, agentId: agent.id });
  return { success: true, token, agent: agentSafe };
}

async function logout(token) {
  if (!token) return { success: false, error: 'Token é obrigatório' };
  await initialize();

  sessions.delete(token);

  if (dbAvailable()) {
    const SessionModel = typeof Session === 'function' ? Session() : Session;
    await SessionModel.destroy({ where: { token } });
  }

  return { success: true };
}

async function logoutAllSessions(agentId) {
  if (!agentId) return 0;
  await initialize();

  let removed = 0;
  for (const [token, s] of sessions.entries()) {
    if (s.agentId === agentId) {
      sessions.delete(token);
      removed++;
    }
  }

  if (dbAvailable()) {
    const SessionModel = typeof Session === 'function' ? Session() : Session;
    await SessionModel.destroy({ where: { user_id: agentId } });
  }

  return removed;
}

/**
 * Valida token de forma SÍNCRONA usando cache em memória.
 * (O middleware depende disso.)
 */
function validateToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token inválido' };
  }
  if (!initialized) {
    return { valid: false, error: 'AuthService ainda não inicializado' };
  }

  const session = sessions.get(token);
  if (!session) {
    return { valid: false, error: 'Sessão não encontrada' };
  }

  const now = new Date();
  const expiresAt = new Date(session.expiresAt);
  if (expiresAt <= now) {
    sessions.delete(token);
    if (dbAvailable()) {
      // best-effort async cleanup
      const SessionModel = typeof Session === 'function' ? Session() : Session;
      setImmediate(() => SessionModel.destroy({ where: { token } }).catch(() => {}));
    }
    return { valid: false, error: 'Sessão expirada' };
  }

  const lastActivity = new Date(session.lastActivityAt);
  const inactiveTime = now - lastActivity;
  const timeoutMs = INACTIVITY_TIMEOUT_MINUTES * 60 * 1000;
  if (inactiveTime > timeoutMs) {
    sessions.delete(token);
    if (dbAvailable()) {
      const SessionModel = typeof Session === 'function' ? Session() : Session;
      setImmediate(() => SessionModel.destroy({ where: { token } }).catch(() => {}));
    }
    return { valid: false, error: 'Sessão expirada por inatividade' };
  }

  // Atualiza lastActivityAt no cache em memória a cada chamada (usado pelo
  // timeout de inatividade acima). A persistência no DB é throttled: no
  // máximo 1 write por ACTIVITY_PERSIST_INTERVAL_MS por sessão.
  session.lastActivityAt = now.toISOString();
  sessions.set(token, session);
  if (dbAvailable()) {
    const lastPersistedAt = session.lastActivityPersistedAt
      ? new Date(session.lastActivityPersistedAt)
      : lastActivity;
    if (now - lastPersistedAt > ACTIVITY_PERSIST_INTERVAL_MS) {
      session.lastActivityPersistedAt = now.toISOString();
      const SessionModel = typeof Session === 'function' ? Session() : Session;
      setImmediate(() => SessionModel.update(
        { last_activity_at: now },
        { where: { token } }
      ).catch(() => {}));
    }
  }

  return { valid: true, agent: session.agentSnapshot, session };
}

// ---------------------------------------------------------------------------
// RPA Token login
// ---------------------------------------------------------------------------

async function loginWithRpaToken(rpaToken, tenantId, ipAddress = 'unknown', userAgent = 'unknown') {
  if (!rpaToken || typeof rpaToken !== 'string') {
    return { success: false, error: 'Token RPA é obrigatório' };
  }
  if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
    return { success: false, error: 'tenantId é obrigatório' };
  }
  const effectiveTenantId = tenantId.trim();

  let expectedToken = null;
  try {
    const rpaTokenManager = require('../../core/rpa/utils/rpaTokenManager');
    expectedToken = rpaTokenManager.loadRpaToken();
    if (!expectedToken) {
      return { success: false, error: 'Token RPA não configurado no servidor' };
    }
    if (rpaToken !== expectedToken) {
      logger.warn('[AuthService] Tentativa de login RPA com token inválido', { ipAddress });
      return { success: false, error: 'Token RPA inválido' };
    }
    if (!rpaTokenManager.isTokenValid(rpaToken)) {
      return { success: false, error: 'Token RPA expirado ou inválido' };
    }
  } catch (err) {
    logger.error('[AuthService] CRÍTICO: rpaTokenManager indisponível', { error: safeErrorMessage(err) });
    return { success: false, error: 'Sistema de validação de token RPA não disponível' };
  }

  await initialize();

  // Busca ou cria usuário RPA
  // username e email escopados por tenant para evitar violação de UNIQUE global entre tenants
  const username = `rpa_${effectiveTenantId}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 60);
  const email = `rpa+${effectiveTenantId}@local.test`;

  let rpaAgent = null;
  for (const a of agents.values()) {
    if (a.username === username && a.tenantId === effectiveTenantId) {
      rpaAgent = a;
      break;
    }
  }

  if (dbAvailable()) {
    const UserModel = typeof User === 'function' ? User() : User;
    const row = await UserModel.findOne({ where: { username, tenant_key: effectiveTenantId } });
    if (!row) {
      const created = await UserModel.create({
        username,
        email,
        name: 'RPA Automation',
        password_hash: hashPassword(crypto.randomBytes(16).toString('hex')),
        role: 'admin',
        is_active: true,
        status: 'active',
        tenant_key: effectiveTenantId,
        is_superadmin: false,
        mfa_enabled: false,
      });
      rpaAgent = { ...buildAgentFromUserRow(created), _passwordHash: created.password_hash };
      agents.set(created.id, rpaAgent);
    } else {
      if (row.role !== 'admin' || row.is_superadmin) {
        await UserModel.update(
          { role: 'admin', is_superadmin: false },
          { where: { id: row.id } },
        );
        row.role = 'admin';
        row.is_superadmin = false;
      }
      rpaAgent = { ...buildAgentFromUserRow(row), _passwordHash: row.password_hash };
      agents.set(row.id, rpaAgent);
    }
  } else if (!rpaAgent) {
    const id = `rpa-${Date.now()}`;
    rpaAgent = {
      id,
      tenantId: effectiveTenantId,
      username,
      email,
      role: 'admin',
      name: 'RPA Automation',
      active: true,
      status: 'active',
      mfaEnabled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLoginAt: null,
      _passwordHash: hashPassword('noop'),
    };
    agents.set(id, rpaAgent);
  }

  // Cria sessão SEM depender de senha (RPA já autenticou via token)
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_EXPIRATION_HOURS * 60 * 60 * 1000);
  const agentSafe = toAgentSafe(rpaAgent);

  const sessionObj = {
    token,
    agentId: rpaAgent.id,
    username: rpaAgent.username,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    lastActivityAt: now.toISOString(),
    lastActivityPersistedAt: now.toISOString(),
    ipAddress,
    userAgent: `RPA/${userAgent}`,
    tenantKey: rpaAgent.tenantId,
    agentSnapshot: agentSafe,
  };

  sessions.set(token, sessionObj);

  if (dbAvailable()) {
    const SessionModel = typeof Session === 'function' ? Session() : Session;
    await SessionModel.create({
      token,
      user_id: rpaAgent.id,
      tenant_key: rpaAgent.tenantId,
      ip_address: ipAddress,
      user_agent: `RPA/${userAgent}`,
      agent_snapshot: agentSafe,
      expires_at: expiresAt,
      last_activity_at: now,
    });
  }

  logger.info('[AuthService] Login RPA realizado', { username: rpaAgent.username, agentId: rpaAgent.id });
  return { success: true, token, agent: agentSafe };
}

// ---------------------------------------------------------------------------
// Convites / Reset de Senha
// ---------------------------------------------------------------------------

async function inviteUser({ tenantId, email, role = 'operator', name = null, username = null }) {
  if (!email) return { success: false, error: 'Email é obrigatório' };
  if (!tenantId) return { success: false, error: 'tenantId é obrigatório' };

  await initialize();

  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  if (!dbAvailable()) {
    return { success: false, error: 'PostgreSQL é obrigatório para convites' };
  }

  const UserModel = typeof User === 'function' ? User() : User;

  const existing = await UserModel.findOne({ where: { email } });
  if (existing) {
    return { success: false, error: 'Usuário já existe' };
  }

  const created = await UserModel.create({
    tenant_key: tenantId,
    username: username || email.split('@')[0],
    email,
    name: name || email.split('@')[0],
    password_hash: hashPassword(crypto.randomBytes(16).toString('hex')),
    role: normalizeRole(role),
    is_active: false,
    status: 'pending',
    is_superadmin: false,
    mfa_enabled: false,
    invitation_token: token,
    invitation_expires_at: expiresAt,
  });

  // Atualiza cache
  agents.set(created.id, {
    ...buildAgentFromUserRow(created),
    _passwordHash: created.password_hash,
    invitationToken: token,
    invitationExpiresAt: expiresAt.toISOString(),
  });

  return { success: true, agentId: created.id, invitationToken: token, invitationExpiresAt: expiresAt.toISOString() };
}

async function acceptInvitation(invitationToken, password, username) {
  if (!invitationToken || !password || !username) {
    return { success: false, error: 'invitationToken, password e username são obrigatórios' };
  }

  await initialize();
  if (!dbAvailable()) return { success: false, error: 'PostgreSQL é obrigatório para aceitar convite' };

  const UserModel = typeof User === 'function' ? User() : User;

  const row = await UserModel.findOne({ where: { invitation_token: invitationToken } });
  if (!row) return { success: false, error: 'Convite inválido' };

  if (row.invitation_expires_at && new Date(row.invitation_expires_at) < new Date()) {
    return { success: false, error: 'Convite expirado' };
  }

  await row.update({
    username,
    password_hash: hashPassword(password),
    is_active: true,
    status: 'active',
    invitation_token: null,
    invitation_expires_at: null,
  });

  // Atualiza cache e faz login
  const agent = { ...buildAgentFromUserRow(row), _passwordHash: row.password_hash };
  agents.set(row.id, agent);

  const loginResult = await login(username, password);
  if (!loginResult.success) {
    return { success: false, error: loginResult.error || 'Falha ao autenticar após aceitar convite' };
  }

  return { success: true, token: loginResult.token, agent: loginResult.agent };
}

async function requestPasswordReset(email) {
  if (!email) return { success: false, error: 'Email é obrigatório' };

  await initialize();
  if (!dbAvailable()) return { success: false, error: 'PostgreSQL é obrigatório para reset de senha' };

  const UserModel = typeof User === 'function' ? User() : User;
  const row = await UserModel.findOne({ where: { email } });
  if (!row) return { success: true };

  const resetToken = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await row.update({
    password_reset_token: resetToken,
    password_reset_expires_at: expiresAt,
  });

  // Não retornamos token publicamente por segurança
  return { success: true };
}

async function resetPassword(resetToken, newPassword) {
  if (!resetToken || !newPassword) {
    return { success: false, error: 'resetToken e newPassword são obrigatórios' };
  }

  await initialize();
  if (!dbAvailable()) return { success: false, error: 'PostgreSQL é obrigatório para reset de senha' };

  const UserModel = typeof User === 'function' ? User() : User;
  const row = await UserModel.findOne({ where: { password_reset_token: resetToken } });
  if (!row) return { success: false, error: 'Token inválido' };

  if (row.password_reset_expires_at && new Date(row.password_reset_expires_at) < new Date()) {
    return { success: false, error: 'Token expirado' };
  }

  await row.update({
    password_hash: hashPassword(newPassword),
    password_reset_token: null,
    password_reset_expires_at: null,
  });

  // Atualiza cache
  const agent = { ...buildAgentFromUserRow(row), _passwordHash: row.password_hash };
  agents.set(row.id, agent);

  return { success: true };
}

module.exports = {
  initialize,
  // agents
  createAgent,
  createSaasSignupAccount,
  listAgents,
  getAgent,
  updateAgent,
  deleteAgent,
  // sessions
  login,
  logout,
  logoutAllSessions,
  validateToken,
  // rpa
  loginWithRpaToken,
  // invite/reset
  inviteUser,
  acceptInvitation,
  requestPasswordReset,
  resetPassword,
  _internal: {
    sessions,
    sweepExpiredSessions,
  },
};

