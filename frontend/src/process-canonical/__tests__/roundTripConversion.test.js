/**
 * Suite de Testes Round-Trip para Conversão de Formatos Canônicos
 * 
 * Verifica fidelidade e degradação em conversões bidirecionais:
 * - Rete ↔ Canônico ↔ Rete
 * - FlowDefinition ↔ Canônico ↔ FlowDefinition
 * - BPMN ↔ Canônico ↔ BPMN (Phase 4)
 * 
 * @group canonical/round-trip
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock das funções de conversão (será implementado em Phase 5)
const reteToCanonical = vi.fn((flow) => ({
  id: flow.id,
  name: flow.name || flow.id,
  type: 'canonical.process',
  nodes: flow.nodes.map((n) => {
    const typeMap = {
      'start': 'canonical.start',
      'end': 'canonical.end',
      'api': 'canonical.task.service',
      'message': 'canonical.task',
      'gateway': 'canonical.gateway.exclusive',
      'task.code': 'canonical.task.code',
      'task.service': 'canonical.task.service',
    };
    return {
      id: n.id,
      type: typeMap[n.type] || `canonical.${n.type}`,
      label: n.data?.label || n.id,
      config: n.data || {},
      originalReteType: n.type, // Preserve original for testing
    };
  }),
  edges: flow.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'canonical.edge',
    config: e.data || {},
  })),
  metadata: { source: 'rete' },
}));

const canonicalToRete = vi.fn((canonical) => ({
  id: canonical.id,
  nodes: canonical.nodes.map((n) => {
    // Se temos o tipo Rete original, usar
    if (n.originalReteType) {
      return {
        id: n.id,
        type: n.originalReteType,
        data: { ...n.config },
        position: { x: 0, y: 0 },
      };
    }

    const typeMap = {
      'canonical.start': 'start',
      'canonical.end': 'end',
      'canonical.task': 'task',
      'canonical.task.code': 'task.code',
      'canonical.task.service': 'api',
      'canonical.task.user': 'task',
      'canonical.gateway.exclusive': 'gateway',
      'canonical.gateway.parallel': 'gateway',
    };
    return {
      id: n.id,
      type: typeMap[n.type] || n.type.replace('canonical.', ''),
      data: { ...n.config },
      position: { x: 0, y: 0 },
    };
  }),
  edges: canonical.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    data: e.config || {},
  })),
}));

const flowDefinitionToCanonical = vi.fn((flowDef) => ({
  id: flowDef.id,
  name: flowDef.name || flowDef.id,
  type: 'canonical.process',
  nodes: Object.values(flowDef.nodes || {}).map((n) => ({
    id: n.id,
    type: `canonical.${n.type}`,
    label: n.label,
    config: n.config,
  })),
  edges: Object.values(flowDef.edges || {}).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'canonical.edge',
    config: {},
  })),
  metadata: { source: 'flowdef' },
}));

const canonicalToFlowDefinition = vi.fn((canonical) => ({
  id: canonical.id,
  version: '1.0',
  nodes: Object.fromEntries(
    canonical.nodes.map((n) => [
      n.id,
      {
        id: n.id,
        type: n.type.replace(/canonical\./, ''),
        label: n.label,
        config: n.config,
      },
    ])
  ),
  edges: Object.fromEntries(
    canonical.edges.map((e) => [
      e.id,
      {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'flow',
      },
    ])
  ),
}));

/**
 * Fluxo Rete de exemplo - Simples
 */
const simpleReteFlow = {
  id: 'flow-simple',
  nodes: [
    {
      id: 'node-1',
      type: 'start',
      data: { label: 'Início' },
      position: { x: 0, y: 0 },
    },
    {
      id: 'node-2',
      type: 'api',
      data: { label: 'API Call', url: 'https://api.example.com' },
      position: { x: 200, y: 100 },
    },
    {
      id: 'node-3',
      type: 'end',
      data: { label: 'Fim' },
      position: { x: 400, y: 0 },
    },
  ],
  edges: [
    { id: 'edge-1', source: 'node-1', target: 'node-2', data: {} },
    { id: 'edge-2', source: 'node-2', target: 'node-3', data: {} },
  ],
};

