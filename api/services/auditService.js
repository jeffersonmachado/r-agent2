/**
 * Serviço de auditoria de ações de agentes.
 *
 * Responsabilidades:
 * - Registrar ações de agentes (login, logout, criação de tickets, etc.)
 * - Persistir logs de auditoria em JSON
 * - Consultar histórico de ações
 *
 * Persistência:
 * - Logs: api/data/audit.json
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * @typedef {Object} AuditLog
 * @property {string} id - ID único do log
 * @property {string} timestamp - Data/hora da ação (ISO string)
 * @property {string} agentId - ID do agente que realizou a ação
 * @property {string} username - Nome de usuário (para facilitar consultas)
 * @property {string} action - Ação realizada (login, logout, ticket_create, ticket_assign, etc.)
 * @property {string} resource - Recurso afetado (ticket, queue, agent, etc.)
 * @property {string|null} resourceId - ID do recurso afetado (se aplicável)
 * @property {Object|null} details - Detalhes adicionais da ação
 * @property {string} ipAddress - Endereço IP da requisição
 * @property {string} userAgent - User agent do navegador
 */

// Armazenamento em memória (limitado para performance)
/** @type {Array<AuditLog>} */
const auditLogs = [];

// Caminho do arquivo de persistência
const dataDir = path.join(__dirname, '..', 'data');
const auditFile = path.join(dataDir, 'audit.json');

// Configurações
const MAX_MEMORY_LOGS = 1000; // Mantém apenas os últimos 1000 logs em memória
const MAX_FILE_LOGS = 10000; // Limite de logs no arquivo (rotação)

/**
 * Garante que o diretório de dados existe.
 */
function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * Salva logs de auditoria no arquivo JSON.
 */
function saveAuditToFile() {
  try {
    ensureDataDir();
    
    // Carrega logs existentes
    let existingLogs = [];
    if (fs.existsSync(auditFile)) {
      try {
        const data = fs.readFileSync(auditFile, 'utf8');
        existingLogs = JSON.parse(data);
        if (!Array.isArray(existingLogs)) {
          existingLogs = [];
        }
      } catch (err) {
        logger.warn('[AuditService] Erro ao ler arquivo de auditoria, criando novo:', err.message);
        existingLogs = [];
      }
    }

    // Adiciona novos logs
    existingLogs.push(...auditLogs);

    // Limita tamanho do arquivo (mantém apenas os últimos MAX_FILE_LOGS)
    if (existingLogs.length > MAX_FILE_LOGS) {
      existingLogs = existingLogs.slice(-MAX_FILE_LOGS);
    }

    // Salva
    const data = JSON.stringify(existingLogs, null, 2);
    fs.writeFileSync(auditFile, data, 'utf8');
    
    logger.debug(`[AuditService] Logs salvos: ${auditLogs.length} novo(s), ${existingLogs.length} total`);
    
    // Limpa logs da memória após salvar
    auditLogs.length = 0;
  } catch (err) {
    logger.error('[AuditService] Erro ao salvar logs de auditoria:', err);
  }
}

/**
 * Carrega logs de auditoria do arquivo JSON (apenas os mais recentes para memória).
 */
function loadAuditFromFile() {
  try {
    ensureDataDir();
    if (!fs.existsSync(auditFile)) {
      logger.info(`[AuditService] Arquivo de auditoria não encontrado: ${auditFile}. Iniciando com dados vazios.`);
      return;
    }

    const data = fs.readFileSync(auditFile, 'utf8');
    const logs = JSON.parse(data);

    if (Array.isArray(logs)) {
      // Carrega apenas os últimos MAX_MEMORY_LOGS para memória
      const recentLogs = logs.slice(-MAX_MEMORY_LOGS);
      auditLogs.push(...recentLogs);
      logger.info(`[AuditService] Logs carregados: ${recentLogs.length} log(s) recente(s) de ${logs.length} total`);
    }
  } catch (err) {
    logger.error('[AuditService] Erro ao carregar logs de auditoria:', err);
  }
}

// Carrega dados ao iniciar o módulo
loadAuditFromFile();

// Salva logs periodicamente (a cada 5 minutos)
setInterval(() => {
  if (auditLogs.length > 0) {
    saveAuditToFile();
  }
}, 5 * 60 * 1000);

// Salva logs ao encerrar o processo
process.on('beforeExit', () => {
  if (auditLogs.length > 0) {
    saveAuditToFile();
  }
});

/**
 * Registra uma ação de auditoria.
 *
 * @param {Object} params
 * @param {string} params.agentId - ID do agente
 * @param {string} params.username - Nome de usuário
 * @param {string} [params.tenantId] - ID do tenant (opcional, será extraído do agente se não fornecido)
 * @param {string} params.action - Ação (login, logout, ticket_create, etc.)
 * @param {string} params.resource - Recurso (ticket, queue, agent, etc.)
 * @param {string|null} params.resourceId - ID do recurso (opcional)
 * @param {Object|null} params.details - Detalhes adicionais (opcional)
 * @param {string} params.ipAddress - Endereço IP
 * @param {string} params.userAgent - User agent
 */
