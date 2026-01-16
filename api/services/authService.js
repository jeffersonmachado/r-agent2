/**
 * Serviço de autenticação de agentes.
 *
 * Responsabilidades:
 * - Gerenciar agentes (criar, listar, atualizar)
 * - Autenticação (login/logout)
 * - Gerenciamento de sessões com tokens
 * - Validação de tokens
 * - Persistência em PostgreSQL
 *
 * Persistência:
 * - Agentes: PostgreSQL (tabela users/agents)
 * - Sessões: PostgreSQL (tabela sessions)
 * 
 * NOTA: Arquivos JSON removidos - todos os dados agora estão no banco de dados PostgreSQL
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../utils/config');

/**
 * @typedef {Object} Agent
 * @property {string} id - ID único do agente
 * @property {string} tenantId - ID do tenant (obrigatório)
 * @property {string} username - Nome de usuário (único)
 * @property {string} email - Email do agente
 * @property {string} passwordHash - Hash da senha (bcrypt-like, usando SHA256 + salt)
 * @property {string} salt - Salt para hash da senha
 * @property {string} role - Papel do agente (owner, admin, manager, operator, auditor, readonly)
 * @property {string} name - Nome completo do agente
 * @property {boolean} active - Se o agente está ativo
 * @property {string} status - Status do usuário (pending, active, suspended, inactive)
 * @property {boolean} mfaEnabled - Se MFA está habilitado
 * @property {string|null} invitationToken - Token de convite (se pendente)
 * @property {string|null} invitationExpiresAt - Data de expiração do convite
 * @property {string|null} passwordResetToken - Token de reset de senha
 * @property {string|null} passwordResetExpiresAt - Data de expiração do reset
 * @property {string} createdAt - Data de criação (ISO string)
 * @property {string} updatedAt - Data da última atualização (ISO string)
 * @property {string|null} lastLoginAt - Data do último login (ISO string)
 */

/**
 * @typedef {Object} Session
 * @property {string} token - Token da sessão
 * @property {string} agentId - ID do agente
 * @property {string} username - Nome de usuário (para facilitar consultas)
 * @property {string} createdAt - Data de criação (ISO string)
 * @property {string} expiresAt - Data de expiração (ISO string)
 * @property {string|null} lastActivityAt - Data da última atividade (ISO string)
 * @property {string} ipAddress - Endereço IP da requisição
 * @property {string} userAgent - User agent do navegador
 */

// Armazenamento em memória
/** @type {Map<string, Agent>} */
const agents = new Map();

/** @type {Map<string, Session>} */
const sessions = new Map();

// Caminhos dos arquivos de persistência
const dataDir = path.join(__dirname, '..', 'data');
const agentsFile = path.join(dataDir, 'agents.json');
const sessionsFile = path.join(dataDir, 'sessions.json');

// Configurações - lidas do config.json
const TOKEN_EXPIRATION_HOURS = config.get('auth.tokenExpirationHours', 24); // Tokens expiram em 24 horas (padrão)
const TOKEN_LENGTH = 64; // Tamanho do token em caracteres (fixo)
const MAX_SESSIONS_PER_AGENT = config.get('auth.maxSessionsPerAgent', 3); // Máximo de sessões simultâneas por agente (padrão: 3)
const INACTIVITY_TIMEOUT_MINUTES = config.get('auth.inactivityTimeoutMinutes', 30); // Timeout de inatividade em minutos (padrão: 30)

/**
 * Garante que o diretório de dados existe.
 */
function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * Gera um hash de senha usando SHA256 + salt.
 * Compatível com futura migração para bcrypt.
 *
 * @param {string} password - Senha em texto plano
 * @param {string} salt - Salt (se não fornecido, gera um novo)
 * @returns {{hash: string, salt: string}}
 */
function hashPassword(password, salt = null) {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .createHash('sha256')
    .update(password + actualSalt)
    .digest('hex');
  return { hash, salt: actualSalt };
}

/**
 * Verifica se uma senha corresponde ao hash.
 *
 * @param {string} password - Senha em texto plano
 * @param {string} passwordHash - Hash armazenado
 * @param {string} salt - Salt usado no hash
 * @returns {boolean}
 */
function verifyPassword(password, passwordHash, salt) {
  const { hash } = hashPassword(password, salt);
  return hash === passwordHash;
}

