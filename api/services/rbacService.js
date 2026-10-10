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
    // Engineering Mission (§19): ações granulares de engenharia. `policy_admin` é a ÚNICA
    // autorização que permite escalação de política (§20) — por isso é concedida apenas a owner
    // (e a super_admin, que já tem bypass) e NUNCA a papéis operacionais.
    { resource: 'engineering', action: 'read' },
    { resource: 'engineering', action: 'create' },
    { resource: 'engineering', action: 'enrich' },
    { resource: 'engineering', action: 'approve' },
    { resource: 'engineering', action: 'reject' },
    { resource: 'engineering', action: 'execute' },
    { resource: 'engineering', action: 'policy_admin' },
    // Security Intelligence (RAP Version & Security Intelligence): a superfície é
    // DEVELOPMENT-only, mas a AUTORIDADE sobre ela é POR AÇÃO. Aceitar risco
    // (waiver), revogar isenção e submeter correção ao Roteador Engenheiro são
    // decisões distintas de LER o inventário — e nenhuma delas decorre de "ter
    // acesso à tela". Ver api/modules/security-intel/approvalAuthority.js.
    { resource: 'security_intel', action: 'read' },
    { resource: 'security_intel', action: 'scan' },
    { resource: 'security_intel', action: 'waiver_request' },
    { resource: 'security_intel', action: 'waiver_approve' },
    { resource: 'security_intel', action: 'waiver_revoke' },
    { resource: 'security_intel', action: 'patch_mission' },
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
    // Inbox (conversas omnichannel)
    { resource: 'inbox', action: 'read' },
    { resource: 'inbox', action: 'assign' },
    { resource: 'inbox', action: 'update' },
    { resource: 'inbox', action: 'reply' },
    { resource: 'inbox', action: 'transfer' },
    { resource: 'inbox', action: 'create' },
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
    // Governança de agentes (Agent Factory: approve/publish exigem papel explícito)
    { resource: 'agents', action: 'approve' },
    { resource: 'agents', action: 'publish' },
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
    // Analytics (aplicar recomendações / decision intelligence)
    { resource: 'analytics', action: 'write' },
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
    // Projects
    { resource: 'projects', action: 'read' },
    { resource: 'projects', action: 'create' },
    { resource: 'projects', action: 'update' },
    { resource: 'projects', action: 'delete' },
    { resource: 'projects', action: 'manage_members' },
    { resource: 'projects', action: 'manage_workflow' },
    { resource: 'projects', action: 'comment' },
    { resource: 'projects', action: 'attach' },
    { resource: 'projects', action: 'manage_templates' },
    { resource: 'projects', action: 'view_all' },
    { resource: 'projects', action: 'run_automation' },
    // CRM
    { resource: 'crm', action: 'read' },
    { resource: 'crm', action: 'create' },
    { resource: 'crm', action: 'update' },
    { resource: 'crm', action: 'delete' },
  ],

  admin: [
    // Engineering Mission (§19): engenharia sim, mas SEM `policy_admin` — um admin de tenant não
    // autoriza escalação de política da instalação (§20). Quem precisa escalar pede a owner.
    { resource: 'engineering', action: 'read' },
    { resource: 'engineering', action: 'create' },
    { resource: 'engineering', action: 'enrich' },
    { resource: 'engineering', action: 'approve' },
    { resource: 'engineering', action: 'reject' },
    { resource: 'engineering', action: 'execute' },
    // Security Intelligence: admin de tenant pode ler/scanear e decidir sobre
    // risco do PRÓPRIO tenant (waiver/revogação/missão). Não é acesso de
    // plataforma — a classificação DEVELOPMENT continua sendo exigida à parte.
    { resource: 'security_intel', action: 'read' },
    { resource: 'security_intel', action: 'scan' },
    { resource: 'security_intel', action: 'waiver_request' },
    { resource: 'security_intel', action: 'waiver_approve' },
    { resource: 'security_intel', action: 'waiver_revoke' },
    { resource: 'security_intel', action: 'patch_mission' },
    // Tickets
    { resource: 'tickets', action: 'create' },
    { resource: 'tickets', action: 'read' },
    { resource: 'tickets', action: 'update' },
    { resource: 'tickets', action: 'delete' },
    { resource: 'tickets', action: 'assign' },
    { resource: 'tickets', action: 'close' },
    { resource: 'tickets', action: 'list_all' },
    // Inbox (conversas omnichannel)
    { resource: 'inbox', action: 'read' },
    { resource: 'inbox', action: 'assign' },
    { resource: 'inbox', action: 'update' },
    { resource: 'inbox', action: 'reply' },
    { resource: 'inbox', action: 'transfer' },
    { resource: 'inbox', action: 'create' },
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
    // Governança de agentes (Agent Factory: approve/publish exigem papel explícito)
    { resource: 'agents', action: 'approve' },
    { resource: 'agents', action: 'publish' },
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
    // Analytics (aplicar recomendações / decision intelligence)
    { resource: 'analytics', action: 'write' },
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
    // Projects
    { resource: 'projects', action: 'read' },
    { resource: 'projects', action: 'create' },
    { resource: 'projects', action: 'update' },
    { resource: 'projects', action: 'delete' },
    { resource: 'projects', action: 'manage_members' },
    { resource: 'projects', action: 'manage_workflow' },
    { resource: 'projects', action: 'comment' },
    { resource: 'projects', action: 'attach' },
    { resource: 'projects', action: 'manage_templates' },
    { resource: 'projects', action: 'view_all' },
    { resource: 'projects', action: 'run_automation' },
    // CRM
    { resource: 'crm', action: 'read' },
    { resource: 'crm', action: 'create' },
    { resource: 'crm', action: 'update' },
    { resource: 'crm', action: 'delete' },
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
    // Analytics (aplicar recomendações / decision intelligence)
    { resource: 'analytics', action: 'write' },
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
    // Projects
    { resource: 'projects', action: 'read' },
    { resource: 'projects', action: 'create' },
    { resource: 'projects', action: 'update' },
    { resource: 'projects', action: 'manage_members' },
    { resource: 'projects', action: 'manage_workflow' },
    { resource: 'projects', action: 'comment' },
    { resource: 'projects', action: 'attach' },
    { resource: 'projects', action: 'manage_templates' },
    { resource: 'projects', action: 'view_all' },
    { resource: 'projects', action: 'run_automation' },
    // CRM
    { resource: 'crm', action: 'read' },
    { resource: 'crm', action: 'create' },
    { resource: 'crm', action: 'update' },
  ],

  manager: [
    // Tickets
    { resource: 'tickets', action: 'create' },
    { resource: 'tickets', action: 'read' },
    { resource: 'tickets', action: 'update' },
    { resource: 'tickets', action: 'assign' },
    { resource: 'tickets', action: 'close' },
    { resource: 'tickets', action: 'list_all' },
    // Inbox (conversas omnichannel)
    { resource: 'inbox', action: 'read' },
    { resource: 'inbox', action: 'assign' },
    { resource: 'inbox', action: 'update' },
    { resource: 'inbox', action: 'reply' },
    { resource: 'inbox', action: 'transfer' },
    { resource: 'inbox', action: 'create' },
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
    // Analytics (aplicar recomendações / decision intelligence)
    { resource: 'analytics', action: 'write' },
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
    // Projects
    { resource: 'projects', action: 'read' },
    { resource: 'projects', action: 'create' },
    { resource: 'projects', action: 'update' },
    { resource: 'projects', action: 'manage_members' },
    { resource: 'projects', action: 'manage_workflow' },
    { resource: 'projects', action: 'comment' },
    { resource: 'projects', action: 'attach' },
    { resource: 'projects', action: 'manage_templates' },
    { resource: 'projects', action: 'view_all' },
    { resource: 'projects', action: 'run_automation' },
    // CRM
    { resource: 'crm', action: 'read' },
    { resource: 'crm', action: 'create' },
    { resource: 'crm', action: 'update' },
    { resource: 'crm', action: 'delete' },
  ],

  operator: [
    // Tickets (apenas próprios ou não atribuídos)
    { resource: 'tickets', action: 'read' },
    { resource: 'tickets', action: 'assign' }, // Pode atribuir para si mesmo
    { resource: 'tickets', action: 'close' }, // Pode fechar tickets atribuídos a si
    { resource: 'tickets', action: 'update' }, // Pode atualizar tickets atribuídos a si
    // Inbox (conversas omnichannel)
    { resource: 'inbox', action: 'read' },
    { resource: 'inbox', action: 'assign' },
    { resource: 'inbox', action: 'update' },
    { resource: 'inbox', action: 'reply' },
    { resource: 'inbox', action: 'transfer' },
    { resource: 'inbox', action: 'create' },
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
    // Projects
    { resource: 'projects', action: 'read' },
    { resource: 'projects', action: 'comment' },
    // CRM
    { resource: 'crm', action: 'read' },
  ],

  auditor: [
    // Apenas leitura e auditoria
    { resource: 'tickets', action: 'read' },
    { resource: 'tickets', action: 'list_all' },
    { resource: 'inbox', action: 'read' },
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
    { resource: 'projects', action: 'read' },
    { resource: 'projects', action: 'view_all' },
  ],

  readonly: [
    // Apenas leitura básica
    { resource: 'tickets', action: 'read' },
    { resource: 'inbox', action: 'read' },
    { resource: 'queues', action: 'read' },
    { resource: 'agents', action: 'read' },
    { resource: 'flows', action: 'read' },
    // Analytics (KPIs/metrics operacionais)
    { resource: 'analytics', action: 'read' },
    { resource: 'quick_replies', action: 'read' },
    { resource: 'departments', action: 'read' },
    { resource: 'rag', action: 'read' },
    { resource: 'rag', action: 'query' },
    { resource: 'projects', action: 'read' },
  ],
};