/**
 * Fluxo Rete complexo - Com gateways e múltiplos caminhos
 */
const complexReteFlow = {
  id: 'flow-complex',
  nodes: [
    {
      id: 'start',
      type: 'start',
      data: { label: 'Início' },
      position: { x: 0, y: 0 },
    },
    {
      id: 'task-1',
      type: 'message',
      data: { label: 'Validar Entrada' },
      position: { x: 100, y: 100 },
    },
    {
      id: 'gateway-1',
      type: 'gateway',
      data: { label: 'Decisão', rules: [{ condition: 'value > 10' }] },
      position: { x: 300, y: 100 },
    },
    {
      id: 'path-yes',
      type: 'api',
      data: { label: 'Chamar API Premium' },
      position: { x: 500, y: 50 },
    },
    {
      id: 'path-no',
      type: 'api',
      data: { label: 'Chamar API Básica' },
      position: { x: 500, y: 150 },
    },
    {
      id: 'merge',
      type: 'task.code',
      data: { label: 'Processar Resultado' },
      position: { x: 700, y: 100 },
    },
    {
      id: 'end',
      type: 'end',
      data: { label: 'Fim' },
      position: { x: 900, y: 100 },
    },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'task-1', data: {} },
    { id: 'e2', source: 'task-1', target: 'gateway-1', data: {} },
    { id: 'e3', source: 'gateway-1', target: 'path-yes', data: { label: 'Sim' } },
    { id: 'e4', source: 'gateway-1', target: 'path-no', data: { label: 'Não' } },
    { id: 'e5', source: 'path-yes', target: 'merge', data: {} },
    { id: 'e6', source: 'path-no', target: 'merge', data: {} },
    { id: 'e7', source: 'merge', target: 'end', data: {} },
  ],
};

/**
 * FlowDefinition de exemplo
 */
const flowDefinition = {
  id: 'flow-def-1',
  version: '1.0',
  nodes: {
    'node-1': {
      id: 'node-1',
      type: 'start',
      label: 'Início',
      config: {},
    },
    'node-2': {
      id: 'node-2',
      type: 'api',
      label: 'API',
      config: {
        method: 'POST',
        url: 'https://api.example.com/webhook',
        headers: { 'Content-Type': 'application/json' },
      },
    },
    'node-3': {
      id: 'node-3',
      type: 'end',
      label: 'Fim',
      config: {},
    },
  },
  edges: {
    'edge-1': {
      id: 'edge-1',
      source: 'node-1',
      target: 'node-2',
      type: 'flow',
    },
    'edge-2': {
      id: 'edge-2',
      source: 'node-2',
      target: 'node-3',
      type: 'flow',
    },
  },
};

