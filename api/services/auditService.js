/**
 * Serviço de Auditoria.
 * 
 * Registra ações do sistema e gera relatórios de auditoria para gerações de fluxos e testes RPA.
 * Mantém rastreabilidade completa de decisões humanas e fontes utilizadas.
 */

const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { AuditEvent, GenerationAudit, AuditReport } = require('../db/models');

// ============================================================================
// AUDITORIA DE AÇÕES DO SISTEMA (logAction, queryLogs, getAuditStats)
// ============================================================================

const memoryAuditEvents = [];
const MAX_MEMORY_EVENTS = 2000;

function dbAvailable() {
  return !!getSequelize();
}

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
  const entry = {
    timestamp: new Date().toISOString(),
    agentId: agentId || null,
    username: username || null,
    tenantId: tenantId || null,
    action,
    resource,
    resourceId,
    details: details || null,
    ipAddress,
    userAgent,
  };

  // Mantém um buffer em memória (útil para debug e fallback)
  memoryAuditEvents.push(entry);
  if (memoryAuditEvents.length > MAX_MEMORY_EVENTS) {
    memoryAuditEvents.splice(0, memoryAuditEvents.length - MAX_MEMORY_EVENTS);
  }

  // Persistência em DB (best-effort, sem bloquear request)
  if (dbAvailable()) {
    const AuditEventModel = typeof AuditEvent === 'function' ? AuditEvent() : AuditEvent;
    setImmediate(() => {
      if (!AuditEventModel || typeof AuditEventModel.create !== 'function') {
        return;
      }
      AuditEventModel.create({
        tenant_key: tenantId || null,
        actor_user_id: agentId && agentId !== 'system' ? agentId : null,
        username: username || null,
        action,
        resource,
        resource_id: resourceId || null,
        details: details || {},
        ip_address: ipAddress || null,
        user_agent: userAgent || null,
      }).catch((err) => {
        logger.warn('[AuditService] Falha ao persistir audit_event no PostgreSQL', { error: err.message });
      });
    });
  }

  logger.debug('Ação de auditoria registrada', { action, resource, resourceId });
}

/**
 * Consulta logs de auditoria.
 *
 * @param {Object} filters - Filtros (agentId, action, resource, startDate, endDate, tenantId)
 * @returns {Promise<{total:number,items:Array}>} Logs encontrados
 */
async function queryLogs(filters = {}) {
  const limit = Math.min(parseInt(filters.limit || '1000', 10) || 1000, 5000);
  const offset = Math.max(parseInt(filters.offset || '0', 10) || 0, 0);

  if (!dbAvailable()) {
    // fallback: memória
    let items = [...memoryAuditEvents];
    if (filters.agentId) items = items.filter(l => l.agentId === filters.agentId);
    if (filters.action) items = items.filter(l => l.action === filters.action);
    if (filters.resource) items = items.filter(l => l.resource === filters.resource);
    if (filters.resourceId) items = items.filter(l => l.resourceId === filters.resourceId);
    if (filters.tenantId) items = items.filter(l => l.tenantId === filters.tenantId);
    if (filters.startDate) items = items.filter(l => new Date(l.timestamp) >= new Date(filters.startDate));
    if (filters.endDate) items = items.filter(l => new Date(l.timestamp) <= new Date(filters.endDate));
    items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const total = items.length;
    items = items.slice(offset, offset + limit);
    return { total, items };
  }

  const AuditEventModel = typeof AuditEvent === 'function' ? AuditEvent() : AuditEvent;
  if (!AuditEventModel || !AuditEventModel.sequelize) {
    // fallback: memória quando model/Sequelize não está disponível
    let items = [...memoryAuditEvents];
    if (filters.agentId) items = items.filter(l => l.agentId === filters.agentId);
    if (filters.action) items = items.filter(l => l.action === filters.action);
    if (filters.resource) items = items.filter(l => l.resource === filters.resource);
    if (filters.resourceId) items = items.filter(l => l.resourceId === filters.resourceId);
    if (filters.tenantId) items = items.filter(l => l.tenantId === filters.tenantId);
    if (filters.startDate) items = items.filter(l => new Date(l.timestamp) >= new Date(filters.startDate));
    if (filters.endDate) items = items.filter(l => new Date(l.timestamp) <= new Date(filters.endDate));
    items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const total = items.length;
    items = items.slice(offset, offset + limit);
    return { total, items };
  }
  const sequelize = AuditEventModel.sequelize;
  const Op = sequelize.constructor.Op;
  const where = {};

  if (filters.agentId) where.actor_user_id = filters.agentId;
  if (filters.username) where.username = filters.username;
  if (filters.action) where.action = filters.action;
  if (filters.resource) where.resource = filters.resource;
  if (filters.resourceId) where.resource_id = filters.resourceId;
  if (filters.tenantId) where.tenant_key = filters.tenantId;
  if (filters.startDate || filters.endDate) {
    where.created_at = {};
    if (filters.startDate) where.created_at[Op.gte] = new Date(filters.startDate);
    if (filters.endDate) where.created_at[Op.lte] = new Date(filters.endDate);
  }

  const { count, rows } = await AuditEventModel.findAndCountAll({
    where,
    order: [['created_at', 'DESC']],
    limit,
    offset,
  });

  const items = rows.map(r => ({
    timestamp: r.created_at ? new Date(r.created_at).toISOString() : (r.createdAt?.toISOString?.() || null),
    agentId: r.actor_user_id || null,
    username: r.username || null,
    tenantId: r.tenant_key || null,
    action: r.action,
    resource: r.resource,
    resourceId: r.resource_id || null,
    details: r.details || {},
    ipAddress: r.ip_address || null,
    userAgent: r.user_agent || null,
  }));

  return { total: count, items };
}

