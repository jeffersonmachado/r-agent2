/**
 * Serviço de gerenciamento de filas e tickets de atendimento.
 *
 * Responsabilidades:
 * - Criar tickets quando uma conversa é transferida para atendimento humano
 * - Listar tickets por fila
 * - Atribuir tickets para atendentes
 * - Fechar tickets
 * - Obter informações de tickets e sessões
 * - Persistir dados em PostgreSQL
 *
 * Persistência:
 * - Tickets e filas: PostgreSQL (tabelas tickets, queues)
 * 
 * NOTA: Arquivos JSON removidos - todos os dados agora estão no banco de dados PostgreSQL
 * - Dados são carregados ao iniciar o servidor
 * - Salvamento automático após operações de escrita
 */

const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const {
  safeToString,
  safeTrim,
  safeTrimLower,
  safeGet,
  safeErrorMessage,
} = require('../utils/defensiveCoercion');
const {
  toDbPayload,
  fromDbRow,
  upsertTicketInRuntimeCache,
} = require('./queue/queueTicketPersistenceMapper');
const {
  ensureQueueIndex,
  addTicketToQueueIndex,
  removeTicketFromQueueIndex,
  moveTicketAcrossQueueIndexes,
  getQueueTicketIds,
  getQueueStats,
} = require('./queue/queueIndexStore');
const {
  appendUserMessage,
  appendAgentMessage,
  appendTicketNote,
  applyOutboundMessageMeta,
  resetUnreadCount,
} = require('./queue/queueTicketMessaging');
const {
  cleanupOldTickets: cleanupOldTicketsFromRetention,
  startAutoCleanup: startAutoCleanupFromRetention,
} = require('./queue/queueTicketRetention');
const { buildTicketMetrics } = require('./queue/queueTicketMetrics');
const { buildListAllTicketsResponse } = require('./queue/queueTicketQuery');
const { applyTicketMode } = require('./queue/queueTicketMode');
const {
  applyTicketAssignment,
  applyTicketClosure,
  normalizeTransferParams,
  applyTicketTransferMutation,
  applyTicketPatch,
} = require('./queue/queueTicketLifecycle');
const { closeOrderIncidentFromTicket } = require('./queue/queueTicketOrderIncident');
const {
  findActiveTicketBySession,
  findActiveTicketByConversation,
} = require('./queue/queueTicketLookup');
const { updateConversationForTicket } = require('./queue/queueTicketConversationSync');
const { buildNewQueueTicket } = require('./queue/queueTicketFactory');
const {
  persistTicketBestEffort: persistTicketBestEffortFromRuntime,
  deleteTicketBestEffort: deleteTicketBestEffortFromRuntime,
  initializeRuntimeCache,
} = require('./queue/queueTicketPersistenceRuntime');
const {
  createQueue: _createQueue,
  deleteQueue: _deleteQueue,
  getQueueInfo: _getQueueInfo,
} = require('./queue/queueAdminOperations');
const {
  listQueue: _listQueue,
  listQueues: _listQueues,
  getTicket: _getTicket,
  getTicketBySession: _getTicketBySession,
  getTicketByConversationId: _getTicketByConversationId,
  getTicketMessages: _getTicketMessages,
  listAllTickets: _listAllTickets,
} = require('./queue/queueTicketReadOperations');
const {
  assignTicket: _assignTicket,
  closeTicket: _closeTicket,
  updateTicket: _updateTicket,
  updateLastMessage: _updateLastMessage,
  addAgentMessage: _addAgentMessage,
  addTicketNote: _addTicketNote,
  transferTicket: _transferTicket,
  updateOutboundMessageMeta: _updateOutboundMessageMeta,
  markMessagesAsRead: _markMessagesAsRead,
  setTicketMode: _setTicketMode,
} = require('./queue/queueTicketMutationOperations');

/**
 * @typedef {Object} Message
 * @property {string} id - ID único da mensagem
 * @property {string} text - Texto da mensagem
 * @property {string} sender - "user" | "agent" | "system"
 * @property {string} timestamp - Data/hora (ISO string)
 */

