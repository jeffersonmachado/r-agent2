/**
 * Estrutura central de permissões do menu de usuário.
 * Baseado no sistema RBAC do backend.
 */

import { navigationMenu, flattenNavigationLeaves, normalizeNavigationPath } from '../navigation/menu';
import { getAgentClassification } from './classification';

/**
 * Definição de itens do menu com suas permissões.
 */
export const menuItems = flattenNavigationLeaves(navigationMenu)
  .filter((item) => item.path)
  .map((item) => ({
    label: item.label,
    path: item.path,
    icon: item.icon || '•',
    permission: item.permission || null,
    roles: item.roles,
    classifications: item.classifications,
    capability: item.capability,
    hiddenInSidebar: item.hiddenInSidebar,
    hiddenInSubNav: item.hiddenInSubNav,
  }));

/**
 * Mapeamento de permissões por papel (baseado no rbacService do backend).
 */
const ROLE_PERMISSIONS = {
  owner: [
    { resource: 'tenant', action: 'read' },
    { resource: 'tenant', action: 'update' },
    { resource: 'tenant', action: 'manage' },
    { resource: 'tickets', action: 'read' },
    { resource: 'tickets', action: 'list_all' },
    { resource: 'inbox', action: 'read' },
    { resource: 'inbox', action: 'assign' },
    { resource: 'inbox', action: 'update' },
    { resource: 'inbox', action: 'reply' },
    { resource: 'inbox', action: 'transfer' },
    { resource: 'flows', action: 'read' },
    { resource: 'flows', action: 'update' },
    { resource: 'config', action: 'read' },
    { resource: 'agents', action: 'list_all' },
    { resource: 'agents', action: 'invite' },
    { resource: 'audit', action: 'read' },
    { resource: 'quick_replies', action: 'read' },
    { resource: 'departments', action: 'read' },
    { resource: 'bulk_messaging', action: 'read' },
    { resource: 'reports', action: 'read' },
    { resource: 'reports', action: 'export' },
    { resource: 'rag', action: 'read' },
    { resource: 'rag', action: 'create' },
    { resource: 'rag', action: 'update' },
    { resource: 'rag', action: 'delete' },
    { resource: 'crm', action: 'read' },
    { resource: 'crm', action: 'create' },
    { resource: 'crm', action: 'update' },
    { resource: 'crm', action: 'delete' },
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
  ],
  admin: [
    { resource: 'tickets', action: 'read' },
    { resource: 'tickets', action: 'list_all' },
    { resource: 'inbox', action: 'read' },
    { resource: 'inbox', action: 'assign' },
    { resource: 'inbox', action: 'update' },
    { resource: 'inbox', action: 'reply' },
    { resource: 'inbox', action: 'transfer' },
    { resource: 'flows', action: 'read' },
    { resource: 'flows', action: 'update' },
    { resource: 'config', action: 'read' },
    { resource: 'config', action: 'update' },
    { resource: 'agents', action: 'list_all' },
    { resource: 'agents', action: 'invite' },
    { resource: 'audit', action: 'read' },
    { resource: 'quick_replies', action: 'read' },
    { resource: 'departments', action: 'read' },
    { resource: 'bulk_messaging', action: 'read' },
    { resource: 'reports', action: 'read' },
    { resource: 'reports', action: 'export' },
    { resource: 'rag', action: 'read' },
    { resource: 'rag', action: 'create' },
    { resource: 'rag', action: 'update' },
    { resource: 'rag', action: 'delete' },
    { resource: 'crm', action: 'read' },
    { resource: 'crm', action: 'create' },
    { resource: 'crm', action: 'update' },
    { resource: 'crm', action: 'delete' },
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
  ],
  manager: [
    { resource: 'tickets', action: 'read' },
    { resource: 'tickets', action: 'list_all' },
    { resource: 'inbox', action: 'read' },
    { resource: 'inbox', action: 'assign' },
    { resource: 'inbox', action: 'update' },
    { resource: 'inbox', action: 'reply' },
    { resource: 'inbox', action: 'transfer' },
    { resource: 'flows', action: 'read' },
    { resource: 'config', action: 'read' },
    { resource: 'agents', action: 'list_all' },
    { resource: 'audit', action: 'read' },
    { resource: 'quick_replies', action: 'read' },
    { resource: 'departments', action: 'read' },
    { resource: 'bulk_messaging', action: 'read' },
    { resource: 'reports', action: 'read' },
    { resource: 'rag', action: 'read' },
    { resource: 'rag', action: 'create' },
    { resource: 'rag', action: 'update' },
    { resource: 'crm', action: 'read' },
    { resource: 'crm', action: 'create' },
    { resource: 'crm', action: 'update' },
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
  ],
  operator: [
    { resource: 'tickets', action: 'read' },
    { resource: 'inbox', action: 'read' },
    { resource: 'inbox', action: 'assign' },
    { resource: 'inbox', action: 'update' },
    { resource: 'inbox', action: 'reply' },
    { resource: 'inbox', action: 'transfer' },
    { resource: 'flows', action: 'read' },
    { resource: 'quick_replies', action: 'read' },
    { resource: 'departments', action: 'read' },
    { resource: 'rag', action: 'read' },
    { resource: 'rag', action: 'query' },
    { resource: 'projects', action: 'read' },
    { resource: 'projects', action: 'comment' },
  ],
  auditor: [
    { resource: 'tickets', action: 'read' },
    { resource: 'tickets', action: 'list_all' },
    { resource: 'inbox', action: 'read' },
    { resource: 'audit', action: 'read' },
    { resource: 'audit', action: 'export' },
    { resource: 'reports', action: 'read' },
    { resource: 'projects', action: 'read' },
    { resource: 'projects', action: 'view_all' },
  ],
  readonly: [
    { resource: 'tickets', action: 'read' },
    { resource: 'inbox', action: 'read' },
    { resource: 'flows', action: 'read' },
    { resource: 'quick_replies', action: 'read' },
    { resource: 'departments', action: 'read' },
    { resource: 'rag', action: 'read' },
    { resource: 'rag', action: 'query' },
    { resource: 'projects', action: 'read' },
  ],
  // Compatibilidade com roles antigos
  supervisor: [
    { resource: 'tickets', action: 'read' },
    { resource: 'tickets', action: 'list_all' },
    { resource: 'flows', action: 'read' },
    { resource: 'config', action: 'read' },
    { resource: 'agents', action: 'list_all' },
    { resource: 'audit', action: 'read' },
    { resource: 'quick_replies', action: 'read' },
    { resource: 'departments', action: 'read' },
    { resource: 'bulk_messaging', action: 'read' },
    { resource: 'reports', action: 'read' },
    { resource: 'rag', action: 'read' },
    { resource: 'rag', action: 'create' },
    { resource: 'rag', action: 'update' },
    { resource: 'crm', action: 'read' },
    { resource: 'crm', action: 'create' },
    { resource: 'crm', action: 'update' },
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
  ],
  agent: [
    { resource: 'tickets', action: 'read' },
    { resource: 'flows', action: 'read' },
    { resource: 'quick_replies', action: 'read' },
    { resource: 'departments', action: 'read' },
    { resource: 'rag', action: 'read' },
    { resource: 'rag', action: 'query' },
    { resource: 'projects', action: 'read' },
    { resource: 'projects', action: 'comment' },
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

/**
 * Verifica se um agente tem permissão para uma ação em um recurso.
 *
 * @param {Object} agent - Agente (deve ter campo 'role')
 * @param {string} resource - Recurso (tickets, flows, config, etc.)
 * @param {string} action - Ação (read, update, list_all, etc.)
 * @returns {boolean}
 */
export function hasPermission(agent, resource, action) {
  if (!agent || !agent.role) {
    return false;
  }

  // Super Admin tem acesso total (alinha com o backend)
  if (isSuperAdmin(agent)) {
    return true;
  }

  let role = agent.role.toLowerCase();
  
  // Migra roles antigos
  if (role === 'supervisor') {
    role = 'manager';
  } else if (role === 'agent') {
    role = 'operator';
  }

  const permissions = ROLE_PERMISSIONS[role] || [];

  return permissions.some(
    (perm) => perm.resource === resource && perm.action === action
  );
}

/**
 * Verifica se um agente é Super Admin.
 * Mesma lógica do backend: role 'super_admin' OU owner do tenant 'system'
 *
 * @param {Object} agent - Agente autenticado
 * @returns {boolean}
 */
export function isSuperAdmin(agent) {
  if (!agent) return false;

  const normalizedRole = String(agent.role || '').trim().toLowerCase().replace(/-/g, '_');

  // Super Admin pode ser:
  // 1. Role 'super_admin' (aceita variações de caixa e hífen)
  // 2. Owner do tenant 'system' (verifica tenantId original se disponível, ou atual)
  // 3. Username 'systemadmin' com role 'owner' (para quando tenantId foi alterado temporariamente)
  if (normalizedRole === 'super_admin') {
    return true;
  }

  // Verifica tenantId original (preservado quando systemadmin escolhe outro tenant)
  const originalTenantId = String(agent.originalTenantId || agent.tenantId || '').trim().toLowerCase();
  if (normalizedRole === 'owner' && originalTenantId === 'system') {
    return true;
  }

  // Fallback: verifica se é o systemadmin pelo username
  const normalizedUsername = String(agent.username || '').trim().toLowerCase();
  if (normalizedRole === 'owner' && normalizedUsername === 'systemadmin') {
    return true;
  }

  return false;
}

/**
 * Filtra itens do menu baseado nas permissões do agente.
 *
 * @param {Object} agent - Agente autenticado
 * @param {Object} [capabilities] - Capacidades do tenant (para itens com `capability`)
 * @returns {Array} Itens do menu que o agente pode ver
 */
export function getVisibleMenuItems(agent, capabilities) {
  if (!agent) {
    return [];
  }

  return menuItems.filter((item) => canAccessMenuItem(agent, item, capabilities));
}

export function canAccessMenuItem(agent, item, capabilities) {
  if (!agent || !item) {
    return false;
  }

  // Capacidade do tenant é um gate de funcionalidade, não de papel:
  // aplica-se a qualquer agente (inclusive super_admin).
  if (item.capability && capabilities?.[item.capability] !== true) {
    return false;
  }

  // Itens restritos por classificação de experiência (PRODUCTION/SUPPORT/DEVELOPMENT).
  // Sem classificação conhecida, getAgentClassification retorna PRODUCTION (fail-closed).
  if (item.classifications && Array.isArray(item.classifications)) {
    if (!item.classifications.includes(getAgentClassification(agent))) {
      return false;
    }
  }

  if (isSuperAdmin(agent)) {
    return true;
  }

  if (item.roles && Array.isArray(item.roles)) {
    const agentRole = agent.role?.toLowerCase();

    const hasSuperAdminAccess = item.roles.includes('super_admin') && isSuperAdmin(agent);
    const hasDirectRoleAccess = Boolean(agentRole) && item.roles.includes(agentRole);

    if (!hasSuperAdminAccess && !hasDirectRoleAccess) {
      return false;
    }
  }

  if (!item.permission) {
    return true;
  }

  return hasPermission(agent, item.permission.resource, item.permission.action);
}

export function filterNavigationTree(agent, nodes = [], capabilities) {
  if (!agent) return [];

  return nodes.reduce((acc, node) => {
    const visibleChildren = Array.isArray(node.children)
      ? filterNavigationTree(agent, node.children, capabilities)
      : [];

    const currentNode = {
      ...node,
      children: visibleChildren,
    };

    const isAccessible = canAccessMenuItem(agent, currentNode, capabilities);
    const hasVisibleChildren = visibleChildren.length > 0;

    if (isAccessible || hasVisibleChildren) {
      acc.push(currentNode);
    }
    return acc;
  }, []);
}

/**
 * Prefixos de rotas de engenharia (PRODUCTION_HIDDEN na política de segregação):
 * exigem super_admin, inclusive para paths sem mapeamento explícito no menu
 * (allowUnknown não se aplica a esses prefixos).
 * Inclui aliases legados fora de /dev que renderizam páginas de engenharia
 * (ver main.jsx): '/rpa-seeds', '/system-status', '/generate-system'.
 * '/rpa-replays' NÃO está aqui: é ferramenta de investigação SUPPORT — o acesso
 * é decidido pelo item de menu (classifications SUPPORT + DEVELOPMENT) em canAccessPath.
 */
const PROTECTED_PATH_PREFIXES = ['/dev', '/qa', '/qa-mesh', '/rpa', '/rpa-seeds', '/system-status', '/generate-system'];

function isProtectedPath(targetPath) {
  return PROTECTED_PATH_PREFIXES.some(
    (prefix) => targetPath === prefix || targetPath.startsWith(`${prefix}/`)
  );
}

/**
 * Verifica se um agente pode acessar uma rota do frontend com base nas regras do menu/RBAC.
 *
 * @param {Object} agent - Agente autenticado
 * @param {string} path - URL/rota atual
 * @param {Object} options
 * @param {boolean} options.allowUnknown - Quando true, rotas sem mapeamento explícito são permitidas
 * @param {Object} [options.capabilities] - Capacidades do tenant; rotas com `capability`
 *   no item de menu (ex.: '/cases' exige caseManagement) são negadas sem ela (fail-closed)
 * @returns {boolean}
 */
export function canAccessPath(agent, path, options = {}) {
  const { allowUnknown = true, capabilities } = options;
  const targetPath = normalizeNavigationPath(path);

  if (!agent) {
    return false;
  }

  if (isProtectedPath(targetPath)) {
    return isSuperAdmin(agent);
  }

  const item = menuItems.find((menuItem) => {
    const basePath = normalizeNavigationPath(menuItem.path);
    return targetPath === basePath || targetPath.startsWith(`${basePath}/`);
  });

  if (!item) {
    return allowUnknown;
  }

  return canAccessMenuItem(agent, item, capabilities);
}