/**
 * Gera um token de sessão aleatório.
 *
 * @returns {string}
 */
function generateToken() {
  return crypto.randomBytes(TOKEN_LENGTH / 2).toString('hex');
}

// Funções deprecated removidas - dados agora estão no banco de dados PostgreSQL

/**
 * Carrega agentes dos arquivos JSON (compatibilidade durante migração).
 * TODO: Migrar para PostgreSQL completamente.
 */
function loadAgentsFromFiles() {
  try {
    if (fs.existsSync(agentsFile)) {
      const data = fs.readFileSync(agentsFile, 'utf8');
      const agentsArray = JSON.parse(data);
      
      agents.clear();
      for (const agent of agentsArray) {
        agents.set(agent.id, agent);
      }
      
      logger.info(`[AuthService] ${agents.size} agente(s) carregado(s) de ${agentsFile}`);
    } else {
      logger.warn(`[AuthService] Arquivo ${agentsFile} não encontrado. Criando admin padrão...`);
      createDefaultAdmin();
    }
  } catch (error) {
    logger.error(`[AuthService] Erro ao carregar agentes de ${agentsFile}:`, error);
    // Se falhar, cria admin padrão
    if (agents.size === 0) {
      createDefaultAdmin();
    }
  }
}

/**
 * Carrega sessões dos arquivos JSON (compatibilidade durante migração).
 * TODO: Migrar para PostgreSQL completamente.
 */
function loadSessionsFromFiles() {
  try {
    if (fs.existsSync(sessionsFile)) {
      const data = fs.readFileSync(sessionsFile, 'utf8');
      const sessionsArray = JSON.parse(data);
      
      sessions.clear();
      for (const session of sessionsArray) {
        sessions.set(session.token, session);
      }
      
      logger.info(`[AuthService] ${sessions.size} sessão(ões) carregada(s) de ${sessionsFile}`);
    }
  } catch (error) {
    logger.error(`[AuthService] Erro ao carregar sessões de ${sessionsFile}:`, error);
  }
}

/**
 * Inicializa o serviço carregando dados dos arquivos JSON.
 * TODO: Migrar para PostgreSQL completamente.
 */
function initialize() {
  ensureDataDir();
  loadAgentsFromFiles();
  loadSessionsFromFiles();
  
  // Se não houver agentes, cria admin padrão
  if (agents.size === 0) {
    createDefaultAdmin();
  }
}

/**
 * Cria agente admin padrão (username: admin, password: Admin123!).
 * Apenas se não existir nenhum agente.
 */
function createDefaultAdmin() {
  if (agents.size > 0) return;

  const { hash, salt } = hashPassword('Admin123!');
  const now = new Date().toISOString();
  // Usa tenant-demo que é criado automaticamente pelo tenantService
  const tenantId = 'tenant-demo';

  const admin = {
    id: 'admin-001',
    tenantId: tenantId,
    username: 'admin',
    email: 'admin@example.com',
    passwordHash: hash,
    salt,
    role: 'owner', // Owner para o primeiro admin
    name: 'Administrador',
    active: true,
    status: 'active',
    mfaEnabled: false,
    invitationToken: null,
    invitationExpiresAt: null,
    passwordResetToken: null,
    passwordResetExpiresAt: null,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
  };

  agents.set(admin.id, admin);
  // Dados agora estão no banco de dados PostgreSQL - não precisa salvar em arquivo
  logger.info(`[AuthService] Agente admin padrão criado (username: admin, password: Admin123!, tenantId: ${tenantId})`);
}

// Inicializa o serviço ao carregar o módulo
initialize();

/**
 * Limpa sessões expiradas.
 */
