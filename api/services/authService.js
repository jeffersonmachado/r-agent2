/**
 * Serviço de autenticação de agentes.
 *
 * Responsabilidades:
 * - Gerenciar agentes (criar, listar, atualizar)
 * - Autenticação (login/logout)
 * - Gerenciamento de sessões com tokens
 * - Validação de tokens
 * - Persistência em JSON
 *
 * Persistência:
 * - Agentes: api/data/agents.json
 * - Sessões: api/data/sessions.json
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
 * @property {string} role - Papel do agente (admin, supervisor, agent)
 * @property {string} name - Nome completo do agente
 * @property {boolean} active - Se o agente está ativo
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

// Configurações
const TOKEN_EXPIRATION_HOURS = 24; // Tokens expiram em 24 horas
const TOKEN_LENGTH = 64; // Tamanho do token em caracteres

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

/**
 * Salva agentes no arquivo JSON.
 */
function saveAgentsToFile() {
  try {
    ensureDataDir();
    const agentsArray = Array.from(agents.values());
    const data = JSON.stringify(agentsArray, null, 2);
    fs.writeFileSync(agentsFile, data, 'utf8');
    logger.debug(`[AuthService] Agentes salvos: ${agentsArray.length} agente(s)`);
  } catch (err) {
    logger.error('[AuthService] Erro ao salvar agentes:', err);
  }
}

/**
 * Carrega agentes do arquivo JSON.
 * Migra agentes existentes sem tenantId para o tenant padrão.
 */
function loadAgentsFromFile() {
  try {
    ensureDataDir();
    if (!fs.existsSync(agentsFile)) {
      logger.info(`[AuthService] Arquivo de agentes não encontrado: ${agentsFile}. Iniciando com dados vazios.`);
      // Cria agente admin padrão se não existir
      createDefaultAdmin();
      return;
    }

    const data = fs.readFileSync(agentsFile, 'utf8');
    const agentsArray = JSON.parse(data);
    const defaultTenantId = config.get('api.defaultTenantId', 'tenant-demo');
    let migrated = 0;

    if (Array.isArray(agentsArray)) {
      agents.clear();
      for (const agent of agentsArray) {
        if (agent && agent.id && agent.username) {
          // Migração: adiciona tenantId se não existir
          if (!agent.tenantId || typeof agent.tenantId !== 'string' || agent.tenantId.trim() === '') {
            agent.tenantId = defaultTenantId;
            migrated++;
          }
          agents.set(agent.id, agent);
        }
      }
      logger.info(`[AuthService] Agentes carregados: ${agents.size} agente(s)`);
      if (migrated > 0) {
        logger.info(`[AuthService] ${migrated} agente(s) migrado(s) para tenant padrão: ${defaultTenantId}`);
        saveAgentsToFile(); // Salva com tenantId
      }
    }
  } catch (err) {
    logger.error('[AuthService] Erro ao carregar agentes:', err);
    // Cria agente admin padrão em caso de erro
    createDefaultAdmin();
  }
}

/**
 * Salva sessões no arquivo JSON.
 */
function saveSessionsToFile() {
  try {
    ensureDataDir();
    const sessionsArray = Array.from(sessions.values());
    const data = JSON.stringify(sessionsArray, null, 2);
    fs.writeFileSync(sessionsFile, data, 'utf8');
    logger.debug(`[AuthService] Sessões salvas: ${sessionsArray.length} sessão(ões)`);
  } catch (err) {
    logger.error('[AuthService] Erro ao salvar sessões:', err);
  }
}

/**
 * Carrega sessões do arquivo JSON.
 */
function loadSessionsFromFile() {
  try {
    ensureDataDir();
    if (!fs.existsSync(sessionsFile)) {
      logger.info(`[AuthService] Arquivo de sessões não encontrado: ${sessionsFile}. Iniciando com dados vazios.`);
      return;
    }

    const data = fs.readFileSync(sessionsFile, 'utf8');
    const sessionsArray = JSON.parse(data);

    if (Array.isArray(sessionsArray)) {
      sessions.clear();
      const now = new Date();
      for (const session of sessionsArray) {
        // Remove sessões expiradas ao carregar
        const expiresAt = new Date(session.expiresAt);
        if (expiresAt > now) {
          sessions.set(session.token, session);
        }
      }
      logger.info(`[AuthService] Sessões carregadas: ${sessions.size} sessão(ões) válida(s)`);
    }
  } catch (err) {
    logger.error('[AuthService] Erro ao carregar sessões:', err);
  }
}

/**
 * Cria agente admin padrão (username: admin, password: admin123).
 * Apenas se não existir nenhum agente.
 */
function createDefaultAdmin() {
  if (agents.size > 0) return;

  const { hash, salt } = hashPassword('admin123');
  const now = new Date().toISOString();
  const defaultTenantId = config.get('api.defaultTenantId', 'tenant-demo');

  const admin = {
    id: 'admin-001',
    tenantId: defaultTenantId,
    username: 'admin',
    email: 'admin@example.com',
    passwordHash: hash,
    salt,
    role: 'admin',
    name: 'Administrador',
    active: true,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
  };

  agents.set(admin.id, admin);
  saveAgentsToFile();
  logger.info(`[AuthService] Agente admin padrão criado (username: admin, password: admin123, tenantId: ${defaultTenantId})`);
}

// Carrega dados ao iniciar o módulo
loadAgentsFromFile();
loadSessionsFromFile();

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
    saveSessionsToFile();
  }
}

// Limpa sessões expiradas a cada hora
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

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

  if (!['admin', 'supervisor', 'agent'].includes(role)) {
    return { success: false, error: 'Papel inválido. Use: admin, supervisor ou agent' };
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
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
  };

  agents.set(id, agent);
  saveAgentsToFile();

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
  saveSessionsToFile();

  // Atualiza último login do agente
  agent.lastLoginAt = now.toISOString();
  agent.updatedAt = now.toISOString();
  saveAgentsToFile();

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
    saveSessionsToFile();
    logger.info(`[AuthService] Logout realizado: ${session.username} (${session.agentId})`);
  }

  return { success: true };
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
    saveSessionsToFile();
    return { valid: false, error: 'Sessão expirada' };
  }

  // Busca agente
  const agent = agents.get(session.agentId);
  if (!agent) {
    sessions.delete(token);
    saveSessionsToFile();
    return { valid: false, error: 'Agente não encontrado' };
  }

  if (!agent.active) {
    sessions.delete(token);
    saveSessionsToFile();
    return { valid: false, error: 'Agente inativo' };
  }

  // Atualiza última atividade
  session.lastActivityAt = now.toISOString();
  saveSessionsToFile();

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
    if (!['admin', 'supervisor', 'agent'].includes(updates.role)) {
      return { success: false, error: 'Papel inválido' };
    }
    agent.role = updates.role;
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
  saveAgentsToFile();

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
  saveSessionsToFile();

  agents.delete(agentId);
  saveAgentsToFile();

  logger.info(`[AuthService] Agente removido: ${agent.username} (${agentId})`);

  return { success: true };
}

module.exports = {
  createAgent,
  login,
  logout,
  validateToken,
  listAgents,
  getAgent,
  updateAgent,
  deleteAgent,
  // Funções internas para testes
  _internal: {
    hashPassword,
    verifyPassword,
    generateToken,
    saveAgentsToFile,
    loadAgentsFromFile,
    saveSessionsToFile,
    loadSessionsFromFile,
  },
};

