import {
  flattenNavigationLeaves,
  pathMatches,
} from './menu';

const AREA_BLUEPRINTS = [
  {
    id: 'home',
    label: 'Espaço de Trabalho',
    shortLabel: 'RAP',
    icon: 'users',
    accent: 'var(--color-status-success)',
    description: 'Cliente 360, timeline única e ações inteligentes.',
    searchScope: 'workspace',
    defaultContextPanel: 'support',
    pathPrefixes: ['/workspace', '/dashboard', '/dashboard-legacy'],
    legacyAnchorIds: ['cockpit'],
    fallbackPath: '/workspace',
  },
  {
    id: 'atendimento',
    label: 'Atendimento',
    shortLabel: 'ATD',
    icon: 'spark',
    accent: 'var(--color-status-warning)',
    description: 'Fila ativa, conversas e rotinas de atendimento.',
    searchScope: 'tickets',
    defaultContextPanel: 'support',
    pathPrefixes: [
      '/support',
      '/inbox',
      '/maintenance',
      '/quick-replies',
      '/departments',
      '/failed-messages',
      '/bulk-messaging',
      '/whatsapp-templates',
      '/marketing',
    ],
    legacyAnchorIds: ['relacionamento'],
    fallbackPath: '/support',
    excludeNodeIds: ['crm'],
  },
  {
    id: 'clientes',
    label: 'Clientes',
    shortLabel: 'CRM',
    icon: 'users',
    accent: 'var(--color-status-success)',
    description: 'Gestão de contas, contatos, leads e oportunidades.',
    searchScope: 'crm',
    defaultContextPanel: 'crm',
    pathPrefixes: ['/crm'],
    legacyAnchorIds: ['relacionamento'],
    includeNodeIds: ['crm'],
    fallbackPath: '/crm',
  },
  {
    id: 'conhecimento',
    label: 'Conhecimento',
    shortLabel: 'KB',
    icon: 'book',
    accent: 'var(--color-node-ai)',
    description: 'Base de conhecimento, RAG e documentação.',
    searchScope: 'knowledge',
    defaultContextPanel: 'knowledge',
    pathPrefixes: [
      '/knowledge-base',
      '/product-docs',
      '/rag-documents',
      '/web-scraping',
      '/faq',
      '/qa',
      '/qa-mesh',
      '/qa/stability',
    ],
    legacyAnchorIds: ['inteligencia'],
    fallbackPath: '/knowledge-base',
  },
  {
    id: 'operacoes',
    label: 'Operações',
    shortLabel: 'OPS',
    icon: 'pulse',
    accent: 'var(--color-accent-primary)',
    description: 'Monitoramento, canais, PBX e painéis operacionais.',
    searchScope: 'operations',
    defaultContextPanel: 'operations',
    pathPrefixes: [
      '/supervisor',
      '/operations-dashboard',
      '/analytics',
      '/tenant-intelligence',
      '/system-status',
      '/channel-health',
      '/channel-accounts',
      '/plan-usage',
      '/chat-humano',
      '/fila-fisica',
      '/pbx',
      '/vertical/dashboard',
      '/orders',
      '/kitchen',
      '/dispatch',
      '/beauty',
      '/fitness',
    ],
    legacyAnchorIds: ['operacao', 'verticais'],
    fallbackPath: '/supervisor',
  },
  {
    id: 'builder',
    label: 'Construtor',
    shortLabel: 'BLD',
    icon: 'flow',
    accent: 'var(--color-node-start)',
    description: 'Construção de fluxos, automações e testes.',
    searchScope: 'automation',
    defaultContextPanel: 'builder',
    pathPrefixes: [
      '/editor',
      '/bpmn-editor',
      '/automations',
      '/projects',
      '/tasks',
      '/agenda',
      '/sla-policies',
      '/generate-system',
      '/dev/rpa-test',
      '/dev/rpa-replays',
      '/rpa-seeds',
      '/chat',
      '/ai-tools',
      '/segmentation',
      '/node-marketplace',
      '/solutions',
    ],
    legacyAnchorIds: ['automacao'],
    fallbackPath: '/editor',
  },
  {
    id: 'admin',
    label: 'Admin',
    shortLabel: 'ADM',
    icon: 'shield',
    accent: 'var(--color-status-error)',
    description: 'Configurações, governança e administração da plataforma.',
    searchScope: 'governance',
    defaultContextPanel: 'admin',
    pathPrefixes: [
      '/config',
      '/agents',
      '/tenants',
      '/audit',
      '/rbac',
      '/mfa',
      '/developer-keys',
      '/access-control',
      '/export',
      '/backup',
      '/sso-scim',
      '/dev',
    ],
    legacyAnchorIds: ['plataforma'],
    fallbackPath: '/config',
  },
];

function uniqueByPath(items = []) {
  const seen = new Set();
  const output = [];
  items.forEach((item) => {
    if (!item?.path) return;
    if (seen.has(item.path)) return;
    seen.add(item.path);
    output.push(item);
  });
  return output;
}