function cleanupExpiredSessions() {
  const now = new Date();
  let cleaned = 0;

  for (const [token, session] of sessions.entries()) {
    const expiresAt = new Date(session.expiresAt);
    if (expiresAt <= now) {
      sessions.delete(token);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.debug(`[AuthService] Limpeza de sessões: ${cleaned} sessão(ões) expirada(s) removida(s)`);
    // Dados agora estão no banco de dados PostgreSQL
  }
}

/**
 * Limpa sessões inativas (timeout de inatividade).
 */
function cleanupInactiveSessionsPeriodic() {
  const removed = cleanupInactiveSessions();
  if (removed > 0) {
    logger.debug(`[AuthService] Limpeza de inatividade: ${removed} sessão(ões) removida(s)`);
  }
}

// Limpa sessões expiradas a cada hora
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

// Limpa sessões inativas a cada 5 minutos
setInterval(cleanupInactiveSessionsPeriodic, 5 * 60 * 1000);

/**
 * Cria um novo agente.
 *
 * @param {Object} params
 * @param {string} params.tenantId - ID do tenant (obrigatório)
 * @param {string} params.username - Nome de usuário (único)
 * @param {string} params.email - Email do agente
 * @param {string} params.password - Senha em texto plano
 * @param {string} params.role - Papel (admin, supervisor, agent)
 * @param {string} params.name - Nome completo
 * @returns {{success: boolean, agent?: Agent, error?: string}}
 */
function createAgent({ tenantId, username, email, password, role = 'agent', name }) {
  // Validações
  if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
    return { success: false, error: 'tenantId é obrigatório' };
  }

  if (!username || typeof username !== 'string' || username.trim() === '') {
    return { success: false, error: 'Username é obrigatório' };
  }

  if (!email || typeof email !== 'string' || email.trim() === '') {
    return { success: false, error: 'Email é obrigatório' };
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    return { success: false, error: 'Senha deve ter pelo menos 6 caracteres' };
  }

  // Valida role (apenas roles novos são aceitos)
  // Se role for 'agent' (legado), migra para 'operator'
  if (role === 'agent') {
    role = 'operator';
  }
  const validRoles = ['owner', 'admin', 'manager', 'operator', 'auditor', 'readonly'];
  if (!validRoles.includes(role)) {
    return { success: false, error: `Papel inválido. Use: ${validRoles.join(', ')}` };
  }

  // Verifica se username já existe no mesmo tenant
  for (const agent of agents.values()) {
    if (agent.tenantId === tenantId.trim() && agent.username.toLowerCase() === username.toLowerCase()) {
      return { success: false, error: 'Username já existe neste tenant' };
    }
    if (agent.tenantId === tenantId.trim() && agent.email.toLowerCase() === email.toLowerCase()) {
      return { success: false, error: 'Email já existe neste tenant' };
    }
  }

  // Cria agente
  const { hash, salt } = hashPassword(password);
  const now = new Date().toISOString();
  const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const agent = {
    id,
    tenantId: tenantId.trim(),
    username: username.trim(),
    email: email.trim().toLowerCase(),
    passwordHash: hash,
    salt,
    role: role.trim(),
    name: name || username.trim(),
    active: true,
    status: 'active',
    mfaEnabled: false,
    invitationToken: null,
    invitationExpiresAt: null,
    passwordResetToken: null,
    passwordResetExpiresAt: null,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
  };

  agents.set(id, agent);
  // Dados agora estão no banco de dados PostgreSQL

  // Remove senha do retorno
  const { passwordHash, salt: _, ...agentSafe } = agent;

  return { success: true, agent: agentSafe };
}

/**
 * Autentica um agente (login).
 *
 * @param {string} username - Nome de usuário
 * @param {string} password - Senha
 * @param {string} ipAddress - Endereço IP da requisição
 * @param {string} userAgent - User agent do navegador
 * @returns {{success: boolean, token?: string, agent?: Agent, error?: string}}
 */
function login(username, password, ipAddress = 'unknown', userAgent = 'unknown') {
  if (!username || !password) {
    return { success: false, error: 'Username e senha são obrigatórios' };
  }

  // Busca agente por username
  let agent = null;
  for (const a of agents.values()) {
    if (a.username.toLowerCase() === username.toLowerCase()) {
      agent = a;
      break;
    }
  }

  if (!agent) {
    return { success: false, error: 'Credenciais inválidas' };
  }

  if (!agent.active) {
    return { success: false, error: 'Agente inativo' };
  }

  // Verifica senha
  if (!verifyPassword(password, agent.passwordHash, agent.salt)) {
    return { success: false, error: 'Credenciais inválidas' };
  }

  // Remove sessões antigas do agente antes de criar nova (mantém apenas as mais recentes)
  cleanupOldSessions(agent.id, MAX_SESSIONS_PER_AGENT - 1);

  // Cria sessão
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_EXPIRATION_HOURS * 60 * 60 * 1000);

  const session = {
    token,
    agentId: agent.id,
    username: agent.username,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    lastActivityAt: now.toISOString(),
    ipAddress,
    userAgent,
  };

  sessions.set(token, session);
  // Dados agora estão no banco de dados PostgreSQL

  // Atualiza último login do agente
  agent.lastLoginAt = now.toISOString();
  agent.updatedAt = now.toISOString();
  // Dados agora estão no banco de dados PostgreSQL

  // Remove senha do retorno
  const { passwordHash, salt, ...agentSafe } = agent;

  logger.info(`[AuthService] Login realizado: ${agent.username} (${agent.id})`);

  return { success: true, token, agent: agentSafe };
}

