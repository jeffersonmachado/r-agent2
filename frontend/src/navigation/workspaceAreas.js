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
    // Fallback canônico da área de Atendimento: o Inbox omnichannel é a
    // superfície principal; '/support' é legada e gated por caseManagement.
    fallbackPath: '/inbox',
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
    // Recorte por EXCLUSÃO: `includeNodeIds: ['crm']` podava os filhos do nó `crm`
    // (pickByNodeIds mantém só os ids pedidos), e a área ficava sem seção própria —
    // exibindo apenas o atalho para `/support`, que é a página LEGADA de Atendimento.
    excludeNodeIds: ['atendimento', 'canais-mensageria'],
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
    ],
    legacyAnchorIds: ['inteligencia'],
    fallbackPath: '/knowledge-base',
    excludeNodeIds: ['governed-insights'],
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
      '/dev/system-status',
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
      '/ai-tools',
      '/segmentation',
      '/node-marketplace',
      '/solutions',
    ],
    legacyAnchorIds: ['automacao'],
    fallbackPath: '/editor',
  },
  {
    // Área de engenharia (rail DEV). Sem este blueprint, `/dev*` era resolvido para
    // `admin` (o Admin também declara prefixo `/dev`) — ver AI_MEMORY/runtime-navigation.md.
    // O escopo é o prefixo `/dev` MAIS as páginas de negócio de QA (`/qa`, `/qa/stability`,
    // `/qa-mesh`): o grupo de menu `qualidade` pertence à área Dev, não ao Admin (decisão
    // 2026-10-09). O recorte é por EXCLUSÃO: `operacao` traz /dev/system-status e
    // /dev/stack-versions (Monitoramento, decisão consciente de 2026-07-23) e `dev-qa-rpa`
    // traz as ferramentas de QA técnica/RPA, que permanecem no Admin (grupo Super Admin).
    id: 'dev',
    label: 'Dev',
    shortLabel: 'DEV',
    icon: 'flow',
    accent: 'var(--color-status-info)',
    description: 'Engenharia: Central Dev, Engineering Model Router e Qualidade.',
    searchScope: 'engineering',
    defaultContextPanel: 'admin',
    pathPrefixes: ['/dev', '/qa', '/qa/stability', '/qa-mesh'],
    excludeNodeIds: ['operacao', 'dev-qa-rpa'],
    // Âncora explícita da área: sem ela o `primaryPath` cairia na PRIMEIRA folha do
    // menu (hoje `/qa`, porque o grupo `qualidade` vem antes de `dev-hub` em
    // `plataforma`) e a área passaria a apontar para Qualidade. Diferente de
    // `fallbackPath`, `primaryPath` NÃO faz a área sobreviver sem itens acessíveis:
    // só é honrado quando o path existe entre as folhas já filtradas por permissão.
    primaryPath: '/dev',
    // Sem `fallbackPath` de propósito: se o agente não tem nenhum item acessível da
    // engenharia, a área NÃO existe e o rail DEV não aparece (com fallback, a área
    // sobrevive apontando para /dev mesmo para quem não pode abrir a rota).
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
    // As superfícies de engenharia (Central Dev e Engineering Model Router) e o grupo
    // Qualidade (QA / Estabilidade QA / QA Mesh) são da área `dev`. O prefixo `/dev` do
    // Admin continua existindo apenas para `/dev/system-status` e `/dev/stack-versions`
    // (Monitoramento) e para as ferramentas de QA técnica/RPA de `dev-qa-rpa`, que
    // permanecem no grupo Super Admin.
    excludeNodeIds: ['dev-hub', 'dev-engineering', 'qualidade'],
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
    // Um nó ANCESTRAL (grupo) pode ter path próprio que não é página desta área: na área
    // Clientes, `relacionamento` (path `/support`, Central de Atendimento LEGADA) é apenas
    // o ancestral do nó `crm`. O path de um grupo só vale como item da área quando casa o
    // `pathPrefixes` dela (ex.: `cockpit` → `/workspace` é página da área inicial).
    const belongsToArea = (item) => {
      const isGroupNode = Array.isArray(item.children) && item.children.length > 0;
      if (!isGroupNode) return true;
      return (area.pathPrefixes || []).some((prefix) => pathMatches(prefix, item.path));
    };
    const allLeaves = uniqueByPath(
      sourceLeaves.filter((item) => item.path && scopedNodePaths.has(item.path) && belongsToArea(item)),
    );
    const leaves = allLeaves.filter((item) => !item.hiddenInSidebar);

    const activeByLeaf = leaves.some((item) => pathMatches(item.path, currentPath));
    // `nodes` inclui ANCESTRAIS de grupo cujo path próprio (ex.: `plataforma` → `/config`)
    // não é uma página desta área — sem o filtro por `leafPaths`, a área `dev` (que tem
    // `plataforma` como ancestral) reivindicava `/config`, que é do Admin.
    const leafPaths = new Set(allLeaves.map((item) => item.path));
    const activeByNode = nodes.some(
      (item) => item.path && leafPaths.has(item.path) && pathMatches(item.path, currentPath),
    );
    const activeByPrefix = Array.isArray(area.pathPrefixes) && area.pathPrefixes.some((prefix) => pathMatches(prefix, currentPath));
    const preferredPath = leaves.find((item) => item.path === area.fallbackPath)?.path;
    // `primaryPath` explícito só vale quando a folha correspondente está acessível —
    // assim a âncora da área não vira um link para uma página que o agente não pode abrir.
    const explicitPrimary = area.primaryPath && leaves.some((item) => item.path === area.primaryPath)
      ? area.primaryPath
      : null;
    const fallbackFromMenu = availablePaths.has(area.fallbackPath) ? area.fallbackPath : null;
    const primaryPath = explicitPrimary || preferredPath || fallbackFromMenu || leaves[0]?.path || allLeaves[0]?.path || area.fallbackPath || null;

    return {
      ...area,
      nodes,
      items: leaves,
      path: primaryPath,
      isActive: activeByLeaf || activeByNode || activeByPrefix,
    };
  }).filter((area) => area.path);

  function getAreaMatchScore(area) {
    const leaves = uniqueByPath(flattenNavigationLeaves(area.nodes || []).filter((item) => item.path));
    if (leaves.some((item) => item.path === currentPath)) return 100;
    if (area.path === currentPath || area.fallbackPath === currentPath) return 95;
    if (leaves.some((item) => pathMatches(item.path, currentPath))) return 80;
    if ((area.pathPrefixes || []).some((prefix) => prefix === currentPath)) return 70;
    if ((area.pathPrefixes || []).some((prefix) => pathMatches(prefix, currentPath))) return 60;
    return area.isActive ? 10 : 0;
  }

  const activeArea = areas
    .filter((area) => area.isActive)
    .sort((left, right) => getAreaMatchScore(right) - getAreaMatchScore(left))[0]
    || areas.find((area) => area.id === 'home')
    || areas[0]
    || null;

  return { areas, activeArea };
}

export { AREA_BLUEPRINTS };
