/**
 * Serviço de RBAC (Role-Based Access Control).
 *
 * Responsabilidades:
 * - Definir permissões por papel
 * - Verificar permissões de agentes
 * - Gerenciar papéis e permissões
 *
 * Papéis:
 * - admin: Acesso total
 * - supervisor: Pode gerenciar agentes e ver relatórios
 * - agent: Acesso básico a tickets e atendimento
 */

/**
 * @typedef {Object} Permission
 * @property {string} resource - Recurso (tickets, queues, agents, etc.)
 * @property {string} action - Ação (create, read, update, delete, etc.)
 */

/**
 * Definição de permissões por papel.
 */
const ROLE_PERMISSIONS = {
  admin: [
    // Tickets
    { resource: 'tickets', action: 'create' },
    { resource: 'tickets', action: 'read' },
    { resource: 'tickets', action: 'update' },
    { resource: 'tickets', action: 'delete' },
    { resource: 'tickets', action: 'assign' },
    { resource: 'tickets', action: 'close' },
    { resource: 'tickets', action: 'list_all' },
    // Filas
    { resource: 'queues', action: 'create' },
    { resource: 'queues', action: 'read' },
    { resource: 'queues', action: 'update' },
    { resource: 'queues', action: 'delete' },
    { resource: 'queues', action: 'admin' },
    { resource: 'queues', action: 'list_all' },
    // Agentes
    { resource: 'agents', action: 'create' },
    { resource: 'agents', action: 'read' },
    { resource: 'agents', action: 'update' },
    { resource: 'agents', action: 'delete' },
    { resource: 'agents', action: 'list_all' },
    // Configuração
    { resource: 'config', action: 'read' },
    { resource: 'config', action: 'update' },
    // Fluxos
    { resource: 'flows', action: 'create' },
    { resource: 'flows', action: 'read' },
    { resource: 'flows', action: 'update' },
    { resource: 'flows', action: 'delete' },
    // Relatórios
    { resource: 'reports', action: 'read' },
    { resource: 'reports', action: 'export' },
    // Auditoria
    { resource: 'audit', action: 'read' },
    // Respostas Rápidas
    { resource: 'quick_replies', action: 'create' },
    { resource: 'quick_replies', action: 'read' },
    { resource: 'quick_replies', action: 'update' },
    { resource: 'quick_replies', action: 'delete' },
    // Departamentos
    { resource: 'departments', action: 'create' },
    { resource: 'departments', action: 'read' },
    { resource: 'departments', action: 'update' },
    { resource: 'departments', action: 'delete' },
    // Disparos em Massa
    { resource: 'bulk_messaging', action: 'create' },
    { resource: 'bulk_messaging', action: 'read' },
    { resource: 'bulk_messaging', action: 'update' },
    { resource: 'bulk_messaging', action: 'delete' },
    // RAG
    { resource: 'rag', action: 'create' },
    { resource: 'rag', action: 'read' },
    { resource: 'rag', action: 'query' },
    { resource: 'rag', action: 'index' },
    { resource: 'rag', action: 'delete' },
    { resource: 'rag', action: 'admin' },
  ],

  supervisor: [
    // Tickets
    { resource: 'tickets', action: 'create' },
    { resource: 'tickets', action: 'read' },
    { resource: 'tickets', action: 'update' },
    { resource: 'tickets', action: 'assign' },
    { resource: 'tickets', action: 'close' },
    { resource: 'tickets', action: 'list_all' },
    // Filas
    { resource: 'queues', action: 'read' },
    { resource: 'queues', action: 'list_all' },
    // Agentes
    { resource: 'agents', action: 'read' },
    { resource: 'agents', action: 'update' },
    { resource: 'agents', action: 'list_all' },
    // Configuração
    { resource: 'config', action: 'read' },
    // Fluxos
    { resource: 'flows', action: 'read' },
    // Relatórios
    { resource: 'reports', action: 'read' },
    // Auditoria
    { resource: 'audit', action: 'read' },
    // Respostas Rápidas
    { resource: 'quick_replies', action: 'read' },
    { resource: 'quick_replies', action: 'update' },
    // Departamentos
    { resource: 'departments', action: 'read' },
    // Disparos em Massa
    { resource: 'bulk_messaging', action: 'read' },
    // RAG
    { resource: 'rag', action: 'create' },
    { resource: 'rag', action: 'read' },
    { resource: 'rag', action: 'query' },
    { resource: 'rag', action: 'index' },
  ],

  agent: [
    // Tickets (apenas próprios ou não atribuídos)
    { resource: 'tickets', action: 'read' },
    { resource: 'tickets', action: 'assign' }, // Pode atribuir para si mesmo
    { resource: 'tickets', action: 'close' }, // Pode fechar tickets atribuídos a si
    { resource: 'tickets', action: 'update' }, // Pode atualizar tickets atribuídos a si
    // Filas (apenas leitura)
    { resource: 'queues', action: 'read' },
    // Agentes (apenas próprio perfil)
    { resource: 'agents', action: 'read' }, // Apenas próprio
    // Configuração (nenhuma)
    // Fluxos (apenas leitura)
    { resource: 'flows', action: 'read' },
    // Respostas Rápidas (apenas leitura e uso)
    { resource: 'quick_replies', action: 'read' },
    // Departamentos (apenas leitura)
    { resource: 'departments', action: 'read' },
    // RAG (consulta e leitura de documentos)
    { resource: 'rag', action: 'query' },
    { resource: 'rag', action: 'read' },
  ],
};