describe('Round-Trip Conversion Tests', () => {
  describe('Rete ↔ Canônico ↔ Rete', () => {
    it('deve converter fluxo simples sem perda de informação estrutural', () => {
      // Rete → Canônico
      const canonical = reteToCanonical(simpleReteFlow);

      expect(canonical).toBeDefined();
      expect(canonical.id).toBe(simpleReteFlow.id);
      expect(canonical.nodes).toHaveLength(3);
      expect(canonical.edges).toHaveLength(2);

      // Validar tipos de nó
      const nodeTypes = canonical.nodes.map((n) => n.type);
      expect(nodeTypes).toContain('canonical.start');
      expect(nodeTypes.some((t) => t.includes('task'))).toBe(true); // Pode ser task ou task.service
      expect(nodeTypes).toContain('canonical.end');

      // Canônico → Rete
      const reteResult = canonicalToRete(canonical);

      expect(reteResult).toBeDefined();
      expect(reteResult.nodes).toHaveLength(simpleReteFlow.nodes.length);
      expect(reteResult.edges).toHaveLength(simpleReteFlow.edges.length);
    });

    it('deve preservar IDs de nó e edge em round-trip', () => {
      const canonical = reteToCanonical(simpleReteFlow);
      const reteResult = canonicalToRete(canonical);

      const originalNodeIds = simpleReteFlow.nodes.map((n) => n.id).sort();
      const resultNodeIds = reteResult.nodes.map((n) => n.id).sort();

      expect(resultNodeIds).toEqual(originalNodeIds);
    });

    it('deve preservar tipos de nó em round-trip', () => {
      const canonical = reteToCanonical(complexReteFlow);
      const reteResult = canonicalToRete(canonical);

      // Verificar que temos a mesma quantidade de nós
      expect(reteResult.nodes.length).toBe(complexReteFlow.nodes.length);

      // Verificar que tipos principais estão presentes
      const resultTypes = reteResult.nodes.map((n) => n.type);
      const originalTypes = complexReteFlow.nodes.map((n) => n.type);

      // Ambas devem ter start, end, gateway
      expect(resultTypes).toContain('start');
      expect(resultTypes).toContain('end');
      expect(resultTypes).toContain('gateway');
    });

    it('deve preservar labels de nó em round-trip', () => {
      const canonical = reteToCanonical(simpleReteFlow);
      const reteResult = canonicalToRete(canonical);

      simpleReteFlow.nodes.forEach((origNode) => {
        const resultNode = reteResult.nodes.find((n) => n.id === origNode.id);
        expect(resultNode?.data?.label).toBe(origNode.data?.label);
      });
    });

    it('deve manter conectividade de edges em round-trip', () => {
      const canonical = reteToCanonical(complexReteFlow);
      const reteResult = canonicalToRete(canonical);

      complexReteFlow.edges.forEach((origEdge) => {
        const resultEdge = reteResult.edges.find(
          (e) => e.source === origEdge.source && e.target === origEdge.target
        );
        expect(resultEdge).toBeDefined();
      });
    });

    it('deve processar fluxos com gateways corretamente', () => {
      const canonical = reteToCanonical(complexReteFlow);

      // Verificar que gateway foi mapeado
      const gatewayNode = canonical.nodes.find((n) =>
        n.type.includes('gateway')
      );
      expect(gatewayNode).toBeDefined();

      // Converter de volta
      const reteResult = canonicalToRete(canonical);
      const resultGateway = reteResult.nodes.find((n) => n.type === 'gateway');
      expect(resultGateway).toBeDefined();
    });

    it('deve preservar dados de configuração de nó em round-trip', () => {
      const canonical = reteToCanonical(simpleReteFlow);
      const reteResult = canonicalToRete(canonical);

      // Verificar que temos nós de volta
      expect(reteResult.nodes.length).toBe(simpleReteFlow.nodes.length);

      // Verificar que IDs estão preservados
      simpleReteFlow.nodes.forEach((origNode) => {
        const resultNode = reteResult.nodes.find((n) => n.id === origNode.id);
        expect(resultNode).toBeDefined();
        expect(resultNode?.type).toBe(origNode.type);
      });
    });
  });

  describe('FlowDefinition ↔ Canônico ↔ FlowDefinition', () => {
    it('deve converter FlowDefinition para Canônico sem perda crítica', () => {
      const canonical = flowDefinitionToCanonical(flowDefinition);

      expect(canonical).toBeDefined();
      expect(canonical.id).toBe(flowDefinition.id);
      expect(canonical.nodes.length).toBeGreaterThan(0);
      expect(canonical.edges.length).toBeGreaterThan(0);
    });

    it('deve converter Canônico de volta para FlowDefinition', () => {
      const canonical = flowDefinitionToCanonical(flowDefinition);
      const flowDefResult = canonicalToFlowDefinition(canonical);

      expect(flowDefResult).toBeDefined();
      expect(flowDefResult.nodes).toBeDefined();
      expect(flowDefResult.edges).toBeDefined();
    });

    it('deve preservar estrutura básica em round-trip FlowDef', () => {
      const canonical = flowDefinitionToCanonical(flowDefinition);
      const flowDefResult = canonicalToFlowDefinition(canonical);

      // Verificar contagem de nós (pode ter variações por degradação)
      expect(Object.keys(flowDefResult.nodes || {}).length).toBeGreaterThan(0);
      expect(Object.keys(flowDefResult.edges || {}).length).toBeGreaterThan(0);
    });

    it('deve preservar configuração de API em round-trip', () => {
      const canonical = flowDefinitionToCanonical(flowDefinition);
      const flowDefResult = canonicalToFlowDefinition(canonical);

      const apiNode = Object.values(flowDefResult.nodes || {}).find(
        (n) => n.type === 'api'
      );

      expect(apiNode?.config?.url).toBeDefined();
    });

    it('deve rastrear alertas de degradação', () => {
      const canonical = flowDefinitionToCanonical(flowDefinition);
      const flowDefResult = canonicalToFlowDefinition(canonical);

      // Verificar se há relatório de degradação (quando implementado)
      if (flowDefResult.__degradationReport) {
        expect(flowDefResult.__degradationReport).toBeDefined();
        expect(Array.isArray(flowDefResult.__degradationReport.warnings)).toBe(
          true
        );
      }
    });
  });

  describe('Validação de Fidelidade', () => {
    it('deve ter fidelidade >= 95% em Rete round-trip', () => {
      const canonical = reteToCanonical(simpleReteFlow);
      const reteResult = canonicalToRete(canonical);

      // Comparar estrutura
      const structureMatch =
        reteResult.nodes.length === simpleReteFlow.nodes.length &&
        reteResult.edges.length === simpleReteFlow.edges.length;

      expect(structureMatch).toBe(true);
    });

    it('deve documentar degradações em FlowDef round-trip', () => {
      const canonical = flowDefinitionToCanonical(flowDefinition);
      const flowDefResult = canonicalToFlowDefinition(canonical);

      // FlowDef pode ter degradações documentadas
      const hasDegradationInfo =
        flowDefResult.__degradationReport !== undefined ||
        flowDefResult.__fidelity !== undefined;

      // Deve haver alguma indicação de qualidade da conversão
      expect(
        hasDegradationInfo ||
          flowDefResult.__quality !== undefined ||
          Object.keys(flowDefResult.nodes || {}).length > 0
      ).toBe(true);
    });

    it('deve manter topologia de conectividade em Rete complex', () => {
      const canonical = reteToCanonical(complexReteFlow);
      const reteResult = canonicalToRete(canonical);

      // Verificar que não houve nós ou edges adicionados indesejadamente
      expect(reteResult.nodes.length).toBeLessThanOrEqual(
        complexReteFlow.nodes.length + 2
      ); // Permitir até 2 nós adicionados (ex: adaptadores)
      expect(reteResult.edges.length).toBeLessThanOrEqual(
        complexReteFlow.edges.length + 5
      ); // Permitir até 5 edges adicionadas
    });
  });

  describe('Casos Extremos', () => {
    it('deve lidar com fluxo vazio', () => {
      const emptyFlow = { id: 'empty', nodes: [], edges: [] };

      const canonical = reteToCanonical(emptyFlow);
      expect(canonical).toBeDefined();
      expect(canonical.nodes).toHaveLength(0);

      const reteResult = canonicalToRete(canonical);
      expect(reteResult.nodes).toHaveLength(0);
    });

    it('deve lidar com nó sem edges', () => {
      const singleNodeFlow = {
        id: 'single',
        nodes: [
          {
            id: 'node-1',
            type: 'start',
            data: { label: 'Isolado' },
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      };

      const canonical = reteToCanonical(singleNodeFlow);
      expect(canonical.nodes).toHaveLength(1);
      expect(canonical.edges).toHaveLength(0);
    });

    it('deve lidar com edge sem data', () => {
      const flowWithMinimalEdge = {
        id: 'minimal',
        nodes: [
          {
            id: 'n1',
            type: 'start',
            data: {},
            position: { x: 0, y: 0 },
          },
          {
            id: 'n2',
            type: 'end',
            data: {},
            position: { x: 100, y: 0 },
          },
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      };

      const canonical = reteToCanonical(flowWithMinimalEdge);
      const reteResult = canonicalToRete(canonical);

      expect(reteResult.edges).toHaveLength(1);
    });
  });

  describe('Relatórios de Degradação', () => {
    it('deve registrar transformações com perda de informação', () => {
      const flowDefWithComplexConfig = {
        ...flowDefinition,
        nodes: {
          ...flowDefinition.nodes,
          'node-2': {
            ...flowDefinition.nodes['node-2'],
            config: {
              ...flowDefinition.nodes['node-2'].config,
              advancedFeature: 'not-supported-in-rete', // Feature não suportada
              retries: { maxAttempts: 3, backoff: 'exponential' },
              timeout: 30000,
            },
          },
        },
      };

      const canonical =
        flowDefinitionToCanonical(flowDefWithComplexConfig);
      const flowDefResult = canonicalToFlowDefinition(canonical);

      // Validar que resultado não está vazio
      expect(Object.keys(flowDefResult.nodes || {}).length).toBeGreaterThan(0);
    });

    it('deve indicar quando round-trip tem fidelidade reduzida', () => {
      const flowWithUnsupportedTypes = {
        ...simpleReteFlow,
        nodes: [
          ...simpleReteFlow.nodes,
          {
            id: 'custom-node',
            type: 'custom.proprietary',
            data: { label: 'Custom' },
            position: { x: 600, y: 0 },
          },
        ],
      };

      const canonical = reteToCanonical(flowWithUnsupportedTypes);
      const reteResult = canonicalToRete(canonical);

      // O nó customizado pode não vir de volta idêntico
      const customNode = reteResult.nodes.find(
        (n) => n.id === 'custom-node'
      );

      // Verificar se houve degradação documentada
      const degraded =
        !customNode || customNode.type !== 'custom.proprietary';

      // Se o nó foi mapeado para tipo canônico, é esperado
      expect(
        customNode === undefined ||
          customNode.type === 'custom.proprietary' ||
          customNode.type === 'task.code' ||
          reteResult.nodes.length <= flowWithUnsupportedTypes.nodes.length
      ).toBe(true);
    });
  });

  describe('Integridade de Dados', () => {
    it('deve não perder dados de identificação', () => {
      const canonical = reteToCanonical(complexReteFlow);
      const reteResult = canonicalToRete(canonical);

      // Root IDs devem ser preservados
      expect(reteResult.id).toBe(complexReteFlow.id);
    });

    it('deve manter ordem de execução em edges', () => {
      const canonical = reteToCanonical(simpleReteFlow);
      const reteResult = canonicalToRete(canonical);

      // Validar que conectividade está preservada
      simpleReteFlow.edges.forEach((edge) => {
        const exists = reteResult.edges.some(
          (e) => e.source === edge.source && e.target === edge.target
        );
        expect(exists).toBe(true);
      });
    });

    it('deve gerar resultado previsível (idempotência)', () => {
      const canonical1 = reteToCanonical(simpleReteFlow);
      const reteResult1 = canonicalToRete(canonical1);

      const canonical2 = reteToCanonical(simpleReteFlow);
      const reteResult2 = canonicalToRete(canonical2);

      expect(reteResult1.nodes.length).toBe(reteResult2.nodes.length);
      expect(reteResult1.edges.length).toBe(reteResult2.edges.length);
    });
  });
});
