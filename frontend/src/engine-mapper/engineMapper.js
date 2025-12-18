/**
 * Mapper entre o grafo do editor (Rete JSON) e o FlowDefinition da engine.
 *
 * IMPORTANTE:
 * - Nenhuma regra de negócio aqui.
 * - Nada de validação de TYPE_COMPATIBILITY, loops, etc.
 * - Apenas serialização / transformação de formatos.
 */

import logger from '../utils/logger';

/**
 * Converte o JSON do editor (Rete) em um FlowDefinition da engine.
 *
 * Assumimos o formato padrão do Rete:
 * {
 *   id: string,
 *   nodes: {
 *     [id: string]: {
 *       id: number,
 *       data: { type?: string, config?: any },
 *       outputs: {
 *         [key: string]: {
 *           connections: Array<{ node: number, input: string }>
 *         }
 *       }
 *     }
 *   }
 * }
 *
 * @param {any} reteJson
 * @param {{ tenantId?: string, id?: string, name?: string, version?: number }} [meta]
 * @returns {import('../api/types').EngineFlowDefinition}
 */
export function reteJsonToEngineFlow(reteJson, meta) {
  const nodesObj = (reteJson && reteJson.nodes) || {};
  const engineNodes = [];

  /** @type {Map<string, string>} */
  const idMap = new Map();

  // Primeiro passamos para criar nós sem "next"
  Object.values(nodesObj).forEach((node, index) => {
    if (!node || typeof node.id === 'undefined') return;
    const engineId = String(node.id);
    idMap.set(String(node.id), engineId);

    engineNodes.push({
      id: engineId,
      type: (node.data && node.data.type) || 'unknown',
      config: (node.data && node.data.config) || {},
      next: null,
    });
  });

  const byId = new Map(engineNodes.map((n) => [n.id, n]));

  // Segundo passo: mapeamos "next" a partir da primeira conexão de saída
  Object.values(nodesObj).forEach((node) => {
    if (!node || typeof node.id === 'undefined') return;
    const fromId = String(node.id);
    const engineNode = byId.get(fromId);
    if (!engineNode || !node.outputs) return;

    const outputs = node.outputs || {};
    for (const output of Object.values(outputs)) {
      if (!output || !Array.isArray(output.connections)) continue;
      const first = output.connections[0];
      if (first && typeof first.node !== 'undefined') {
        const targetId = String(first.node);
        engineNode.next = targetId;
        break;
      }
    }
  });

  return {
    tenantId: (meta && meta.tenantId) || 'demo-tenant',
    id: (meta && meta.id) || 'demo-flow',
    name: (meta && meta.name) || 'Fluxo sem nome',
    version: (meta && typeof meta.version === 'number' ? meta.version : 1),
    nodes: engineNodes,
    metadata: {},
  };
}

/**
 * Converte um FlowDefinition da engine para um JSON mínimo aceito pelo Rete.
 *
 * @param {import('../api/types').EngineFlowDefinition} flow
 * @returns {any}
 */
