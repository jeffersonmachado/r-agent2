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

  // Segundo passo: mapeamos "next" a partir de todas as conexões de saída
  // Suportamos múltiplas conexões armazenando como array quando há mais de uma
  // Também coletamos as posições dos nós para preservar o layout
  const positions = {};
  
  Object.values(nodesObj).forEach((node) => {
    if (!node || typeof node.id === 'undefined') return;
    const fromId = String(node.id);
    const engineNode = byId.get(fromId);
    if (!engineNode) return;

    // Salva a posição do nó se existir
    if (node.position && Array.isArray(node.position) && node.position.length >= 2) {
      positions[fromId] = [node.position[0], node.position[1]];
      logger.debug('Posição coletada para nó', {
        nodeId: fromId,
        position: positions[fromId]
      });
    } else {
      logger.debug('Nó sem posição válida', {
        nodeId: fromId,
        hasPosition: !!node.position,
        positionType: typeof node.position,
        positionValue: node.position
      });
    }

    if (!node.outputs) return;

    const outputs = node.outputs || {};
    const allConnections = [];
    
    for (const output of Object.values(outputs)) {
      if (!output || !Array.isArray(output.connections)) continue;
      for (const connection of output.connections) {
        if (connection && typeof connection.node !== 'undefined') {
          const targetId = String(connection.node);
          allConnections.push(targetId);
        }
      }
    }
    
    // Se há conexões, armazenamos todas elas
    if (allConnections.length > 0) {
      // Para compatibilidade: se há apenas uma conexão, usamos string
      // Se há múltiplas, usamos array
      engineNode.next = allConnections.length === 1 ? allConnections[0] : allConnections;
      logger.debug('Conexões mapeadas para nó', {
        nodeId: fromId,
        connectionCount: allConnections.length,
        connections: allConnections
      });
    }
  });

  const result = {
    tenantId: (meta && meta.tenantId) || 'demo-tenant',
    id: (meta && meta.id) || 'demo-flow',
    name: (meta && meta.name) || 'Fluxo sem nome',
    version: (meta && typeof meta.version === 'number' ? meta.version : 1),
    nodes: engineNodes,
    metadata: {
      positions: positions,
    },
  };

  logger.debug('Posições coletadas para salvamento', {
    positionsCount: Object.keys(positions).length,
    positions: positions,
    nodeCount: engineNodes.length
  });

  return result;
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

  // Recupera posições salvas do metadata, se existirem
  const savedPositions = (flow.metadata && flow.metadata.positions) || {};
  logger.debug('Posições salvas encontradas no fluxo', {
    hasMetadata: !!flow.metadata,
    hasPositions: !!(flow.metadata && flow.metadata.positions),
    positionsCount: Object.keys(savedPositions).length,
    positions: savedPositions,
    savedPositionKeys: Object.keys(savedPositions),
    engineNodeIds: flow.nodes.map(n => String(n.id))
  });

  // Criamos nós com posições preservadas ou calculadas em grade
  // Primeiro, criamos um mapa do ID original do engine para o ID numérico do Rete
  const engineIdToNumeric = new Map();
  
  flow.nodes.forEach((node, index) => {
    const numericId = Number.isNaN(Number(node.id)) ? index + 1 : Number(node.id);
    
    // Usa posição salva se existir, caso contrário calcula em grade
    let position;
    const nodeId = String(node.id);
    
    // Tenta buscar posição usando o ID do engine primeiro
    // Se não encontrar, tenta com o numericId (ID do Rete)
    // Também tenta todas as variações possíveis de ID
    let savedPosition = savedPositions[nodeId];
    if (!savedPosition) {
      // Tenta com numericId
      savedPosition = savedPositions[String(numericId)];
      if (savedPosition) {
        logger.debug('Posição encontrada usando numericId', { 
          nodeId, 
          numericId, 
          position: savedPosition 
        });
      }
    }
    
    // Se ainda não encontrou, tenta buscar por todas as chaves disponíveis
    // Isso ajuda a lidar com casos onde o ID mudou
    if (!savedPosition && Object.keys(savedPositions).length > 0) {
      // Tenta encontrar por índice (última tentativa)
      const positionKeys = Object.keys(savedPositions);
      if (positionKeys.length > index) {
        // Se houver posições suficientes, usa por ordem
        const keyByIndex = positionKeys[index];
        savedPosition = savedPositions[keyByIndex];
        if (savedPosition) {
          logger.debug('Posição encontrada usando índice', { 
            nodeId, 
            numericId, 
            index,
            keyUsed: keyByIndex,
            position: savedPosition 
          });
        }
      }
    }
    
    if (savedPosition && Array.isArray(savedPosition) && savedPosition.length >= 2) {
      position = [savedPosition[0], savedPosition[1]];
      logger.debug('Usando posição salva para nó', { nodeId, numericId, position });
    } else {
      // Posição padrão em grade se não houver posição salva
      const x = (index % 5) * 250;
      const y = Math.floor(index / 5) * 160;
      position = [x, y];
      logger.debug('Usando posição calculada para nó (posição salva não encontrada)', { 
        nodeId, 
        numericId, 
        position,
        triedKeys: [nodeId, String(numericId)],
        availableKeys: Object.keys(savedPositions)
      });
    }

    // Mapeia o ID original do engine para o ID numérico do Rete
    engineIdToNumeric.set(nodeId, numericId);

    // Cria estrutura do nó baseada no tipo
    const nodeData = {
      id: numericId,
      data: {
        type: node.type,
        config: node.config || {},
      },
      position: position,
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
  // Suportamos tanto string (conexão única) quanto array (múltiplas conexões)
  flow.nodes.forEach((node) => {
    if (!node.next) return;
    
    const fromNumeric = engineIdToNumeric.get(String(node.id));
    if (!fromNumeric) {
      logger.warn('Não foi possível mapear nó de origem', {
        fromId: node.id,
        availableIds: Array.from(engineIdToNumeric.keys())
      });
      return;
    }

    const fromNode = nodes[fromNumeric];
    if (!fromNode || !fromNode.outputs || !fromNode.outputs.out || !Array.isArray(fromNode.outputs.out.connections)) {
      logger.warn('Nó de origem não tem output válido', {
        fromId: node.id,
        fromNumeric,
        hasOutputs: !!(fromNode && fromNode.outputs),
        hasOutOutput: !!(fromNode && fromNode.outputs && fromNode.outputs.out),
        nodeType: fromNode?.data?.type
      });
      return;
    }

    // Suporta tanto string (conexão única) quanto array (múltiplas conexões)
    const nextConnections = Array.isArray(node.next) ? node.next : [node.next];
    
    for (const nextId of nextConnections) {
      const toNumeric = engineIdToNumeric.get(String(nextId));
      
      if (!toNumeric) {
        logger.warn('Não foi possível mapear nó de destino', {
          fromId: node.id,
          toId: nextId,
          fromNumeric,
          availableIds: Array.from(engineIdToNumeric.keys())
        });
        continue;
      }

      fromNode.outputs.out.connections.push({
        node: toNumeric,
        input: 'in',
      });
      logger.debug('Conexão adicionada ao JSON', {
        fromId: node.id,
        toId: nextId,
        fromNumeric,
        toNumeric
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


