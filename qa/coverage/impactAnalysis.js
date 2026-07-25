'use strict';

/**
 * Análise de impacto de mudanças de inventário sobre o grafo de
 * rastreabilidade (jornadas, ondas técnicas e itens).
 *
 * Grafo construído a partir do inventário:
 * - nós `journey:<id>` para cada jornada ligada (linkedJourneys);
 * - nós `wave:<nome>` para cada onda técnica (technicalWave);
 * - nó por item do inventário (kind → tipo do nó: api/page/model/field/
 *   relation; table → model);
 * - arestas EXPECTED journey↔item e wave↔item.
 *
 * computeImpact usa TraceabilityGraph.propagateImpact a partir dos itens com
 * fingerprint alterado (diff.changed) e classifica os nós atingidos:
 * jornadas/ondas afetadas e itens que passam a exigir REVALIDATION_REQUIRED.
 */

const { TraceabilityGraph } = require('./traceabilityGraph');

const KIND_TO_NODE_TYPE = Object.freeze({
  api: 'api',
  page: 'page',
  model: 'model',
  table: 'model',
  field: 'field',
  relation: 'relation',
});

const JOURNEY_PREFIX = 'journey:';
const WAVE_PREFIX = 'wave:';

/**
 * @param {{inventoryItems: object[]}} input
 * @returns {TraceabilityGraph}
 */
function buildInventoryGraph({ inventoryItems = [] } = {}) {
  const graph = new TraceabilityGraph();

  for (const item of inventoryItems) {
    graph.addNode({
      id: item.id,
      type: KIND_TO_NODE_TYPE[item.kind] || 'service',
      criticality: item.criticality || 'NORMAL',
      classification: item.classification,
      fingerprint: item.fingerprint,
    });
  }

  const anchors = new Set();
  for (const item of inventoryItems) {
    for (const journeyId of item.linkedJourneys || []) {
      const anchorId = `${JOURNEY_PREFIX}${journeyId}`;
      if (!anchors.has(anchorId)) {
        graph.addNode({ id: anchorId, type: 'journey' });
        anchors.add(anchorId);
      }
      graph.declareEdge(anchorId, item.id);
    }
    if (item.technicalWave) {
      const anchorId = `${WAVE_PREFIX}${item.technicalWave}`;
      if (!anchors.has(anchorId)) {
        graph.addNode({ id: anchorId, type: 'wave' });
        anchors.add(anchorId);
      }
      graph.declareEdge(anchorId, item.id);
    }
  }

  return graph;
}

/**
 * Propaga o impacto de um diff de inventário.
 *
 * @param {object} input
 * @param {TraceabilityGraph} input.graph grafo do inventário mais recente
 * @param {{added:string[], removed:string[], changed:Array<{id:string}>}} input.diff
 * @param {object[]} [input.inventoryItems] itens do inventário mais recente
 *   (para enriquecer os itens afetados com kind/linkStatus).
 * @returns {object} análise de impacto
 */
function computeImpact({ graph, diff, inventoryItems = [] } = {}) {
  if (!graph) throw new Error('computeImpact: graph é obrigatório');
  if (!diff) throw new Error('computeImpact: diff é obrigatório');

  const changedIds = (diff.changed || []).map((entry) => entry.id);
  const affected = graph.propagateImpact(changedIds);

  const itemById = new Map(inventoryItems.map((item) => [item.id, item]));

  const journeys = [];
  const waves = [];
  const items = [];
  for (const id of affected) {
    if (id.startsWith(JOURNEY_PREFIX)) {
      journeys.push(id.slice(JOURNEY_PREFIX.length));
    } else if (id.startsWith(WAVE_PREFIX)) {
      waves.push(id.slice(WAVE_PREFIX.length));
    } else {
      const item = itemById.get(id);
      items.push({
        id,
        kind: item ? item.kind : undefined,
        linkStatus: item ? item.linkStatus : undefined,
        changed: changedIds.includes(id),
      });
    }
  }

  journeys.sort();
  waves.sort();

  return {
    changedItems: changedIds,
    addedItems: diff.added || [],
    removedItems: diff.removed || [],
    affected: {
      total: affected.size,
      journeys,
      technicalWaves: waves,
      items,
    },
    // Itens atingidos pelo impacto passam a exigir revalidação.
    revalidationRequired: items.map((item) => item.id),
    // Waves mínimas necessárias para cobrir o impacto.
    minimumWaves: {
      businessJourneys: journeys,
      technicalWaves: waves,
    },
  };
}

module.exports = {
  buildInventoryGraph,
  computeImpact,
  KIND_TO_NODE_TYPE,
};
