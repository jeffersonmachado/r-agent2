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
 * 
 * Roles:
 * - owner: Proprietário do tenant (acesso total, pode gerenciar tenant)
 * - admin: Administrador (acesso total, exceto gestão de tenant)
 * - manager: Gerente (gerencia equipe e operações)
 * - operator: Operador (operações do dia a dia)
 * - auditor: Auditor (apenas leitura e auditoria)
 * - readonly: Leitura apenas
 * 
 * Compatibilidade com roles antigos:
 * - supervisor -> manager
 * - agent -> operator
 */
const ROLE_PERMISSIONS = {
  owner: [
    // Acesso total + gestão de tenant
    { resource: 'tenant', action: 'read' },
    { resource: 'tenant', action: 'update' },
    { resource: 'tenant', action: 'manage' },
    { resource: 'tenant', action: 'billing' },
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
    { resource: 'agents', action: 'invite' },
    // Configuração
    { resource: 'config', action: 'read' },
    { resource: 'config', action: 'update' },
    // Fluxos
    { resource: 'flows', action: 'create' },
    { resource: 'flows', action: 'read' },
    { resource: 'flows', action: 'update' },
    { resource: 'flows', action: 'delete' },
    { resource: 'flows', action: 'execute' },
    // Relatórios
    { resource: 'reports', action: 'read' },
    { resource: 'reports', action: 'export' },
    // Analytics (KPIs/metrics operacionais)
    { resource: 'analytics', action: 'read' },
    // Auditoria
    { resource: 'audit', action: 'read' },
    { resource: 'audit', action: 'export' },
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
    { resource: 'rag', action: 'update' },
    { resource: 'rag', action: 'delete' },
    { resource: 'rag', action: 'admin' },
    { resource: 'rag', action: 'train' },
    // RPA
    { resource: 'rpa', action: 'create' },
    { resource: 'rpa', action: 'read' },
    { resource: 'rpa', action: 'update' },
    { resource: 'rpa', action: 'delete' },
    { resource: 'rpa', action: 'execute' },
    // IA
    { resource: 'ai', action: 'train' },
    { resource: 'ai', action: 'execute' },
    { resource: 'ai', action: 'configure' },
    // Agenda Autônoma
    { resource: 'autonomous_scheduling', action: 'read' },
    { resource: 'autonomous_scheduling', action: 'update' },
    { resource: 'autonomous_scheduling', action: 'run' },
    { resource: 'autonomous_scheduling', action: 'accept' },
  ],

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
    // Analytics (KPIs/metrics operacionais)
    { resource: 'analytics', action: 'read' },
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
    { resource: 'rag', action: 'update' },
    { resource: 'rag', action: 'delete' },
    { resource: 'rag', action: 'admin' },
    // Desenvolvimento
    { resource: 'dev', action: 'read' },
    { resource: 'dev', action: 'write' },
    // Agenda Autônoma
    { resource: 'autonomous_scheduling', action: 'read' },
    { resource: 'autonomous_scheduling', action: 'update' },
    { resource: 'autonomous_scheduling', action: 'run' },
    { resource: 'autonomous_scheduling', action: 'accept' },
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
    // Analytics (KPIs/metrics operacionais)
    { resource: 'analytics', action: 'read' },
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
    { resource: 'rag', action: 'update' },
    // Desenvolvimento
    { resource: 'dev', action: 'read' },
    { resource: 'dev', action: 'write' },
    // Agenda Autônoma
    { resource: 'autonomous_scheduling', action: 'read' },
    { resource: 'autonomous_scheduling', action: 'update' },
    { resource: 'autonomous_scheduling', action: 'run' },
    { resource: 'autonomous_scheduling', action: 'accept' },
  ],

  manager: [
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
    { resource: 'flows', action: 'update' },
    // Relatórios
    { resource: 'reports', action: 'read' },
    // Analytics (KPIs/metrics operacionais)
    { resource: 'analytics', action: 'read' },
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
    { resource: 'rag', action: 'update' },
    // RPA
    { resource: 'rpa', action: 'read' },
    { resource: 'rpa', action: 'execute' },
    // IA
    { resource: 'ai', action: 'execute' },
    // Agenda Autônoma
    { resource: 'autonomous_scheduling', action: 'read' },
    { resource: 'autonomous_scheduling', action: 'update' },
    { resource: 'autonomous_scheduling', action: 'run' },
    { resource: 'autonomous_scheduling', action: 'accept' },
  ],

  operator: [
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
    // RPA (apenas execução)
    { resource: 'rpa', action: 'read' },
    { resource: 'rpa', action: 'execute' },
    // IA (apenas execução)
    { resource: 'ai', action: 'execute' },
    // Agenda Autônoma
    { resource: 'autonomous_scheduling', action: 'read' },
  ],

  auditor: [
    // Apenas leitura e auditoria
    { resource: 'tickets', action: 'read' },
    { resource: 'tickets', action: 'list_all' },
    { resource: 'queues', action: 'read' },
    { resource: 'agents', action: 'read' },
    { resource: 'agents', action: 'list_all' },
    { resource: 'config', action: 'read' },
    { resource: 'flows', action: 'read' },
    { resource: 'reports', action: 'read' },
    // Analytics (KPIs/metrics operacionais)
    { resource: 'analytics', action: 'read' },
    { resource: 'audit', action: 'read' },
    { resource: 'audit', action: 'export' },
    { resource: 'quick_replies', action: 'read' },
    { resource: 'departments', action: 'read' },
    { resource: 'bulk_messaging', action: 'read' },
    { resource: 'rag', action: 'read' },
    { resource: 'rpa', action: 'read' },
    { resource: 'autonomous_scheduling', action: 'read' },
  ],

  readonly: [
    // Apenas leitura básica
    { resource: 'tickets', action: 'read' },
    { resource: 'queues', action: 'read' },
    { resource: 'agents', action: 'read' },
    { resource: 'flows', action: 'read' },
    // Analytics (KPIs/metrics operacionais)
    { resource: 'analytics', action: 'read' },
    { resource: 'quick_replies', action: 'read' },
    { resource: 'departments', action: 'read' },
    { resource: 'rag', action: 'read' },
    { resource: 'rag', action: 'query' },
    { resource: 'autonomous_scheduling', action: 'read' },
  ],
};