function pickByNodeIds(nodes = [], nodeIds = []) {
  const wanted = new Set(nodeIds);

  function visit(list) {
    const result = [];
    list.forEach((node) => {
      const nested = Array.isArray(node.children) ? visit(node.children) : [];
      if (wanted.has(node.id) || nested.length > 0) {
        result.push({ ...node, children: nested });
      }
    });
    return result;
  }

  return visit(nodes);
}

function excludeNodeIds(nodes = [], nodeIds = []) {
  const blocked = new Set(nodeIds);

  function visit(list) {
    return list
      .filter((node) => !blocked.has(node.id))
      .map((node) => ({
        ...node,
        children: Array.isArray(node.children) ? visit(node.children) : [],
      }));
  }

  return visit(nodes);
}

function pathInScope(path, prefixes = []) {
  if (!path || prefixes.length === 0) return false;
  return prefixes.some((prefix) => pathMatches(prefix, path));
}

function leavesFromPathScope(filteredMenu = [], area = {}) {
  const allLeaves = flattenNavigationLeaves(filteredMenu, []);
  return allLeaves.filter((leaf) => pathInScope(leaf.path, area.pathPrefixes || []));
}

function leavesFromLegacyAnchors(filteredMenu = [], area = {}) {
  if (!Array.isArray(area.legacyAnchorIds) || area.legacyAnchorIds.length === 0) {
    return [];
  }
  const topLevel = filteredMenu.filter((node) => area.legacyAnchorIds.includes(node.id));
  return flattenNavigationLeaves(topLevel, []);
}

function nodesFromLeaves(filteredMenu = [], leaves = []) {
  const leafIds = new Set(leaves.map((leaf) => leaf.id));
  if (leafIds.size === 0) return [];

  function prune(nodes) {
    return nodes
      .map((node) => {
        const children = Array.isArray(node.children) ? prune(node.children) : [];
        const keepCurrent = leafIds.has(node.id);
        if (!keepCurrent && children.length === 0) return null;
        return { ...node, children };
      })
      .filter(Boolean);
  }

  return prune(filteredMenu);
}

function resolveSourceNodes(filteredMenu, area) {
  const scopedLeaves = leavesFromPathScope(filteredMenu, area);
  const legacyLeaves = leavesFromLegacyAnchors(filteredMenu, area);

  const mergedLeaves = uniqueByPath([...scopedLeaves, ...legacyLeaves]);
  let scopedNodes = nodesFromLeaves(filteredMenu, mergedLeaves);

  if (Array.isArray(area.includeNodeIds) && area.includeNodeIds.length > 0) {
    scopedNodes = pickByNodeIds(scopedNodes, area.includeNodeIds);
  }
  if (Array.isArray(area.excludeNodeIds) && area.excludeNodeIds.length > 0) {
    scopedNodes = excludeNodeIds(scopedNodes, area.excludeNodeIds);
  }

  return { nodes: scopedNodes, sourceLeaves: mergedLeaves };
}

export function buildWorkspaceAreas(filteredMenu = [], currentPath = '/') {
  const availablePaths = new Set(
    flattenNavigationLeaves(filteredMenu)
      .filter((item) => item.path)
      .map((item) => item.path),
  );

  const areas = AREA_BLUEPRINTS.map((area) => {
    const { nodes, sourceLeaves } = resolveSourceNodes(filteredMenu, area);
    const scopedNodePaths = new Set(
      flattenNavigationLeaves(nodes)
        .filter((item) => item.path)
        .map((item) => item.path),
    );
    const allLeaves = uniqueByPath(
      sourceLeaves.filter((item) => item.path && scopedNodePaths.has(item.path)),
    );
    const leaves = allLeaves.filter((item) => !item.hiddenInSidebar);

    const activeByLeaf = leaves.some((item) => pathMatches(item.path, currentPath));
    const activeByNode = nodes.some((item) => item.path && pathMatches(item.path, currentPath));
    const activeByPrefix = Array.isArray(area.pathPrefixes) && area.pathPrefixes.some((prefix) => pathMatches(prefix, currentPath));
    const preferredPath = leaves.find((item) => item.path === area.fallbackPath)?.path;
    const fallbackFromMenu = availablePaths.has(area.fallbackPath) ? area.fallbackPath : null;
    const primaryPath = preferredPath || fallbackFromMenu || leaves[0]?.path || allLeaves[0]?.path || area.fallbackPath || null;

    return {
      ...area,
      nodes,
      items: leaves,
      path: primaryPath,
      isActive: activeByLeaf || activeByNode || activeByPrefix,
    };
  }).filter((area) => area.path);

  const activeArea = areas.find((area) => area.isActive)
    || areas.find((area) => area.id === 'home')
    || areas[0]
    || null;

  return { areas, activeArea };
}

export { AREA_BLUEPRINTS };
