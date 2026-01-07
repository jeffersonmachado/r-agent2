/**
 * Serviço de Auditoria.
 * 
 * Registra ações do sistema e gera relatórios de auditoria para gerações de fluxos e testes RPA.
 * Mantém rastreabilidade completa de decisões humanas e fontes utilizadas.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const AUDIT_DIR = path.join(__dirname, '..', '..', 'governance', 'audit');
const REPORTS_DIR = path.join(AUDIT_DIR, 'reports');
const LOGS_DIR = path.join(AUDIT_DIR, 'logs');

// Garante que os diretórios existem
if (!fs.existsSync(AUDIT_DIR)) {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
}
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// ============================================================================
// AUDITORIA DE AÇÕES DO SISTEMA (logAction, queryLogs, getAuditStats)
// ============================================================================

const auditLogs = [];
const MAX_MEMORY_LOGS = 1000;
const LOG_FILE = path.join(LOGS_DIR, 'audit.log');

/**
 * Salva logs em arquivo.
 */
function saveAuditToFile() {
  if (auditLogs.length === 0) return;

  try {
    const logContent = auditLogs.map(log => JSON.stringify(log)).join('\n') + '\n';
    fs.appendFileSync(LOG_FILE, logContent, 'utf8');
    auditLogs.length = 0; // Limpa array após salvar
  } catch (err) {
    logger.error('Erro ao salvar logs de auditoria', err);
  }
}

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
 * REGRA: tenant_id é OBRIGATÓRIO. Se não fornecido, tenta obter do agente.
 *
 * @param {Object} params
 * @param {string} params.agentId - ID do agente
 * @param {string} params.username - Nome de usuário
 * @param {string} params.tenantId - ID do tenant (OBRIGATÓRIO, será extraído do agente se não fornecido)
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
      logger.warn('[AuditService] Erro ao obter tenantId do agente', { agentId, error: err.message });
    }
  }

  // Se ainda não tem tenantId, tenta obter do request (se disponível)
  if (!effectiveTenantId && typeof req !== 'undefined' && req.tenantId) {
    effectiveTenantId = req.tenantId;
  }

  // CRÍTICO: Se ainda não tem tenantId, registra como 'unknown' mas loga warning
  if (!effectiveTenantId || effectiveTenantId === 'default') {
    logger.warn('[AuditService] Ação de auditoria sem tenantId', {
      agentId,
      action,
      resource,
    });
    effectiveTenantId = 'unknown';
  }

  const logEntry = {
    timestamp: new Date().toISOString(),
    agentId: agentId || 'system',
    username: username || 'system',
    tenantId: effectiveTenantId, // SEMPRE presente agora
    action,
    resource,
    resourceId,
    details,
    ipAddress,
    userAgent,
    metadata: {
      // Metadados adicionais para compliance
      source: 'api',
      version: '1.0',
    },
  };

  auditLogs.push(logEntry);

  // Se exceder limite de memória, salva em arquivo
  if (auditLogs.length >= MAX_MEMORY_LOGS) {
    saveAuditToFile();
  }

  logger.debug('Ação de auditoria registrada', { action, resource, resourceId });
}

/**
 * Consulta logs de auditoria.
 *
 * @param {Object} filters - Filtros (agentId, action, resource, startDate, endDate, tenantId)
 * @returns {Array} Logs encontrados
 */
function queryLogs(filters = {}) {
  // Carrega logs do arquivo se necessário
  let allLogs = [...auditLogs];

  if (fs.existsSync(LOG_FILE)) {
    try {
      const fileContent = fs.readFileSync(LOG_FILE, 'utf8');
      const fileLogs = fileContent
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try {
            return JSON.parse(line);
          } catch (err) {
            return null;
          }
        })
        .filter(log => log !== null);

      allLogs = [...fileLogs, ...allLogs];
    } catch (err) {
      logger.warn('Erro ao carregar logs de arquivo', err);
    }
  }

  // Aplica filtros
  let filtered = allLogs;

  if (filters.agentId) {
    filtered = filtered.filter(log => log.agentId === filters.agentId);
  }

  if (filters.action) {
    filtered = filtered.filter(log => log.action === filters.action);
  }

  if (filters.resource) {
    filtered = filtered.filter(log => log.resource === filters.resource);
  }

  if (filters.tenantId) {
    filtered = filtered.filter(log => log.tenantId === filters.tenantId);
  }

  if (filters.startDate) {
    const start = new Date(filters.startDate);
    filtered = filtered.filter(log => new Date(log.timestamp) >= start);
  }

  if (filters.endDate) {
    const end = new Date(filters.endDate);
    filtered = filtered.filter(log => new Date(log.timestamp) <= end);
  }

  // Ordena por timestamp (mais recente primeiro)
  filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // Limita resultados (padrão: 1000)
  const limit = filters.limit || 1000;
  return filtered.slice(0, limit);
}

/**
 * Obtém estatísticas de auditoria.
 *
 * @returns {Object} Estatísticas
 */