/**
 * Normaliza roles para compatibilidade e consistência.
 * - supervisor -> manager
 * - agent -> operator
 *
 * @param {string} role
 * @returns {string|null}
 */
function normalizeRole(role) {
  if (!role) return null;
  const r = String(role).toLowerCase();
  if (r === 'supervisor') return 'manager';
  if (r === 'agent') return 'operator';
  return r;
}

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

  const role = normalizeRole(agent.role);
  if (!role) return false;

  // Super-admin: permissões globais (RBAC não deve bloquear; isolamento de tenant é tratado separadamente)
  if (role === 'super_admin') {
    return true;
  }

  const permissions = ROLE_PERMISSIONS[role] || [];

  return permissions.some(
    (perm) => perm.resource === resource && perm.action === action
  );
}

/**
 * Verifica se um agente pode acessar um ticket específico.
 * Regras:
 * - super_admin/owner/admin/manager: podem acessar qualquer ticket
 * - operator (antigo agent): apenas tickets atribuídos a ele ou não atribuídos
 *
 * @param {Object} agent - Agente
 * @param {Object} ticket - Ticket (deve ter campo 'assignedTo')
 * @returns {boolean}
 */
function canAccessTicket(agent, ticket) {
  if (!agent || !ticket) {
    return false;
  }

  const role = normalizeRole(agent.role);
  if (!role) return false;

  // Papéis com acesso amplo
  if (role === 'super_admin' || role === 'owner' || role === 'admin' || role === 'manager') {
    return true;
  }

  // Operator pode acessar apenas tickets atribuídos a ele ou não atribuídos
  if (role === 'operator') {
    return !ticket.assignedTo || ticket.assignedTo === agent.id || ticket.assignedTo === agent.username;
  }

  return false;
}

/**
 * Verifica se um agente pode modificar um ticket específico.
 * Regras:
 * - super_admin/owner/admin/manager: podem modificar qualquer ticket
 * - operator (antigo agent): apenas tickets atribuídos a ele
 *
 * @param {Object} agent - Agente
 * @param {Object} ticket - Ticket
 * @returns {boolean}
 */
function canModifyTicket(agent, ticket) {
  if (!agent || !ticket) {
    return false;
  }

  const role = normalizeRole(agent.role);
  if (!role) return false;

  // Papéis com acesso amplo
  if (role === 'super_admin' || role === 'owner' || role === 'admin' || role === 'manager') {
    return true;
  }

  // Operator pode modificar apenas tickets atribuídos a ele
  if (role === 'operator') {
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
  const normalized = normalizeRole(role);
  if (!normalized) return [];
  if (normalized === 'super_admin') {
    // Super-admin tem permissões globais; retorna um "superset" útil para UI/debug
    return ROLE_PERMISSIONS.owner || [];
  }
  return ROLE_PERMISSIONS[normalized] || [];
}

/**
 * Lista todos os papéis disponíveis.
 *
 * @returns {string[]}
 */
function listRoles() {
  return Object.keys(ROLE_PERMISSIONS);
}

function listPermissions() {
  const perms = [];
  const seen = new Set();
  for (const list of Object.values(ROLE_PERMISSIONS)) {
    for (const perm of list) {
      if (!perm || !perm.resource || !perm.action) continue;
      const key = `${perm.resource}:${perm.action}`;
      if (seen.has(key)) continue;
      seen.add(key);
      perms.push({ resource: perm.resource, action: perm.action });
    }
  }
  perms.sort((a, b) => {
    if (a.resource === b.resource) return a.action.localeCompare(b.action);
    return a.resource.localeCompare(b.resource);
  });
  return perms;
}

function sanitizePermissions(raw = []) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(raw)) return out;
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const resource = typeof p.resource === 'string' ? p.resource.trim() : '';
    const action = typeof p.action === 'string' ? p.action.trim() : '';
    if (!resource || !action) continue;
    const key = `${resource}:${action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ resource, action });
  }
  return out;
}

function createRole(roleName, permissions = []) {
  const name = roleName ? String(roleName).trim().toLowerCase() : '';
  if (!name) return { success: false, error: 'role inválido' };
  if (ROLE_PERMISSIONS[name]) {
    return { success: false, error: 'role já existe' };
  }
  const perms = sanitizePermissions(permissions);
  ROLE_PERMISSIONS[name] = perms;
  return { success: true, role: name, permissions: perms };
}

function getRoleDefinitions() {
  return Object.entries(ROLE_PERMISSIONS).map(([role, permissions]) => ({
    role,
    permissions: Array.isArray(permissions) ? permissions : [],
  }));
}

module.exports = {
  hasPermission,
  canAccessTicket,
  canModifyTicket,
  getRolePermissions,
  listRoles,
  listPermissions,
  createRole,
  getRoleDefinitions,
  ROLE_PERMISSIONS,
};
