/**
 * Serviço de Análise e Métricas (Analytics).
 *
 * Responsabilidades:
 * - Calcular KPIs e métricas em tempo real
 * - Agregar dados de tickets, conversas e atendimentos
 * - Gerar estatísticas por período
 * - Fornecer dados para dashboards
 *
 * Métricas:
 * - Total de tickets (abertos, fechados, em andamento)
 * - Tempo médio de resposta
 * - Tempo médio de resolução
 * - Taxa de satisfação
 * - Volume de mensagens
 * - Performance por agente
 * - Performance por departamento
 * - Performance por fila
 */

const { listAllTickets } = require('./queueService');
const { listAgents } = require('./authService');
const { queryLogs } = require('./auditService');
const { listDepartments } = require('./departmentsService');
const { listQueues } = require('./queueService');
const queueDefinitionService = require('./queueDefinitionService');
const { getSequelize } = require('../db/sequelize');
const { ChannelConversation } = require('../db/models');

function dbAvailable() {
  return !!getSequelize();
}

/**
 * Calcula métricas gerais do sistema.
 * @param {Object} options
 * @param {string} [options.startDate] - Data inicial (ISO string)
 * @param {string} [options.endDate] - Data final (ISO string)
 * @returns {Object}
 */
async function getGeneralMetrics(options = {}) {
  const { startDate, endDate, tenantId } = options;
  
  const allTickets = listAllTickets({ tenantId });
  let tickets = allTickets.tickets || [];
  
  // Filtra por período se fornecido
  if (startDate || endDate) {
    tickets = tickets.filter(ticket => {
      const ticketDate = new Date(ticket.createdAt);
      if (startDate && ticketDate < new Date(startDate)) return false;
      if (endDate && ticketDate > new Date(endDate)) return false;
      return true;
    });
  }
  
  const totalTickets = tickets.length;
  const openTickets = tickets.filter(t => t.status === 'waiting' || t.status === 'in_progress').length;
  const closedTickets = tickets.filter(t => t.status === 'closed').length;
  const inProgressTickets = tickets.filter(t => t.status === 'in_progress').length;
  const waitingTickets = tickets.filter(t => t.status === 'waiting').length;
  
  // Calcula tempos médios
  const closedTicketsWithTime = tickets.filter(t => t.status === 'closed' && t.createdAt && t.updatedAt);
  let avgResolutionTime = 0;
  if (closedTicketsWithTime.length > 0) {
    const totalTime = closedTicketsWithTime.reduce((sum, ticket) => {
      const created = new Date(ticket.createdAt);
      const closed = new Date(ticket.updatedAt);
      return sum + (closed - created);
    }, 0);
    avgResolutionTime = Math.round(totalTime / closedTicketsWithTime.length / 1000 / 60); // em minutos
  }
  
  // Calcula tempo médio de primeira resposta
  let avgFirstResponseTime = 0;
  const ticketsWithMessages = tickets.filter(t => 
    t.messages && Array.isArray(t.messages) && t.messages.length > 0
  );
  if (ticketsWithMessages.length > 0) {
    const responseTimes = [];
    for (const ticket of ticketsWithMessages) {
      const userMessages = ticket.messages.filter(m => m.sender === 'user');
      const agentMessages = ticket.messages.filter(m => m.sender === 'agent');
      
      if (userMessages.length > 0 && agentMessages.length > 0) {
        const firstUserMessage = userMessages[0];
        const firstAgentMessage = agentMessages[0];
        
        if (firstUserMessage.timestamp && firstAgentMessage.timestamp) {
          const userTime = new Date(firstUserMessage.timestamp);
          const agentTime = new Date(firstAgentMessage.timestamp);
          if (agentTime > userTime) {
            responseTimes.push((agentTime - userTime) / 1000 / 60); // em minutos
          }
        }
      }
    }
    
    if (responseTimes.length > 0) {
      avgFirstResponseTime = Math.round(
        responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      );
    }
  }
  
  // Total de mensagens
  const totalMessages = tickets.reduce((sum, ticket) => {
    return sum + (ticket.messages ? ticket.messages.length : 0);
  }, 0);

  // -----------------------------------------------------------------------
  // SLA (TME/TMA, abandono) - usa campos persistidos quando disponíveis
  // -----------------------------------------------------------------------
  const firstResponseSeconds = [];
  const handlingSeconds = [];
  let abandonedClosed = 0;

  for (const t of tickets) {
    if (!t) continue;

    if (Number.isFinite(t.waitingTimeSeconds) && t.waitingTimeSeconds >= 0 && t.firstResponseAt) {
      firstResponseSeconds.push(t.waitingTimeSeconds);
    }

    if (t.status === 'closed') {
      const hasFirstResponse = !!t.firstResponseAt;
      if (!hasFirstResponse) abandonedClosed++;

      if (Number.isFinite(t.handlingTimeSeconds) && t.handlingTimeSeconds >= 0 && t.resolvedAt && t.firstResponseAt) {
        handlingSeconds.push(t.handlingTimeSeconds);
      }
    }
  }

  const avgFirstResponseTimeSeconds = firstResponseSeconds.length
    ? Math.round(firstResponseSeconds.reduce((a, b) => a + b, 0) / firstResponseSeconds.length)
    : null;

  const avgHandlingTimeSeconds = handlingSeconds.length
    ? Math.round(handlingSeconds.reduce((a, b) => a + b, 0) / handlingSeconds.length)
    : null;

  const abandonmentRate = closedTickets > 0 ? Number((abandonedClosed / closedTickets).toFixed(4)) : 0;

  // -----------------------------------------------------------------------
  // Contenção bot (best-effort com ChannelConversation)
  // - taxa de conversas no período que NÃO viraram ticket
  // -----------------------------------------------------------------------
  let botContainmentRate = null;
  if (dbAvailable() && tenantId) {
    try {
      const ConversationModel = typeof ChannelConversation === 'function' ? ChannelConversation() : ChannelConversation;
      const sequelize = ConversationModel.sequelize;
      const Op = sequelize.constructor.Op;
      const where = { tenant_key: tenantId };

      if (startDate || endDate) {
        where.last_message_at = {};
        if (startDate) where.last_message_at[Op.gte] = new Date(startDate);
        if (endDate) where.last_message_at[Op.lte] = new Date(endDate);
      }

      const totalConversations = await ConversationModel.count({ where });
      const withTicket = await ConversationModel.count({
        where: {
          ...where,
          current_ticket_id: { [Op.ne]: null },
        },
      });

      if (totalConversations > 0) {
        botContainmentRate = Number((1 - (withTicket / totalConversations)).toFixed(4));
      } else {
        botContainmentRate = null;
      }
    } catch (e) {
      botContainmentRate = null;
    }
  }
  
  return {
    totalTickets,
    openTickets,
    closedTickets,
    inProgressTickets,
    waitingTickets,
    avgResolutionTime, // em minutos
    avgFirstResponseTime, // em minutos
    // SLA (novos)
    avgFirstResponseTimeSeconds, // TME em segundos
    avgHandlingTimeSeconds, // TMA em segundos
    abandonmentRate, // 0..1
    botContainmentRate, // 0..1 ou null
    totalMessages,
    ticketsByStatus: {
      waiting: waitingTickets,
      in_progress: inProgressTickets,
      closed: closedTickets,
    },
  };
}