function getAuditStats() {
  const logs = queryLogs({ limit: 10000 }); // Últimos 10k logs para estatísticas

  const stats = {
    total: logs.length,
    byAction: {},
    byResource: {},
    byAgent: {},
    recent: logs.slice(0, 100), // Últimos 100 logs
  };

  logs.forEach(log => {
    // Por ação
    stats.byAction[log.action] = (stats.byAction[log.action] || 0) + 1;

    // Por recurso
    stats.byResource[log.resource] = (stats.byResource[log.resource] || 0) + 1;

    // Por agente
    stats.byAgent[log.agentId] = (stats.byAgent[log.agentId] || 0) + 1;
  });

  return stats;
}

// ============================================================================
// AUDITORIA DE GERAÇÃO (registerGeneration, generateAuditReport, queryAuditRecords)
// ============================================================================

/**
 * Registra uma geração para auditoria.
 * 
 * @param {Object} auditData - Dados de auditoria
 * @returns {string} ID do registro de auditoria
 */
function registerGeneration(auditData) {
  const auditId = `audit-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const timestamp = new Date().toISOString();

  const record = {
    id: auditId,
    timestamp,
    ...auditData,
  };

  // Salva registro individual
  const recordPath = path.join(AUDIT_DIR, `${auditId}.json`);
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2), 'utf8');

  // Adiciona ao índice
  const indexPath = path.join(AUDIT_DIR, 'index.json');
  let index = [];
  if (fs.existsSync(indexPath)) {
    try {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    } catch (err) {
      logger.warn('Erro ao carregar índice de auditoria, criando novo', err);
      index = [];
    }
  }

  index.push({
    id: auditId,
    timestamp,
    flowId: auditData.artifacts?.flowId,
    rpaTestId: auditData.artifacts?.rpaTestId,
    sources: auditData.context?.sources || [],
  });

  // Mantém apenas últimos 1000 registros no índice
  if (index.length > 1000) {
    index = index.slice(-1000);
  }

  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');

  logger.info('Registro de auditoria criado', { auditId, flowId: auditData.artifacts?.flowId });

  return auditId;
}

/**
 * Gera relatório de auditoria cognitiva.
 * 
 * @param {Object} auditMetadata - Metadata de auditoria
 * @param {Object} options - Opções (format: 'json' | 'text')
 * @returns {Object} Relatório gerado
 */
function generateAuditReport(auditMetadata, options = {}) {
  const format = options.format || 'json';
  const timestamp = new Date().toISOString();

  const report = {
    reportId: `report-${Date.now()}`,
    generatedAt: timestamp,
    payload: auditMetadata.payload,
    context: auditMetadata.context,
    artifacts: auditMetadata.artifacts,
    contract: auditMetadata.contract,
    humanDecisions: {
      useRag: auditMetadata.payload.useRag,
      ragSources: auditMetadata.payload.ragSources,
      useWebScraping: auditMetadata.payload.useWebScraping,
      scrapingTargets: auditMetadata.payload.scrapingTargets,
      generateRpaTest: auditMetadata.payload.generateRpaTest,
      rpaMode: auditMetadata.payload.rpaMode,
    },
    summary: {
      sourcesUsed: auditMetadata.context.sources,
      flowGenerated: !!auditMetadata.artifacts.flowId,
      rpaTestGenerated: !!auditMetadata.artifacts.rpaTestId,
      nodeCount: auditMetadata.artifacts.nodeCount || 0,
      rpaStepsCount: auditMetadata.artifacts.rpaTestSteps || 0,
    },
  };

  // Salva relatório
  const reportPath = path.join(REPORTS_DIR, `${report.reportId}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  // Gera versão texto se solicitado
  if (format === 'text' || format === 'both') {
    const textReport = generateTextReport(report);
    const textReportPath = path.join(REPORTS_DIR, `${report.reportId}.txt`);
    fs.writeFileSync(textReportPath, textReport, 'utf8');
  }

  logger.info('Relatório de auditoria gerado', { reportId: report.reportId });

  return report;
}

/**
 * Gera relatório em formato texto legível.
 * 
 * @param {Object} report - Relatório JSON
 * @returns {string} Relatório em texto
 */
