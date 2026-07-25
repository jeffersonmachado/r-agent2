'use strict';

/**
 * Grafo de rastreabilidade entre artefatos de cobertura.
 *
 * Relações:
 * - EXPECTED: aresta declarada (contrato/plano diz que a ligação deve existir).
 * - OBSERVED: aresta observada em runtime durante uma execução.
 *
 * Status resolvidos por computeEdgeStatuses({ executed }):
 * - CONFIRMED: declarada e observada.
 * - UNEXPECTED: observada sem declaração.
 * - MISSING: declarada, não observada, e a execução já ocorreu.
 * - PENDING: declarada, não observada, e a execução ainda não ocorreu.
 */

/** Pesos de criticidade usados na cobertura ponderada. */
const CRITICALITY_WEIGHTS = Object.freeze({
  CRITICAL: 5,
  HIGH: 3,
  NORMAL: 1,
});

const NODE_TYPES = Object.freeze([
  'journey', 'path', 'state', 'transition', 'page', 'api', 'service',
  'model', 'field', 'relation', 'event', 'outcome', 'seed', 'evidence', 'wave',
]);

const EDGE_STATUSES = Object.freeze({
  CONFIRMED: 'CONFIRMED',
  UNEXPECTED: 'UNEXPECTED',
  MISSING: 'MISSING',
  PENDING: 'PENDING',
  STALE: 'STALE',
});

/** Tipos que ancoram a análise de órfãos. */
const ANCHOR_TYPES = Object.freeze(['journey', 'wave']);

function edgeKey(fromId, toId) {
  return `${fromId}→${toId}`;
}

class TraceabilityGraph {
  constructor() {
    /** @type {Map<string, {id:string,type:string,criticality:string,classification:*,fingerprint:*,metadata:*}>} */
    this.nodes = new Map();
    /** @type {Map<string, {from:string,to:string,expected:boolean,observed:boolean,status:string|null}>} */
    this.edges = new Map();
  }

  /**
   * Adiciona (ou atualiza) um nó.
   * @param {{id:string,type:string,criticality?:string,classification?:*,fingerprint?:*,metadata?:*}} node
   */
  addNode(node) {
    if (!node || typeof node.id !== 'string' || node.id.length === 0) {
      throw new Error('traceability_node_id_required');
    }
    if (!NODE_TYPES.includes(node.type)) {
      throw new Error(`traceability_node_type_invalid: ${node.type}`);
    }
    this.nodes.set(node.id, {
      id: node.id,
      type: node.type,
      criticality: node.criticality || 'NORMAL',
      classification: node.classification,
      fingerprint: node.fingerprint,
      metadata: node.metadata,
    });
    return this;
  }

  _ensureEdge(fromId, toId) {
    if (!this.nodes.has(fromId)) throw new Error(`traceability_node_unknown: ${fromId}`);
    if (!this.nodes.has(toId)) throw new Error(`traceability_node_unknown: ${toId}`);
    const key = edgeKey(fromId, toId);
    let edge = this.edges.get(key);
    if (!edge) {
      edge = { from: fromId, to: toId, expected: false, observed: false, status: null };
      this.edges.set(key, edge);
    }
    return edge;
  }

  /** Declara uma relação EXPECTED entre dois nós. */
  declareEdge(fromId, toId) {
    this._ensureEdge(fromId, toId).expected = true;
    return this;
  }

  /** Registra uma relação OBSERVED (runtime) entre dois nós. */
  observeEdge(fromId, toId) {
    this._ensureEdge(fromId, toId).observed = true;
    return this;
  }

  /**
   * Resolve o status de todas as arestas.
   * @param {{executed?: boolean}} options
   * @returns {Array<{from:string,to:string,status:string}>}
   */
  computeEdgeStatuses({ executed = false } = {}) {
    const result = [];
    for (const edge of this.edges.values()) {
      if (edge.status === EDGE_STATUSES.STALE) {
        result.push({ from: edge.from, to: edge.to, status: EDGE_STATUSES.STALE });
        continue;
      }
      let status;
      if (edge.expected && edge.observed) status = EDGE_STATUSES.CONFIRMED;
      else if (edge.observed) status = EDGE_STATUSES.UNEXPECTED;
      else if (executed) status = EDGE_STATUSES.MISSING;
      else status = EDGE_STATUSES.PENDING;
      edge.status = status;
      result.push({ from: edge.from, to: edge.to, status });
    }
    return result;
  }

  _adjacency() {
    const adj = new Map();
    for (const id of this.nodes.keys()) adj.set(id, []);
    for (const edge of this.edges.keys()) {
      const [from, to] = edge.split('→');
      adj.get(from).push(to);
      adj.get(to).push(from);
    }
    return adj;
  }

  /**
   * Nós órfãos: sem nenhuma aresta que os ligue (alcançabilidade bidirecional)
   * a um nó âncora (`journey` ou `wave`). Âncoras nunca são órfãs.
   * @returns {string[]} ids dos nós órfãos
   */
  findOrphans() {
    const adj = this._adjacency();
    const reached = new Set();
    const queue = [];
    for (const node of this.nodes.values()) {
      if (ANCHOR_TYPES.includes(node.type)) {
        reached.add(node.id);
        queue.push(node.id);
      }
    }
    while (queue.length > 0) {
      const current = queue.shift();
      for (const next of adj.get(current)) {
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }
    const orphans = [];
    for (const id of this.nodes.keys()) {
      if (!reached.has(id)) orphans.push(id);
    }
    return orphans;
  }

  /**
   * Marca STALE as arestas CONFIRMED cujo fingerprint de endpoint mudou
   * (identificado pelo conjunto de nós alterados).
   * @param {string[]} changedNodeIds
   * @returns {Array<{from:string,to:string}>} arestas marcadas
   */
  markStale(changedNodeIds) {
    const changed = new Set(changedNodeIds);
    const marked = [];
    for (const edge of this.edges.values()) {
      if (edge.status === EDGE_STATUSES.CONFIRMED
        && (changed.has(edge.from) || changed.has(edge.to))) {
        edge.status = EDGE_STATUSES.STALE;
        marked.push({ from: edge.from, to: edge.to });
      }
    }
    return marked;
  }

  /**
   * Propaga impacto a partir dos nós alterados, retornando todos os nós
   * atingidos via travessia bidirecional do grafo (com proteção contra ciclos).
   * @param {string[]} changedNodeIds
   * @returns {Set<string>} ids afetados (inclui os nós alterados)
   */
  propagateImpact(changedNodeIds) {
    const adj = this._adjacency();
    const affected = new Set();
    const queue = [];
    for (const id of changedNodeIds) {
      if (this.nodes.has(id) && !affected.has(id)) {
        affected.add(id);
        queue.push(id);
      }
    }
    while (queue.length > 0) {
      const current = queue.shift();
      for (const next of adj.get(current)) {
        if (!affected.has(next)) {
          affected.add(next);
          queue.push(next);
        }
      }
    }
    return affected;
  }
}

module.exports = {
  TraceabilityGraph,
  CRITICALITY_WEIGHTS,
  NODE_TYPES,
  EDGE_STATUSES,
};
