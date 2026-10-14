const logPort = require('../shared/logger');
const clock = require('../shared/clock');
/**
 * Serviços de persistência disponíveis para nós (DB-only).
 *
 * A engine não lê mais arquivos em `api/data/*.json`.
 * - Flows: PostgreSQL (tabela flows)
 * - Tickets/queues: PostgreSQL (tabela tickets)
 * - Config: `api/utils/config` (config.json + env) — configuração, não persistência operacional
 */

const config = require('../../api/utils/config');
const { getSequelize } = require('../../api/db/sequelize');
const { Flow: FlowGetter, Ticket: TicketGetter } = require('../../api/db/models');

/**
 * Mapeia uma row do model Flow para o objeto de fluxo usado pela engine.
 *
 * @param {Object} row
 * @returns {Object}
 */
function mapFlowRow(row) {
  const data = row.data && typeof row.data === 'object' ? row.data : {};
  const flowObj = { ...data, id: row.id };
  if (row.tenant_key && !flowObj.tenantId) flowObj.tenantId = row.tenant_key;
  if (row.name && !flowObj.name) flowObj.name = row.name;
  return flowObj;
}

/**
 * Mapeia uma row do model Ticket para o objeto de ticket usado pela engine.
 *
 * @param {Object} row
 * @returns {Object}
 */
function mapTicketRow(row) {
  return {
    id: row.id,
    tenantId: row.tenant_key,
    sessionId: row.session_id,
    queue: row.queue,
    status: row.status,
    assignedTo: row.assigned_to || null,
    phoneNumber: row.phone_number || null,
    lastUserMessage: row.last_user_message || null,
    unreadCount: Number.isFinite(row.unread_count) ? row.unread_count : 0,
    tags: Array.isArray(row.tags) ? row.tags : [],
    category: row.category || null,
    messages: Array.isArray(row.messages) ? row.messages : [],
    context: row.context || {},
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : (row.createdAt?.toISOString?.() || clock.nowIso()),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : (row.updatedAt?.toISOString?.() || clock.nowIso()),
  };
}

/**
 * Lê todos os fluxos disponíveis.
 * 
 * @returns {Promise<Array<Object>>} Lista de fluxos
 */
async function getFlows() {
  try {
    if (!getSequelize()) return [];
    const FlowModel = typeof FlowGetter === 'function' ? FlowGetter() : FlowGetter;
    const rows = await FlowModel.findAll();
    return rows.map(mapFlowRow);
  } catch (err) {
    // eslint-disable-next-line no-console
    logPort.error('[PersistenceServices] Erro ao ler flows do PostgreSQL:', err.message);
    return [];
  }
}

/**
 * Obtém um fluxo específico por ID.
 *
 * Busca direta por chave primária (findByPk): a versão anterior fazia
 * findAll de TODOS os flows + .find linear a cada chamada de nó
 * (subflow/get_flow_info).
 * 
 * @param {string} flowId - ID do fluxo
 * @returns {Promise<Object|null>} Fluxo encontrado ou null
 */
async function getFlow(flowId) {
  if (!flowId || typeof flowId !== 'string') {
    return null;
  }
  
  try {
    if (!getSequelize()) return null;
    const FlowModel = typeof FlowGetter === 'function' ? FlowGetter() : FlowGetter;
    const row = await FlowModel.findByPk(flowId);
    return row ? mapFlowRow(row) : null;
  } catch (err) {
    // eslint-disable-next-line no-console
    logPort.error('[PersistenceServices] Erro ao buscar fluxo:', err.message);
    return null;
  }
}

/**
 * Busca fluxos por critério.
 * 
 * @param {Object} criteria - Critérios de busca
 * @param {string} [criteria.tenantId] - Filtrar por tenant
 * @param {string} [criteria.name] - Filtrar por nome (contém)
 * @returns {Promise<Array<Object>>} Fluxos encontrados
 */