const WORKSPACE_PERMISSIONS = [
  { resource: 'workspace', action: 'read' },
  { resource: 'workspace', action: 'write' },
  { resource: 'workspace', action: 'action' },
  { resource: 'workspace', action: 'insight' },
];

for (const rolePermissions of Object.values(ROLE_PERMISSIONS)) {
  if (!Array.isArray(rolePermissions)) continue;
  for (const permission of WORKSPACE_PERMISSIONS) {
    if (!rolePermissions.some((item) => item.resource === permission.resource && item.action === permission.action)) {
      rolePermissions.push(permission);
    }
  }
}

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeTrimLower(value, fallback = '') {
  const str = safeToString(value, fallback);
  try { return str.trim().toLowerCase(); } catch (_) { return fallback; }
}

function safeKeys(obj) {
  if (!obj || typeof obj !== 'object') return [];
  try { return Object.keys(obj); } catch (_) { return []; }
}

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
  const r = safeTrimLower(role);
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
  return safeKeys(ROLE_PERMISSIONS);
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
    let resource = '';
    let action = '';
    try {
      const rawResource = p.resource;
      const rawAction = p.action;
      resource = typeof rawResource === 'string' ? rawResource.trim() : '';
      action = typeof rawAction === 'string' ? rawAction.trim() : '';
    } catch (_) {
      continue;
    }
    if (!resource || !action) continue;
    const key = `${resource}:${action}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ resource, action });
  }
  return out;
}

function createRole(roleName, permissions = []) {
  const name = roleName ? safeTrimLower(roleName) : '';
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