/**
 * @typedef {Object} Ticket
 * @property {string} id - Identificador único do ticket
 * @property {string} tenantId - ID do tenant (obrigatório)
 * @property {string} sessionId - ID da sessão do bot (ex.: "whatsapp_5511999999999")
 * @property {string} queue - Nome da fila de atendimento
 * @property {string} status - Status do ticket: "waiting" | "in_progress" | "closed"
 * @property {string} createdAt - Data de criação (ISO string)
 * @property {string} updatedAt - Data da última atualização (ISO string)
 * @property {string|null} lastUserMessage - Última mensagem do usuário antes do handoff
 * @property {string|null} assignedTo - ID/nome do atendente atribuído (opcional)
 * @property {string|null} phoneNumber - Número de telefone do usuário (extraído do sessionId)
 * @property {Message[]} messages - Histórico de mensagens do atendimento
 * @property {number} unreadCount - Contador de mensagens não lidas do usuário
 * @property {Object} [context] - Contexto preservado do bot (histórico, variáveis, motivo da escalada, etc.)
 * @property {string} [context.flowId] - ID do fluxo em execução
 * @property {string} [context.escalationReason] - Motivo da escalada (fallbackType)
 * @property {number} [context.escalationAttempt] - Número da tentativa quando escalou
 * @property {Message[]} [context.botHistory] - Histórico de mensagens do bot antes da escalada
 * @property {Object} [context.variables] - Variáveis de contexto da conversa
 * @property {boolean} [context.allowReturnToBot] - Se permite retorno ao bot após atendimento
 * @property {string|null} [context.safeReturnNode] - Nó para retornar após atendimento
 */

// Armazenamento em memória
/** @type {Map<string, Ticket>} */
const tickets = new Map();

/** @type {Map<string, Set<string>>} */
const queues = new Map(); // queueName -> Set<ticketId>

function dbAvailable() {
  return !!getSequelize();
}

/**
 * Upsert de ticket no cache runtime a partir de uma row Sequelize.
 * Exportado apenas para serviços internos (ex.: linker omnichannel).
 *
 * @param {any} row
 * @returns {Ticket|null}
 */
function upsertTicketFromDbRow(row) {
  return upsertTicketInRuntimeCache({ row, tickets, queues });
}

function persistTicketBestEffort(ticket) {
  persistTicketBestEffortFromRuntime(ticket, toDbPayload);
}

function deleteTicketBestEffort(ticketId) {
  deleteTicketBestEffortFromRuntime(ticketId);
}

/**
 * Inicializa cache em memória a partir do PostgreSQL (best-effort).
 * Mantém API síncrona do QueueService, com DB como fonte de verdade.
 */
async function initialize() {
  return initializeRuntimeCache({
    tickets,
    queues,
    fromDbRow,
    addTicketToQueueIndex,
  });
}

// Teste de getMetrics após carregar dados (apenas em desenvolvimento)
if (process.env.NODE_ENV !== 'production') {
  // Aguarda um pouco para garantir que os dados foram carregados
  const _metricsTestTimer = setTimeout(() => {
    const testMetrics = getMetrics();
    logger.debug('[QueueService] Teste de getMetrics após carregar dados:', {
      totalTickets: testMetrics.totalTickets,
      ticketsByStatus: testMetrics.ticketsByStatus,
      ticketsByQueue: testMetrics.ticketsByQueue,
    });
  }, 100);
  _metricsTestTimer.unref();
}

/**
 * Cria um novo ticket de atendimento.
 *
 * @param {Object} params
 * @param {string} params.tenantId - ID do tenant (obrigatório)
 * @param {string} params.sessionId - ID da sessão
 * @param {string} params.queue - Nome da fila
 * @param {string} [params.lastUserMessage] - Última mensagem do usuário
 * @param {Object} [params.context] - Contexto adicional (histórico do bot, motivo da escalada, etc.)
 * @returns {Ticket}
 */
