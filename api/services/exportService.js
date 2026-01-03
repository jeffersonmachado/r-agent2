/**
 * Serviço de Exportação de Dados.
 *
 * Responsabilidades:
 * - Exportar dados em diferentes formatos (CSV, JSON)
 * - Gerar relatórios de tickets, conversas e métricas
 * - Preparar dados para download
 *
 * Formatos suportados:
 * - CSV (para Excel)
 * - JSON
 */

const { listAllTickets } = require('./queueService');
const { listAgents } = require('./authService');
const { queryLogs } = require('./auditService');
const { getAllMetrics } = require('./analyticsService');

/**
 * Converte array de objetos para CSV.
 * @param {Array} data - Array de objetos
 * @param {Array} columns - Array de {key, label}
 * @returns {string}
 */
function arrayToCSV(data, columns) {
  if (!Array.isArray(data) || data.length === 0) {
    return '';
  }

  // Cabeçalho
  const header = columns.map(col => `"${col.label}"`).join(',');
  
  // Linhas
  const rows = data.map(item => {
    return columns.map(col => {
      let value = item[col.key];
      
      // Trata valores especiais
      if (value === null || value === undefined) {
        value = '';
      } else if (typeof value === 'object') {
        value = JSON.stringify(value);
      } else {
        value = String(value);
      }
      
      // Escapa aspas e quebras de linha
      value = value.replace(/"/g, '""');
      value = value.replace(/\n/g, ' ');
      value = value.replace(/\r/g, ' ');
      
      return `"${value}"`;
    }).join(',');
  });
  
  return [header, ...rows].join('\n');
}

/**
 * Exporta tickets em CSV.
 * @param {Object} options
 * @param {string} [options.startDate]
 * @param {string} [options.endDate]
 * @param {string} [options.status]
 * @param {string} [options.queue]
 * @returns {string}
 */
function exportTicketsCSV(options = {}) {
  const { startDate, endDate, status, queue } = options;
  
  const allTickets = listAllTickets();
  let tickets = allTickets.tickets || [];
  
  // Filtra tickets
  if (startDate || endDate) {
    tickets = tickets.filter(ticket => {
      const ticketDate = new Date(ticket.createdAt);
      if (startDate && ticketDate < new Date(startDate)) return false;
      if (endDate && ticketDate > new Date(endDate)) return false;
      return true;
    });
  }
  
  if (status) {
    tickets = tickets.filter(t => t.status === status);
  }
  
  if (queue) {
    tickets = tickets.filter(t => t.queue === queue);
  }
  
  const columns = [
    { key: 'id', label: 'ID' },
    { key: 'sessionId', label: 'Sessão' },
    { key: 'queue', label: 'Fila' },
    { key: 'status', label: 'Status' },
    { key: 'assignedTo', label: 'Atribuído a' },
    { key: 'phoneNumber', label: 'Telefone' },
    { key: 'createdAt', label: 'Data de Criação' },
    { key: 'updatedAt', label: 'Última Atualização' },
    { key: 'lastUserMessage', label: 'Última Mensagem do Usuário' },
    { key: 'unreadCount', label: 'Não Lidas' },
    { key: 'messages', label: 'Total de Mensagens' },
  ];
  
  // Prepara dados
  const data = tickets.map(ticket => ({
    id: ticket.id,
    sessionId: ticket.sessionId || '',
    queue: ticket.queue || '',
    status: ticket.status || '',
    assignedTo: ticket.assignedTo || '',
    phoneNumber: ticket.phoneNumber || '',
    createdAt: ticket.createdAt || '',
    updatedAt: ticket.updatedAt || '',
    lastUserMessage: ticket.lastUserMessage || '',
    unreadCount: ticket.unreadCount || 0,
    messages: ticket.messages ? ticket.messages.length : 0,
  }));
  
  return arrayToCSV(data, columns);
}

/**
 * Exporta métricas em CSV.
 * @param {Object} options
 * @returns {string}
 */
function exportMetricsCSV(options = {}) {
  const metrics = getAllMetrics(options);
  
  const lines = [];
  lines.push('MÉTRICAS GERAIS');
  lines.push('Total de Tickets,' + metrics.general.totalTickets);
  lines.push('Tickets Abertos,' + metrics.general.openTickets);
  lines.push('Tickets Fechados,' + metrics.general.closedTickets);
  lines.push('Tempo Médio de Resolução (min),' + metrics.general.avgResolutionTime);
  lines.push('Tempo Médio de Primeira Resposta (min),' + metrics.general.avgFirstResponseTime);
  lines.push('Total de Mensagens,' + metrics.general.totalMessages);
  lines.push('');
  
  lines.push('MÉTRICAS POR AGENTE');
  lines.push('Agente,Total de Tickets,Tickets Fechados,Tickets Abertos,Total de Mensagens,Tempo Médio de Resolução (min)');
  for (const agent of metrics.agents) {
    lines.push([
      `"${agent.agentName}"`,
      agent.totalTickets,
      agent.closedTickets,
      agent.openTickets,
      agent.totalMessages,
      agent.avgResolutionTime,
    ].join(','));
  }
  lines.push('');
  
  lines.push('MÉTRICAS POR DEPARTAMENTO');
  lines.push('Departamento,Total de Tickets,Tickets Fechados,Tickets Abertos,Total de Mensagens,Tempo Médio de Resolução (min)');
  for (const dept of metrics.departments) {
    lines.push([
      `"${dept.departmentName}"`,
      dept.totalTickets,
      dept.closedTickets,
      dept.openTickets,
      dept.totalMessages,
      dept.avgResolutionTime,
    ].join(','));
  }
  lines.push('');
  
  lines.push('MÉTRICAS POR FILA');
  lines.push('Fila,Total de Tickets,Tickets Fechados,Tickets Abertos,Total de Mensagens,Tempo Médio de Resolução (min)');
  for (const queue of metrics.queues) {
    lines.push([
      `"${queue.queueName}"`,
      queue.totalTickets,
      queue.closedTickets,
      queue.openTickets,
      queue.totalMessages,
      queue.avgResolutionTime,
    ].join(','));
  }
  
  return lines.join('\n');
}

/**
 * Exporta conversas em JSON.
 * @param {Object} options
 * @returns {Object}
 */
function exportConversationsJSON(options = {}) {
  const { startDate, endDate } = options;
  
  const allTickets = listAllTickets();
  let tickets = allTickets.tickets || [];
  
  // Filtra por período
  if (startDate || endDate) {
    tickets = tickets.filter(ticket => {
      const ticketDate = new Date(ticket.createdAt);
      if (startDate && ticketDate < new Date(startDate)) return false;
      if (endDate && ticketDate > new Date(endDate)) return false;
      return true;
    });
  }
  
  return {
    exportDate: new Date().toISOString(),
    period: {
      startDate: startDate || null,
      endDate: endDate || null,
    },
    totalConversations: tickets.length,
    conversations: tickets.map(ticket => ({
      id: ticket.id,
      sessionId: ticket.sessionId,
      queue: ticket.queue,
      status: ticket.status,
      assignedTo: ticket.assignedTo,
      phoneNumber: ticket.phoneNumber,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      closedAt: ticket.status === 'closed' ? ticket.updatedAt : null,
      messages: ticket.messages || [],
      context: ticket.context || {},
    })),
  };
}

/**
 * Exporta relatório completo em JSON.
 * @param {Object} options
 * @returns {Object}
 */
function exportFullReportJSON(options = {}) {
  const metrics = getAllMetrics(options);
  const conversations = exportConversationsJSON(options);
  
  return {
    exportDate: new Date().toISOString(),
    period: {
      startDate: options.startDate || null,
      endDate: options.endDate || null,
    },
    metrics,
    conversations: conversations.conversations,
    summary: {
      totalTickets: metrics.general.totalTickets,
      openTickets: metrics.general.openTickets,
      closedTickets: metrics.general.closedTickets,
      avgResolutionTime: metrics.general.avgResolutionTime,
      avgFirstResponseTime: metrics.general.avgFirstResponseTime,
      totalMessages: metrics.general.totalMessages,
    },
  };
}

module.exports = {
  exportTicketsCSV,
  exportMetricsCSV,
  exportConversationsJSON,
  exportFullReportJSON,
  arrayToCSV,
};