/**
 * Calcula métricas por agente.
 * @param {Object} options
 * @param {string} [options.startDate]
 * @param {string} [options.endDate]
 * @returns {Array}
 */
function getAgentMetrics(options = {}) {
  const { startDate, endDate, tenantId } = options;
  
  const agents = listAgents(tenantId);
  const allTickets = listAllTickets({ tenantId });
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
  
  const agentStats = {};
  
  // Inicializa estatísticas para cada agente
  for (const agent of agents) {
    agentStats[agent.id] = {
      agentId: agent.id,
      agentName: agent.name || agent.username,
      totalTickets: 0,
      closedTickets: 0,
      openTickets: 0,
      totalMessages: 0,
      avgResponseTime: 0,
      avgResolutionTime: 0,
    };
  }
  
  // Processa tickets
  for (const ticket of tickets) {
    if (ticket.assignedTo) {
      const agentId = ticket.assignedTo;
      if (agentStats[agentId]) {
        agentStats[agentId].totalTickets++;
        
        if (ticket.status === 'closed') {
          agentStats[agentId].closedTickets++;
        } else {
          agentStats[agentId].openTickets++;
        }
        
        // Conta mensagens do agente
        if (ticket.messages && Array.isArray(ticket.messages)) {
          const agentMessages = ticket.messages.filter(m => m.sender === 'agent' && m.agentId === agentId);
          agentStats[agentId].totalMessages += agentMessages.length;
        }
      }
    }
  }
  
  // Calcula tempos médios por agente
  for (const agentId in agentStats) {
    const agentTickets = tickets.filter(t => t.assignedTo === agentId);
    const closedTickets = agentTickets.filter(t => t.status === 'closed' && t.createdAt && t.updatedAt);
    
    if (closedTickets.length > 0) {
      const totalTime = closedTickets.reduce((sum, ticket) => {
        const created = new Date(ticket.createdAt);
        const closed = new Date(ticket.updatedAt);
        return sum + (closed - created);
      }, 0);
      agentStats[agentId].avgResolutionTime = Math.round(totalTime / closedTickets.length / 1000 / 60);
    }
  }
  
  return Object.values(agentStats).sort((a, b) => b.totalTickets - a.totalTickets);
}

