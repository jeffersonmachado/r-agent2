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
const { Ticket: TicketGetter, ChannelConversation: ChannelConversationGetter } = require('../db/models');

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

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeTrim(value, fallback = '') {
  const str = safeToString(value, fallback);
  try { return str.trim(); } catch (_) { return fallback; }
}

function safeTrimLower(value, fallback = '') {
  const str = safeTrim(value, fallback);
  try { return str.toLowerCase(); } catch (_) { return fallback; }
}

function safeGet(obj, path, fallback = null) {
  try {
    return path.split('.').reduce((acc, key) => acc?.[key], obj) ?? fallback;
  } catch (_) {
    return fallback;
  }
}

async function updateConversationForTicket(ticket, patch = {}) {
  if (!ticket || !ticket.conversationId) return;
  if (!dbAvailable()) return;
  try {
    const ConversationModel = typeof ChannelConversationGetter === 'function'
      ? ChannelConversationGetter()
      : ChannelConversationGetter;
    if (!ConversationModel) return;
    await ConversationModel.update(
      { ...patch, updated_at: new Date() },
      { where: { id: safeToString(ticket.conversationId), tenant_key: safeToString(ticket.tenantId) } },
    );
  } catch (err) {
    logger.debug('[QueueService] Falha ao atualizar channel_conversation (ignorado)', {
      ticketId: ticket.id,
      error: err.message,
    });
  }
}

function toDbPayload(ticket) {
  return {
    id: ticket.id,
    tenant_key: ticket.tenantId,
    session_id: ticket.sessionId,
    conversation_id: ticket.conversationId || null,
    channel_type: ticket.channelType || null,
    queue: ticket.queue,
    status: ticket.status,
    mode: ticket.mode || 'bot',
    pause_reason: ticket.pauseReason || null,
    takeover_at: ticket.takeoverAt ? new Date(ticket.takeoverAt) : null,
    return_to_bot_at: ticket.returnToBotAt ? new Date(ticket.returnToBotAt) : null,
    takeover_reason: ticket.takeoverReason || null,
    return_reason: ticket.returnReason || null,
    first_response_at: ticket.firstResponseAt ? new Date(ticket.firstResponseAt) : null,
    resolved_at: ticket.resolvedAt ? new Date(ticket.resolvedAt) : null,
    waiting_time_seconds: Number.isFinite(ticket.waitingTimeSeconds) ? ticket.waitingTimeSeconds : null,
    handling_time_seconds: Number.isFinite(ticket.handlingTimeSeconds) ? ticket.handlingTimeSeconds : null,
    assigned_to: ticket.assignedTo || null,
    phone_number: ticket.phoneNumber || null,
    last_user_message: ticket.lastUserMessage || null,
    unread_count: Number.isFinite(ticket.unreadCount) ? ticket.unreadCount : 0,
    tags: Array.isArray(ticket.tags) ? ticket.tags : [],
    category: ticket.category || null,
    messages: Array.isArray(ticket.messages) ? ticket.messages : [],
    context: ticket.context || {},
  };
}

function fromDbRow(row) {
  return {
    id: row.id,
    tenantId: row.tenant_key,
    sessionId: row.session_id,
    conversationId: row.conversation_id || null,
    channelType: row.channel_type || (row.session_id && safeToString(row.session_id, '').startsWith('whatsapp_') ? 'whatsapp' : null),
    queue: row.queue,
    status: row.status,
    mode: row.mode || 'bot',
    pauseReason: row.pause_reason || null,
    takeoverAt: row.takeover_at ? new Date(row.takeover_at).toISOString() : null,
    returnToBotAt: row.return_to_bot_at ? new Date(row.return_to_bot_at).toISOString() : null,
    takeoverReason: row.takeover_reason || null,
    returnReason: row.return_reason || null,
    firstResponseAt: row.first_response_at ? new Date(row.first_response_at).toISOString() : null,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
    waitingTimeSeconds: Number.isFinite(row.waiting_time_seconds) ? row.waiting_time_seconds : null,
    handlingTimeSeconds: Number.isFinite(row.handling_time_seconds) ? row.handling_time_seconds : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : (row.createdAt?.toISOString?.() || new Date().toISOString()),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : (row.updatedAt?.toISOString?.() || new Date().toISOString()),
    lastUserMessage: row.last_user_message || null,
    assignedTo: row.assigned_to || null,
    phoneNumber: row.phone_number || null,
    messages: Array.isArray(row.messages) ? row.messages : [],
    unreadCount: Number.isFinite(row.unread_count) ? row.unread_count : 0,
    tags: Array.isArray(row.tags) ? row.tags : [],
    category: row.category || null,
    context: row.context || {},
  };
}

/**
 * Upsert de ticket no cache runtime a partir de uma row Sequelize.
 * Exportado apenas para serviços internos (ex.: linker omnichannel).
 *
 * @param {any} row
 * @returns {Ticket|null}
 */
function upsertTicketFromDbRow(row) {
  if (!row) return null;
  const t = fromDbRow(row);
  if (!t?.id) return null;

  tickets.set(t.id, t);
  if (!queues.has(t.queue)) queues.set(t.queue, new Set());
  queues.get(t.queue).add(t.id);

  return t;
}

