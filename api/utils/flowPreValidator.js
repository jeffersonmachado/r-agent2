/**
 * FlowPreValidator
 *
 * Valida um "flow draft" (nodes + edges ou nodes com next) ANTES de qualquer uso posterior.
 * NÃO corrige, apenas rejeita lançando erro com { code, message }.
 *
 * Regras mandatórias:
 * 1) Detectar ciclos (hard) via SCC (Tarjan) sobre nodes[].next
 * 2) Proibir arestas para ancestrais (DFS com stack) em um grafo dirigido
 * 3) Fan-in ilegal (entradas > 1) exceto types: merge, handoff, end
 * 4) Fallback NÃO pode ter fan-in direto (> 1)
 * 5) Reutilização de blocos decisórios (heurística de revisita)
 * 6) Todos os nós devem ser alcançáveis a partir do start
 */

const DECISION_NODE_TYPES = new Set(['router', 'options', 'ai_task', 'subflow', 'fallback']);
const FANIN_ALLOWED_TYPES = new Set(['merge', 'handoff', 'end']);

function makeFlowError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function isObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

function extractTargetsFromNext(next) {
  if (!next) return [];
  if (typeof next === 'string') return [next];
  if (Array.isArray(next)) return next.filter((x) => typeof x === 'string');
  if (isObject(next)) {
    const out = [];
    for (const v of Object.values(next)) {
      if (typeof v === 'string') out.push(v);
      else if (Array.isArray(v)) out.push(...v.filter((x) => typeof x === 'string'));
    }
    return out;
  }
  return [];
}

/**
 * Constrói uma lista de arestas dirigidas (from -> to) para um draft.
 *
 * @param {any} flow
 * @param {{ includeRouterRules?: boolean, includeEdgesArray?: boolean }} [options]
 * @returns {{ edges: Array<{from:string,to:string}>, nodesById: Map<string, any>, startId: string|null }}
 */
function buildEdges(flow, options = {}) {
  const includeRouterRules = options.includeRouterRules === true;
  const includeEdgesArray = options.includeEdgesArray !== false;

  const nodes = safeArray(flow?.nodes).filter((n) => n && typeof n === 'object');
  const nodesById = new Map();
  for (const n of nodes) {
    const id = typeof n.id === 'string' ? n.id : null;
    if (!id) continue;
    if (!nodesById.has(id)) nodesById.set(id, n);
  }

  const startId = (() => {
    for (const n of nodes) {
      if (n && n.type === 'start' && typeof n.id === 'string') return n.id;
    }
    return null;
  })();

  /** @type {Array<{from:string,to:string}>} */
  const edges = [];

  for (const n of nodes) {
    const from = typeof n?.id === 'string' ? n.id : null;
    if (!from) continue;

    // next (string | array | object-port-map)
    for (const to of extractTargetsFromNext(n.next)) {
      edges.push({ from, to });
    }

    // router rules (branch edges)
    if (includeRouterRules && n.type === 'router' && isObject(n.config) && Array.isArray(n.config.rules)) {
      for (const r of n.config.rules) {
        const to = r && typeof r.next === 'string' ? r.next : null;
        if (to) edges.push({ from, to });
      }
    }
  }

  // edges[] compatível (quando existir no draft)
  if (includeEdgesArray) {
    for (const e of safeArray(flow?.edges)) {
      const from = e && typeof e.from === 'string' ? e.from : null;
      const to = e && typeof e.to === 'string' ? e.to : null;
      if (from && to) edges.push({ from, to });
    }
  }

  return { edges, nodesById, startId };
}

/**
 * @param {Map<string, Set<string>>} adj
 * @param {string} from
 * @param {string} to
 */
function addEdge(adj, from, to) {
  if (!adj.has(from)) adj.set(from, new Set());
  adj.get(from).add(to);
}

/**
 * @param {Map<string, Set<string>>} adj
 * @param {Iterable<string>} nodeIds
 */
function ensureAllNodesPresent(adj, nodeIds) {
  for (const id of nodeIds) {
    if (!adj.has(id)) adj.set(id, new Set());
  }
}

/**
 * Tarjan SCC.
 *
 * @param {Iterable<string>} nodeIds
 * @param {Map<string, Set<string>>} adj
 * @returns {string[][]}
 */
