import { flattenNavigationLeaves, pathMatches } from './menu';

const AREA_BLUEPRINTS = [
  {
    id: 'home',
    label: 'Home',
    icon: '⌂',
    description: 'Visao geral e indicadores principais da operacao.',
    topLevelIds: ['cockpit'],
    fallbackPath: '/dashboard',
  },
  {
    id: 'atendimento',
    label: 'Atendimento',
    icon: '✦',
    description: 'Fila ativa, conversas e rotinas de atendimento.',
    topLevelIds: ['relacionamento'],
    fallbackPath: '/support',
    excludeNodeIds: ['crm'],
  },
  {
    id: 'clientes',
    label: 'Clientes',
    icon: '◉',
    description: 'Gestao de contas, contatos, leads e oportunidades.',
    topLevelIds: ['relacionamento'],
    includeNodeIds: ['crm'],
    fallbackPath: '/crm',
  },
  {
    id: 'conhecimento',
    label: 'Conhecimento',
    icon: '◇',
    description: 'Base de conhecimento, RAG e documentacao.',
    topLevelIds: ['inteligencia'],
    fallbackPath: '/knowledge-base',
  },
  {
    id: 'operacoes',
    label: 'Operacoes',
    icon: '△',
    description: 'Monitoramento, canais, PBX e paineis operacionais.',
    topLevelIds: ['operacao', 'verticais'],
    fallbackPath: '/supervisor',
  },
  {
    id: 'builder',
    label: 'Builder',
    icon: '□',
    description: 'Construcao de fluxos, automacoes e testes.',
    topLevelIds: ['automacao'],
    fallbackPath: '/editor',
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: '▤',
    description: 'Configuracoes, governanca e administracao da plataforma.',
    topLevelIds: ['plataforma'],
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

function resolveSourceNodes(filteredMenu, area) {
  const topLevel = filteredMenu.filter((node) => area.topLevelIds.includes(node.id));

  let scopedNodes = topLevel;
  if (Array.isArray(area.includeNodeIds) && area.includeNodeIds.length > 0) {
    scopedNodes = pickByNodeIds(topLevel, area.includeNodeIds);
  }
  if (Array.isArray(area.excludeNodeIds) && area.excludeNodeIds.length > 0) {
    scopedNodes = excludeNodeIds(scopedNodes, area.excludeNodeIds);
  }

  return scopedNodes;
}

export function buildWorkspaceAreas(filteredMenu = [], currentPath = '/') {
  const areas = AREA_BLUEPRINTS.map((area) => {
    const nodes = resolveSourceNodes(filteredMenu, area);
    const leaves = uniqueByPath(
      flattenNavigationLeaves(nodes).filter((item) => item.path && !item.hiddenInSidebar),
    );

    const activeByLeaf = leaves.some((item) => pathMatches(item.path, currentPath));
    const activeByNode = nodes.some((item) => item.path && pathMatches(item.path, currentPath));

    return {
      ...area,
      nodes,
      items: leaves,
      path: leaves[0]?.path || area.fallbackPath,
      isActive: activeByLeaf || activeByNode,
    };
  }).filter((area) => area.path);

  const activeArea = areas.find((area) => area.isActive)
    || areas.find((area) => area.id === 'home')
    || areas[0]
    || null;

  return { areas, activeArea };
}
