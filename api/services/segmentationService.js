/**
 * Serviço de Segmentação de Atendimentos.
 *
 * Responsabilidades:
 * - Gerenciar tags e categorias de tickets
 * - Filtrar e segmentar tickets por critérios
 * - Criar regras de segmentação automática
 */

const { listAllTickets } = require('./queueService');
const logger = require('../utils/logger');

/**
 * Lista todas as tags usadas em tickets.
 * @param {Object} options
 * @returns {Array<{tag: string, count: number}>}
 */
function getAllTags(options = {}) {
  const allTickets = listAllTickets();
  const tickets = allTickets.tickets || [];
  
  const tagCounts = {};
  
  for (const ticket of tickets) {
    if (Array.isArray(ticket.tags)) {
      for (const tag of ticket.tags) {
        if (tag && typeof tag === 'string') {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }
      }
    }
  }
  
  return Object.entries(tagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Lista todas as categorias usadas em tickets.
 * @param {Object} options
 * @returns {Array<{category: string, count: number}>}
 */
function getAllCategories(options = {}) {
  const allTickets = listAllTickets();
  const tickets = allTickets.tickets || [];
  
  const categoryCounts = {};
  
  for (const ticket of tickets) {
    if (ticket.category && typeof ticket.category === 'string') {
      categoryCounts[ticket.category] = (categoryCounts[ticket.category] || 0) + 1;
    }
  }
  
  return Object.entries(categoryCounts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Filtra tickets por critérios avançados.
 * @param {Object} filters
 * @param {string[]} [filters.tags] - Tags para filtrar
 * @param {string} [filters.category] - Categoria para filtrar
 * @param {string} [filters.status] - Status para filtrar
 * @param {string} [filters.queue] - Fila para filtrar
 * @param {string} [filters.assignedTo] - Atribuído a
 * @param {string} [filters.startDate] - Data inicial
 * @param {string} [filters.endDate] - Data final
 * @param {string} [filters.search] - Busca por texto (mensagens, telefone)
 * @returns {Array}
 */
function filterTickets(filters = {}) {
  const allTickets = listAllTickets();
  let tickets = allTickets.tickets || [];
  
  // Filtro por tags
  if (filters.tags && Array.isArray(filters.tags) && filters.tags.length > 0) {
    tickets = tickets.filter(ticket => {
      if (!Array.isArray(ticket.tags) || ticket.tags.length === 0) return false;
      return filters.tags.some(tag => ticket.tags.includes(tag));
    });
  }
  
  // Filtro por categoria
  if (filters.category) {
    tickets = tickets.filter(t => t.category === filters.category);
  }
  
  // Filtro por status
  if (filters.status) {
    tickets = tickets.filter(t => t.status === filters.status);
  }
  
  // Filtro por fila
  if (filters.queue) {
    tickets = tickets.filter(t => t.queue === filters.queue);
  }
  
  // Filtro por atribuído a
  if (filters.assignedTo) {
    tickets = tickets.filter(t => t.assignedTo === filters.assignedTo);
  }
  
  // Filtro por data
  if (filters.startDate || filters.endDate) {
    tickets = tickets.filter(ticket => {
      const ticketDate = new Date(ticket.createdAt);
      if (filters.startDate && ticketDate < new Date(filters.startDate)) return false;
      if (filters.endDate && ticketDate > new Date(filters.endDate)) return false;
      return true;
    });
  }
  
  // Busca por texto
  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    tickets = tickets.filter(ticket => {
      // Busca em telefone
      if (ticket.phoneNumber && ticket.phoneNumber.toLowerCase().includes(searchLower)) {
        return true;
      }
      
      // Busca em última mensagem
      if (ticket.lastUserMessage && ticket.lastUserMessage.toLowerCase().includes(searchLower)) {
        return true;
      }
      
      // Busca em mensagens
      if (ticket.messages && Array.isArray(ticket.messages)) {
        return ticket.messages.some(msg => {
          const msgText = msg.text || msg.message || '';
          return msgText.toLowerCase().includes(searchLower);
        });
      }
      
      // Busca em tags
      if (Array.isArray(ticket.tags)) {
        return ticket.tags.some(tag => tag.toLowerCase().includes(searchLower));
      }
      
      return false;
    });
  }
  
  return tickets;
}

/**
 * Adiciona tag a um ticket.
 * @param {string} ticketId
 * @param {string} tag
 * @returns {{success: boolean, ticket?: Object, error?: string}}
 */
function addTagToTicket(ticketId, tag) {
  const { getTicket, updateTicket } = require('./queueService');
  const { recordTagActionBestEffort } = require('./ticketTagService');
  
  const ticket = getTicket(ticketId);
  if (!ticket) {
    return { success: false, error: 'Ticket não encontrado' };
  }
  
  if (!tag || typeof tag !== 'string' || tag.trim() === '') {
    return { success: false, error: 'Tag inválida' };
  }
  
  const normalizedTag = tag.trim().toLowerCase();
  
  if (!Array.isArray(ticket.tags)) {
    ticket.tags = [];
  }
  
  if (!ticket.tags.includes(normalizedTag)) {
    ticket.tags.push(normalizedTag);
    ticket.updatedAt = new Date().toISOString();

    // Persistência (DB-only) + trilha de tags (best-effort)
    updateTicket(ticketId, { tags: ticket.tags });
    recordTagActionBestEffort({
      tenantId: ticket.tenantId,
      ticketId,
      tag: normalizedTag,
      action: 'add',
      actorUserId: null,
    });

    // Ação visível
    if (!Array.isArray(ticket.messages)) ticket.messages = [];
    ticket.messages.push({
      id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      text: `Tag adicionada: ${normalizedTag}`,
      sender: 'system',
      timestamp: new Date().toISOString(),
    });
    updateTicket(ticketId, { messages: ticket.messages });
  }
  
  return { success: true, ticket };
}

/**
 * Remove tag de um ticket.
 * @param {string} ticketId
 * @param {string} tag
 * @returns {{success: boolean, ticket?: Object, error?: string}}
 */
function removeTagFromTicket(ticketId, tag) {
  const { getTicket, updateTicket } = require('./queueService');
  const { recordTagActionBestEffort } = require('./ticketTagService');
  
  const ticket = getTicket(ticketId);
  if (!ticket) {
    return { success: false, error: 'Ticket não encontrado' };
  }
  
  if (!Array.isArray(ticket.tags)) {
    return { success: true, ticket };
  }
  
  const normalizedTag = tag.trim().toLowerCase();
  ticket.tags = ticket.tags.filter(t => t !== normalizedTag);
  ticket.updatedAt = new Date().toISOString();
  updateTicket(ticketId, { tags: ticket.tags });
  recordTagActionBestEffort({
    tenantId: ticket.tenantId,
    ticketId,
    tag: normalizedTag,
    action: 'remove',
    actorUserId: null,
  });

  if (!Array.isArray(ticket.messages)) ticket.messages = [];
  ticket.messages.push({
    id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    text: `Tag removida: ${normalizedTag}`,
    sender: 'system',
    timestamp: new Date().toISOString(),
  });
  updateTicket(ticketId, { messages: ticket.messages });
  
  return { success: true, ticket };
}

/**
 * Define categoria de um ticket.
 * @param {string} ticketId
 * @param {string} category
 * @returns {{success: boolean, ticket?: Object, error?: string}}
 */
function setTicketCategory(ticketId, category) {
  const { getTicket, updateTicket } = require('./queueService');
  
  const ticket = getTicket(ticketId);
  if (!ticket) {
    return { success: false, error: 'Ticket não encontrado' };
  }
  
  ticket.category = category ? category.trim() : null;
  ticket.updatedAt = new Date().toISOString();
  updateTicket(ticketId, { category: ticket.category });
  
  return { success: true, ticket };
}

/**
 * Obtém estatísticas de segmentação.
 * @param {Object} filters
 * @returns {Object}
 */
function getSegmentationStats(filters = {}) {
  const filteredTickets = filterTickets(filters);
  
  const stats = {
    totalTickets: filteredTickets.length,
    byStatus: {},
    byCategory: {},
    byQueue: {},
    byTags: {},
    topTags: [],
    topCategories: [],
  };
  
  for (const ticket of filteredTickets) {
    // Por status
    stats.byStatus[ticket.status] = (stats.byStatus[ticket.status] || 0) + 1;
    
    // Por categoria
    if (ticket.category) {
      stats.byCategory[ticket.category] = (stats.byCategory[ticket.category] || 0) + 1;
    }
    
    // Por fila
    if (ticket.queue) {
      stats.byQueue[ticket.queue] = (stats.byQueue[ticket.queue] || 0) + 1;
    }
    
    // Por tags
    if (Array.isArray(ticket.tags)) {
      for (const tag of ticket.tags) {
        stats.byTags[tag] = (stats.byTags[tag] || 0) + 1;
      }
    }
  }
  
  // Top tags
  stats.topTags = Object.entries(stats.byTags)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  // Top categorias
  stats.topCategories = Object.entries(stats.byCategory)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  return stats;
}

module.exports = {
  getAllTags,
  getAllCategories,
  filterTickets,
  addTagToTicket,
  removeTagFromTicket,
  setTicketCategory,
  getSegmentationStats,
};