function tarjanScc(nodeIds, adj) {
  /** @type {Map<string, number>} */
  const indexBy = new Map();
  /** @type {Map<string, number>} */
  const lowlinkBy = new Map();
  /** @type {string[]} */
  const stack = [];
  const onStack = new Set();
  let index = 0;
  /** @type {string[][]} */
  const sccs = [];

  const strongConnect = (v) => {
    indexBy.set(v, index);
    lowlinkBy.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);

    const neighbors = adj.get(v) || new Set();
    for (const w of neighbors) {
      if (!indexBy.has(w)) {
        strongConnect(w);
        lowlinkBy.set(v, Math.min(lowlinkBy.get(v), lowlinkBy.get(w)));
      } else if (onStack.has(w)) {
        lowlinkBy.set(v, Math.min(lowlinkBy.get(v), indexBy.get(w)));
      }
    }

    if (lowlinkBy.get(v) === indexBy.get(v)) {
      const component = [];
      while (stack.length) {
        const w = stack.pop();
        onStack.delete(w);
        component.push(w);
        if (w === v) break;
      }
      sccs.push(component);
    }
  };

  for (const v of nodeIds) {
    if (!indexBy.has(v)) strongConnect(v);
  }

  return sccs;
}

/**
 * DFS com stack para detectar arestas para ancestrais (back-edge).
 *
 * @param {Iterable<string>} nodeIds
 * @param {Map<string, Set<string>>} adj
 */
function dfsFromStartOrThrow(startId, nodeIds, adj, nodesById) {
  const allIds = new Set(Array.from(nodeIds));
  const visited = new Set();
  const inStack = new Set();
  /** @type {Map<string, number>} */
  const decisionVisits = new Map();

  const dfs = (v, parentId) => {
    visited.add(v);
    inStack.add(v);

    const neighbors = adj.get(v) || new Set();
    for (const w of neighbors) {
      if (!allIds.has(w)) continue;
      if (inStack.has(w)) {
        throw makeFlowError(
          'FLOW_POINTS_TO_ANCESTOR',
          'Nó aponta para ancestral do grafo. Fluxos devem ser acíclicos.',
        );
      }

      // Reuso de blocos decisórios: conta visitas por aresta/entrada.
      const wType = nodesById.get(w)?.type;
      if (DECISION_NODE_TYPES.has(wType)) {
        const nextCount = (decisionVisits.get(w) || 0) + 1;
        decisionVisits.set(w, nextCount);
        const parentType = nodesById.get(v)?.type || null;
        if (nextCount > 1 && parentType !== 'merge') {
          throw makeFlowError(
            'FLOW_BLOCK_REUSE',
            'Reutilização de bloco decisório detectada. Blocos devem ser duplicados.',
          );
        }
      }

      if (!visited.has(w)) dfs(w, v);
    }

    inStack.delete(v);
  };

  if (!startId || typeof startId !== 'string') {
    throw makeFlowError('FLOW_DISCONNECTED', 'Existem nós não alcançáveis a partir do start.');
  }

  if (!allIds.has(startId)) {
    throw makeFlowError('FLOW_DISCONNECTED', 'Existem nós não alcançáveis a partir do start.');
  }

  dfs(startId, null);
  return visited;
}

/**
 * @param {string} startId
 * @param {Map<string, Set<string>>} adj
 * @returns {Set<string>}
 */
function reachableFrom(startId, adj) {
  const seen = new Set();
  const stack = [startId];
  while (stack.length) {
    const v = stack.pop();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    const neighbors = adj.get(v) || new Set();
    for (const w of neighbors) {
      if (!seen.has(w)) stack.push(w);
    }
  }
  return seen;
}

/**
 * Export público.
 *
 * @param {any} flow
 */