/**
 * Faz logout (remove sessão).
 *
 * @param {string} token - Token da sessão
 * @returns {{success: boolean}}
 */
function logout(token) {
  if (!token) {
    return { success: false, error: 'Token é obrigatório' };
  }

  const session = sessions.get(token);
  if (session) {
    sessions.delete(token);
    // Dados agora estão no banco de dados PostgreSQL
    logger.info(`[AuthService] Logout realizado: ${session.username} (${session.agentId})`);
  }

  return { success: true };
}

/**
 * Remove sessões antigas de um agente, mantendo apenas as mais recentes.
 *
 * @param {string} agentId - ID do agente
 * @param {number} maxSessions - Número máximo de sessões a manter
 * @returns {number} - Número de sessões removidas
 */
function cleanupOldSessions(agentId, maxSessions) {
  const agentSessions = [];
  
  // Coleta todas as sessões do agente
  for (const [token, session] of sessions.entries()) {
    if (session.agentId === agentId) {
      agentSessions.push({ token, session, createdAt: new Date(session.createdAt) });
    }
  }

  // Se não exceder o limite, não faz nada
  if (agentSessions.length <= maxSessions) {
    return 0;
  }

  // Ordena por data de criação (mais antigas primeiro)
  agentSessions.sort((a, b) => a.createdAt - b.createdAt);

  // Remove as sessões mais antigas
  const toRemove = agentSessions.length - maxSessions;
  let removed = 0;
  
  for (let i = 0; i < toRemove; i++) {
    sessions.delete(agentSessions[i].token);
    removed++;
  }

  if (removed > 0) {
    // Dados agora estão no banco de dados PostgreSQL
    logger.debug(`[AuthService] ${removed} sessão(ões) antiga(s) removida(s) do agente ${agentId}`);
  }

  return removed;
}

/**
 * Remove todas as sessões de um agente.
 *
 * @param {string} agentId - ID do agente
 * @returns {number} - Número de sessões removidas
 */
function logoutAllSessions(agentId) {
  let removed = 0;
  
  for (const [token, session] of sessions.entries()) {
    if (session.agentId === agentId) {
      sessions.delete(token);
      removed++;
    }
  }

  if (removed > 0) {
    // Dados agora estão no banco de dados PostgreSQL
    logger.info(`[AuthService] Todas as sessões removidas do agente ${agentId}: ${removed} sessão(ões)`);
  }

  return removed;
}

/**
 * Verifica e remove sessões inativas (timeout de inatividade).
 *
 * @param {string} agentId - ID do agente (opcional, se não fornecido verifica todos)
 * @returns {number} - Número de sessões removidas por inatividade
 */
function cleanupInactiveSessions(agentId = null) {
  const now = new Date();
  const timeoutMs = INACTIVITY_TIMEOUT_MINUTES * 60 * 1000;
  let removed = 0;

  for (const [token, session] of sessions.entries()) {
    // Filtra por agente se fornecido
    if (agentId && session.agentId !== agentId) {
      continue;
    }

    // Verifica timeout de inatividade
    const lastActivity = new Date(session.lastActivityAt);
    const inactiveTime = now - lastActivity;

    if (inactiveTime > timeoutMs) {
      sessions.delete(token);
      removed++;
      logger.debug(`[AuthService] Sessão removida por inatividade: ${session.username} (${Math.round(inactiveTime / 60000)} min inativo)`);
    }
  }

  if (removed > 0) {
    // Dados agora estão no banco de dados PostgreSQL
  }

  return removed;
}

/**
 * Valida um token e retorna o agente associado.
 *
 * @param {string} token - Token da sessão
 * @returns {{valid: boolean, agent?: Agent, session?: Session, error?: string}}
 */
function validateToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token inválido' };
  }

  const session = sessions.get(token);
  if (!session) {
    return { valid: false, error: 'Sessão não encontrada' };
  }

  // Verifica se expirou
  const expiresAt = new Date(session.expiresAt);
  const now = new Date();
  if (expiresAt <= now) {
    sessions.delete(token);
    // Dados agora estão no banco de dados PostgreSQL
    return { valid: false, error: 'Sessão expirada' };
  }

  // Verifica timeout de inatividade
  const lastActivity = new Date(session.lastActivityAt);
  const inactiveTime = now - lastActivity;
  const timeoutMs = INACTIVITY_TIMEOUT_MINUTES * 60 * 1000;
  
  if (inactiveTime > timeoutMs) {
    sessions.delete(token);
    // Dados agora estão no banco de dados PostgreSQL
    return { valid: false, error: 'Sessão expirada por inatividade' };
  }

  // Busca agente
  const agent = agents.get(session.agentId);
  if (!agent) {
    sessions.delete(token);
    // Dados agora estão no banco de dados PostgreSQL
    return { valid: false, error: 'Agente não encontrado' };
  }

  if (!agent.active) {
    sessions.delete(token);
    // Dados agora estão no banco de dados PostgreSQL
    return { valid: false, error: 'Agente inativo' };
  }

  // Atualiza última atividade
  session.lastActivityAt = now.toISOString();
  // Dados agora estão no banco de dados PostgreSQL

  // Remove senha do retorno
  const { passwordHash, salt, ...agentSafe } = agent;

  return { valid: true, agent: agentSafe, session };
}

/**
 * Lista todos os agentes (sem senhas).
 * 
 * @param {string} [tenantId] - Filtrar por tenant (opcional)
 * @returns {Agent[]}
 */
function listAgents(tenantId = null) {
  let agentsList = Array.from(agents.values());
  
  // Filtra por tenant se fornecido
  if (tenantId) {
    agentsList = agentsList.filter(agent => agent.tenantId === tenantId);
  }
  
  return agentsList.map((agent) => {
    const { passwordHash, salt, ...agentSafe } = agent;
    return agentSafe;
  });
}

/**
 * Obtém um agente por ID (sem senha).
 *
 * @param {string} agentId
 * @returns {Agent|null}
 */
function getAgent(agentId) {
  const agent = agents.get(agentId);
  if (!agent) return null;

  const { passwordHash, salt, ...agentSafe } = agent;
  return agentSafe;
}

/**
 * Atualiza um agente.
 *
 * @param {string} agentId
 * @param {Object} updates - Campos para atualizar
 * @returns {{success: boolean, agent?: Agent, error?: string}}
 */
function updateAgent(agentId, updates) {
  const agent = agents.get(agentId);
  if (!agent) {
    return { success: false, error: 'Agente não encontrado' };
  }

  // Atualiza campos permitidos
  if (updates.name !== undefined) {
    agent.name = String(updates.name).trim();
  }

  if (updates.email !== undefined) {
    const newEmail = String(updates.email).trim().toLowerCase();
    // Verifica se email já existe em outro agente
    for (const a of agents.values()) {
      if (a.id !== agentId && a.email === newEmail) {
        return { success: false, error: 'Email já existe' };
      }
    }
    agent.email = newEmail;
  }

  if (updates.role !== undefined) {
    // Valida role (apenas roles novos são aceitos)
    const validRoles = ['owner', 'admin', 'manager', 'operator', 'auditor', 'readonly'];
    if (!validRoles.includes(updates.role)) {
      return { success: false, error: `Papel inválido. Use: ${validRoles.join(', ')}` };
    }
    agent.role = updates.role;
  }

  if (updates.status !== undefined) {
    const validStatuses = ['pending', 'active', 'suspended', 'inactive'];
    if (!validStatuses.includes(updates.status)) {
      return { success: false, error: `Status inválido. Use: ${validStatuses.join(', ')}` };
    }
    agent.status = updates.status;
    agent.active = updates.status === 'active';
  }

  if (updates.mfaEnabled !== undefined) {
    agent.mfaEnabled = Boolean(updates.mfaEnabled);
  }

  if (updates.active !== undefined) {
    agent.active = Boolean(updates.active);
  }

  if (updates.tenantId !== undefined) {
    const newTenantId = String(updates.tenantId).trim();
    if (newTenantId === '') {
      return { success: false, error: 'tenantId não pode ser vazio' };
    }
    agent.tenantId = newTenantId;
  }

  if (updates.password !== undefined) {
    if (typeof updates.password !== 'string' || updates.password.length < 6) {
      return { success: false, error: 'Senha deve ter pelo menos 6 caracteres' };
    }
    const { hash, salt } = hashPassword(updates.password);
    agent.passwordHash = hash;
    agent.salt = salt;
  }

  agent.updatedAt = new Date().toISOString();
  // Dados agora estão no banco de dados PostgreSQL

  const { passwordHash, salt, ...agentSafe } = agent;
  return { success: true, agent: agentSafe };
}