/**
 * Calcula métricas por departamento.
 * @param {Object} options
 * @param {string} [options.startDate]
 * @param {string} [options.endDate]
 * @returns {Array}
 */
function getDepartmentMetrics(options = {}) {
  const { startDate, endDate, tenantId } = options;
  
  const departments = listDepartments({ tenantId });
  const allTickets = listAllTickets({ tenantId });
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
  
  const deptStats = {};
  
  // Inicializa estatísticas para cada departamento
  for (const dept of departments) {
    deptStats[dept.id] = {
      departmentId: dept.id,
      departmentName: dept.name,
      totalTickets: 0,
      closedTickets: 0,
      openTickets: 0,
      totalMessages: 0,
      avgResolutionTime: 0,
    };
    
    // Conta tickets das filas do departamento
    for (const queueName of dept.queueNames || []) {
      const queueTickets = tickets.filter(t => t.queue === queueName);
      deptStats[dept.id].totalTickets += queueTickets.length;
      deptStats[dept.id].closedTickets += queueTickets.filter(t => t.status === 'closed').length;
      deptStats[dept.id].openTickets += queueTickets.filter(t => t.status !== 'closed').length;
      
      // Conta mensagens
      for (const ticket of queueTickets) {
        if (ticket.messages && Array.isArray(ticket.messages)) {
          deptStats[dept.id].totalMessages += ticket.messages.length;
        }
      }
    }
    
    // Calcula tempo médio de resolução
    const deptTickets = tickets.filter(t => 
      dept.queueNames && dept.queueNames.includes(t.queue)
    );
    const closedTickets = deptTickets.filter(t => t.status === 'closed' && t.createdAt && t.updatedAt);
    
    if (closedTickets.length > 0) {
      const totalTime = closedTickets.reduce((sum, ticket) => {
        const created = new Date(ticket.createdAt);
        const closed = new Date(ticket.updatedAt);
        return sum + (closed - created);
      }, 0);
      deptStats[dept.id].avgResolutionTime = Math.round(totalTime / closedTickets.length / 1000 / 60);
    }
  }
  
  return Object.values(deptStats).sort((a, b) => b.totalTickets - a.totalTickets);
}

/**
 * Calcula métricas por fila.
 * @param {Object} options
 * @param {string} [options.startDate]
 * @param {string} [options.endDate]
 * @returns {Array}
 */
