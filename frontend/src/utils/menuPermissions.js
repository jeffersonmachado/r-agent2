/**
 * Estrutura central de permissões do menu de usuário.
 * Baseado no sistema RBAC do backend.
 */

import { navigationMenu, flattenNavigationLeaves, normalizeNavigationPath } from '../navigation/menu';

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
  ],
  admin: [
    { resource: 'tickets', action: 'read' },
    { resource: 'tickets', action: 'list_all' },
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
  ],
  manager: [
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
  ],
  operator: [
    { resource: 'tickets', action: 'read' },
    { resource: 'flows', action: 'read' },
    { resource: 'quick_replies', action: 'read' },
    { resource: 'departments', action: 'read' },
    { resource: 'rag', action: 'read' },
    { resource: 'rag', action: 'query' },
  ],
  auditor: [
    { resource: 'tickets', action: 'read' },
    { resource: 'tickets', action: 'list_all' },
    { resource: 'audit', action: 'read' },
    { resource: 'audit', action: 'export' },
    { resource: 'reports', action: 'read' },
  ],
  readonly: [
    { resource: 'tickets', action: 'read' },
    { resource: 'flows', action: 'read' },
    { resource: 'quick_replies', action: 'read' },
    { resource: 'departments', action: 'read' },
    { resource: 'rag', action: 'read' },
    { resource: 'rag', action: 'query' },
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
  ],
  agent: [
    { resource: 'tickets', action: 'read' },
    { resource: 'flows', action: 'read' },
    { resource: 'quick_replies', action: 'read' },
    { resource: 'departments', action: 'read' },
    { resource: 'rag', action: 'read' },
    { resource: 'rag', action: 'query' },
  ],
};

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
  
  // Super Admin pode ser:
  // 1. Role 'super_admin'
  // 2. Owner do tenant 'system' (verifica tenantId original se disponível, ou atual)
  // 3. Username 'systemadmin' com role 'owner' (para quando tenantId foi alterado temporariamente)
  if (agent.role === 'super_admin') {
    return true;
  }
  
  // Verifica tenantId original (preservado quando systemadmin escolhe outro tenant)
  const originalTenantId = agent.originalTenantId || agent.tenantId;
  if (agent.role === 'owner' && originalTenantId === 'system') {
    return true;
  }
  
  // Fallback: verifica se é o systemadmin pelo username
  if (agent.role === 'owner' && agent.username === 'systemadmin') {
    return true;
  }
  
  return false;
}

/**
 * Filtra itens do menu baseado nas permissões do agente.
 *
 * @param {Object} agent - Agente autenticado
 * @returns {Array} Itens do menu que o agente pode ver
 */
export function getVisibleMenuItems(agent) {
  if (!agent) {
    return [];
  }

  return menuItems.filter((item) => canAccessMenuItem(agent, item));
}

export function canAccessMenuItem(agent, item) {
  if (!agent || !item) {
    return false;
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

export function filterNavigationTree(agent, nodes = []) {
  if (!agent) return [];

  return nodes.reduce((acc, node) => {
    const visibleChildren = Array.isArray(node.children)
      ? filterNavigationTree(agent, node.children)
      : [];

    const currentNode = {
      ...node,
      children: visibleChildren,
    };

    const isAccessible = canAccessMenuItem(agent, currentNode);
    const hasVisibleChildren = visibleChildren.length > 0;

    if (isAccessible || hasVisibleChildren) {
      acc.push(currentNode);
    }
    return acc;
  }, []);
}

/**
 * Verifica se um agente pode acessar uma rota do frontend com base nas regras do menu/RBAC.
 *
 * @param {Object} agent - Agente autenticado
 * @param {string} path - URL/rota atual
 * @param {Object} options
 * @param {boolean} options.allowUnknown - Quando true, rotas sem mapeamento explícito são permitidas
 * @returns {boolean}
 */
export function canAccessPath(agent, path, options = {}) {
  const { allowUnknown = true } = options;
  const targetPath = normalizeNavigationPath(path);

  if (!agent) {
    return false;
  }

  const item = menuItems.find((menuItem) => {
    const basePath = normalizeNavigationPath(menuItem.path);
    return targetPath === basePath || targetPath.startsWith(`${basePath}/`);
  });

  if (!item) {
    return allowUnknown;
  }

  return canAccessMenuItem(agent, item);
}