function createTicket({ tenantId, sessionId, queue, lastUserMessage, context = {}, tags = [], category = null }) {
  // Valida tenantId ou usa padrão
  const effectiveTenantId = tenantId || context.tenantId; // Tenant deve ser fornecido explicitamente
  const normalizedTenantId = safeTrim(effectiveTenantId);
  
  if (!effectiveTenantId || typeof effectiveTenantId !== 'string' || normalizedTenantId === '') {
    throw new Error('Invalid tenantId');
  }

  const id = `${queue}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const now = new Date().toISOString();

  const ticket = buildNewQueueTicket({
    id,
    tenantId: normalizedTenantId,
    sessionId,
    queue,
    lastUserMessage,
    context,
    tags,
    category,
    now,
  });

  tickets.set(id, ticket);

  // Adiciona à fila
  addTicketToQueueIndex({ queues, queueName: queue, ticketId: id });

  // Persistência best-effort em PostgreSQL
  persistTicketBestEffort(ticket);

  return ticket;
}

/**
 * Lista todos os tickets de uma fila.
 *
 * @param {string} queue - Nome da fila
 * @param {Object} [options]
 * @param {string} [options.tenantId] - Filtrar por tenant (obrigatório para isolamento)
 * @param {string} [options.status] - Filtrar por status ("waiting", "in_progress", "closed")
 * @returns {Ticket[]}
 */
function listQueue(queue, options = {}) {
  return _listQueue(queue, options, { queues, tickets, getQueueTicketIds });
}

/**
 * Lista todas as filas disponíveis.
 *
 * @returns {string[]}
 */
function listQueues() {
  return _listQueues({ queues });
}

function createQueue(queueName) {
  return _createQueue(queueName, { queues, ensureQueueIndex, safeTrim, logger });
}

function deleteQueue(queueName, force = false) {
  return _deleteQueue(queueName, force, { queues, tickets, getQueueStats, persistTicketBestEffort, safeTrim, logger });
}

function getQueueInfo(queueName) {
  return _getQueueInfo(queueName, { queues, tickets, getQueueStats, safeTrim });
}

/**
 * Obtém um ticket por ID.
 *
 * @param {string} ticketId
 * @returns {Ticket|null}
 */
function getTicket(ticketId) {
  return _getTicket(ticketId, { tickets });
}

/**
 * Obtém ticket por sessionId (último ticket ativo da sessão).
 *
 * @param {string} sessionId
 * @returns {Ticket|null}
 */
function getTicketBySession(sessionId) {
  // Compatibilidade: se tenantId vier como 2º argumento, filtra hard por tenant
  const tenantId = arguments.length > 1 ? (arguments[1] || null) : null;
  return _getTicketBySession(sessionId, tenantId, { tickets, findActiveTicketBySession });
}

/**
 * Obtém ticket ativo por conversationId (omnichannel), com filtro hard por tenant.
 *
 * @param {string} conversationId
 * @param {string} tenantId
 * @returns {Ticket|null}
 */
function getTicketByConversationId(conversationId, tenantId) {
  return _getTicketByConversationId(conversationId, tenantId, { tickets, findActiveTicketByConversation });
}

/**
 * Atribui um ticket para um atendente.
 *
 * @param {string} ticketId
 * @param {string} assignedTo - ID/nome do atendente
 * @returns {Ticket|null}
 */
function assignTicket(ticketId, assignedTo) {
  return _assignTicket(ticketId, assignedTo, { tickets, applyTicketAssignment, persistTicketBestEffort });
}

/**
 * Fecha um ticket.
 *
 * @param {string} ticketId
 * @returns {Ticket|null}
 */
function closeTicket(ticketId) {
  return _closeTicket(ticketId, {
    tickets,
    queues,
    applyTicketClosure,
    removeTicketFromQueueIndex,
    persistTicketBestEffort,
    updateConversationForTicket,
    closeOrderIncidentFromTicket,
  });
}

/**
 * Atualiza ticket em memória e persiste best-effort.
 * Útil para operações de segmentação (tags/categoria) sem quebrar API.
 *
 * @param {string} ticketId
 * @param {Object} patch
 * @returns {Ticket|null}
 */
function updateTicket(ticketId, patch = {}) {
  return _updateTicket(ticketId, patch, {
    tickets,
    queues,
    safeToString,
    moveTicketAcrossQueueIndexes,
    applyTicketPatch,
    persistTicketBestEffort,
  });
}

/**
 * Atualiza a última mensagem do usuário em um ticket e adiciona ao histórico.
 *
 * @param {string} ticketId
 * @param {string} message
 * @returns {Ticket|null}
 */
function updateLastMessage(ticketId, message) {
  // Compatibilidade: aceita externalMessageId e timestamp como argumentos opcionais
  const externalMessageId = arguments.length > 2 ? (arguments[2] || null) : null;
  const timestampOverride = arguments.length > 3 ? (arguments[3] || null) : null;
  const mediaFields = arguments.length > 4 ? (arguments[4] || null) : null;
  return _updateLastMessage(ticketId, message, externalMessageId, timestampOverride, mediaFields, {
    tickets,
    appendUserMessage,
    persistTicketBestEffort,
  });
}

/**
 * Adiciona mensagem do atendente ao histórico do ticket.
 *
 * @param {string} ticketId
 * @param {string} message
 * @param {string} [agentId] - ID do atendente (opcional)
 * @returns {Ticket|null}
 */
function addAgentMessage(ticketId, message, agentId = null) {
  // Compatibilidade: aceita options como 4º argumento
  const options = arguments.length > 3 ? (arguments[3] || {}) : {};
  return _addAgentMessage(ticketId, message, agentId, options, {
    tickets,
    appendAgentMessage,
    persistTicketBestEffort,
  });
}

/**
 * Adiciona uma nota interna ao ticket (não enviada ao usuário).
 *
 * @param {string} ticketId
 * @param {string} note
 * @param {Object|string|null} [author]
 * @returns {Ticket|null}
 */
function addTicketNote(ticketId, note, author = null) {
  return _addTicketNote(ticketId, note, author, {
    tickets,
    appendTicketNote,
    persistTicketBestEffort,
  });
}

/**
 * Transfere um ticket de fila e/ou atendente.
 *
 * @param {string} ticketId
 * @param {{queue?: string|null, assignedTo?: string|null}} params
 * @returns {Ticket|null}
 */
function transferTicket(ticketId, params = {}) {
  return _transferTicket(ticketId, params, {
    tickets,
    queues,
    safeToString,
    normalizeTransferParams,
    moveTicketAcrossQueueIndexes,
    addTicketToQueueIndex,
    applyTicketTransferMutation,
    persistTicketBestEffort,
  });
}

/**
 * Atualiza deliveryStatus/externalMessageId de uma mensagem outbound no ticket (best-effort).
 *
 * @param {string} ticketId
 * @param {{clientMessageId?: string|null, externalMessageId?: string|null, deliveryStatus?: string|null}} patch
 * @returns {Ticket|null}
 */
function updateOutboundMessageMeta(ticketId, patch = {}) {
  return _updateOutboundMessageMeta(ticketId, patch, {
    tickets,
    applyOutboundMessageMeta,
    persistTicketBestEffort,
  });
}

/**
 * Marca mensagens do usuário como lidas.
 *
 * @param {string} ticketId
 * @returns {Ticket|null}
 */
function markMessagesAsRead(ticketId) {
  return _markMessagesAsRead(ticketId, {
    tickets,
    resetUnreadCount,
    persistTicketBestEffort,
  });
}

/**
 * Atualiza modo de atendimento do ticket (bot|human) e registra histórico.
 *
 * @param {string} ticketId
 * @param {{mode: 'bot'|'human'|'paused', pauseReason?: string|null, actorId?: string|null, actorUsername?: string|null}} params
 * @returns {Ticket|null}
 */
function setTicketMode(ticketId, params = {}) {
  return _setTicketMode(ticketId, params, {
    tickets,
    applyTicketMode,
    persistTicketBestEffort,
    updateConversationForTicket,
  });
}

/**
 * Obtém histórico de mensagens de um ticket.
 *
 * @param {string} ticketId
 * @returns {Message[]}
 */
function getTicketMessages(ticketId) {
  return _getTicketMessages(ticketId, { tickets });
}

/**
 * Lista todos os tickets (para administração).
 *
 * @param {Object} [options]
 * @param {string} [options.tenantId] - Filtrar por tenant (obrigatório para isolamento)
 * @param {string} [options.status] - Filtrar por status
 * @param {string} [options.queue] - Filtrar por fila
 * @param {number} [options.limit] - Limite de resultados (padrão: 1000, máximo: 10000)
 * @param {number} [options.offset] - Offset para paginação (padrão: 0)
 * @returns {{tickets: Ticket[], total: number, limit: number, offset: number}}
 */
function listAllTickets(options = {}) {
  return _listAllTickets(options, { tickets, logger, buildListAllTicketsResponse });
}

/**
 * Limpa tickets fechados antigos da memória.
 * Remove tickets fechados com mais de X dias.
 *
 * @param {number} maxAgeDays - Idade máxima em dias (padrão: 7)
 * @returns {number} Número de tickets removidos
 */
function cleanupOldTickets(maxAgeDays = 7) {
  const cleaned = cleanupOldTicketsFromRetention({
    tickets,
    maxAgeDays,
    onDeleteTicket: deleteTicketBestEffort,
  });

  if (cleaned > 0) {
    logger.info(`[QueueService] Limpeza de tickets: ${cleaned} ticket(s) fechado(s) antigo(s) removido(s)`);
  }

  return cleaned;
}

/**
 * Inicia limpeza periódica automática de tickets.
 * Executa a cada hora e remove tickets fechados com mais de 7 dias.
 *
 * @param {number} intervalHours - Intervalo em horas (padrão: 1)
 * @param {number} maxAgeDays - Idade máxima em dias (padrão: 7)
 * @returns {NodeJS.Timeout} ID do intervalo (para poder cancelar)
 */
function startAutoCleanup(intervalHours = 1, maxAgeDays = 7) {
  const intervalId = startAutoCleanupFromRetention({
    intervalHours,
    maxAgeDays,
    runCleanup: cleanupOldTickets,
  });

  logger.info(`[QueueService] Limpeza automática iniciada: a cada ${intervalHours}h, removendo tickets fechados com mais de ${maxAgeDays} dias`);

  return intervalId;
}

/**
 * Obtém métricas e estatísticas do sistema de filas.
 *
 * @returns {Object} Métricas do sistema
 */
function getMetrics() {
  // Log de debug para verificar o estado do Map
  const ticketCount = tickets.size;
  logger.debug(`[QueueService] getMetrics: Map tem ${ticketCount} ticket(s), Array tem ${ticketCount} ticket(s)`);

  const metrics = buildTicketMetrics({
    tickets,
    logger,
    memoryUsageProvider: () => ({
      rss: process.memoryUsage().rss,
      heapTotal: process.memoryUsage().heapTotal,
      heapUsed: process.memoryUsage().heapUsed,
      external: process.memoryUsage().external,
    }),
  });

  // Log de debug sempre (para identificar quando está vazio)
  logger.debug(`[QueueService] Métricas calculadas: ${metrics.totalTickets} ticket(s)`, {
    totalTickets: metrics.totalTickets,
    byStatus: metrics.ticketsByStatus,
    byQueue: Object.keys(metrics.ticketsByQueue).length,
    queueDetails: metrics.ticketsByQueue,
  });

  return metrics;
}

module.exports = {
  initialize,
  createTicket,
  listQueue,
  listQueues,
  createQueue,
  deleteQueue,
  getQueueInfo,
  getTicket,
  getTicketBySession,
  getTicketByConversationId,
  assignTicket,
  closeTicket,
  updateTicket,
  updateLastMessage,
  addAgentMessage,
  addTicketNote,
  transferTicket,
  updateOutboundMessageMeta,
  markMessagesAsRead,
  setTicketMode,
  getTicketMessages,
  listAllTickets,
  cleanupOldTickets,
  startAutoCleanup,
  getMetrics,
  // Interno: usado por services omnichannel para repovoar cache runtime.
  _upsertTicketFromDbRow: upsertTicketFromDbRow,
};