async function upsertTicketToDb(ticket) {
  if (!dbAvailable()) return;
  const TicketModel = typeof TicketGetter === 'function' ? TicketGetter() : TicketGetter;
  const payload = toDbPayload(ticket);
  const now = new Date();

  const existing = await TicketModel.findByPk(ticket.id);
  if (existing) {
    await existing.update({ ...payload, updated_at: now });
  } else {
    await TicketModel.create({ ...payload, created_at: now, updated_at: now });
  }
}

async function deleteTicketFromDb(ticketId) {
  if (!dbAvailable()) return;
  const TicketModel = typeof TicketGetter === 'function' ? TicketGetter() : TicketGetter;
  await TicketModel.destroy({ where: { id: ticketId } });
}

function persistTicketBestEffort(ticket) {
  if (!dbAvailable()) return;
  setImmediate(() => {
    upsertTicketToDb(ticket).catch((err) => {
      logger.warn('[QueueService] Falha ao persistir ticket no PostgreSQL', { ticketId: ticket.id, error: err.message });
    });
  });
}

function deleteTicketBestEffort(ticketId) {
  if (!dbAvailable()) return;
  setImmediate(() => {
    deleteTicketFromDb(ticketId).catch((err) => {
      logger.warn('[QueueService] Falha ao remover ticket no PostgreSQL', { ticketId, error: err.message });
    });
  });
}

/**
 * Inicializa cache em memória a partir do PostgreSQL (best-effort).
 * Mantém API síncrona do QueueService, com DB como fonte de verdade.
 */
async function initialize() {
  if (!dbAvailable()) return;
  try {
    const TicketModel = typeof TicketGetter === 'function' ? TicketGetter() : TicketGetter;
    const rows = await TicketModel.findAll();

    tickets.clear();
    queues.clear();

    for (const row of rows) {
      const t = fromDbRow(row);
      tickets.set(t.id, t);
      if (!queues.has(t.queue)) queues.set(t.queue, new Set());
      queues.get(t.queue).add(t.id);
    }

    logger.info('[QueueService] Cache inicializado do PostgreSQL', { tickets: tickets.size, queues: queues.size });
  } catch (err) {
    logger.warn('[QueueService] Falha ao inicializar cache do PostgreSQL', { error: err.message });
  }
}

// Teste de getMetrics após carregar dados (apenas em desenvolvimento)
if (process.env.NODE_ENV !== 'production') {
  // Aguarda um pouco para garantir que os dados foram carregados
  setTimeout(() => {
    const testMetrics = getMetrics();
    logger.debug('[QueueService] Teste de getMetrics após carregar dados:', {
      totalTickets: testMetrics.totalTickets,
      ticketsByStatus: testMetrics.ticketsByStatus,
      ticketsByQueue: testMetrics.ticketsByQueue,
    });
  }, 100);
}

/**
 * Extrai número de telefone do sessionId (formato: "whatsapp_5511999999999")
 *
 * @param {string} sessionId
 * @returns {string|null}
 */