/**
 * Verifica se um agente tem permissão para uma ação em um recurso.
 *
 * @param {Object} agent - Agente (deve ter campo 'role')
 * @param {string} resource - Recurso (tickets, queues, agents, etc.)
 * @param {string} action - Ação (create, read, update, delete, etc.)
 * @returns {boolean}
 */
function hasPermission(agent, resource, action) {
  if (!agent || !agent.role) {
    return false;
  }

  const role = agent.role.toLowerCase();
  const permissions = ROLE_PERMISSIONS[role] || [];

  return permissions.some(
    (perm) => perm.resource === resource && perm.action === action
  );
}

/**
 * Verifica se um agente pode acessar um ticket específico.
 * Regras:
 * - Admin e supervisor: podem acessar qualquer ticket
 * - Agent: apenas tickets atribuídos a ele ou não atribuídos
 *
 * @param {Object} agent - Agente
 * @param {Object} ticket - Ticket (deve ter campo 'assignedTo')
 * @returns {boolean}
 */
function canAccessTicket(agent, ticket) {
  if (!agent || !ticket) {
    return false;
  }

  // Admin e supervisor podem acessar qualquer ticket
  if (agent.role === 'admin' || agent.role === 'supervisor') {
    return true;
  }

  // Agent pode acessar apenas tickets atribuídos a ele ou não atribuídos
  if (agent.role === 'agent') {
    return !ticket.assignedTo || ticket.assignedTo === agent.id || ticket.assignedTo === agent.username;
  }

  return false;
}

/**
 * Verifica se um agente pode modificar um ticket específico.
 * Regras:
 * - Admin e supervisor: podem modificar qualquer ticket
 * - Agent: apenas tickets atribuídos a ele
 *
 * @param {Object} agent - Agente
 * @param {Object} ticket - Ticket
 * @returns {boolean}
 */
function canModifyTicket(agent, ticket) {
  if (!agent || !ticket) {
    return false;
  }

  // Admin e supervisor podem modificar qualquer ticket
  if (agent.role === 'admin' || agent.role === 'supervisor') {
    return true;
  }

  // Agent pode modificar apenas tickets atribuídos a ele
  if (agent.role === 'agent') {
    return ticket.assignedTo === agent.id || ticket.assignedTo === agent.username;
  }

  return false;
}

/**
 * Obtém todas as permissões de um papel.
 *
 * @param {string} role - Papel (admin, supervisor, agent)
 * @returns {Permission[]}
 */
function getRolePermissions(role) {
  return ROLE_PERMISSIONS[role.toLowerCase()] || [];
}

/**
 * Lista todos os papéis disponíveis.
 *
 * @returns {string[]}
 */
function listRoles() {
  return Object.keys(ROLE_PERMISSIONS);
}

module.exports = {
  hasPermission,
  canAccessTicket,
  canModifyTicket,
  getRolePermissions,
  listRoles,
  ROLE_PERMISSIONS,
};