export function engineFlowToReteJson(flow) {
  logger.debug('engineFlowToReteJson - Input', {
    hasFlow: !!flow,
    hasNodes: !!flow?.nodes,
    nodesIsArray: Array.isArray(flow?.nodes),
    nodesLength: flow?.nodes?.length,
    flowId: flow?.id,
    flowName: flow?.name,
  });

  if (!flow) {
    logger.warn('engineFlowToReteJson - Fluxo é null/undefined');
    return {
      id: 'chatbot-flow@0.1.0',
      nodes: {},
    };
  }
  
  if (!Array.isArray(flow.nodes) || flow.nodes.length === 0) {
    logger.warn('engineFlowToReteJson - Fluxo sem nós válidos', {
      hasNodes: !!flow.nodes,
      nodesIsArray: Array.isArray(flow.nodes),
      nodesLength: flow.nodes?.length,
      flowId: flow.id,
    });
    return {
      id: 'chatbot-flow@0.1.0',
      nodes: {},
    };
  }

  /** @type {Record<string, any>} */
  const nodes = {};

  // Criamos nós com posições básicas em grade
  // Primeiro, criamos um mapa do ID original do engine para o ID numérico do Rete
  const engineIdToNumeric = new Map();
  
  flow.nodes.forEach((node, index) => {
    const numericId = Number.isNaN(Number(node.id)) ? index + 1 : Number(node.id);
    const x = (index % 5) * 250;
    const y = Math.floor(index / 5) * 160;

    // Mapeia o ID original do engine para o ID numérico do Rete
    engineIdToNumeric.set(String(node.id), numericId);

    // Cria estrutura do nó baseada no tipo
    const nodeData = {
      id: numericId,
      data: {
        type: node.type,
        config: node.config || {},
      },
      position: [x, y],
      name: 'FlowNode',
    };
    
    // Nó start não tem input
    if (node.type !== 'start') {
      nodeData.inputs = {
        in: {
          connections: [],
        },
      };
    }
    
    // Nó end não tem output
    if (node.type !== 'end') {
      nodeData.outputs = {
        out: {
          connections: [],
        },
      };
    }
    
    nodes[numericId] = nodeData;
  });

  // Preenchemos conexões de saída a partir do campo "next"
  flow.nodes.forEach((node) => {
    if (!node.next) return;
    
    const fromNumeric = engineIdToNumeric.get(String(node.id));
    const toNumeric = engineIdToNumeric.get(String(node.next));
    
    if (!fromNumeric || !toNumeric) {
      logger.warn('Não foi possível mapear conexão', {
        fromId: node.id,
        toId: node.next,
        fromNumeric,
        toNumeric,
        availableIds: Array.from(engineIdToNumeric.keys())
      });
      return;
    }

    const fromNode = nodes[fromNumeric];
    if (
      fromNode &&
      fromNode.outputs &&
      fromNode.outputs.out &&
      Array.isArray(fromNode.outputs.out.connections)
    ) {
      fromNode.outputs.out.connections.push({
        node: toNumeric,
        input: 'in',
      });
      logger.debug('Conexão adicionada ao JSON', {
        fromId: node.id,
        toId: node.next,
        fromNumeric,
        toNumeric
      });
    } else {
      logger.warn('Nó de origem não tem output válido', {
        fromId: node.id,
        fromNumeric,
        hasOutputs: !!(fromNode && fromNode.outputs),
        hasOutOutput: !!(fromNode && fromNode.outputs && fromNode.outputs.out),
        nodeType: fromNode?.data?.type
      });
    }
  });

  const result = {
    id: 'chatbot-flow@0.1.0',
    nodes,
  };

  const nodeCount = Object.keys(nodes).length;
  
  // Log detalhado de cada nó criado
  logger.debug('engineFlowToReteJson - Nós criados', {
    nodeCount,
    nodeIds: Object.keys(nodes),
    nodesDetail: Object.entries(nodes).map(([id, node]) => ({
      id,
      type: node.data?.type,
      hasInputs: !!node.inputs,
      hasOutputs: !!node.outputs,
      connectionsCount: node.outputs?.out?.connections?.length || 0
    }))
  });
  
  logger.debug('engineFlowToReteJson - Output', {
    nodeCount,
    nodeIds: Object.keys(nodes),
    inputNodesCount: flow.nodes.length,
  });

  if (nodeCount === 0 && flow.nodes.length > 0) {
    logger.error('engineFlowToReteJson - Nenhum nó convertido apesar de ter nós no input', {
      inputNodes: flow.nodes,
      flowId: flow.id,
    });
  }

  return result;
}

/**
 * Mapeia erros de validação vindos do backend para uma estrutura
 * simples de UI.
 *
 * @param {Array<{ code: string, message: string, nodeIds?: string[], details?: any }>} errors
 * @returns {import('../api/types').ValidationErrorUi[]}
 */
export function mapValidationErrorsToUi(errors) {
  if (!Array.isArray(errors)) return [];

  return errors.map((err) => {
    /** @type {'info'|'warning'|'error'} */
    let severity = 'error';

    if (err.code === 'NODE_DISCONNECTED') {
      severity = 'warning';
    }

    return {
      code: err.code,
      message: err.message,
      severity,
      nodeIds: err.nodeIds || [],
      details: err.details || {},
    };
  });
}