function getQueueMetrics(options = {}) {
  const { startDate, endDate, tenantId } = options;
  
  const allTickets = listAllTickets({ tenantId });
  let tickets = allTickets.tickets || [];

  // Determina filas relevantes para o tenant:
  // - filas vistas nos tickets (runtime)
  // - filas definidas no DB (queueDefinitionService)
  const queueNames = new Set();
  try {
    for (const t of tickets) {
      if (t?.queue) queueNames.add(String(t.queue));
    }
  } catch (_) {}
  try {
    if (tenantId) {
      for (const q of queueDefinitionService.listQueues({ tenantId, activeOnly: false })) {
        if (q?.name) queueNames.add(String(q.name));
      }
    }
  } catch (_) {}
  // Compat: inclui filas do runtime legado (pode conter nomes globais)
  try {
    for (const qName of (listQueues() || [])) queueNames.add(String(qName));
  } catch (_) {}
  
  // Filtra por período
  if (startDate || endDate) {
    tickets = tickets.filter(ticket => {
      const ticketDate = new Date(ticket.createdAt);
      if (startDate && ticketDate < new Date(startDate)) return false;
      if (endDate && ticketDate > new Date(endDate)) return false;
      return true;
    });
  }
  
  const queueStats = {};
  
  // Inicializa estatísticas para cada fila
  for (const queueName of Array.from(queueNames.values())) {
    queueStats[queueName] = {
      queueName,
      totalTickets: 0,
      closedTickets: 0,
      openTickets: 0,
      waitingTickets: 0,
      inProgressTickets: 0,
      totalMessages: 0,
      avgResolutionTime: 0,
    };
  }
  
  // Processa tickets
  for (const ticket of tickets) {
    const queueName = ticket.queue;
    if (queueStats[queueName]) {
      queueStats[queueName].totalTickets++;
      
      if (ticket.status === 'closed') {
        queueStats[queueName].closedTickets++;
      } else {
        queueStats[queueName].openTickets++;
        
        if (ticket.status === 'waiting') {
          queueStats[queueName].waitingTickets++;
        } else if (ticket.status === 'in_progress') {
          queueStats[queueName].inProgressTickets++;
        }
      }
      
      // Conta mensagens
      if (ticket.messages && Array.isArray(ticket.messages)) {
        queueStats[queueName].totalMessages += ticket.messages.length;
      }
    }
  }
  
  // Calcula tempos médios por fila
  for (const queueName in queueStats) {
    const queueTickets = tickets.filter(t => t.queue === queueName);
    const closedTickets = queueTickets.filter(t => t.status === 'closed' && t.createdAt && t.updatedAt);
    
    if (closedTickets.length > 0) {
      const totalTime = closedTickets.reduce((sum, ticket) => {
        const created = new Date(ticket.createdAt);
        const closed = new Date(ticket.updatedAt);
        return sum + (closed - created);
      }, 0);
      queueStats[queueName].avgResolutionTime = Math.round(totalTime / closedTickets.length / 1000 / 60);
    }
  }
  
  return Object.values(queueStats).sort((a, b) => b.totalTickets - a.totalTickets);
}

/**
 * Calcula métricas de tendência (evolução ao longo do tempo).
 * @param {Object} options
 * @param {string} [options.startDate]
 * @param {string} [options.endDate]
 * @param {string} [options.groupBy] - 'day', 'week', 'month'
 * @returns {Array}
 */
function getTrendMetrics(options = {}) {
  const { startDate, endDate, groupBy = 'day' } = options;
  
  const allTickets = listAllTickets();
  let tickets = allTickets.tickets || [];
  
  // Define período padrão (últimos 30 dias se não especificado)
  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  
  // Filtra tickets no período
  tickets = tickets.filter(ticket => {
    const ticketDate = new Date(ticket.createdAt);
    return ticketDate >= start && ticketDate <= end;
  });
  
  // Agrupa por período
  const groups = {};
  
  for (const ticket of tickets) {
    const ticketDate = new Date(ticket.createdAt);
    let key;
    
    if (groupBy === 'day') {
      key = ticketDate.toISOString().split('T')[0]; // YYYY-MM-DD
    } else if (groupBy === 'week') {
      const weekStart = new Date(ticketDate);
      weekStart.setDate(ticketDate.getDate() - ticketDate.getDay());
      key = weekStart.toISOString().split('T')[0];
    } else if (groupBy === 'month') {
      key = `${ticketDate.getFullYear()}-${String(ticketDate.getMonth() + 1).padStart(2, '0')}`;
    }
    
    if (!groups[key]) {
      groups[key] = {
        period: key,
        totalTickets: 0,
        closedTickets: 0,
        openTickets: 0,
        totalMessages: 0,
      };
    }
    
    groups[key].totalTickets++;
    if (ticket.status === 'closed') {
      groups[key].closedTickets++;
    } else {
      groups[key].openTickets++;
    }
    
    if (ticket.messages && Array.isArray(ticket.messages)) {
      groups[key].totalMessages += ticket.messages.length;
    }
  }
  
  // Converte para array e ordena
  return Object.values(groups).sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Obtém todas as métricas consolidadas.
 * @param {Object} options
 * @returns {Object}
 */
function getAllMetrics(options = {}) {
  return {
    general: getGeneralMetrics(options),
    agents: getAgentMetrics(options),
    departments: getDepartmentMetrics(options),
    queues: getQueueMetrics(options),
    trends: getTrendMetrics(options),
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  getGeneralMetrics,
  getAgentMetrics,
  getDepartmentMetrics,
  getQueueMetrics,
  getTrendMetrics,
  getAllMetrics,
};