function generateTextReport(report) {
  const lines = [];

  lines.push('='.repeat(80));
  lines.push('RELATÓRIO DE AUDITORIA COGNITIVA');
  lines.push('='.repeat(80));
  lines.push('');
  lines.push(`ID do Relatório: ${report.reportId}`);
  lines.push(`Gerado em: ${report.generatedAt}`);
  lines.push('');

  lines.push('-'.repeat(80));
  lines.push('PAYLOAD ORIGINAL');
  lines.push('-'.repeat(80));
  lines.push(`Nome: ${report.payload.name}`);
  lines.push(`Descrição: ${report.payload.description?.substring(0, 200)}...`);
  lines.push('');

  lines.push('-'.repeat(80));
  lines.push('DECISÕES HUMANAS EXPLÍCITAS');
  lines.push('-'.repeat(80));
  lines.push(`Usar RAG: ${report.humanDecisions.useRag ? 'SIM' : 'NÃO'}`);
  if (report.humanDecisions.useRag) {
    lines.push(`  Fontes RAG: ${report.humanDecisions.ragSources.join(', ')}`);
  }
  lines.push(`Usar Scraping: ${report.humanDecisions.useWebScraping ? 'SIM' : 'NÃO'}`);
  if (report.humanDecisions.useWebScraping) {
    lines.push(`  URLs: ${report.humanDecisions.scrapingTargets.join(', ')}`);
  }
  lines.push(`Gerar Teste RPA: ${report.humanDecisions.generateRpaTest ? 'SIM' : 'NÃO'}`);
  if (report.humanDecisions.generateRpaTest) {
    lines.push(`  Modo RPA: ${report.humanDecisions.rpaMode}`);
  }
  lines.push('');

  lines.push('-'.repeat(80));
  lines.push('CONTEXTO RESOLVIDO');
  lines.push('-'.repeat(80));
  lines.push(`Fontes utilizadas: ${report.context.sources.join(', ')}`);
  if (report.context.rag) {
    lines.push(`RAG: ${report.context.rag.sources.join(', ')}`);
  }
  if (report.context.scraping) {
    lines.push(`Scraping: ${report.context.scraping.targets.length} URL(s)`);
  }
  lines.push('');

  lines.push('-'.repeat(80));
  lines.push('ARTEFATOS GERADOS');
  lines.push('-'.repeat(80));
  lines.push(`Fluxo ID: ${report.artifacts.flowId || 'N/A'}`);
  lines.push(`Fluxo Nome: ${report.artifacts.flowName || 'N/A'}`);
  lines.push(`Nós: ${report.artifacts.nodeCount || 0}`);
  if (report.artifacts.rpaTestId) {
    lines.push(`Teste RPA ID: ${report.artifacts.rpaTestId}`);
    lines.push(`Passos RPA: ${report.artifacts.rpaTestSteps || 0}`);
    lines.push(`Asserts RPA: ${report.artifacts.rpaTestAsserts || 0}`);
  }
  lines.push('');

  lines.push('-'.repeat(80));
  lines.push('CONTRATO');
  lines.push('-'.repeat(80));
  lines.push(`Hash: ${report.contract.hash || 'N/A'}`);
  lines.push(`Versão: ${report.contract.version || 'N/A'}`);
  lines.push('');

  lines.push('-'.repeat(80));
  lines.push('RESUMO');
  lines.push('-'.repeat(80));
  lines.push(`Fontes utilizadas: ${report.summary.sourcesUsed.join(', ')}`);
  lines.push(`Fluxo gerado: ${report.summary.flowGenerated ? 'SIM' : 'NÃO'}`);
  lines.push(`Teste RPA gerado: ${report.summary.rpaTestGenerated ? 'SIM' : 'NÃO'}`);
  lines.push(`Total de nós: ${report.summary.nodeCount}`);
  lines.push(`Total de passos RPA: ${report.summary.rpaStepsCount}`);
  lines.push('');

  lines.push('='.repeat(80));

  return lines.join('\n');
}

/**
 * Consulta registros de auditoria.
 * 
 * @param {Object} filters - Filtros (flowId, rpaTestId, startDate, endDate)
 * @returns {Array} Registros encontrados
 */
function queryAuditRecords(filters = {}) {
  const indexPath = path.join(AUDIT_DIR, 'index.json');
  if (!fs.existsSync(indexPath)) {
    return [];
  }

  let index = [];
  try {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch (err) {
    logger.warn('Erro ao carregar índice de auditoria', err);
    return [];
  }

  // Aplica filtros
  let filtered = index;

  if (filters.flowId) {
    filtered = filtered.filter(r => r.flowId === filters.flowId);
  }

  if (filters.rpaTestId) {
    filtered = filtered.filter(r => r.rpaTestId === filters.rpaTestId);
  }

  if (filters.startDate) {
    const start = new Date(filters.startDate);
    filtered = filtered.filter(r => new Date(r.timestamp) >= start);
  }

  if (filters.endDate) {
    const end = new Date(filters.endDate);
    filtered = filtered.filter(r => new Date(r.timestamp) <= end);
  }

  // Carrega registros completos
  const records = filtered.map(entry => {
    const recordPath = path.join(AUDIT_DIR, `${entry.id}.json`);
    if (fs.existsSync(recordPath)) {
      try {
        return JSON.parse(fs.readFileSync(recordPath, 'utf8'));
      } catch (err) {
        logger.warn(`Erro ao carregar registro ${entry.id}`, err);
        return null;
      }
    }
    return null;
  }).filter(r => r !== null);

  return records;
}

module.exports = {
  // Auditoria de ações do sistema
  logAction,
  queryLogs,
  getAuditStats,
  // Auditoria de geração
  registerGeneration,
  generateAuditReport,
  queryAuditRecords,
};
