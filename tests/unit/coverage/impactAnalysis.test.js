'use strict';

const { buildInventoryGraph, computeImpact } = require('../../../qa/coverage/impactAnalysis');

function item(id, extra = {}) {
  return {
    id,
    kind: 'api',
    classification: 'PRODUCTION',
    linkStatus: 'LINKED',
    linkKind: 'journey',
    fingerprint: `fp-${id}`,
    ...extra,
  };
}

function fixture() {
  const inventoryItems = [
    item('api:GET:/api/beauty/a', { linkedJourneys: ['beauty_booking'] }),
    item('api:GET:/api/beauty/b', { linkedJourneys: ['beauty_booking'] }),
    item('api:GET:/api/fitness/a', { linkedJourneys: ['fitness_checkin'] }),
    item('model:Tenant', {
      kind: 'model', linkKind: 'technical-wave', technicalWave: 'database-integrity', linkedJourneys: [],
    }),
  ];
  return { inventoryItems };
}

describe('coverage/impactAnalysis', () => {
  test('buildInventoryGraph cria nós de jornada, onda técnica e itens com arestas', () => {
    const { inventoryItems } = fixture();
    const graph = buildInventoryGraph({ inventoryItems });

    expect(graph.nodes.has('journey:beauty_booking')).toBe(true);
    expect(graph.nodes.has('wave:database-integrity')).toBe(true);
    expect(graph.edges.has('journey:beauty_booking→api:GET:/api/beauty/a')).toBe(true);
    expect(graph.edges.has('wave:database-integrity→model:Tenant')).toBe(true);
  });

  test('computeImpact propaga mudança para jornada e itens ligados', () => {
    const { inventoryItems } = fixture();
    const graph = buildInventoryGraph({ inventoryItems });
    const diff = {
      added: [],
      removed: [],
      changed: [{ id: 'api:GET:/api/beauty/a', beforeFingerprint: 'x', afterFingerprint: 'y' }],
    };

    const impact = computeImpact({ graph, diff, inventoryItems });

    expect(impact.affected.journeys).toEqual(['beauty_booking']);
    expect(impact.affected.technicalWaves).toEqual([]);
    expect(impact.revalidationRequired).toContain('api:GET:/api/beauty/a');
    expect(impact.revalidationRequired).toContain('api:GET:/api/beauty/b');
    expect(impact.revalidationRequired).not.toContain('api:GET:/api/fitness/a');
    expect(impact.minimumWaves.businessJourneys).toEqual(['beauty_booking']);
  });

  test('computeImpact em item de onda técnica propaga para a wave', () => {
    const { inventoryItems } = fixture();
    const graph = buildInventoryGraph({ inventoryItems });
    const diff = {
      added: [],
      removed: [],
      changed: [{ id: 'model:Tenant', beforeFingerprint: 'x', afterFingerprint: 'y' }],
    };

    const impact = computeImpact({ graph, diff, inventoryItems });

    expect(impact.affected.technicalWaves).toEqual(['database-integrity']);
    expect(impact.minimumWaves.technicalWaves).toEqual(['database-integrity']);
    expect(impact.affected.journeys).toEqual([]);
  });

  test('diff vazio não gera impacto', () => {
    const { inventoryItems } = fixture();
    const graph = buildInventoryGraph({ inventoryItems });
    const impact = computeImpact({ graph, diff: { added: [], removed: [], changed: [] }, inventoryItems });

    expect(impact.affected.total).toBe(0);
    expect(impact.revalidationRequired).toEqual([]);
  });
});
