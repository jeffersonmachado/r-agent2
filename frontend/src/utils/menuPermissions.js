/**
 * Estrutura central de permissões do menu de usuário.
 * Baseado no sistema RBAC do backend.
 */

/**
 * Definição de itens do menu com suas permissões.
 */
export const menuItems = [
  {
    label: 'Dashboard',
    path: '/dashboard',
    icon: '🏠',
    // Dashboard é visível para todos autenticados
    permission: null,
  },
  {
    label: 'Atendimento',
    path: '/support',
    icon: '💬',
    permission: { resource: 'tickets', action: 'read' },
  },
  {
    label: 'Inbox',
    path: '/inbox',
    icon: '📥',
    permission: { resource: 'tickets', action: 'read' },
  },
  {
    label: 'Editor',
    path: '/editor',
    icon: '📝',
    permission: { resource: 'flows', action: 'read' },
    // Editor é visível apenas para supervisor e admin (mesmo que agent tenha flows:read)
    roles: ['supervisor', 'admin'],
  },
  {
    label: 'Respostas Rápidas',
    path: '/quick-replies',
    icon: '⚡',
    permission: { resource: 'quick_replies', action: 'read' },
  },
  {
    label: 'FAQ',
    path: '/faq',
    icon: '❓',
    permission: { resource: 'rag', action: 'update' },
  },
  {
    label: 'Departamentos',
    path: '/departments',
    icon: '🏢',
    permission: { resource: 'departments', action: 'read' },
  },
  {
    label: 'Disparos em Massa',
    path: '/bulk-messaging',
    icon: '📢',
    permission: { resource: 'bulk_messaging', action: 'read' },
    roles: ['supervisor', 'admin'],
  },
  {
    label: 'Marketing',
    path: '/marketing',
    icon: '🧲',
    permission: { resource: 'config', action: 'read' },
    roles: ['supervisor', 'manager', 'admin', 'owner'],
  },
  {
    label: 'Solutions Packs',
    path: '/solutions',
    icon: '📦',
    permission: { resource: 'config', action: 'read' },
    roles: ['supervisor', 'manager', 'admin', 'owner'],
  },
  {
    label: 'Analytics',
    path: '/analytics',
    icon: '📊',
    permission: { resource: 'reports', action: 'read' },
  },
  {
    label: 'Supervisor',
    path: '/supervisor',
    icon: '🧭',
    permission: { resource: 'reports', action: 'read' },
    roles: ['supervisor', 'manager', 'admin', 'owner'],
  },
  {
    label: 'RBAC',
    path: '/rbac',
    icon: '🔐',
    permission: { resource: 'agents', action: 'update' },
    roles: ['admin', 'owner'],
  },
  {
    label: 'MFA',
    path: '/mfa',
    icon: '🛡️',
    permission: { resource: 'config', action: 'update' },
    roles: ['admin', 'owner', 'manager', 'supervisor'],
  },
  {
    label: 'URA WhatsApp',
    path: '/whatsapp-ivr',
    icon: '💬',
    permission: { resource: 'config', action: 'update' },
    roles: ['admin', 'owner', 'manager', 'supervisor'],
  },
  {
    label: 'WhatsApp QR',
    path: '/whatsapp-connections',
    icon: '📱',
    permission: { resource: 'config', action: 'update' },
    roles: ['admin', 'owner', 'manager', 'supervisor'],
  },
  {
    label: 'API Keys',
    path: '/developer-keys',
    icon: '🔑',
    permission: { resource: 'config', action: 'read' },
    roles: ['admin', 'owner', 'manager', 'supervisor'],
  },
  {
    label: 'Automações',
    path: '/automations',
    icon: '🧩',
    permission: { resource: 'config', action: 'update' },
    roles: ['admin', 'owner', 'manager', 'supervisor'],
  },
  {
    label: 'Tarefas',
    path: '/tasks',
    icon: '✅',
    permission: { resource: 'config', action: 'update' },
    roles: ['admin', 'owner', 'manager', 'supervisor'],
  },
  {
    label: 'SLA',
    path: '/sla-policies',
    icon: '⏱️',
    permission: { resource: 'reports', action: 'read' },
    roles: ['admin', 'owner', 'manager', 'supervisor'],
  },
  {
    label: 'Exportação',
    path: '/export',
    icon: '📥',
    permission: { resource: 'reports', action: 'export' },
    roles: ['supervisor', 'admin'],
  },
  {
    label: 'Ferramentas de IA',
    path: '/ai-tools',
    icon: '🤖',
    permission: { resource: 'tickets', action: 'read' },
  },
  {
    label: 'Segmentação',
    path: '/segmentation',
    icon: '🏷️',
    permission: { resource: 'tickets', action: 'read' },
  },
  {
    label: 'Templates WhatsApp',
    path: '/whatsapp-templates',
    icon: '📋',
    permission: { resource: 'flows', action: 'read' },
  },
  {
    label: 'Node Marketplace',
    path: '/node-marketplace',
    icon: '🧩',
    permission: { resource: 'config', action: 'read' },
    roles: ['supervisor', 'manager', 'admin', 'owner'],
  },
  {
    label: 'SSO / SCIM',
    path: '/sso-scim',
    icon: '🔐',
    permission: { resource: 'config', action: 'read' },
    roles: ['admin', 'owner'],
  },
  {
    label: 'Backup / DR',
    path: '/backup',
    icon: '🗄️',
    permission: { resource: 'config', action: 'read' },
    roles: ['admin', 'owner'],
  },
  {
    label: 'Canais',
    path: '/channel-accounts',
    icon: '🔌',
    permission: { resource: 'config', action: 'read' },
    roles: ['supervisor', 'manager', 'admin', 'owner'],
  },
  {
    label: 'Plano e Uso',
    path: '/plan-usage',
    icon: '📦',
    permission: { resource: 'config', action: 'read' },
    roles: ['admin', 'owner'],
  },
  {
    label: 'Saúde de Canais',
    path: '/channel-health',
    icon: '📡',
    permission: { resource: 'config', action: 'read' },
    roles: ['supervisor', 'manager', 'admin', 'owner'],
  },
  {
    label: 'PBX (Legado)',
    path: '/pbx',
    icon: '📞',
    permission: { resource: 'config', action: 'read' },
    roles: ['supervisor', 'manager', 'admin', 'owner'],
  },
  {
    label: 'Configuração',
    path: '/config',
    icon: '⚙️',
    permission: { resource: 'config', action: 'read' },
  },
  {
    label: 'Manutenção',
    path: '/maintenance',
    icon: '🛠️',
    permission: { resource: 'tickets', action: 'list_all' },
  },
  {
    label: 'Agentes',
    path: '/agents',
    icon: '👥',
    permission: { resource: 'agents', action: 'list_all' },
  },
  {
    label: 'Tenants',
    path: '/tenants',
    icon: '🏢',
    permission: { resource: 'tenant', action: 'read' },
    roles: ['owner', 'admin'],
  },
  {
    label: 'Super Admin',
    path: '/super-admin',
    icon: '🔐',
    roles: ['super_admin'],
  },
  {
    label: 'Dev Dashboard',
    path: '/dev',
    icon: '🛠️',
    roles: ['super_admin'],
  },
  {
    label: 'Onboarding',
    path: '/onboarding',
    icon: '🚀',
    permission: { resource: 'tenant', action: 'read' },
  },
  {
    label: 'Auditoria',
    path: '/audit',
    icon: '📋',
    permission: { resource: 'audit', action: 'read' },
  },
  {
    label: 'Base de Conhecimento',
    path: '/knowledge-base',
    icon: '📚',
    permission: { resource: 'rag', action: 'read' },
  },
  {
    label: 'Documentação de Produtos',
    path: '/product-docs',
    icon: '📦',
    permission: { resource: 'rag', action: 'read' },
  },
  {
    label: 'Documentos RAG',
    path: '/rag-documents',
    icon: '🔍',
    permission: { resource: 'rag', action: 'read' },
  },
  {
    label: 'Raspagem de Sites',
    path: '/web-scraping',
    icon: '🕷️',
    permission: { resource: 'rag', action: 'create' },
  },
];

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

function normalizePath(path) {
  if (!path || typeof path !== 'string') {
    return '/';
  }
  const withoutQuery = path.split('?')[0].split('#')[0];
  if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) {
    return withoutQuery.slice(0, -1);
  }
  return withoutQuery;
}

function canAccessMenuItem(agent, item) {
  if (!agent || !item) {
    return false;
  }

  if (isSuperAdmin(agent)) {
    return true;
  }

  if (item.roles && Array.isArray(item.roles)) {
    const agentRole = agent.role?.toLowerCase();

    if (item.roles.includes('super_admin')) {
      return isSuperAdmin(agent);
    }

    if (!item.roles.includes(agentRole)) {
      return false;
    }
  }

  if (!item.permission) {
    return true;
  }

  return hasPermission(agent, item.permission.resource, item.permission.action);
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
  const targetPath = normalizePath(path);

  if (!agent) {
    return false;
  }

  const item = menuItems.find((menuItem) => {
    const basePath = normalizePath(menuItem.path);
    return targetPath === basePath || targetPath.startsWith(`${basePath}/`);
  });

  if (!item) {
    return allowUnknown;
  }

  return canAccessMenuItem(agent, item);
}