function validateFlowDraft(flow) {
  const nodes = safeArray(flow?.nodes).filter((n) => n && typeof n === 'object');
  if (!nodes.length) {
    throw makeFlowError('FLOW_DISCONNECTED', 'Existem nós não alcançáveis a partir do start.');
  }

  // -----------------------------
  // (1) CICLOS (hard) via SCC em nodes[].next
  // -----------------------------
  const nextOnly = buildEdges(flow, { includeRouterRules: false, includeEdgesArray: false });
  const adjNextOnly = new Map();
  for (const { from, to } of nextOnly.edges) addEdge(adjNextOnly, from, to);
  ensureAllNodesPresent(adjNextOnly, nextOnly.nodesById.keys());

  // Grafo para validações DFS/alcance/fanin/reuso:
  // - inclui arestas do next
  // - inclui arestas do router.config.rules[].next (como o engine considera)
  // - NÃO usa flow.edges[] (desativado)
  const graph = buildEdges(flow, { includeRouterRules: true, includeEdgesArray: false });
  const adj = new Map();
  for (const { from, to } of graph.edges) addEdge(adj, from, to);
  ensureAllNodesPresent(adj, graph.nodesById.keys());

  // -----------------------------
  // (2) FALLBACK NÃO PODE TER FAN-IN DIRETO (apenas nodes[].next)
  // -----------------------------
  /** @type {Map<string, number>} */
  const incomingGraph = new Map();
  for (const id of graph.nodesById.keys()) incomingGraph.set(id, 0);
  for (const { from, to } of graph.edges) {
    if (!graph.nodesById.has(from) || !graph.nodesById.has(to)) continue;
    incomingGraph.set(to, (incomingGraph.get(to) || 0) + 1);
  }
  for (const [id, node] of graph.nodesById.entries()) {
    const inCount = incomingGraph.get(id) || 0;
    if (node?.type === 'fallback' && inCount > 1) {
      throw makeFlowError(
        'FLOW_FALLBACK_FANIN',
        'Fallback não pode receber múltiplas entradas diretas. Use merge antes.',
      );
    }
  }

  // self-loop explícito via next
  for (const { from, to } of nextOnly.edges) {
    if (from === to) {
      throw makeFlowError('FLOW_HAS_CYCLE', 'Fluxo contém ciclo. O engine exige DAG puro.');
    }
  }

  // -----------------------------
  // (1.5) DETECÇÃO DE ANCESTRAIS (DFS com stack) + (3) BLOCK REUSE (DFS)
  // e (4) ALCANCE TOTAL (DFS) — tudo usando apenas nodes[].next
  // -----------------------------
  // IMPORTANT: roda ANTES do SCC para garantir back-edge -> FLOW_POINTS_TO_ANCESTOR.
  const reachable = dfsFromStartOrThrow(graph.startId, graph.nodesById.keys(), adj, graph.nodesById);

  const sccs = tarjanScc(nextOnly.nodesById.keys(), adjNextOnly);
  if (sccs.some((c) => Array.isArray(c) && c.length > 1)) {
    throw makeFlowError('FLOW_HAS_CYCLE', 'Fluxo contém ciclo. O engine exige DAG puro.');
  }

  // -----------------------------
  // Fan-in ilegal (múltiplas entradas) — mantém regra existente, mas usa apenas nodes[].next
  // (Fallback fan-in já é bloqueado acima.)
  // -----------------------------
  /** @type {Map<string, number>} */
  const incoming = new Map();
  for (const id of graph.nodesById.keys()) incoming.set(id, 0);
  for (const { from, to } of graph.edges) {
    if (!graph.nodesById.has(from) || !graph.nodesById.has(to)) continue;
    incoming.set(to, (incoming.get(to) || 0) + 1);
  }

  for (const [id, node] of graph.nodesById.entries()) {
    const inCount = incoming.get(id) || 0;
    const type = node?.type;
    if (inCount > 1 && !FANIN_ALLOWED_TYPES.has(type)) {
      throw makeFlowError('FLOW_ILLEGAL_FANIN', 'Nó possui múltiplas entradas sem merge.');
    }
  }

  // -----------------------------
  // (4) VALIDAÇÃO DE ALCANCE (start -> todos) — apenas nodes[].next
  // -----------------------------
  for (const id of graph.nodesById.keys()) {
    if (!reachable.has(id)) {
      throw makeFlowError('FLOW_DISCONNECTED', 'Existem nós não alcançáveis a partir do start.');
    }
  }

  return true;
}

module.exports = {
  validateFlowDraft,
};

