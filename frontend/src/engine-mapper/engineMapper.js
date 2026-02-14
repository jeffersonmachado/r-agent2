/**
 * Mapper entre o grafo do editor (Rete JSON) e o FlowDefinition da engine.
 *
 * IMPORTANTE:
 * - Nenhuma regra de negócio aqui.
 * - Nada de validação de TYPE_COMPATIBILITY, loops, etc.
 * - Apenas serialização / transformação de formatos.
 */

import logger from '../utils/logger';
import { getNodeSchema, DEFAULT_SOCKET_NAME, getNodeInputs, getNodeOutputs } from '../editor/nodeSchemas';

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
 * @param {{ tenantId?: string, id?: string, name?: string, version?: number, kind?: string }} [meta]
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
    // ✅ Preserva IDs estáveis do engine quando disponíveis (ex.: fluxos vindos do backend)
    // node.data.__engineId é injetado por engineFlowToReteJson / toJSON().
    const engineId = (node?.data && node.data.__engineId != null)
      ? String(node.data.__engineId)
      : String(node.id);
    // Mapa: ID do Rete JSON (numérico como string) -> ID do engine
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
    const fromReteId = String(node.id);
    const fromId = idMap.get(fromReteId) || fromReteId;
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
    const connectionsByOutput = {};
    const invalidConnections = [];
    
    logger.debug('reteJsonToEngineFlow - processando outputs do nó', {
      nodeId: fromId,
      nodeType: engineNode.type,
      outputsKeys: Object.keys(outputs),
      outputs: outputs,
    });
    
    for (const [outputKey, output] of Object.entries(outputs)) {
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
          const targetReteId = String(connection.node);
          const targetId = idMap.get(targetReteId) || targetReteId;
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
            if (!connectionsByOutput[outputKey]) connectionsByOutput[outputKey] = [];
            connectionsByOutput[outputKey].push(targetId);
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
    
    // Se há conexões, armazenamos:
    // - Compatibilidade: apenas "out" com 1 conexão => string (ou array se múltiplas)
    // - Caso contrário, preserva por outputKey: { out: 'id', error: 'id', ... }
    const keysWithConnections = Object.keys(connectionsByOutput).filter(
      (k) => Array.isArray(connectionsByOutput[k]) && connectionsByOutput[k].length > 0
    );

    if (keysWithConnections.length > 0) {
      const onlyOut = keysWithConnections.length === 1 && keysWithConnections[0] === 'out';
      if (onlyOut) {
        const conns = connectionsByOutput.out || [];
        engineNode.next = conns.length === 1 ? conns[0] : conns;
      } else {
        const nextMap = {};
        for (const key of keysWithConnections) {
          const conns = connectionsByOutput[key];
          nextMap[key] = conns.length === 1 ? conns[0] : conns;
        }
        engineNode.next = nextMap;
      }
      logger.debug('Conexões mapeadas para nó', {
        nodeId: fromId,
        connectionCount: allConnections.length,
        connections: allConnections,
        connectionsByOutput,
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
    kind: (meta && typeof meta.kind === 'string' && meta.kind.trim())
      ? meta.kind.trim()
      : 'chat',
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
  const engineById = new Map();
  
  // Primeira passada: cria todos os mapeamentos de ID
  flow.nodes.forEach((node, index) => {
    const numericId = Number.isNaN(Number(node.id)) ? index + 1 : Number(node.id);
    const nodeId = String(node.id);
    engineIdToNumeric.set(nodeId, numericId);
    engineById.set(nodeId, node);
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
        // ✅ Preserva o ID real do engine para mapear erros do backend no editor
        // (ex.: backend retorna nodeIds como "fallback-1", "msg-inicial", etc.)
        __engineId: String(node.id),
      },
      position: position,
      name: 'FlowNode',
    };
    
    // Adiciona inputs com sockets baseado no schema (inclui inputs dinâmicos)
    const inputDefs = getNodeInputs(node.type, { id: String(numericId), type: node.type, config: nodeConfig });
    if (inputDefs && inputDefs.length > 0) {
      nodeData.inputs = {};
      inputDefs.forEach(inputDef => {
        nodeData.inputs[inputDef.key] = {
          socket: { name: inputDef.socketName || DEFAULT_SOCKET_NAME },
          label: inputDef.label,
          connections: [],
        };
      });
    }
    
    // Adiciona outputs com sockets baseado no schema (inclui outputs dinâmicos e error ports)
    const outputDefs = getNodeOutputs(node.type, { id: String(numericId), type: node.type, config: nodeConfig });
    if (outputDefs && outputDefs.length > 0) {
      nodeData.outputs = {};
      outputDefs.forEach(outputDef => {
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
    if (!fromNode || !fromNode.outputs) {
      // Não gera warning para nós que não devem ter outputs (como "end")
      // Apenas loga em debug para casos inesperados
      if (node.type !== 'end') {
        logger.warn('Nó de origem não tem output válido', {
          fromId: node.id,
          fromNumeric,
          hasOutputs: !!(fromNode && fromNode.outputs),
          outputsKeys: fromNode && fromNode.outputs ? Object.keys(fromNode.outputs) : [],
          nodeType: fromNode?.data?.type
        });
      }
      return;
    }

    /**
     * Resolve qual input do nó destino deve receber a conexão.
     * Preferência: 'in' quando existir; caso contrário, o primeiro input disponível.
     * Retorna null quando o destino não possui inputs (ex.: start).
     */
    const resolveTargetInputKey = (toNumeric) => {
      const targetReteNode = nodes[toNumeric];
      const inputs = targetReteNode?.inputs || null;
      if (!inputs || typeof inputs !== 'object') return null;
      const keys = Object.keys(inputs);
      if (keys.length === 0) return null;
      if (Object.prototype.hasOwnProperty.call(inputs, 'in')) return 'in';
      return keys[0] || null;
    };

    // Função auxiliar para adicionar conexão (por outputKey)
    const addConnection = (outputKey, nextId) => {
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

      const targetEngineNode = engineById.get(String(nextId)) || null;
      if (targetEngineNode?.type === 'start') {
        // Regra normativo: start não pode receber conexões.
        logger.warn('engineFlowToReteJson - ignorando conexão cujo destino é start', {
          fromId: node.id,
          toId: nextId,
          fromNumeric,
          toNumeric,
          outputKey,
        });
        return;
      }

      const targetInputKey = resolveTargetInputKey(toNumeric);
      if (!targetInputKey) {
        logger.warn('engineFlowToReteJson - destino não possui inputs, conexão ignorada', {
          fromId: node.id,
          toId: nextId,
          fromNumeric,
          toNumeric,
          outputKey,
          targetType: targetEngineNode?.type || null,
        });
        return;
      }

      // Garante que o output existe
      if (!fromNode.outputs[outputKey]) {
        const socket = { name: DEFAULT_SOCKET_NAME };
        fromNode.outputs[outputKey] = {
          socket,
          label: outputKey,
          connections: [],
        };
      }

      // Verifica se a conexão já existe para evitar duplicatas
      const existingConnection = fromNode.outputs[outputKey].connections.find(
        conn => conn.node === toNumeric && conn.input === targetInputKey
      );
      
      if (!existingConnection) {
        fromNode.outputs[outputKey].connections.push({
          node: toNumeric,
          input: targetInputKey,
        });
        logger.debug('Conexão adicionada ao JSON', {
          fromId: node.id,
          toId: nextId,
          fromNumeric,
          toNumeric,
          outputKey,
          targetInputKey,
        });
      }
    };

    // Processa conexão padrão via "next"
    // - string/array => conecta em "out"
    // - objeto => conecta por chave (out/error/timeout/etc)
    if (node.next) {
      if (typeof node.next === 'string' || Array.isArray(node.next)) {
        const nextConnections = Array.isArray(node.next) ? node.next : [node.next];
        for (const nextId of nextConnections) {
          // Ajuste de compatibilidade do editor:
          // alguns nós NÃO possuem saída "out" (ex.: router/ai_task usam sockets específicos).
          if (node.type === 'router') {
            addConnection('default', nextId);
          } else if (node.type === 'ai_task') {
            addConnection('fallback', nextId);
          } else if (node.type === 'fallback') {
            // Compatibilidade: fallback não possui saída "out"; conexão simples deve ir para "end"
            addConnection('end', nextId);
          } else if (node.type === 'schedule_router') {
            addConnection('default', nextId);
          } else {
            addConnection('out', nextId);
          }
        }
      } else if (typeof node.next === 'object') {
        for (const [outputKey, rawNext] of Object.entries(node.next)) {
          const nextConnections = Array.isArray(rawNext) ? rawNext : [rawNext];
          for (const nextId of nextConnections) {
            if (typeof nextId === 'string' && nextId.trim()) {
              addConnection(outputKey, nextId);
            }
          }
        }
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

          const targetEngineNode = engineById.get(String(rule.next)) || null;
          if (targetEngineNode?.type === 'start') {
            logger.warn('engineFlowToReteJson - ignorando conexão de regra cujo destino é start', {
              fromId: node.id,
              toId: rule.next,
              ruleIndex: index,
              fromNumeric,
              toNumeric,
            });
            return;
          }

          const targetInputKey = resolveTargetInputKey(toNumeric);
          if (!targetInputKey) {
            logger.warn('engineFlowToReteJson - destino de regra não possui inputs, conexão ignorada', {
              fromId: node.id,
              toId: rule.next,
              ruleIndex: index,
              fromNumeric,
              toNumeric,
              targetType: targetEngineNode?.type || null,
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
            conn => conn.node === toNumeric && conn.input === targetInputKey
          );
          
          if (!existingConnection) {
            fromNode.outputs[ruleOutputKey].connections.push({
              node: toNumeric,
              input: targetInputKey,
            });
            logger.debug('Conexão de regra adicionada ao JSON', {
              fromId: node.id,
              toId: rule.next,
              ruleIndex: index,
              outputKey: ruleOutputKey,
              fromNumeric,
              toNumeric,
              targetInputKey,
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

          const targetEngineNode = engineById.get(String(schedule.next)) || null;
          if (targetEngineNode?.type === 'start') {
            logger.warn('engineFlowToReteJson - ignorando conexão de horário cujo destino é start', {
              fromId: node.id,
              toId: schedule.next,
              scheduleIndex: index,
              fromNumeric,
              toNumeric,
            });
            return;
          }

          const targetInputKey = resolveTargetInputKey(toNumeric);
          if (!targetInputKey) {
            logger.warn('engineFlowToReteJson - destino de horário não possui inputs, conexão ignorada', {
              fromId: node.id,
              toId: schedule.next,
              scheduleIndex: index,
              fromNumeric,
              toNumeric,
              targetType: targetEngineNode?.type || null,
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
            conn => conn.node === toNumeric && conn.input === targetInputKey
          );
          
          if (!existingConnection) {
            fromNode.outputs[scheduleOutputKey].connections.push({
              node: toNumeric,
              input: targetInputKey,
            });
            logger.debug('Conexão de horário adicionada ao JSON', {
              fromId: node.id,
              toId: schedule.next,
              scheduleIndex: index,
              outputKey: scheduleOutputKey,
              fromNumeric,
              toNumeric,
              targetInputKey,
            });
          }
        }
      });
      
      // Processa conexão padrão (defaultNext) para saída "default"
      if (node.config.defaultNext) {
        const toNumeric = engineIdToNumeric.get(String(node.config.defaultNext));
        if (toNumeric) {
          const targetEngineNode = engineById.get(String(node.config.defaultNext)) || null;
          if (targetEngineNode?.type === 'start') {
            logger.warn('engineFlowToReteJson - ignorando conexão defaultNext cujo destino é start', {
              fromId: node.id,
              toId: node.config.defaultNext,
              fromNumeric,
              toNumeric,
            });
            return;
          }

          const targetInputKey = resolveTargetInputKey(toNumeric);
          if (!targetInputKey) {
            logger.warn('engineFlowToReteJson - destino defaultNext não possui inputs, conexão ignorada', {
              fromId: node.id,
              toId: node.config.defaultNext,
              fromNumeric,
              toNumeric,
              targetType: targetEngineNode?.type || null,
            });
            return;
          }

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
            conn => conn.node === toNumeric && conn.input === targetInputKey
          );
          
          if (!existingConnection) {
            fromNode.outputs.default.connections.push({
              node: toNumeric,
              input: targetInputKey,
            });
            logger.debug('Conexão padrão de schedule_router adicionada ao JSON', {
              fromId: node.id,
              toId: node.config.defaultNext,
              fromNumeric,
              toNumeric,
              targetInputKey,
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