/**
 * Obtém estatísticas de auditoria.
 *
 * @returns {Promise<Object>} Estatísticas
 */
async function getAuditStats() {
  const result = await queryLogs({ limit: 10000 });
  const logs = result.items || [];

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
async function registerGeneration(auditData) {
  const auditId = `audit-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const timestamp = new Date().toISOString();

  const record = {
    id: auditId,
    timestamp,
    ...auditData,
  };

  if (dbAvailable()) {
    const GenerationAuditModel = typeof GenerationAudit === 'function' ? GenerationAudit() : GenerationAudit;
    await GenerationAuditModel.create({
      audit_id: auditId,
      timestamp: new Date(timestamp),
      tenant_key: auditData?.tenantId || auditData?.tenant_key || null,
      flow_id: auditData?.artifacts?.flowId || null,
      rpa_test_id: auditData?.artifacts?.rpaTestId || null,
      sources: auditData?.context?.sources || [],
      data: record,
    });
  }

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
async function generateAuditReport(auditMetadata, options = {}) {
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

  const textReport = (format === 'text' || format === 'both') ? generateTextReport(report) : null;

  if (dbAvailable()) {
    const AuditReportModel = typeof AuditReport === 'function' ? AuditReport() : AuditReport;
    await AuditReportModel.create({
      report_id: report.reportId,
      audit_id: auditMetadata?.auditId || null,
      generated_at: new Date(timestamp),
      format: format === 'both' ? 'json' : format,
      data: report,
      text: textReport,
    });
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
async function queryAuditRecords(filters = {}) {
  if (!dbAvailable()) return [];
  const GenerationAuditModel = typeof GenerationAudit === 'function' ? GenerationAudit() : GenerationAudit;
  const sequelize = GenerationAuditModel.sequelize;
  const Op = sequelize.constructor.Op;
  const where = {};

  if (filters.flowId) where.flow_id = filters.flowId;
  if (filters.rpaTestId) where.rpa_test_id = filters.rpaTestId;
  if (filters.startDate || filters.endDate) {
    where.timestamp = {};
    if (filters.startDate) where.timestamp[Op.gte] = new Date(filters.startDate);
    if (filters.endDate) where.timestamp[Op.lte] = new Date(filters.endDate);
  }

  const rows = await GenerationAuditModel.findAll({
    where,
    order: [['timestamp', 'DESC']],
    limit: Math.min(parseInt(filters.limit || '200', 10) || 200, 1000),
  });

  return rows.map(r => r.data || null).filter(Boolean);
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
