/**
 * Mapper entre o grafo do editor (Rete JSON) e o FlowDefinition da engine.
 *
 * IMPORTANTE:
 * - Nenhuma regra de negócio aqui.
 * - Nada de validação de TYPE_COMPATIBILITY, loops, etc.
 * - Apenas serialização / transformação de formatos.
 */

import logger from '../utils/logger';
import { getNodeSchema, DEFAULT_SOCKET_NAME } from '../editor/nodeSchemas';

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

    if (!node.outputs) {
      logger.debug('reteJsonToEngineFlow - nó sem outputs', {
        nodeId: fromId,
        nodeType: engineNode.type,
        hasOutputs: false,
      });
      return;
    }

    const outputs = node.outputs || {};
    const allConnections = [];
    const invalidConnections = [];
    
    logger.debug('reteJsonToEngineFlow - processando outputs do nó', {
      nodeId: fromId,
      nodeType: engineNode.type,
      outputsKeys: Object.keys(outputs),
      outputs: outputs,
    });
    
    for (const output of Object.values(outputs)) {
      if (!output || !Array.isArray(output.connections)) {
        logger.debug('reteJsonToEngineFlow - output sem connections válidas', {
          nodeId: fromId,
          hasOutput: !!output,
          connectionsIsArray: Array.isArray(output?.connections),
          connections: output?.connections,
        });
        continue;
      }
      logger.debug('reteJsonToEngineFlow - processando connections do output', {
        nodeId: fromId,
        connectionsCount: output.connections.length,
        connections: output.connections,
      });
      for (const connection of output.connections) {
        if (connection && typeof connection.node !== 'undefined') {
          const targetId = String(connection.node);
          logger.debug('reteJsonToEngineFlow - processando connection', {
            nodeId: fromId,
            targetId,
            connection,
            targetExists: byId.has(targetId),
            availableIds: Array.from(byId.keys()),
          });
          // Verifica se o nó de destino existe no mapa
          if (byId.has(targetId)) {
            allConnections.push(targetId);
          } else {
            // ✅ Log para debug: conexão aponta para nó inexistente
            invalidConnections.push({
              targetId,
              input: connection.input,
            });
          }
        }
      }
    }
    
    // Log de conexões inválidas
    if (invalidConnections.length > 0) {
      logger.warn('reteJsonToEngineFlow - conexões apontam para nós inexistentes', {
        nodeId: fromId,
        nodeType: engineNode.type,
        invalidConnections,
        availableNodeIds: Array.from(byId.keys()),
      });
    }
    
    // Se há conexões, armazenamos todas elas
    if (allConnections.length > 0) {
      // Para compatibilidade: se há apenas uma conexão, usamos string
      // Se há múltiplas, usamos array
      engineNode.next = allConnections.length === 1 ? allConnections[0] : allConnections;
      logger.debug('Conexões mapeadas para nó', {
        nodeId: fromId,
        connectionCount: allConnections.length,
        connections: allConnections,
        invalidConnectionsCount: invalidConnections.length,
      });
    } else {
      // Debug: log quando um nó não tem conexões
      logger.debug('Nó sem conexões de saída', {
        nodeId: fromId,
        nodeType: engineNode.type,
        hasOutputs: !!node.outputs,
        outputsKeys: node.outputs ? Object.keys(node.outputs) : [],
      });
    }
  });

  // Debug: log final do fluxo convertido
  logger.debug('reteJsonToEngineFlow - Fluxo convertido', {
    totalNodes: engineNodes.length,
    nodesWithNext: engineNodes.filter(n => n.next).length,
    nodesWithoutNext: engineNodes.filter(n => !n.next).map(n => ({ id: n.id, type: n.type })),
    allNodes: engineNodes.map(n => ({
      id: n.id,
      type: n.type,
      next: n.next,
    })),
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
  
  // Primeira passada: cria todos os mapeamentos de ID
  flow.nodes.forEach((node, index) => {
    const numericId = Number.isNaN(Number(node.id)) ? index + 1 : Number(node.id);
    const nodeId = String(node.id);
    engineIdToNumeric.set(nodeId, numericId);
  });
  
  // Segunda passada: cria os nós com configs atualizados
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

    // Obtém schema do nó para informações de sockets
    const nodeSchema = getNodeSchema(node.type);

    // Prepara o config, atualizando IDs nas regras do router se necessário
    let nodeConfig = node.config || {};
    
    // Se for um router, atualiza os IDs nas regras para usar IDs numéricos do Rete
    if (node.type === 'router' && nodeConfig.rules && Array.isArray(nodeConfig.rules)) {
      nodeConfig = {
        ...nodeConfig,
        rules: nodeConfig.rules.map(rule => {
          if (rule && rule.next) {
            const ruleNextNumeric = engineIdToNumeric.get(String(rule.next));
            if (ruleNextNumeric !== undefined) {
              return {
                ...rule,
                next: String(ruleNextNumeric),
              };
            }
          }
          return rule;
        }),
      };
    }

    // Cria estrutura do nó baseada no tipo
    const nodeData = {
      id: numericId,
      data: {
        type: node.type,
        config: nodeConfig,
      },
      position: position,
      name: 'FlowNode',
    };
    
    // Adiciona inputs com sockets baseado no schema
    if (nodeSchema && nodeSchema.inputs && nodeSchema.inputs.length > 0) {
      nodeData.inputs = {};
      nodeSchema.inputs.forEach(inputDef => {
        nodeData.inputs[inputDef.key] = {
          socket: { name: inputDef.socketName || DEFAULT_SOCKET_NAME },
          label: inputDef.label,
          connections: [],
        };
      });
    }
    
    // Adiciona outputs com sockets baseado no schema
    if (nodeSchema && nodeSchema.outputs && nodeSchema.outputs.length > 0) {
      nodeData.outputs = {};
      nodeSchema.outputs.forEach(outputDef => {
        nodeData.outputs[outputDef.key] = {
          socket: { name: outputDef.socketName || DEFAULT_SOCKET_NAME },
          label: outputDef.label,
          connections: [],
        };
      });
    }
    
    nodes[numericId] = nodeData;
  });

  // Preenchemos conexões de saída a partir do campo "next"
  // Suportamos tanto string (conexão única) quanto array (múltiplas conexões)
  // Para routers, também processamos as regras (config.rules[].next)
  flow.nodes.forEach((node) => {
    // Ignora nós do tipo "end" - eles não devem ter outputs nem conexões de saída
    if (node.type === 'end') {
      return;
    }

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
      // Não gera warning para nós que não devem ter outputs (como "end")
      // Apenas loga em debug para casos inesperados
      if (node.type !== 'end') {
        logger.warn('Nó de origem não tem output válido', {
          fromId: node.id,
          fromNumeric,
          hasOutputs: !!(fromNode && fromNode.outputs),
          hasOutOutput: !!(fromNode && fromNode.outputs && fromNode.outputs.out),
          nodeType: fromNode?.data?.type
        });
      }
      return;
    }

    // Função auxiliar para adicionar conexão
    const addConnection = (nextId) => {
      const toNumeric = engineIdToNumeric.get(String(nextId));
      
      if (!toNumeric) {
        logger.warn('Não foi possível mapear nó de destino', {
          fromId: node.id,
          toId: nextId,
          fromNumeric,
          availableIds: Array.from(engineIdToNumeric.keys())
        });
        return;
      }

      // Verifica se a conexão já existe para evitar duplicatas
      const existingConnection = fromNode.outputs.out.connections.find(
        conn => conn.node === toNumeric && conn.input === 'in'
      );
      
      if (!existingConnection) {
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
    };

    // Processa conexão padrão via "next" (para saída "out" ou "default")
    if (node.next) {
      const nextConnections = Array.isArray(node.next) ? node.next : [node.next];
      for (const nextId of nextConnections) {
        addConnection(nextId);
      }
    }

    // Processa conexões específicas de router (config.rules[].next)
    // Mapeia cada regra para sua saída correspondente (rule_0, rule_1, etc.)
    if (node.type === 'router' && node.config && Array.isArray(node.config.rules)) {
      node.config.rules.forEach((rule, index) => {
        if (rule && rule.next) {
          const toNumeric = engineIdToNumeric.get(String(rule.next));
          
          if (!toNumeric) {
            logger.warn('Não foi possível mapear nó de destino da regra', {
              fromId: node.id,
              toId: rule.next,
              ruleIndex: index,
              availableIds: Array.from(engineIdToNumeric.keys())
            });
            return;
          }

          // Cria ou obtém a saída da regra (rule_0, rule_1, etc.)
          const ruleOutputKey = `rule_${index}`;
          if (!fromNode.outputs[ruleOutputKey]) {
            // Gera label descritivo baseado na condição
            let label = `Regra ${index + 1}`;
            if (rule.condition) {
              if (rule.condition.op === 'always') {
                label = 'Sempre';
              } else if (rule.condition.op === 'equals') {
                label = `Igual a "${rule.condition.value}"`;
              } else if (rule.condition.op === 'contains') {
                label = `Contém "${rule.condition.value}"`;
              } else if (rule.condition.var) {
                label = `${rule.condition.var} ${rule.condition.op}`;
              }
            }
            
            // Cria a saída se não existir
            const socket = { name: DEFAULT_SOCKET_NAME };
            fromNode.outputs[ruleOutputKey] = {
              socket,
              label: label,
              connections: [],
            };
          }

          // Verifica se a conexão já existe
          const existingConnection = fromNode.outputs[ruleOutputKey].connections.find(
            conn => conn.node === toNumeric && conn.input === 'in'
          );
          
          if (!existingConnection) {
            fromNode.outputs[ruleOutputKey].connections.push({
              node: toNumeric,
              input: 'in',
            });
            logger.debug('Conexão de regra adicionada ao JSON', {
              fromId: node.id,
              toId: rule.next,
              ruleIndex: index,
              outputKey: ruleOutputKey,
              fromNumeric,
              toNumeric
            });
          }
        }
      });
    }

    // Processa conexões específicas de schedule_router (config.schedules[].next)
    // Mapeia cada horário para sua saída correspondente (schedule_0, schedule_1, etc.)
    if (node.type === 'schedule_router' && node.config && Array.isArray(node.config.schedules)) {
      node.config.schedules.forEach((schedule, index) => {
        if (schedule && schedule.next) {
          const toNumeric = engineIdToNumeric.get(String(schedule.next));
          
          if (!toNumeric) {
            logger.warn('Não foi possível mapear nó de destino do horário', {
              fromId: node.id,
              toId: schedule.next,
              scheduleIndex: index,
              availableIds: Array.from(engineIdToNumeric.keys())
            });
            return;
          }

          // Cria ou obtém a saída do horário (schedule_0, schedule_1, etc.)
          const scheduleOutputKey = `schedule_${index}`;
          if (!fromNode.outputs[scheduleOutputKey]) {
            // Gera label descritivo baseado no horário
            let label = `Horário ${index + 1}`;
            if (schedule.days && schedule.startTime && schedule.endTime) {
              const daysStr = Array.isArray(schedule.days) 
                ? schedule.days.join(', ') 
                : schedule.days;
              label = `${daysStr} ${schedule.startTime}-${schedule.endTime}`;
            } else if (schedule.label) {
              label = schedule.label;
            }
            
            // Cria a saída se não existir
            const socket = { name: DEFAULT_SOCKET_NAME };
            fromNode.outputs[scheduleOutputKey] = {
              socket,
              label: label,
              connections: [],
            };
          }

          // Verifica se a conexão já existe
          const existingConnection = fromNode.outputs[scheduleOutputKey].connections.find(
            conn => conn.node === toNumeric && conn.input === 'in'
          );
          
          if (!existingConnection) {
            fromNode.outputs[scheduleOutputKey].connections.push({
              node: toNumeric,
              input: 'in',
            });
            logger.debug('Conexão de horário adicionada ao JSON', {
              fromId: node.id,
              toId: schedule.next,
              scheduleIndex: index,
              outputKey: scheduleOutputKey,
              fromNumeric,
              toNumeric
            });
          }
        }
      });
      
      // Processa conexão padrão (defaultNext) para saída "default"
      if (node.config.defaultNext) {
        const toNumeric = engineIdToNumeric.get(String(node.config.defaultNext));
        if (toNumeric) {
          // Garante que a saída "default" existe
          if (!fromNode.outputs.default) {
            const socket = { name: DEFAULT_SOCKET_NAME };
            fromNode.outputs.default = {
              socket,
              label: 'Padrão',
              connections: [],
            };
          }
          
          // Verifica se a conexão já existe
          const existingConnection = fromNode.outputs.default.connections.find(
            conn => conn.node === toNumeric && conn.input === 'in'
          );
          
          if (!existingConnection) {
            fromNode.outputs.default.connections.push({
              node: toNumeric,
              input: 'in',
            });
            logger.debug('Conexão padrão de schedule_router adicionada ao JSON', {
              fromId: node.id,
              toId: node.config.defaultNext,
              fromNumeric,
              toNumeric
            });
          }
        }
      }
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