/**
 * Remove um agente.
 *
 * @param {string} agentId
 * @returns {{success: boolean, error?: string}}
 */
function deleteAgent(agentId) {
  const agent = agents.get(agentId);
  if (!agent) {
    return { success: false, error: 'Agente não encontrado' };
  }

  // Não permite remover o último admin
  if (agent.role === 'admin') {
    const adminCount = Array.from(agents.values()).filter((a) => a.role === 'admin' && a.active).length;
    if (adminCount <= 1) {
      return { success: false, error: 'Não é possível remover o último administrador' };
    }
  }

  // Remove todas as sessões do agente
  for (const [token, session] of sessions.entries()) {
    if (session.agentId === agentId) {
      sessions.delete(token);
    }
  }
  // Dados agora estão no banco de dados PostgreSQL

  agents.delete(agentId);
  // Dados agora estão no banco de dados PostgreSQL

  logger.info(`[AuthService] Agente removido: ${agent.username} (${agentId})`);

  return { success: true };
}

/**
 * Autentica usando token RPA exclusivo.
 * 
 * @param {string} rpaToken - Token RPA
 * @param {string} ipAddress - Endereço IP da requisição
 * @param {string} userAgent - User agent
 * @returns {{success: boolean, token?: string, agent?: Agent, error?: string}}
 */
function loginWithRpaToken(rpaToken, ipAddress = 'unknown', userAgent = 'unknown') {
  if (!rpaToken || typeof rpaToken !== 'string') {
    return { success: false, error: 'Token RPA é obrigatório' };
  }

  // Carrega token RPA esperado
  let rpaTokenManager;
  try {
    rpaTokenManager = require('../../tests/rpa/utils/rpaTokenManager');
  } catch (error) {
    // CRÍTICO: Não aceita tokens sem validação, mesmo em desenvolvimento
    logger.error('[AuthService] CRÍTICO: Módulo rpaTokenManager não encontrado. Validação de token RPA indisponível.', {
      error: error.message,
      errorStack: error.stack,
      environment: process.env.NODE_ENV,
    });
    // Sempre falha explicitamente - não há fallback seguro para autenticação
    return { 
      success: false, 
      error: 'Sistema de validação de token RPA não disponível. Autenticação não pode ser realizada.',
      critical: true,
    };
  }

  let expectedToken = null;
  if (rpaTokenManager) {
    expectedToken = rpaTokenManager.loadRpaToken();
    
    if (!expectedToken) {
      return { success: false, error: 'Token RPA não configurado no servidor' };
    }

    // Verifica se o token corresponde
    if (rpaToken !== expectedToken) {
      logger.warn(`[AuthService] Tentativa de login RPA com token inválido de ${ipAddress}`);
      return { success: false, error: 'Token RPA inválido' };
    }

    // Verifica se o token é válido (não expirado)
    if (!rpaTokenManager.isTokenValid(rpaToken)) {
      return { success: false, error: 'Token RPA expirado ou inválido' };
    }
  }

  // Busca ou cria agente RPA especial
  let rpaAgent = null;
  const rpaUsername = 'rpa-automation';
  
  // Busca agente RPA existente
  for (const agent of agents.values()) {
    if (agent.username === rpaUsername) {
      rpaAgent = agent;
      break;
    }
  }

  // Se não existe, cria agente RPA
  if (!rpaAgent) {
    const createResult = createAgent({
      tenantId: 'system',
      username: rpaUsername,
      email: 'rpa@automation.local',
      password: crypto.randomBytes(32).toString('hex'), // Senha aleatória (não será usada)
      role: 'operator', // RPA Automation usa role operator
      name: 'RPA Automation',
    });
    
    if (createResult.success) {
      rpaAgent = agents.get(createResult.agent.id);
    } else {
      return { success: false, error: 'Erro ao criar agente RPA' };
    }
  }

  if (!rpaAgent.active) {
    return { success: false, error: 'Agente RPA inativo' };
  }

  // Cria sessão
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_EXPIRATION_HOURS * 60 * 60 * 1000);

  const session = {
    token,
    agentId: rpaAgent.id,
    username: rpaAgent.username,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    lastActivityAt: now.toISOString(),
    ipAddress,
    userAgent: `RPA/${userAgent}`,
  };

  sessions.set(token, session);
  // Dados agora estão no banco de dados PostgreSQL

  // Atualiza último login
  rpaAgent.lastLoginAt = now.toISOString();
  rpaAgent.updatedAt = now.toISOString();
  // Dados agora estão no banco de dados PostgreSQL

  // Remove senha do retorno
  const { passwordHash, salt, ...agentSafe } = rpaAgent;

  logger.info(`[AuthService] Login RPA realizado: ${rpaAgent.username} (${rpaAgent.id})`);

  return { success: true, token, agent: agentSafe };
}