async function findFlows(criteria = {}) {
  try {
    const flows = await getFlows();
    
    return flows.filter(flow => {
      if (!flow) return false;
      
      if (criteria.tenantId && flow.tenantId !== criteria.tenantId) {
        return false;
      }
      
      if (criteria.name && flow.name) {
        const flowName = String(flow.name).toLowerCase();
        const searchName = String(criteria.name).toLowerCase();
        if (!flowName.includes(searchName)) {
          return false;
        }
      }
      
      return true;
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    logPort.error('[PersistenceServices] Erro ao buscar fluxos:', err.message);
    return [];
  }
}

/**
 * Lê dados de filas e tickets.
 * 
 * @returns {Promise<Object>} Dados de filas e tickets
 */
async function getQueuesData() {
  const tickets = await getAllTickets();
  const queues = {};
  for (const t of tickets) {
    if (!queues[t.queue]) queues[t.queue] = [];
    queues[t.queue].push(t.id);
  }
  return { tickets, queues };
}

async function getAllTickets() {
  try {
    if (!getSequelize()) return [];
    const TicketModel = typeof TicketGetter === 'function' ? TicketGetter() : TicketGetter;
    const rows = await TicketModel.findAll();
    return rows.map(mapTicketRow);
  } catch (err) {
    // eslint-disable-next-line no-console
    logPort.error('[PersistenceServices] Erro ao ler tickets do PostgreSQL:', err.message);
    return [];
  }
}

/**
 * Obtém tickets de uma fila específica.
 *
 * O filtro por fila (e status, quando informado) é aplicado no SQL:
 * a versão anterior varria a tabela inteira e filtrava em memória a
 * cada execução de nó.
 * 
 * @param {string} queueName - Nome da fila
 * @param {Object} [options] - Opções de filtro
 * @param {string} [options.status] - Filtrar por status
 * @returns {Promise<Array>} Lista de tickets
 */
async function getQueueTickets(queueName, options = {}) {
  if (!queueName || typeof queueName !== 'string') {
    return [];
  }
  
  try {
    if (!getSequelize()) return [];
    const TicketModel = typeof TicketGetter === 'function' ? TicketGetter() : TicketGetter;
    const where = { queue: queueName };
    if (options.status) {
      where.status = options.status;
    }
    const rows = await TicketModel.findAll({ where });
    return rows.map(mapTicketRow);
  } catch (err) {
    // eslint-disable-next-line no-console
    logPort.error('[PersistenceServices] Erro ao buscar tickets:', err.message);
    return [];
  }
}

/**
 * Obtém informações sobre uma fila.
 *
 * Uma única query filtrada por fila (reutiliza getQueueTickets):
 * - O "exists" derivado de `tickets.length > 0` é equivalente ao antigo
 *   fallback via getQueuesData(), pois o mapa de filas era construído a
 *   partir dos mesmos tickets — a varredura extra da tabela era redundante.
 * 
 * @param {string} queueName - Nome da fila
 * @returns {Promise<Object>} Informações da fila
 */
async function getQueueInfo(queueName) {
  if (!queueName || typeof queueName !== 'string') {
    return { exists: false, ticketCount: 0, activeTickets: 0, closedTickets: 0 };
  }
  
  try {
    const tickets = await getQueueTickets(queueName);
    const activeTickets = tickets.filter(t => t.status !== 'closed').length;
    const closedTickets = tickets.filter(t => t.status === 'closed').length;
    
    return {
      exists: tickets.length > 0,
      ticketCount: tickets.length,
      activeTickets,
      closedTickets,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    logPort.error('[PersistenceServices] Erro ao obter info da fila:', err.message);
    return { exists: false, ticketCount: 0, activeTickets: 0, closedTickets: 0 };
  }
}

/**
 * Lista todas as filas disponíveis.
 * 
 * @returns {Promise<Array<string>>} Lista de nomes de filas
 */
async function listQueues() {
  try {
    const data = await getQueuesData();
    return Object.keys(data.queues || {});
  } catch (err) {
    // eslint-disable-next-line no-console
    logPort.error('[PersistenceServices] Erro ao listar filas:', err.message);
    return [];
  }
}

/**
 * Lê configuração do sistema.
 * 
 * @returns {Promise<Object>} Configuração do sistema
 */
async function getConfig() {
  try {
    return config.getAll();
  } catch (err) {
    // eslint-disable-next-line no-console
    logPort.error('[PersistenceServices] Erro ao ler config:', err.message);
    return {};
  }
}

/**
 * Obtém um valor específico da configuração usando caminho com notação de ponto.
 * 
 * @param {string} path - Caminho da configuração (ex: 'api.port')
 * @param {any} defaultValue - Valor padrão se não encontrado
 * @returns {Promise<any>} Valor da configuração
 */
async function getConfigValue(path, defaultValue = undefined) {
  try {
    return config.get(path, defaultValue);
  } catch (err) {
    // eslint-disable-next-line no-console
    logPort.error('[PersistenceServices] Erro ao obter valor de config:', err.message);
    return defaultValue;
  }
}

module.exports = {
  getFlows,
  getFlow,
  findFlows,
  getQueuesData,
  getQueueTickets,
  getQueueInfo,
  listQueues,
  getConfig,
  getConfigValue,
};






