function extractPhoneNumber(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return null;
  const match = sessionId.match(/^whatsapp_(.+)$/);
  return match ? match[1] : null;
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
  
  if (!effectiveTenantId || typeof effectiveTenantId !== 'string' || effectiveTenantId.trim() === '') {
    throw new Error('tenantId é obrigatório para criar ticket');
  }

  const id = `${queue}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const now = new Date().toISOString();

  const ticket = {
    id,
    tenantId: effectiveTenantId.trim(),
    sessionId,
    // Channel Gateway (fase 2): campos novos (best-effort)
    conversationId: context.conversationId || null,
    channelType: context.channelType || (sessionId && String(sessionId).startsWith('whatsapp_') ? 'whatsapp' : null),
    queue,
    status: 'waiting',
    // Compatibilidade: ticket implica atendimento humano por padrão
    mode: context.mode || 'human',
    pauseReason: context.pauseReason || null,
    takeoverAt: context.takeoverAt || null,
    returnToBotAt: context.returnToBotAt || null,
    takeoverReason: context.takeoverReason || null,
    returnReason: context.returnReason || null,
    createdAt: now,
    updatedAt: now,
    lastUserMessage: lastUserMessage || null,
    assignedTo: null,
    phoneNumber: extractPhoneNumber(sessionId),
    messages: lastUserMessage ? [{
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      text: lastUserMessage,
      sender: 'user',
      timestamp: now,
    }] : [],
    unreadCount: 0,
    tags: Array.isArray(tags) ? tags : [],
    category: category || null,
    // Contexto preservado para o atendente
    context: {
      flowId: context.flowId || null,
      escalationReason: context.escalationReason || null,
      escalationAttempt: context.escalationAttempt || null,
      botHistory: context.botHistory || [],
      variables: context.variables || {},
      allowReturnToBot: context.allowReturnToBot !== false, // Default: true
      safeReturnNode: context.safeReturnNode || null,
      handoverHistory: Array.isArray(context.handoverHistory) ? context.handoverHistory : [],
      ...(context.metadata || {}),
    },
  };

  tickets.set(id, ticket);

  // Adiciona à fila
  if (!queues.has(queue)) {
    queues.set(queue, new Set());
  }
  queues.get(queue).add(id);

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
  const queueSet = queues.get(queue);
  if (!queueSet) return [];

  const ticketIds = Array.from(queueSet);
  let ticketList = ticketIds.map((id) => tickets.get(id)).filter(Boolean);

  // Filtro por tenant (obrigatório para isolamento multi-tenant)
  if (options.tenantId) {
    ticketList = ticketList.filter((t) => t.tenantId === options.tenantId);
  }

  // Filtra por status se especificado
  if (options.status) {
    ticketList = ticketList.filter((t) => t.status === options.status);
  }

  // Ordena por data de criação (mais antigos primeiro)
  ticketList.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  return ticketList;
}

/**
 * Lista todas as filas disponíveis.
 *
 * @returns {string[]}
 */
function listQueues() {
  return Array.from(queues.keys());
}

/**
 * Cria uma nova fila (vazia).
 * Se a fila já existir, não faz nada.
 *
 * @param {string} queueName - Nome da fila
 * @returns {{success: boolean, message: string, queueName: string}}
 */
function createQueue(queueName) {
  if (!queueName || typeof queueName !== 'string' || queueName.trim() === '') {
    return {
      success: false,
      message: 'Nome da fila é obrigatório',
      queueName: null,
    };
  }

  const normalizedName = queueName.trim();

  // Validação: nome deve ter pelo menos 1 caractere e no máximo 100
  if (normalizedName.length < 1 || normalizedName.length > 100) {
    return {
      success: false,
      message: 'Nome da fila deve ter entre 1 e 100 caracteres',
      queueName: null,
    };
  }

  // Validação: nome deve conter apenas letras, números, hífens e underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(normalizedName)) {
    return {
      success: false,
      message: 'Nome da fila deve conter apenas letras, números, hífens e underscores',
      queueName: null,
    };
  }

  // Se a fila já existe, retorna sucesso (idempotente)
  if (queues.has(normalizedName)) {
    return {
      success: true,
      message: 'Fila já existe',
      queueName: normalizedName,
    };
  }

  // Cria a fila vazia
  queues.set(normalizedName, new Set());

  // Salva automaticamente
  // Dados agora estão no banco de dados PostgreSQL

  logger.debug(`[QueueService] Fila criada: ${normalizedName}`);

  return {
    success: true,
    message: 'Fila criada com sucesso',
    queueName: normalizedName,
  };
}

/**
 * Exclui uma fila.
 * Só pode excluir filas vazias (sem tickets ativos).
 *
 * @param {string} queueName - Nome da fila
 * @param {boolean} [force=false] - Se true, exclui mesmo com tickets (move tickets para outra fila ou fecha)
 * @returns {{success: boolean, message: string, deletedTickets?: number}}
 */
function deleteQueue(queueName, force = false) {
  if (!queueName || typeof queueName !== 'string' || queueName.trim() === '') {
    return {
      success: false,
      message: 'Nome da fila é obrigatório',
    };
  }

  const normalizedName = queueName.trim();

  // Verifica se a fila existe
  if (!queues.has(normalizedName)) {
    return {
      success: false,
      message: 'Fila não encontrada',
    };
  }

  const queueSet = queues.get(normalizedName);
  const ticketIds = Array.from(queueSet);
  
  // Conta tickets ativos (não fechados)
  const activeTickets = ticketIds.filter((id) => {
    const ticket = tickets.get(id);
    return ticket && ticket.status !== 'closed';
  }).length;

  // Se há tickets ativos e não é força, não permite excluir
  if (activeTickets > 0 && !force) {
    return {
      success: false,
      message: `Não é possível excluir a fila. Existem ${activeTickets} ticket(s) ativo(s). Use force=true para forçar exclusão.`,
      activeTickets,
    };
  }

  // Se force=true, fecha todos os tickets ativos
  let deletedTickets = 0;
  if (force && activeTickets > 0) {
    ticketIds.forEach((ticketId) => {
      const ticket = tickets.get(ticketId);
      if (ticket && ticket.status !== 'closed') {
        ticket.status = 'closed';
        ticket.updatedAt = new Date().toISOString();
        persistTicketBestEffort(ticket);
        deletedTickets++;
      }
    });
  }

  // Remove a fila
  queues.delete(normalizedName);

  // Salva automaticamente
  // Dados agora estão no banco de dados PostgreSQL

  logger.debug(`[QueueService] Fila excluída: ${normalizedName}${deletedTickets > 0 ? ` (${deletedTickets} ticket(s) fechado(s))` : ''}`);

  return {
    success: true,
    message: deletedTickets > 0 
      ? `Fila excluída. ${deletedTickets} ticket(s) foram fechado(s).`
      : 'Fila excluída com sucesso',
    deletedTickets: force ? deletedTickets : 0,
  };
}

/**
 * Obtém informações sobre uma fila específica.
 *
 * @param {string} queueName - Nome da fila
 * @returns {{exists: boolean, ticketCount: number, activeTickets: number, closedTickets: number} | null}
 */
function getQueueInfo(queueName) {
  if (!queueName || typeof queueName !== 'string') {
    return null;
  }

  const normalizedName = queueName.trim();
  const queueSet = queues.get(normalizedName);

  if (!queueSet) {
    return {
      exists: false,
      ticketCount: 0,
      activeTickets: 0,
      closedTickets: 0,
    };
  }

  const ticketIds = Array.from(queueSet);
  let activeTickets = 0;
  let closedTickets = 0;

  ticketIds.forEach((id) => {
    const ticket = tickets.get(id);
    if (ticket) {
      if (ticket.status === 'closed') {
        closedTickets++;
      } else {
        activeTickets++;
      }
    }
  });

  return {
    exists: true,
    ticketCount: ticketIds.length,
    activeTickets,
    closedTickets,
  };
}

/**
 * Obtém um ticket por ID.
 *
 * @param {string} ticketId
 * @returns {Ticket|null}
 */
function getTicket(ticketId) {
  return tickets.get(ticketId) || null;
}

/**
 * Obtém ticket por sessionId (último ticket ativo da sessão).
 *
 * @param {string} sessionId
 * @returns {Ticket|null}
 */
function getTicketBySession(sessionId) {
  const effectiveSessionId = sessionId ? safeToString(sessionId) : null;
  if (!effectiveSessionId) return null;

  // Compatibilidade: se tenantId vier como 2º argumento, filtra hard por tenant
  const tenantId = arguments.length > 1 ? (arguments[1] || null) : null;

  for (const ticket of tickets.values()) {
    if (!ticket || ticket.status === 'closed') continue;
    if (ticket.sessionId !== effectiveSessionId) continue;
    if (tenantId && ticket.tenantId !== tenantId) continue;
    return ticket;
  }
  return null;
}

/**
 * Obtém ticket ativo por conversationId (omnichannel), com filtro hard por tenant.
 *
 * @param {string} conversationId
 * @param {string} tenantId
 * @returns {Ticket|null}
 */
function getTicketByConversationId(conversationId, tenantId) {
  const convId = conversationId ? safeToString(conversationId) : null;
  const tId = tenantId ? safeToString(tenantId) : null;
  if (!convId || !tId) return null;

  for (const ticket of tickets.values()) {
    if (!ticket || ticket.status === 'closed') continue;
    if (ticket.tenantId !== tId) continue;
    if (ticket.conversationId === convId) return ticket;
  }
  return null;
}

/**
 * Atribui um ticket para um atendente.
 *
 * @param {string} ticketId
 * @param {string} assignedTo - ID/nome do atendente
 * @returns {Ticket|null}
 */
function assignTicket(ticketId, assignedTo) {
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;

  ticket.status = 'in_progress';
  ticket.assignedTo = assignedTo;
  ticket.updatedAt = new Date().toISOString();

  // Ação visível (console operacional): registra como system message
  if (!Array.isArray(ticket.messages)) ticket.messages = [];
  ticket.messages.push({
    id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    text: `Ticket atribuído para ${assignedTo}.`,
    sender: 'system',
    timestamp: new Date().toISOString(),
  });

  persistTicketBestEffort(ticket);

  return ticket;
}

/**
 * Fecha um ticket.
 *
 * @param {string} ticketId
 * @returns {Ticket|null}
 */
function closeTicket(ticketId) {
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;

  ticket.status = 'closed';
  ticket.updatedAt = new Date().toISOString();

  // SLA: resolvedAt + tempos (best-effort)
  const resolvedAt = new Date();
  ticket.resolvedAt = resolvedAt.toISOString();
  const createdAt = ticket.createdAt ? new Date(ticket.createdAt) : null;
  const firstResponseAt = ticket.firstResponseAt ? new Date(ticket.firstResponseAt) : null;
  if (createdAt && !Number.isNaN(createdAt.getTime())) {
    if (firstResponseAt && !Number.isNaN(firstResponseAt.getTime())) {
      ticket.waitingTimeSeconds = Math.max(0, Math.round((firstResponseAt - createdAt) / 1000));
      ticket.handlingTimeSeconds = Math.max(0, Math.round((resolvedAt - firstResponseAt) / 1000));
    } else {
      ticket.waitingTimeSeconds = Math.max(0, Math.round((resolvedAt - createdAt) / 1000));
      ticket.handlingTimeSeconds = 0;
    }
  }

  // Remove da fila (mas mantém no histórico)
  const queueSet = queues.get(ticket.queue);
  if (queueSet) {
    queueSet.delete(ticketId);
  }

  // Ação visível: system message de encerramento (motivo pode ser setado no context antes)
  if (!Array.isArray(ticket.messages)) ticket.messages = [];
  const closeReasonName = ticket.context?.closeReason?.name || ticket.context?.closeReasonName || null;
  ticket.messages.push({
    id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    text: closeReasonName ? `Ticket encerrado (${closeReasonName}).` : 'Ticket encerrado.',
    sender: 'system',
    timestamp: new Date().toISOString(),
  });

  persistTicketBestEffort(ticket);

  // Best-effort: libera conversa associada (omnichannel 1:1)
  updateConversationForTicket(ticket, {
    status: 'bot',
    current_ticket_id: null,
    last_message_at: new Date(),
  }).catch(() => {});

  // Best-effort: fecha incidente vinculado ao pedido (orders/delivery)
  try {
    const kind = ticket?.context?.metadata?.kind || null;
    const orderId = ticket?.context?.metadata?.orderId || null;
    if (kind === 'order_incident' && orderId && ticket.tenantId) {
      const { getOrderIncident, setOrderIncident } = require('./orderService');
      getOrderIncident({ tenantId: ticket.tenantId, orderId: String(orderId) })
        .then((existing) => {
          const base = existing && typeof existing === 'object' ? existing : {};
          return setOrderIncident({
            tenantId: ticket.tenantId,
            orderId: String(orderId),
            incident: {
              ...base,
              ticketId: ticket.id,
              status: 'closed',
              closedAt: new Date().toISOString(),
            },
          });
        })
        .catch(() => {});
    }
  } catch (_) {}

  return ticket;
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
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;

  // Se a fila mudou, precisa mover o ticket entre os Sets de filas
  const nextQueue = patch && patch.queue ? String(patch.queue) : null;
  const prevQueue = ticket.queue ? String(ticket.queue) : null;

  if (nextQueue && prevQueue && nextQueue !== prevQueue) {
    const prevSet = queues.get(prevQueue);
    if (prevSet) prevSet.delete(ticketId);
    if (!queues.has(nextQueue)) queues.set(nextQueue, new Set());
    queues.get(nextQueue).add(ticketId);
  }

  Object.assign(ticket, patch);
  ticket.updatedAt = new Date().toISOString();
  persistTicketBestEffort(ticket);
  return ticket;
}

/**
 * Atualiza a última mensagem do usuário em um ticket e adiciona ao histórico.
 *
 * @param {string} ticketId
 * @param {string} message
 * @returns {Ticket|null}
 */
function updateLastMessage(ticketId, message) {
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;

  ticket.lastUserMessage = message;
  ticket.updatedAt = new Date().toISOString();

  // Adiciona mensagem ao histórico
  if (!ticket.messages) {
    ticket.messages = [];
  }
  
  // Compatibilidade: aceita externalMessageId e timestamp como argumentos opcionais
  const externalMessageId = arguments.length > 2 ? (arguments[2] || null) : null;
  const timestampOverride = arguments.length > 3 ? (arguments[3] || null) : null;

  // Idempotência por externalMessageId (se disponível)
  if (externalMessageId) {
    const already = ticket.messages.some((m) => m && m.externalMessageId && m.externalMessageId === externalMessageId);
    if (already) {
      return ticket;
    }
  }

  const messageObj = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    text: message,
    sender: 'user',
    timestamp: timestampOverride || new Date().toISOString(),
    externalMessageId: externalMessageId || undefined,
  };
  
  ticket.messages.push(messageObj);
  
  // Incrementa contador de não lidas se ticket está atribuído
  if (ticket.status === 'in_progress' && ticket.assignedTo) {
    ticket.unreadCount = (ticket.unreadCount || 0) + 1;
  }

  persistTicketBestEffort(ticket);

  return ticket;
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
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;

  if (!ticket.messages) {
    ticket.messages = [];
  }

  // Compatibilidade: aceita options como 4º argumento
  const options = arguments.length > 3 ? (arguments[3] || {}) : {};
  const clientMessageId = options && options.clientMessageId ? safeToString(options.clientMessageId) : null;
  const externalMessageId = options && options.externalMessageId ? safeToString(options.externalMessageId) : null;
  const deliveryStatus = options && options.deliveryStatus ? safeToString(options.deliveryStatus) : null;
  const mediaType = options && options.mediaType ? safeTrimLower(options.mediaType) : null;
  const mediaUrl = options && options.mediaUrl ? safeTrim(options.mediaUrl) : null;
  const mediaKind = options && options.mediaKind ? safeTrimLower(options.mediaKind) : null;
  const documentId = options && options.documentId ? safeTrim(options.documentId) : null;
  const fileName = options && options.fileName ? safeTrim(options.fileName) : null;
  const mimeType = options && options.mimeType ? safeTrim(options.mimeType) : null;
  const sizeBytes = Number.isFinite(options && options.sizeBytes) ? Number(options.sizeBytes) : null;

  const messageObj = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    text: message,
    sender: 'agent',
    agentId: agentId || ticket.assignedTo || 'unknown',
    timestamp: new Date().toISOString(),
    clientMessageId: clientMessageId || undefined,
    externalMessageId: externalMessageId || undefined,
    deliveryStatus: deliveryStatus || undefined,
    mediaKind: mediaKind || undefined,
    documentId: documentId || undefined,
    mediaUrl: mediaUrl || undefined,
    fileName: fileName || undefined,
    mimeType: mimeType || undefined,
    sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : undefined,
    type: mediaType || undefined,
    media: (mediaUrl || documentId)
      ? {
        ...(mediaType ? { type: mediaType } : {}),
        ...(mediaUrl ? { url: mediaUrl } : {}),
        ...(fileName ? { fileName } : {}),
        ...(mimeType ? { mimeType } : {}),
        ...(Number.isFinite(sizeBytes) ? { sizeBytes } : {}),
        ...(mediaKind ? { kind: mediaKind } : {}),
        ...(documentId ? { documentId } : {}),
      }
      : undefined,
  };

  ticket.messages.push(messageObj);
  ticket.updatedAt = new Date().toISOString();

  // SLA: marca primeira resposta quando o agente envia a primeira mensagem
  if (!ticket.firstResponseAt) {
    ticket.firstResponseAt = messageObj.timestamp;
    const createdAt = ticket.createdAt ? new Date(ticket.createdAt) : null;
    const first = new Date(ticket.firstResponseAt);
    if (createdAt && !Number.isNaN(createdAt.getTime()) && !Number.isNaN(first.getTime())) {
      ticket.waitingTimeSeconds = Math.max(0, Math.round((first - createdAt) / 1000));
    }
  }

  persistTicketBestEffort(ticket);

  return ticket;
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
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;

  const text = note != null ? safeTrim(note) : '';
  if (!text) return ticket;

  if (!ticket.messages) {
    ticket.messages = [];
  }

  const authorId = author && typeof author === 'object' ? (author.id || author.username || null) : null;
  const authorName = author && typeof author === 'object'
    ? (author.username || author.name || author.id || 'system')
    : (author ? safeToString(author, 'system') : 'system');

  const messageObj = {
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    text,
    sender: 'note',
    authorId: authorId || undefined,
    authorName: authorName || undefined,
    timestamp: new Date().toISOString(),
  };

  ticket.messages.push(messageObj);
  ticket.updatedAt = new Date().toISOString();

  persistTicketBestEffort(ticket);

  return ticket;
}

/**
 * Transfere um ticket de fila e/ou atendente.
 *
 * @param {string} ticketId
 * @param {{queue?: string|null, assignedTo?: string|null}} params
 * @returns {Ticket|null}
 */
function transferTicket(ticketId, params = {}) {
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;

  const nextQueue = params.queue != null && safeTrim(params.queue) !== ''
    ? safeTrim(params.queue)
    : null;
  const hasAssignedTo = Object.prototype.hasOwnProperty.call(params, 'assignedTo');
  const assignedTo = hasAssignedTo
    ? (params.assignedTo != null && safeTrim(params.assignedTo) !== '' ? safeTrim(params.assignedTo) : null)
    : undefined;

  if (!nextQueue && !hasAssignedTo) {
    return ticket;
  }

  // Atualiza fila (ajustando índices)
  if (nextQueue && nextQueue !== ticket.queue) {
    const prevQueue = ticket.queue ? safeToString(ticket.queue) : null;
    if (prevQueue) {
      const prevSet = queues.get(prevQueue);
      if (prevSet) prevSet.delete(ticketId);
    }
    if (!queues.has(nextQueue)) queues.set(nextQueue, new Set());
    queues.get(nextQueue).add(ticketId);
    ticket.queue = nextQueue;
  }

  if (hasAssignedTo) {
    ticket.assignedTo = assignedTo || null;
  }

  if (ticket.status !== 'closed') {
    ticket.status = ticket.assignedTo ? 'in_progress' : 'waiting';
  }

  if (!Array.isArray(ticket.messages)) ticket.messages = [];
  const parts = [];
  if (nextQueue) parts.push(`Fila: ${nextQueue}`);
  if (hasAssignedTo) parts.push(ticket.assignedTo ? `Atribuído: ${ticket.assignedTo}` : 'Sem atendente');
  if (parts.length > 0) {
    ticket.messages.push({
      id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      text: `Transferência realizada. ${parts.join(' · ')}`,
      sender: 'system',
      timestamp: new Date().toISOString(),
    });
  }

  ticket.updatedAt = new Date().toISOString();
  persistTicketBestEffort(ticket);

  return ticket;
}

/**
 * Atualiza deliveryStatus/externalMessageId de uma mensagem outbound no ticket (best-effort).
 *
 * @param {string} ticketId
 * @param {{clientMessageId?: string|null, externalMessageId?: string|null, deliveryStatus?: string|null}} patch
 * @returns {Ticket|null}
 */
function updateOutboundMessageMeta(ticketId, patch = {}) {
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;
  if (!Array.isArray(ticket.messages) || ticket.messages.length === 0) return ticket;

  const clientMessageId = patch.clientMessageId ? safeToString(patch.clientMessageId) : null;
  const externalMessageId = patch.externalMessageId ? safeToString(patch.externalMessageId) : null;
  const deliveryStatus = patch.deliveryStatus ? safeToString(patch.deliveryStatus) : null;

  let changed = false;

  for (let i = ticket.messages.length - 1; i >= 0; i--) {
    const m = ticket.messages[i];
    if (!m || m.sender !== 'agent') continue;

    const matchClient = clientMessageId && m.clientMessageId && m.clientMessageId === clientMessageId;
    const matchExternal = externalMessageId && m.externalMessageId && m.externalMessageId === externalMessageId;
    if (!matchClient && !matchExternal) continue;

    if (externalMessageId && !m.externalMessageId) {
      m.externalMessageId = externalMessageId;
      changed = true;
    }
    if (deliveryStatus && m.deliveryStatus !== deliveryStatus) {
      m.deliveryStatus = deliveryStatus;
      changed = true;
    }
    break;
  }

  if (!changed) return ticket;

  ticket.updatedAt = new Date().toISOString();
  persistTicketBestEffort(ticket);
  return ticket;
}

/**
 * Marca mensagens do usuário como lidas.
 *
 * @param {string} ticketId
 * @returns {Ticket|null}
 */
function markMessagesAsRead(ticketId) {
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;

  ticket.unreadCount = 0;
  ticket.updatedAt = new Date().toISOString();

  persistTicketBestEffort(ticket);

  return ticket;
}

/**
 * Atualiza modo de atendimento do ticket (bot|human) e registra histórico.
 *
 * @param {string} ticketId
 * @param {{mode: 'bot'|'human'|'paused', pauseReason?: string|null, actorId?: string|null, actorUsername?: string|null}} params
 * @returns {Ticket|null}
 */
function setTicketMode(ticketId, params = {}) {
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;

  const mode = (params.mode === 'bot' || params.mode === 'human' || params.mode === 'paused')
    ? params.mode
    : 'human';
  const pauseReason = params.pauseReason || null;

  ticket.mode = mode;
  ticket.pauseReason = pauseReason;
  const nowIso = new Date().toISOString();
  ticket.updatedAt = nowIso;

  // Campos explícitos (Blip-like)
  if (mode === 'human') {
    ticket.takeoverAt = nowIso;
    ticket.takeoverReason = pauseReason;
  } else if (mode === 'bot') {
    ticket.returnToBotAt = nowIso;
    ticket.returnReason = pauseReason;
  }

  if (!ticket.context) ticket.context = {};
  if (!Array.isArray(ticket.context.handoverHistory)) ticket.context.handoverHistory = [];

  ticket.context.handoverHistory.push({
    type: mode === 'human' ? 'takeover' : (mode === 'bot' ? 'return_to_bot' : 'paused'),
    mode,
    reason: pauseReason,
    actorId: params.actorId || null,
    actorUsername: params.actorUsername || null,
    timestamp: nowIso,
  });

  // Mensagem de sistema para UI/histórico do ticket
  if (!Array.isArray(ticket.messages)) ticket.messages = [];
  ticket.messages.push({
    id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    text: mode === 'human'
      ? `Atendimento assumido por humano${pauseReason ? ` (${pauseReason})` : ''}.`
      : (mode === 'bot'
        ? `Atendimento devolvido ao bot${pauseReason ? ` (${pauseReason})` : ''}.`
        : `Atendimento pausado${pauseReason ? ` (${pauseReason})` : ''}.`),
    sender: 'system',
    timestamp: nowIso,
  });

  persistTicketBestEffort(ticket);

  // Best-effort: reflete modo no channel_conversation
  const convPatch = {
    status: mode === 'human' ? 'human' : (mode === 'bot' ? 'bot' : 'paused'),
    current_ticket_id: mode === 'human' ? ticket.id : (mode === 'bot' ? ticket.id : ticket.id),
    last_message_at: new Date(),
  };
  updateConversationForTicket(ticket, convPatch).catch(() => {});
  return ticket;
}

/**
 * Obtém histórico de mensagens de um ticket.
 *
 * @param {string} ticketId
 * @returns {Message[]}
 */
function getTicketMessages(ticketId) {
  const ticket = tickets.get(ticketId);
  if (!ticket || !ticket.messages) return [];
  return ticket.messages;
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
  let ticketList = Array.from(tickets.values());

  // Filtro por tenant (obrigatório para isolamento multi-tenant)
  if (options.tenantId) {
    ticketList = ticketList.filter((t) => t.tenantId === options.tenantId);
  }

  // Log de debug para comparar com getMetrics
  logger.debug(`[QueueService] listAllTickets: Map tem ${tickets.size} ticket(s), Array tem ${ticketList.length} ticket(s)`, {
    filters: { tenantId: options.tenantId, status: options.status, queue: options.queue, q: options.q },
  });

  // Filtro de status (pode ser string única ou múltiplos separados por vírgula)
  if (options.status) {
    const statusList = String(options.status)
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s);
    if (statusList.length > 0) {
      ticketList = ticketList.filter((t) => statusList.includes(t.status));
    }
  }

  if (options.queue) {
    ticketList = ticketList.filter((t) => t.queue === options.queue);
  }

  // Filtro de busca por query (q) - procura em ID, contact, número, etc
  if (options.q) {
    const query = String(options.q).toLowerCase();
    ticketList = ticketList.filter((t) => {
      const id = String(t.id || '').toLowerCase();
      const contact = String(t.contact || '').toLowerCase();
      const phone = String(t.phone || '').toLowerCase();
      const firstName = String(t.firstName || '').toLowerCase();
      const lastName = String(t.lastName || '').toLowerCase();
      const queue = String(t.queue || '').toLowerCase();
      
      return (
        id.includes(query) ||
        contact.includes(query) ||
        phone.includes(query) ||
        firstName.includes(query) ||
        lastName.includes(query) ||
        queue.includes(query)
      );
    });
  }

  // Ordena por data de criação (mais recentes primeiro)
  ticketList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = ticketList.length;
  
  // Aplica paginação
  const limit = Math.min(
    Math.max(1, parseInt(options.limit, 10) || 1000),
    10000 // Máximo de 10000 tickets por requisição
  );
  
  let offset = 0;
  if (options.cursor) {
    // Cursor é um índice no array
    offset = Math.max(0, parseInt(options.cursor, 10) || 0);
  } else if (options.offset !== undefined) {
    offset = Math.max(0, parseInt(options.offset, 10) || 0);
  }
  
  const paginatedTickets = ticketList.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  const hasMore = nextOffset < total;
  const nextCursor = hasMore ? String(nextOffset) : null;

  return {
    items: paginatedTickets,
    tickets: paginatedTickets, // Mantém compatibilidade com chamadas antigas
    total,
    limit,
    offset,
    nextCursor,
    hasMore,
  };
}

/**
 * Limpa tickets fechados antigos da memória.
 * Remove tickets fechados com mais de X dias.
 *
 * @param {number} maxAgeDays - Idade máxima em dias (padrão: 7)
 * @returns {number} Número de tickets removidos
 */
function cleanupOldTickets(maxAgeDays = 7) {
  const now = Date.now();
  const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
  let cleaned = 0;

  for (const [ticketId, ticket] of tickets.entries()) {
    if (ticket.status === 'closed') {
      const ticketAge = now - new Date(ticket.updatedAt).getTime();
      if (ticketAge > maxAge) {
        tickets.delete(ticketId);
        deleteTicketBestEffort(ticketId);
        cleaned++;
      }
    }
  }

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
  const intervalMs = intervalHours * 60 * 60 * 1000;
  
  // Executa imediatamente na primeira vez
  cleanupOldTickets(maxAgeDays);
  
  // Depois executa periodicamente
  const intervalId = setInterval(() => {
    cleanupOldTickets(maxAgeDays);
  }, intervalMs);
  // Não manter o processo vivo apenas por timers (ajuda testes/Jest e shutdown limpo)
  if (typeof intervalId.unref === 'function') intervalId.unref();

  logger.info(`[QueueService] Limpeza automática iniciada: a cada ${intervalHours}h, removendo tickets fechados com mais de ${maxAgeDays} dias`);

  return intervalId;
}

/**
 * Obtém métricas e estatísticas do sistema de filas.
 *
 * @returns {Object} Métricas do sistema
 */
function getMetrics() {
  const allTickets = Array.from(tickets.values());
  const now = Date.now();
  const maxAge7Days = 7 * 24 * 60 * 60 * 1000;
  const maxAge30Days = 30 * 24 * 60 * 60 * 1000;

  // Log de debug para verificar o estado do Map
  logger.debug(`[QueueService] getMetrics: Map tem ${tickets.size} ticket(s), Array tem ${allTickets.length} ticket(s)`);

  const metrics = {
    totalTickets: allTickets.length,
    ticketsByStatus: {
      waiting: 0,
      in_progress: 0,
      closed: 0,
    },
    ticketsByQueue: {},
    oldClosedTickets: {
      olderThan7Days: 0,
      olderThan30Days: 0,
    },
    oldestTicket: null,
    newestTicket: null,
    memoryUsage: {
      rss: process.memoryUsage().rss,
      heapTotal: process.memoryUsage().heapTotal,
      heapUsed: process.memoryUsage().heapUsed,
      external: process.memoryUsage().external,
    },
  };

  let oldestDate = Infinity;
  let newestDate = 0;

  allTickets.forEach((ticket) => {
    // Valida se o ticket é válido
    if (!ticket || !ticket.id) {
      logger.warn(`[QueueService] Ticket inválido encontrado no Map:`, ticket);
      return;
    }

    // Contagem por status (apenas status válidos)
    if (ticket.status && (ticket.status === 'waiting' || ticket.status === 'in_progress' || ticket.status === 'closed')) {
      metrics.ticketsByStatus[ticket.status] =
        (metrics.ticketsByStatus[ticket.status] || 0) + 1;
    } else if (ticket.status) {
      // Log para debug: status inválido encontrado
      logger.warn(`[QueueService] Ticket com status inválido: ${ticket.status}`, { ticketId: ticket.id });
    } else {
      // Log para debug: ticket sem status
      // eslint-disable-next-line no-console
      console.warn(`[QueueService] Ticket sem status:`, { ticketId: ticket.id, ticket });
    }

    // Contagem por fila (apenas se a fila existir)
    if (ticket.queue) {
      metrics.ticketsByQueue[ticket.queue] =
        (metrics.ticketsByQueue[ticket.queue] || 0) + 1;
    }

    // Tickets fechados antigos
    if (ticket.status === 'closed') {
      const ticketAge = now - new Date(ticket.updatedAt).getTime();
      if (ticketAge > maxAge7Days) {
        metrics.oldClosedTickets.olderThan7Days++;
      }
      if (ticketAge > maxAge30Days) {
        metrics.oldClosedTickets.olderThan30Days++;
      }
    }

    // Encontrar ticket mais antigo e mais novo
    const createdAt = new Date(ticket.createdAt).getTime();
    if (createdAt < oldestDate) {
      oldestDate = createdAt;
      metrics.oldestTicket = {
        id: ticket.id,
        createdAt: ticket.createdAt,
        ageDays: Math.floor((now - createdAt) / (24 * 60 * 60 * 1000)),
      };
    }
    if (createdAt > newestDate) {
      newestDate = createdAt;
      metrics.newestTicket = {
        id: ticket.id,
        createdAt: ticket.createdAt,
        ageDays: Math.floor((now - createdAt) / (24 * 60 * 60 * 1000)),
      };
    }
  });

  // Log de debug sempre (para identificar quando está vazio)
  logger.debug(`[QueueService] Métricas calculadas: ${allTickets.length} ticket(s)`, {
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