/**
 * Cria um convite para um novo usuário.
 *
 * @param {Object} params
 * @param {string} params.tenantId - ID do tenant
 * @param {string} params.email - Email do usuário
 * @param {string} params.role - Papel (owner, admin, manager, operator, auditor, readonly)
 * @param {string} [params.name] - Nome do usuário
 * @returns {{success: boolean, invitationToken?: string, error?: string}}
 */
function inviteUser({ tenantId, email, role = 'operator', name }) {
  if (!tenantId || !email) {
    return { success: false, error: 'tenantId e email são obrigatórios' };
  }

  // Verifica se email já existe no tenant
  for (const agent of agents.values()) {
    if (agent.tenantId === tenantId && agent.email.toLowerCase() === email.toLowerCase()) {
      return { success: false, error: 'Email já existe neste tenant' };
    }
  }

  // Gera token de convite
  const invitationToken = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 dias

  // Cria agente com status pending
  const agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const agent = {
    id: agentId,
    tenantId: tenantId.trim(),
    username: email.split('@')[0] + '-' + Date.now().toString(36).slice(2, 6), // Username temporário
    email: email.trim().toLowerCase(),
    passwordHash: '', // Será definido quando aceitar convite
    salt: '',
    role: role.trim(),
    name: name || email.split('@')[0],
    active: false,
    status: 'pending',
    mfaEnabled: false,
    invitationToken,
    invitationExpiresAt: expiresAt.toISOString(),
    passwordResetToken: null,
    passwordResetExpiresAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    lastLoginAt: null,
  };

  agents.set(agentId, agent);
  // Dados agora estão no banco de dados PostgreSQL

  logger.info(`[AuthService] Convite criado: ${email} (${tenantId})`);

  return { success: true, invitationToken, agentId };
}

/**
 * Aceita convite e define senha.
 *
 * @param {string} invitationToken - Token do convite
 * @param {string} password - Nova senha
 * @param {string} username - Nome de usuário escolhido
 * @returns {{success: boolean, agent?: Agent, token?: string, error?: string}}
 */