function logAction({ agentId, username, tenantId = null, action, resource, resourceId = null, details = null, ipAddress = 'unknown', userAgent = 'unknown' }) {
  // Tenta obter tenantId do agente se não fornecido
  let effectiveTenantId = tenantId;
  if (!effectiveTenantId && agentId && agentId !== 'system') {
    try {
      const { getAgent } = require('./authService');
      const agent = getAgent(agentId);
      if (agent && agent.tenantId) {
        effectiveTenantId = agent.tenantId;
      }
    } catch (err) {
      // Ignora erro se não conseguir obter agente
    }
  }

  const log = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date().toISOString(),
    agentId: agentId || 'system',
    username: username || 'system',
    tenantId: effectiveTenantId || null,
    action,
    resource,
    resourceId,
    details,
    ipAddress,
    userAgent,
  };

  auditLogs.push(log);

  // Se atingir limite de memória, salva imediatamente
  if (auditLogs.length >= MAX_MEMORY_LOGS) {
    saveAuditToFile();
  }

  logger.debug(`[AuditService] Ação registrada: ${action} em ${resource} por ${username}`);
}

/**
 * Consulta logs de auditoria.
 *
 * @param {Object} [filters]
 * @param {string} [filters.agentId] - Filtrar por agente
 * @param {string} [filters.action] - Filtrar por ação
 * @param {string} [filters.resource] - Filtrar por recurso
 * @param {string} [filters.resourceId] - Filtrar por ID do recurso
 * @param {Date|string} [filters.startDate] - Data inicial
 * @param {Date|string} [filters.endDate] - Data final
 * @param {number} [filters.limit] - Limite de resultados (padrão: 100, máximo: 1000)
 * @param {number} [filters.offset] - Offset para paginação
 * @returns {{logs: AuditLog[], total: number, limit: number, offset: number}}
 */
function queryLogs(filters = {}) {
  try {
    // Carrega todos os logs do arquivo
    let allLogs = [];
    if (fs.existsSync(auditFile)) {
      const data = fs.readFileSync(auditFile, 'utf8');
      allLogs = JSON.parse(data);
      if (!Array.isArray(allLogs)) {
        allLogs = [];
      }
    }

    // Adiciona logs da memória
    allLogs.push(...auditLogs);

    // Aplica filtros
    let filteredLogs = allLogs;

    if (filters.agentId) {
      filteredLogs = filteredLogs.filter((log) => log.agentId === filters.agentId);
    }

    if (filters.username) {
      filteredLogs = filteredLogs.filter((log) => log.username.toLowerCase().includes(filters.username.toLowerCase()));
    }

    if (filters.action) {
      filteredLogs = filteredLogs.filter((log) => log.action === filters.action);
    }

    if (filters.resource) {
      filteredLogs = filteredLogs.filter((log) => log.resource === filters.resource);
    }

    if (filters.resourceId) {
      filteredLogs = filteredLogs.filter((log) => log.resourceId === filters.resourceId);
    }

    if (filters.tenantId) {
      filteredLogs = filteredLogs.filter((log) => log.tenantId === filters.tenantId);
    }

    if (filters.startDate) {
      const startDate = filters.startDate instanceof Date ? filters.startDate : new Date(filters.startDate);
      filteredLogs = filteredLogs.filter((log) => new Date(log.timestamp) >= startDate);
    }

    if (filters.endDate) {
      const endDate = filters.endDate instanceof Date ? filters.endDate : new Date(filters.endDate);
      filteredLogs = filteredLogs.filter((log) => new Date(log.timestamp) <= endDate);
    }

    // Ordena por timestamp (mais recentes primeiro)
    filteredLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const total = filteredLogs.length;

    // Aplica paginação
    const limit = Math.min(Math.max(1, parseInt(filters.limit, 10) || 100), 1000);
    const offset = Math.max(0, parseInt(filters.offset, 10) || 0);
    const paginatedLogs = filteredLogs.slice(offset, offset + limit);

    return {
      logs: paginatedLogs,
      total,
      limit,
      offset,
    };
  } catch (err) {
    logger.error('[AuditService] Erro ao consultar logs:', err);
    return {
      logs: [],
      total: 0,
      limit: filters.limit || 100,
      offset: filters.offset || 0,
    };
  }
}

/**
 * Obtém estatísticas de auditoria.
 *
 * @param {Object} [filters] - Mesmos filtros de queryLogs
 * @returns {Object}
 */
function getAuditStats(filters = {}) {
  const { logs } = queryLogs({ ...filters, limit: 10000 }); // Busca mais logs para estatísticas

  const stats = {
    totalActions: logs.length,
    actionsByType: {},
    actionsByAgent: {},
    actionsByResource: {},
    recentActivity: logs.slice(0, 10), // 10 ações mais recentes
  };

  logs.forEach((log) => {
    // Contagem por tipo de ação
    stats.actionsByType[log.action] = (stats.actionsByType[log.action] || 0) + 1;

    // Contagem por agente
    stats.actionsByAgent[log.username] = (stats.actionsByAgent[log.username] || 0) + 1;

    // Contagem por recurso
    stats.actionsByResource[log.resource] = (stats.actionsByResource[log.resource] || 0) + 1;
  });

  return stats;
}

module.exports = {
  logAction,
  queryLogs,
  getAuditStats,
  // Funções internas para testes
  _internal: {
    saveAuditToFile,
    loadAuditFromFile,
  },
};