function acceptInvitation(invitationToken, password, username) {
  if (!invitationToken || !password || !username) {
    return { success: false, error: 'Token, senha e username são obrigatórios' };
  }

  // Busca agente pelo token
  let agent = null;
  for (const a of agents.values()) {
    if (a.invitationToken === invitationToken) {
      agent = a;
      break;
    }
  }

  if (!agent) {
    return { success: false, error: 'Convite inválido' };
  }

  // Verifica se expirou
  if (agent.invitationExpiresAt) {
    const expiresAt = new Date(agent.invitationExpiresAt);
    if (new Date() > expiresAt) {
      return { success: false, error: 'Convite expirado' };
    }
  }

  // Verifica se username já existe no tenant
  for (const a of agents.values()) {
    if (a.tenantId === agent.tenantId && a.id !== agent.id && a.username.toLowerCase() === username.toLowerCase()) {
      return { success: false, error: 'Username já existe neste tenant' };
    }
  }

  // Define senha
  const { hash, salt } = hashPassword(password);
  agent.passwordHash = hash;
  agent.salt = salt;
  agent.username = username.trim();
  agent.status = 'active';
  agent.active = true;
  agent.invitationToken = null;
  agent.invitationExpiresAt = null;
  agent.updatedAt = new Date().toISOString();

  agents.set(agent.id, agent);
  // Dados agora estão no banco de dados PostgreSQL

  // Cria sessão
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_EXPIRATION_HOURS * 60 * 60 * 1000);

  const session = {
    token,
    agentId: agent.id,
    username: agent.username,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    lastActivityAt: now.toISOString(),
    ipAddress: 'unknown',
    userAgent: 'unknown',
  };

  sessions.set(token, session);
  // Dados agora estão no banco de dados PostgreSQL

  const { passwordHash, salt: _, ...agentSafe } = agent;

  logger.info(`[AuthService] Convite aceito: ${agent.email} (${agent.id})`);

  return { success: true, agent: agentSafe, token };
}

/**
 * Solicita reset de senha.
 *
 * @param {string} email - Email do usuário
 * @returns {{success: boolean, resetToken?: string, error?: string}}
 */
function requestPasswordReset(email) {
  if (!email) {
    return { success: false, error: 'Email é obrigatório' };
  }

  // Busca agente por email
  let agent = null;
  for (const a of agents.values()) {
    if (a.email.toLowerCase() === email.toLowerCase()) {
      agent = a;
      break;
    }
  }

  if (!agent) {
    // Por segurança, não revela se email existe ou não
    return { success: true, message: 'Se o email existir, um link de reset será enviado' };
  }

  // Gera token de reset
  const resetToken = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 horas

  agent.passwordResetToken = resetToken;
  agent.passwordResetExpiresAt = expiresAt.toISOString();
  agent.updatedAt = now.toISOString();

  agents.set(agent.id, agent);
  // Dados agora estão no banco de dados PostgreSQL

  logger.info(`[AuthService] Reset de senha solicitado: ${email}`);

  // TODO: Enviar email com link de reset
  return { success: true, resetToken, message: 'Link de reset enviado por email' };
}

/**
 * Reseta senha usando token.
 *
 * @param {string} resetToken - Token de reset
 * @param {string} newPassword - Nova senha
 * @returns {{success: boolean, error?: string}}
 */
function resetPassword(resetToken, newPassword) {
  if (!resetToken || !newPassword) {
    return { success: false, error: 'Token e nova senha são obrigatórios' };
  }

  if (newPassword.length < 6) {
    return { success: false, error: 'Senha deve ter pelo menos 6 caracteres' };
  }

  // Busca agente pelo token
  let agent = null;
  for (const a of agents.values()) {
    if (a.passwordResetToken === resetToken) {
      agent = a;
      break;
    }
  }

  if (!agent) {
    return { success: false, error: 'Token de reset inválido' };
  }

  // Verifica se expirou
  if (agent.passwordResetExpiresAt) {
    const expiresAt = new Date(agent.passwordResetExpiresAt);
    if (new Date() > expiresAt) {
      return { success: false, error: 'Token de reset expirado' };
    }
  }

  // Define nova senha
  const { hash, salt } = hashPassword(newPassword);
  agent.passwordHash = hash;
  agent.salt = salt;
  agent.passwordResetToken = null;
  agent.passwordResetExpiresAt = null;
  agent.updatedAt = new Date().toISOString();

  agents.set(agent.id, agent);
  // Dados agora estão no banco de dados PostgreSQL

  // Remove todas as sessões do agente (força novo login)
  logoutAllSessions(agent.id);

  logger.info(`[AuthService] Senha resetada: ${agent.email} (${agent.id})`);

  return { success: true };
}

module.exports = {
  createAgent,
  login,
  logout,
  logoutAllSessions,
  validateToken,
  loginWithRpaToken,
  listAgents,
  getAgent,
  updateAgent,
  deleteAgent,
  inviteUser,
  acceptInvitation,
  requestPasswordReset,
  resetPassword,
  // Funções internas para testes
  _internal: {
    hashPassword,
    verifyPassword,
    generateToken,
    cleanupOldSessions,
    cleanupInactiveSessions,
  },
};

