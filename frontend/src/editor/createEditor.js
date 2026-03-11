import { NodeEditor, ClassicPreset } from 'rete';
import { AreaPlugin, AreaExtensions } from 'rete-area-plugin';
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';
import { AutoArrangePlugin, Presets as ArrangePresets } from 'rete-auto-arrange-plugin';
import { createRoot } from 'react-dom/client';

import ReactRenderPlugin from '../ReteReactPluginShim';
import { runFlowValidation } from './validation/runFlowValidation';
import { canCreateNode, canCreateConnection } from './validation/preventiveValidation';
import { createNode } from './nodeFactory';
import { DEFAULT_SOCKET_NAME, getNodeInputs, getNodeOutputs } from './nodeSchemas';
import { getNodeBpmnMapping, requiresExtension } from '../bpmn/bpmnNodeMapping';
import logger from '../utils/logger';

/**
 * Cria e configura o editor Rete.js seguindo o padrão do reference.
 * 
 * @param {HTMLElement} container - Container DOM onde o editor será renderizado
 * @param {Object} options - Opções de configuração
 * @param {Function} options.onFlowChanged - Callback quando o fluxo muda
 * @param {Function} options.onNodeSelected - Callback quando um nó é selecionado
 * @returns {Promise<{ destroy: () => void, editor: NodeEditor, area: AreaPlugin }>}
 */
export async function createEditor(container, options = {}) {
  const { onFlowChanged, onNodeSelected, showToast, bpmnVisualMode = false } = options;

  // ✅ Flag para desabilitar validações preventivas durante carregamento de fluxo
  let isLoadingFromJson = false;
  let isBpmnVisualMode = Boolean(bpmnVisualMode);

  // Verifica se o container tem dimensões
  const containerRect = container.getBoundingClientRect();
  logger.debug('Container do editor', {
    width: containerRect.width,
    height: containerRect.height,
    hasWidth: containerRect.width > 0,
    hasHeight: containerRect.height > 0,
  });

  // Criação do editor
  const editor = new NodeEditor();
  
  // Plugins
  const area = new AreaPlugin(container);
  
  logger.debug('Area criada', {
    hasArea: !!area,
    hasAreaArea: !!area.area,
    hasContent: !!area.area?.content,
  });
  const connection = new ConnectionPlugin();
  const reactPlugin = new ReactRenderPlugin({ createRoot });

  // Configura ConnectionPlugin com preset (seguindo padrão do reference)
  connection.addPreset(ConnectionPresets.classic.setup());

  // Configura ReactPlugin com preset customizado (seguindo padrão do reference)
  const reactPreset = ReactRenderPlugin.createPreset(connection);
  reactPlugin.addPreset(reactPreset);

  logger.debug('ReactPlugin configurado', {
    hasPlugin: !!reactPlugin,
    hasPreset: !!reactPreset,
    presetType: typeof reactPreset,
    presetKeys: reactPreset ? Object.keys(reactPreset) : [],
  });

  // Instala plugins (seguindo o padrão do Rete.js v2)
  editor.use(area);
  area.use(connection);
  area.use(reactPlugin);

  // AutoArrangePlugin para organização automática de nós
  const arrange = new AutoArrangePlugin();
  arrange.addPreset(ArrangePresets.classic.setup());
  area.use(arrange);

  // Adiciona background ao canvas para torná-lo visível
  const background = document.createElement('div');
  background.classList.add('rete-background');
  area.area.content.add(background);

  logger.debug('Plugins instalados no area', {
    hasArea: !!area,
    hasConnection: !!connection,
    hasReactPlugin: !!reactPlugin,
    hasBackground: !!background,
  });

  // =========================
  // EXTENSÕES DO AREA (seguindo padrão do reference)
  // =========================
  
  // Seleção de nós (seguindo padrão do reference)
  AreaExtensions.selectableNodes(area, AreaExtensions.selector(), {
    accumulating: AreaExtensions.accumulateOnCtrl(),
  });

  // Ordenação simples de nós (seguindo padrão do reference)
  AreaExtensions.simpleNodesOrder(area);

  // =========================
  // VISUAL BPMN PROGRESSIVO
  // =========================
  function applyBpmnVisualMetadata(node) {
    if (!node) return;

    const nodeType = node.data?.type;
    const mapping = nodeType ? getNodeBpmnMapping(nodeType) : null;
    const currentUi = node.data?.ui || {};

    if (!isBpmnVisualMode) {
      node.data = {
        ...node.data,
        ui: {
          ...currentUi,
          bpmnVisualMode: false,
          bpmnElement: null,
          bpmnStatus: null,
          bpmnRequiresExtension: false,
        },
      };
      return;
    }

    node.data = {
      ...node.data,
      ui: {
        ...currentUi,
        bpmnVisualMode: true,
        bpmnElement: mapping?.bpmnElement || null,
        bpmnStatus: mapping?.status || 'nao mapeado',
        bpmnRequiresExtension: mapping ? requiresExtension(nodeType) : false,
      },
    };
  }

  function getNodeBpmnVisualCategory(node) {
    const nodeType = node?.data?.type;
    const mapping = nodeType ? getNodeBpmnMapping(nodeType) : null;
    if (!mapping) return 'unmapped';
    if (requiresExtension(nodeType)) return 'extension';
    if (String(mapping.status || '').includes('degradacao')) return 'degraded';
    return 'supported';
  }

  function resolveConnectionBpmnCategory(connection) {
    const sourceNode = editor.getNode(connection?.source);
    const targetNode = editor.getNode(connection?.target);
    const categories = [
      getNodeBpmnVisualCategory(sourceNode),
      getNodeBpmnVisualCategory(targetNode),
    ];

    if (categories.includes('unmapped')) return 'unmapped';
    if (categories.includes('extension')) return 'extension';
    if (categories.includes('degraded')) return 'degraded';
    return 'supported';
  }

  function applyBpmnConnectionMetadata(connection) {
    if (!connection) return;

    if (!isBpmnVisualMode) {
      connection.bpmnVisualMode = false;
      connection.bpmnVisualCategory = null;
      return;
    }

    connection.bpmnVisualMode = true;
    connection.bpmnVisualCategory = resolveConnectionBpmnCategory(connection);
  }

  function applyBpmnVisualModeToAllConnections() {
    const connections = editor.getConnections();
    connections.forEach((connection) => {
      applyBpmnConnectionMetadata(connection);
      if (area && typeof area.update === 'function') {
        try {
          area.update('connection', connection.id);
        } catch (updateErr) {
          logger.debug('Erro ao atualizar conexao apos alternar modo visual BPMN', {
            connectionId: connection.id,
            error: updateErr,
          });
        }
      }
    });
  }

  function applyBpmnVisualModeToAllNodes() {
    const nodes = editor.getNodes();
    nodes.forEach((node) => {
      applyBpmnVisualMetadata(node);
      if (area && typeof area.update === 'function') {
        try {
          area.update('node', node.id);
        } catch (updateErr) {
          logger.debug('Erro ao atualizar no apos alternar modo visual BPMN', {
            nodeId: node.id,
            error: updateErr,
          });
        }
      }
    });

    applyBpmnVisualModeToAllConnections();
  }

  // =========================
  // EXPORTAÇÃO DO EDITOR PARA JSON
  // =========================
  async function toJSON() {
    const nodes = editor.getNodes();
    
    const reteJson = {
      id: 'chatbot-flow@0.1.0',
      nodes: {},
    };

    // ✅ ETAPA 1: Cria mapeamento completo de todos os nós primeiro
    const nodeIdMap = new Map();
    nodes.forEach((node, index) => {
      const jsonId = String(index + 1);
      nodeIdMap.set(node.id, jsonId);
    });

    // ✅ ETAPA 2: Processa cada nó e suas conexões usando o mapeamento completo
    nodes.forEach((node, index) => {
      const jsonId = String(index + 1);
      
      // Obtém posição do nó usando area.nodeViews
      let position = [0, 0];
      try {
        const nodeView = area.nodeViews.get(node.id);
        if (nodeView && nodeView.position) {
          position = [nodeView.position.x || 0, nodeView.position.y || 0];
        }
      } catch (err) {
        logger.debug('toJSON - erro ao obter posição do nó', { nodeId: node.id, error: err });
      }
      
      // Constrói outputs com conexões
      const outputs = {};
      if (node.outputs) {
        // Obtém todas as conexões do editor uma vez
        let connectionsList = [];
        if (typeof editor.getConnections === 'function') {
          connectionsList = editor.getConnections();
          logger.debug('toJSON - conexões obtidas do editor', {
            nodeId: node.id,
            nodeType: node.data?.type,
            totalConnections: connectionsList.length,
            connections: connectionsList.map(c => ({
              source: c.source,
              target: c.target,
              sourceOutput: c.sourceOutput,
              targetInput: c.targetInput,
            })),
          });
        }
        
        Object.entries(node.outputs).forEach(([outKey, output]) => {
          const connections = [];
          
          // Filtra conexões que saem deste nó e deste output
          connectionsList.forEach((conn) => {
            if (conn && conn.source === node.id && conn.sourceOutput === outKey) {
              const targetJsonId = nodeIdMap.get(conn.target);
              if (targetJsonId) {
                connections.push({
                  node: targetJsonId,
                  input: conn.targetInput,
                });
                logger.debug('toJSON - conexão adicionada ao output', {
                  nodeId: node.id,
                  outputKey: outKey,
                  targetJsonId,
                  targetId: conn.target,
                });
              } else {
                // ✅ Log para debug: conexão ignorada porque nó de destino não está no fluxo atual
                logger.warn('toJSON - conexão ignorada: nó de destino não encontrado no mapeamento', {
                  sourceId: node.id,
                  sourceType: node.data?.type,
                  targetId: conn.target,
                  sourceOutput: outKey,
                  targetInput: conn.targetInput,
                  availableNodeIds: Array.from(nodeIdMap.keys()),
                  totalNodesInEditor: nodes.length,
                });
              }
            }
          });
          
          // Só adiciona output se houver conexões
          if (connections.length > 0) {
            outputs[outKey] = {
              connections,
            };
            logger.debug('toJSON - output criado com conexões', {
              nodeId: node.id,
              outputKey: outKey,
              connectionsCount: connections.length,
            });
          }
        });
      } else {
        logger.debug('toJSON - nó sem outputs definidos', {
          nodeId: node.id,
          nodeType: node.data?.type,
        });
      }
      
      logger.debug('toJSON - outputs finais do nó', {
        nodeId: node.id,
        outputsKeys: Object.keys(outputs),
        outputs,
      });
      
      reteJson.nodes[jsonId] = {
        id: parseInt(jsonId, 10),
        data: {
          type: node.data?.type || 'unknown',
          config: node.data?.config || {},
        },
        position,
        ...(Object.keys(outputs).length > 0 && { outputs }),
      };
    });

    return reteJson;
  }

  // =========================
  // =========================
  // FUNÇÃO PARA CALCULAR NÚMEROS SEQUENCIAIS DOS NÓS
  // =========================
  /**
   * Calcula e atribui números sequenciais aos nós baseado na posição no canvas.
   * Ordena os nós por posição Y (de cima para baixo) e depois por X (da esquerda para direita).
   */
  function updateNodeNumbers() {
    try {
      const nodes = editor.getNodes();
      if (nodes.length === 0) return;

      // Obtém posições dos nós e ordena
      const nodesWithPositions = nodes.map(node => {
        const nodeView = area.nodeViews.get(node.id);
        const position = nodeView?.position || { x: 0, y: 0 };
        return { node, position };
      });

      // Ordena por Y (vertical) primeiro, depois por X (horizontal)
      nodesWithPositions.sort((a, b) => {
        const yDiff = a.position.y - b.position.y;
        if (Math.abs(yDiff) > 50) { // Se a diferença Y for significativa (>50px), ordena por Y
          return yDiff;
        }
        // Se estão na mesma "linha" (diferença Y pequena), ordena por X
        return a.position.x - b.position.x;
      });

      // Atribui números sequenciais
      nodesWithPositions.forEach(({ node }, index) => {
        if (!node.data) {
          node.data = {};
        }
        node.data.nodeNumber = index + 1;
      });

      logger.debug('Números sequenciais atualizados', {
        totalNodes: nodes.length,
        nodeNumbers: nodesWithPositions.map(({ node }) => ({
          nodeId: node.id,
          number: node.data?.nodeNumber,
        })),
      });

      // ✅ Força atualização da área para re-renderizar os nós com os novos números
      if (area && typeof area.update === 'function') {
        try {
          area.update('node');
        } catch (updateErr) {
          logger.warn('Erro ao atualizar área após atualizar números sequenciais', {
            error: updateErr,
          });
        }
      }
    } catch (err) {
      logger.warn('Erro ao atualizar números sequenciais dos nós', { error: err });
    }
  }

  // CARREGAMENTO INICIAL A PARTIR DE JSON (fluxo existente)
  // =========================
  async function loadFromJson(reteJson) {
    if (!reteJson || !reteJson.nodes || typeof reteJson.nodes !== 'object') {
      logger.warn('loadFromJson chamado sem nós válidos', { hasJson: !!reteJson });
      return;
    }

    try {
      // ✅ Desabilita validações preventivas durante carregamento
      isLoadingFromJson = true;
      
      // ✅ Limpa completamente o editor antes de carregar novo fluxo
      // Primeiro remove todas as conexões explicitamente
      const existingConnections = editor.getConnections();
      logger.debug('loadFromJson - limpando conexões existentes', {
        existingConnectionCount: existingConnections.length,
      });
      
      for (const conn of existingConnections) {
        try {
          editor.removeConnection(conn.id);
        } catch (removeErr) {
          logger.warn('loadFromJson - erro ao remover conexão existente', {
            connectionId: conn.id,
            error: removeErr,
          });
        }
      }
      
      // Depois remove todos os nós existentes do editor
      const existingNodes = editor.getNodes();
      
      logger.debug('loadFromJson - limpando nós existentes', {
        existingNodeCount: existingNodes.length,
        existingNodeIds: existingNodes.map(n => n.id),
      });
      
      for (const existingNode of existingNodes) {
        try {
          editor.removeNode(existingNode.id);
        } catch (removeErr) {
          logger.warn('loadFromJson - erro ao remover nó existente', {
            nodeId: existingNode.id,
            error: removeErr,
          });
        }
      }
      
      // ✅ Força atualização da área para garantir que tudo foi removido
      if (area && typeof area.update === 'function') {
        try {
          area.update('node');
          area.update('connection');
        } catch (updateErr) {
          logger.warn('loadFromJson - erro ao atualizar área após limpeza', {
            error: updateErr,
          });
        }
      }
      
      // ✅ Limpa o painel direito (deseleciona nó) ao carregar novo fluxo
      if (onNodeSelected) {
        onNodeSelected(null);
        logger.debug('loadFromJson - painel direito limpo (nó deselecionado)');
      }

      /** @type {Record<string, any>} */
      const createdNodesByJsonId = {};

      // 1) Cria todos os nós
      for (const [jsonId, nodeJson] of Object.entries(reteJson.nodes)) {
        const type = nodeJson?.data?.type;
        const config = nodeJson?.data?.config || {};

        if (!type) {
          logger.warn('loadFromJson - nó sem tipo encontrado, ignorando', {
            jsonId,
            nodeJson,
          });
          continue;
        }

        const node = createNode(type, { config });
        
        await editor.addNode(node);
        applyBpmnVisualMetadata(node);

        // Aplica posição se existir
        const position = Array.isArray(nodeJson.position)
          ? nodeJson.position
          : null;
        if (position && position.length >= 2) {
          await area.translate(node.id, { x: position[0], y: position[1] });
        }

        createdNodesByJsonId[String(jsonId)] = node;
      }

      // 2) Cria conexões com base nas saídas
      for (const [jsonId, nodeJson] of Object.entries(reteJson.nodes)) {
        const sourceNode = createdNodesByJsonId[String(jsonId)];
        if (!sourceNode) continue;

        const outputs = nodeJson.outputs || {};
        for (const [outKey, outData] of Object.entries(outputs)) {
          const connections = outData?.connections || [];
          connections.forEach((connJson) => {
            const targetJsonId = String(connJson.node);
            const targetInputKey = connJson.input;
            const targetNode = createdNodesByJsonId[targetJsonId];

            if (!targetNode || !targetInputKey) {
              logger.warn('loadFromJson - conexão inválida ignorada', {
                fromJsonId: jsonId,
                toJsonId: targetJsonId,
                targetInputKey,
              });
              return;
            }

            try {
              const conn = new ClassicPreset.Connection(
                sourceNode,
                outKey,
                targetNode,
                targetInputKey,
              );
              editor.addConnection(conn);
              applyBpmnConnectionMetadata(conn);
            } catch (connErr) {
              logger.warn('loadFromJson - erro ao criar conexão', {
                fromJsonId: jsonId,
                toJsonId: targetJsonId,
                outKey,
                targetInputKey,
                error: connErr,
              });
            }
          });
        }
      }

      // Após carregar, roda validação e notifica mudança de fluxo
      logger.debug('loadFromJson - executando validação após carregar fluxo', {
        totalNodes: editor.getNodes().length,
        existingNodesCount: existingNodes.length,
      });
      
      runFlowValidation(editor, area);
      
      // Verifica se a validação foi aplicada corretamente
      const nodesAfterValidation = editor.getNodes();
      const invalidNodes = nodesAfterValidation.filter(n => n.data?.validation?.status === 'invalid');
      logger.debug('loadFromJson - validação concluída', {
        totalNodes: nodesAfterValidation.length,
        invalidNodesCount: invalidNodes.length,
        invalidNodeIds: invalidNodes.map(n => n.id),
      });

      applyBpmnVisualModeToAllNodes();
      
      // ✅ Atualiza números sequenciais dos nós após carregar
      updateNodeNumbers();
      
      onFlowChanged?.(editor);

      logger.debug('loadFromJson - fluxo carregado no editor', {
        nodeCount: Object.keys(createdNodesByJsonId).length,
      });
      
      // ✅ Reabilita validações preventivas após carregamento
      isLoadingFromJson = false;
    } catch (err) {
      // ✅ Reabilita validações preventivas mesmo em caso de erro
      isLoadingFromJson = false;
      
      logger.error('loadFromJson - erro ao carregar fluxo no editor', { 
        error: err,
        errorMessage: err?.message,
        errorStack: err?.stack,
        errorName: err?.name,
        errorString: String(err),
        errorType: typeof err,
      });
      // Não re-lança o erro para não quebrar o fluxo de carregamento
    }
  }

  // =========================
  // VALIDAÇÃO PREVENTIVA (seguindo documentação oficial do Rete.js)
  // IMPORTANTE: Estes pipes devem vir ANTES dos pipes de validação pós-ação
  // para bloquear ações inválidas antes de acontecerem
  // Referência: https://retejs.org/docs/guides/validation/
  // =========================

  // Previne criação de nós inválidos
  editor.addPipe(context => {
    if (context.type === 'nodecreate') {
      // ✅ Pula validação durante carregamento de fluxo
      if (isLoadingFromJson) {
        return context;
      }
      
      const nodeData = context.data;
      // O nodeData pode ser um nó já instanciado (ClassicPreset.Node) ou dados brutos
      // Se for uma instância de Node, o tipo está em nodeData.data.type
      // Se for dados brutos, pode estar em nodeData.type
      let nodeType = null;
      
      if (nodeData) {
        // Verifica se é uma instância de Node (tem propriedade data)
        if (nodeData.data && typeof nodeData.data === 'object') {
          nodeType = nodeData.data.type;
        } else if (nodeData.type) {
          // Dados brutos com tipo
          nodeType = nodeData.type;
        } else if (nodeData.label) {
          // Pode ser um label que precisa ser mapeado (não ideal, mas fallback)
          // Não usamos label como tipo, apenas logamos para debug
          logger.debug('nodecreate com label mas sem type', { label: nodeData.label });
        }
      }

      if (nodeType) {
        const validation = canCreateNode(editor, nodeType);
        
        if (!validation.allowed) {
          // Mostra mensagem de erro
          if (showToast) {
            showToast(validation.message || 'Ação não permitida', 'error', 3000);
          } else if (typeof window !== 'undefined') {
            alert(validation.message || 'Ação não permitida');
          }
          
          // Bloqueia a criação retornando sem valor (padrão da documentação)
          return;
        }
      }
    }
    return context;
  });

  // Previne criação de conexões inválidas
  editor.addPipe(context => {
    if (context.type === 'connectioncreate') {
      // ✅ Pula validação durante carregamento de fluxo
      if (isLoadingFromJson) {
        return context;
      }
      
      const connection = context.data;
      
      if (connection) {
        const validation = canCreateConnection(editor, connection);
        
        if (!validation.allowed) {
          // Mostra mensagem de erro
          if (showToast) {
            showToast(validation.message || 'Conexão não permitida', 'error', 3000);
          } else if (typeof window !== 'undefined') {
            alert(validation.message || 'Conexão não permitida');
          }
          
          // Bloqueia a conexão retornando sem valor (padrão da documentação)
          return;
        }
      }
    }
    return context;
  });

  // Garante metadados visuais BPMN em qualquer caminho de criação de nó.
  editor.addPipe((context) => {
    if (context.type === 'nodecreated' && context.data) {
      applyBpmnVisualMetadata(context.data);
      if (area && typeof area.update === 'function') {
        try {
          area.update('node', context.data.id);
        } catch (updateErr) {
          logger.debug('Erro ao aplicar metadados BPMN em nodecreated', {
            nodeId: context.data.id,
            error: updateErr,
          });
        }
      }
    }
    return context;
  });

  editor.addPipe((context) => {
    if (context.type === 'connectioncreated' && context.data) {
      applyBpmnConnectionMetadata(context.data);
      if (area && typeof area.update === 'function') {
        try {
          area.update('connection', context.data.id);
        } catch (updateErr) {
          logger.debug('Erro ao aplicar metadados BPMN em connectioncreated', {
            connectionId: context.data.id,
            error: updateErr,
          });
        }
      }
    }
    return context;
  });

  // =========================
  // PIPE CANÔNICO DE VALIDAÇÃO (🔥 PRINCIPAL)
  // Validação PÓS-AÇÃO para feedback visual
  // =========================
  editor.addPipe(ctx => {
    if (
      ctx.type === 'nodecreated' ||
      ctx.type === 'noderemoved' ||
      ctx.type === 'connectioncreated' ||
      ctx.type === 'connectionremoved' ||
      ctx.type === 'imported'
    ) {
      runFlowValidation(editor, area);
    }
    return ctx;
  });

  // =========================
  // PIPE DE EDIÇÃO DE DADOS
  // =========================
  editor.addPipe(ctx => {
    if (ctx.type === 'nodechanged') {
      runFlowValidation(editor, area);
    }
    return ctx;
  });

  // =========================
  // PIPE DE MOVIMENTO / SELEÇÃO
  // =========================
  editor.addPipe(ctx => {
    if (ctx.type === 'nodetranslated') {
      onFlowChanged?.(editor);
    }
    return ctx;
  });

  // =========================
  // PIPE DE SELEÇÃO DE NÓS (seguindo padrão do reference)
  // =========================
  area.addPipe(ctx => {
    logger.debug('area.addPipe - evento recebido', {
      type: ctx.type,
      hasData: !!ctx.data,
      dataKeys: ctx.data ? Object.keys(ctx.data) : [],
      payload: ctx.data?.payload,
      node: ctx.data?.node,
    });
    
    if (ctx.type === 'nodepicked' || ctx.type === 'nodeselected') {
      // Em alguns eventos (ex.: nodepicked) o Rete envia apenas o id do nó em ctx.data.id
      const rawNode = ctx.data?.payload || ctx.data?.node;
      const nodeIdFromEvent = ctx.data?.id;
      const node = rawNode || (nodeIdFromEvent != null ? editor.getNode(String(nodeIdFromEvent)) : null);

      logger.debug('area.addPipe - nodepicked/nodeselected detectado', {
        type: ctx.type,
        hasRawNode: !!rawNode,
        nodeIdFromEvent,
        resolvedNodeId: node?.id,
      });
      
      if (node && onNodeSelected) {
        // Converte o nó do Rete para formato esperado pelo componente
        const nodeData = {
          id: node.id,
          type: node.data?.type,
          config: node.data?.config || {},
          validationErrors: node.data?.validation?.errors || [],
        };
        logger.debug('area.addPipe - chamando onNodeSelected', { nodeData });
        onNodeSelected(nodeData);
      }
    }
    if (ctx.type === 'nodeselected' && ctx.data?.payload === null) {
      logger.debug('area.addPipe - deseleção de nó detectada');
      // Deseleção de nó
      onNodeSelected?.(null);
    }
    return ctx;
  });

  // =========================
  // HANDLER DE DRAG AND DROP (criação de nós)
  // =========================
  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    
    // Obtém o tipo do nó do dataTransfer
    const nodeType = e.dataTransfer.getData('application/node-type') || 
                     e.dataTransfer.getData('text/plain');
    
    if (!nodeType) {
      logger.warn('Drop sem tipo de nó', { 
        dataTransferTypes: e.dataTransfer.types 
      });
      return;
    }

    // Calcula a posição do mouse relativa ao container
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Obtém a transformação do canvas (zoom e pan)
    const transform = area.area.transform;
    const k = transform?.k || 1; // zoom
    const tx = transform?.x || 0; // pan x
    const ty = transform?.y || 0; // pan y

    // Converte coordenadas do viewport para coordenadas do canvas
    const canvasX = (x - tx) / k;
    const canvasY = (y - ty) / k;

    // Cria o nó usando a factory
    try {
      const node = createNode(nodeType);
      
      // Adiciona o nó ao editor
      await editor.addNode(node);
      applyBpmnVisualMetadata(node);
      
      // Posiciona o nó na posição do drop
      await area.translate(node.id, { x: canvasX, y: canvasY });
      
      logger.debug('Nó criado via drag and drop', {
        nodeType,
        nodeId: node.id,
        position: { x: canvasX, y: canvasY },
        viewportPosition: { x, y },
        transform: { k, tx, ty },
      });

      // Atualiza painel de propriedades imediatamente com o novo nó
      if (onNodeSelected) {
        const nodeData = {
          id: node.id,
          type: node.data?.type,
          config: node.data?.config || {},
          validationErrors: node.data?.validation?.errors || [],
        };
        logger.debug('handleDrop - chamando onNodeSelected para nó recém-criado', {
          nodeData,
        });
        onNodeSelected(nodeData);
      }

      // ✅ Atualiza números sequenciais após criar novo nó
      updateNodeNumbers();

      // Notifica mudança no fluxo
      onFlowChanged?.(editor);
    } catch (err) {
      logger.error('Erro ao criar nó via drag and drop', {
        nodeType,
        error: err,
      });
    }
  };

  // =========================
  // ATALHOS DE TECLADO (remoção de nós / conexões)
  // =========================
  const handleKeyDown = (e) => {
    if (e.repeat) return;
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;

    const target = e.target;
    const tagName = target?.tagName;
    const isInput =
      tagName === 'INPUT' ||
      tagName === 'TEXTAREA' ||
      target?.isContentEditable;

    if (isInput) return;

    e.preventDefault();

    try {
      let removedNodes = 0;
      let removedConnections = 0;

      // Conjunto de IDs de nós que serão removidos
      const removedNodeIds = new Set();

      // Remove nós selecionados (usando flag selected do Rete/AreaExtensions)
      if (typeof editor.getNodes === 'function') {
        const nodes = editor.getNodes();
        nodes.forEach((n) => {
          if (n && n.selected) {
            removedNodeIds.add(String(n.id));
            editor.removeNode(n.id);
            removedNodes += 1;
          }
        });
        // ✅ Atualiza números sequenciais após remover nós
        if (removedNodes > 0) {
          updateNodeNumbers();
        }
      }

      // Remove conexões:
      // - que estão selecionadas
      // - ou que estão ligadas a algum nó removido
      if (typeof editor.getConnections === 'function') {
        const connections = editor.getConnections();
        connections.forEach((conn) => {
          if (!conn) return;

          const sourceId = String(conn.source || '');
          const targetId = String(conn.target || '');
          const isAttachedToRemovedNode =
            removedNodeIds.has(sourceId) || removedNodeIds.has(targetId);

          if (conn.selected || isAttachedToRemovedNode) {
            try {
              editor.removeConnection(conn.id);
              removedConnections += 1;
            } catch (removeErr) {
              logger.warn('Erro ao remover conexão vinculada a nó removido', {
                connectionId: conn.id,
                sourceId,
                targetId,
                error: removeErr,
              });
            }
          }
        });
      }

      if (removedNodes || removedConnections) {
        // Limpa seleção no painel de propriedades
        onNodeSelected?.(null);
        // Notifica alteração no fluxo
        onFlowChanged?.(editor);
        logger.debug('Atalho Delete/Backspace - remoção aplicada', {
          removedNodes,
          removedConnections,
        });
      } else {
        logger.debug('Atalho Delete/Backspace - nenhuma conexão ou nó com selected=true encontrado');
      }
    } catch (err) {
      logger.warn('Erro ao remover nós/conexões via atalho de teclado', {
        error: err,
      });
    }
  };

  // =========================
  // SELEÇÃO DE CONEXÕES (integração com SelectableConnection)
  // =========================
  if (typeof window !== 'undefined') {
    window.__reteConnectionClickHandler = (connectionData) => {
      try {
        if (!connectionData || typeof editor.getConnections !== 'function') {
          return;
        }
        const allConnections = editor.getConnections();
        logger.debug('__reteConnectionClickHandler - estado atual das conexões', {
          clickedId: connectionData.id,
          connectionData,
          allIds: allConnections.map((c) => c && c.id),
        });
        let selectedConnection = null;

        const desiredSelected = !!connectionData.selected;

        allConnections.forEach((conn) => {
          if (!conn) return;
          if (String(conn.id) === String(connectionData.id)) {
            // Não faz toggle aqui, apenas replica o estado vindo do componente React
            conn.selected = desiredSelected;
            if (conn.selected) {
              selectedConnection = conn;
            }
          } else {
            conn.selected = false;
          }
        });

        logger.debug('__reteConnectionClickHandler chamado', {
          clickedId: connectionData.id,
          desiredSelected,
          selectedConnectionId: selectedConnection?.id || null,
        });

        // Dispara evento customizado para que SelectableConnection atualize visualmente
        window.dispatchEvent(
          new CustomEvent('connectionselectionchanged', {
            detail: {
              selectedConnection,
              allConnections,
            },
          }),
        );
      } catch (err) {
        logger.warn('Erro em __reteConnectionClickHandler', { error: err });
      }
    };
  }

  // =========================
  // DEBUG: Monitora mudanças no tamanho do container
  // =========================
  let lastLoggedWidth = 0;
  let lastLoggedHeight = 0;
  let logTimeout = null;
  
  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      
      // Só loga se a mudança for significativa (> 2px) e após debounce
      if (Math.abs(width - lastLoggedWidth) > 2 || Math.abs(height - lastLoggedHeight) > 2) {
        if (logTimeout) {
          clearTimeout(logTimeout);
        }
        
        logTimeout = setTimeout(() => {
          logger.debug('Container resize detectado', {
            width,
            height,
            timestamp: Date.now(),
          });
          lastLoggedWidth = width;
          lastLoggedHeight = height;
        }, 500); // Debounce de 500ms para logs
      }
    }
  });
  
  resizeObserver.observe(container);

  // Adiciona event listeners no container
  container.addEventListener('dragover', handleDragOver);
  container.addEventListener('drop', handleDrop);

  // Atalho global de teclado (Delete / Backspace) para remoção de nós/conexões
  window.addEventListener('keydown', handleKeyDown);

  /**
   * Destaca visualmente o nó ativo e marca nós executados.
   *
   * Importante:
   * - Não acessa o DOM diretamente; apenas atualiza os dados dos nós
   *   e usa area.update para re-renderização (padrão do Rete.js v2).
   * - Somente um nó pode estar ativo por vez.
   * - Se engineNodeId for null/undefined, remove qualquer highlight.
   *
   * @param {string|null|undefined} engineNodeId - ID do nó ativo
   * @param {string[]} executedNodeIds - Array de IDs dos nós já executados
   */
  function setActiveEngineNode(engineNodeId, executedNodeIds = []) {
    try {
      const nodes = editor.getNodes();
      
      // Se ambos são null/vazios, limpa tudo
      if (engineNodeId == null && (!executedNodeIds || executedNodeIds.length === 0)) {
        nodes.forEach((node) => {
          node.data = {
            ...node.data,
            ui: {
              ...(node.data && node.data.ui ? node.data.ui : {}),
              isActive: false,
              isExecuted: false,
            },
          };

          if (area && typeof area.update === 'function') {
            try {
              area.update('node', node.id);
            } catch (err) {
              logger.debug('setActiveEngineNode - erro ao limpar nó', {
                nodeId: node.id,
                error: err,
              });
            }
          }
        });
        return;
      }
      
      // Mapeia o ID do FlowDefinition para o ID real do nó no editor
      // O FlowDefinition usa IDs sequenciais baseados na ordem do toJSON()
      // Precisamos encontrar qual nó corresponde a esse índice
      let targetNodeId = null;
      
      if (engineNodeId != null) {
        // Converte o ID do FlowDefinition para índice (ex: "1" -> 0, "2" -> 1)
        const engineIndex = parseInt(engineNodeId, 10) - 1;
        
        if (!isNaN(engineIndex) && engineIndex >= 0) {
          // O toJSON() itera sobre editor.getNodes() na ordem natural
          // Precisamos usar a mesma ordem aqui
          // Converte para array para garantir ordem consistente
          const nodesArray = Array.from(nodes);
          
          if (engineIndex < nodesArray.length) {
            targetNodeId = nodesArray[engineIndex].id;
            logger.debug('setActiveEngineNode - mapeamento de ID', {
              engineNodeId,
              engineIndex,
              targetNodeId,
              totalNodes: nodesArray.length,
            });
          } else {
            logger.debug('setActiveEngineNode - índice fora do range', {
              engineNodeId,
              engineIndex,
              totalNodes: nodesArray.length,
            });
          }
        } else {
          logger.debug('setActiveEngineNode - ID inválido', { engineNodeId });
        }
      }

      // Mapeia IDs executados para IDs do editor
      const executedEditorNodeIds = new Set();
      if (Array.isArray(executedNodeIds) && executedNodeIds.length > 0) {
        executedNodeIds.forEach((execEngineNodeId) => {
          const engineIndex = parseInt(execEngineNodeId, 10) - 1;
          if (!isNaN(engineIndex) && engineIndex >= 0) {
            const nodesArray = Array.from(nodes);
            if (engineIndex < nodesArray.length) {
              executedEditorNodeIds.add(String(nodesArray[engineIndex].id));
            }
          }
        });
      }

      // Aplica highlight nos nós
      nodes.forEach((node) => {
        const nodeIdStr = String(node.id);
        const isActive = targetNodeId != null && nodeIdStr === String(targetNodeId);
        const isExecuted = executedEditorNodeIds.has(nodeIdStr) && !isActive; // Executado mas não ativo

        // Usa campos ui.isActive e ui.isExecuted
        node.data = {
          ...node.data,
          ui: {
            ...(node.data && node.data.ui ? node.data.ui : {}),
            isActive,
            isExecuted,
          },
        };

        if (area && typeof area.update === 'function') {
          try {
            area.update('node', node.id);
          } catch (err) {
            logger.debug('setActiveEngineNode - erro ao atualizar nó', {
              nodeId: node.id,
              error: err,
            });
          }
        }
      });
    } catch (err) {
      logger.debug('setActiveEngineNode - erro ao processar nós para highlight', {
        engineNodeId,
        error: err,
      });
    }
  }

  /**
   * Listener global para eventos de entrada em nó da engine.
   * Disparado pelo hook useFlowRunner via window.dispatchEvent.
   */
  const handleFlowRunnerNodeEnter = (event) => {
    const detail = (event && event.detail) || {};
    const engineNodeId = detail.nodeId != null ? String(detail.nodeId) : null;
    const executedNodeIds = detail.executedNodeIds || [];
    setActiveEngineNode(engineNodeId, executedNodeIds);
  };

  /**
   * Listener global para limpeza de estados visuais quando o modal de teste fecha.
   */
  const handleFlowRunnerCleanup = (event) => {
    const detail = (event && event.detail) || {};
    if (detail.clearAll) {
      // Limpa todos os estados visuais (ativo e executados)
      setActiveEngineNode(null, []);
    }
  };

  /**
   * Listener para atualização de configuração de nó via edição inline.
   * Força atualização visual da área quando um nó é editado.
   */
  let lastUpdateTime = 0;
  const UPDATE_THROTTLE_MS = 100; // Throttle de 100ms para evitar atualizações excessivas
  
  const handleFlowNodeConfigUpdated = (event) => {
    const now = Date.now();
    // Throttle para evitar atualizações excessivas
    if (now - lastUpdateTime < UPDATE_THROTTLE_MS) {
      return;
    }
    lastUpdateTime = now;
    
    const detail = (event && event.detail) || {};
    const nodeId = detail.nodeId;
    if (nodeId && area && typeof area.update === 'function') {
      try {
        // Verifica se o nó ainda existe antes de atualizar
        const node = editor.getNode(nodeId);
        if (!node) {
          return;
        }
        
        // Força atualização visual do nó
        area.update('node', nodeId);
        // Notifica mudança no fluxo (com debounce implícito via throttle)
        onFlowChanged?.(editor);
      } catch (err) {
        logger.debug('Erro ao atualizar nó após edição inline', { nodeId, error: err });
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('flow-runner-node-enter', handleFlowRunnerNodeEnter);
    window.addEventListener('flow-runner-cleanup', handleFlowRunnerCleanup);
    window.addEventListener('flow-node-config-updated', handleFlowNodeConfigUpdated);
  }

  // Adiciona método toJSON ao editor para compatibilidade
  editor.toJSON = toJSON;

  // Retorna objeto com destroy e referências (seguindo padrão do reference)
  // Referência: https://github.com/retejs/reference/blob/main/src/rete/default.ts#L210
  // O reference apenas chama area.destroy(), que já faz toda a limpeza necessária
  // =========================
  // FUNÇÃO PARA LIMPAR EDITOR COMPLETAMENTE
  // =========================
  async function clearEditor() {
    try {
      logger.debug('clearEditor - iniciando limpeza completa do editor');
      
      // 1. Remove todas as conexões
      const existingConnections = editor.getConnections();
      logger.debug('clearEditor - removendo conexões', {
        connectionCount: existingConnections.length,
      });
      
      for (const conn of existingConnections) {
        try {
          editor.removeConnection(conn.id);
        } catch (removeErr) {
          logger.warn('clearEditor - erro ao remover conexão', {
            connectionId: conn.id,
            error: removeErr,
          });
        }
      }
      
      // 2. Remove todos os nós
      const existingNodes = editor.getNodes();
      logger.debug('clearEditor - removendo nós', {
        nodeCount: existingNodes.length,
      });
      
      for (const node of existingNodes) {
        try {
          editor.removeNode(node.id);
        } catch (removeErr) {
          logger.warn('clearEditor - erro ao remover nó', {
            nodeId: node.id,
            error: removeErr,
          });
        }
      }
      
      // ✅ Atualiza números sequenciais após limpar editor (será vazio, mas garante consistência)
      updateNodeNumbers();
      
      // 3. Limpa o painel direito (deseleciona nó)
      if (onNodeSelected) {
        onNodeSelected(null);
        logger.debug('clearEditor - painel direito limpo');
      }
      
      // 4. Força atualização da área
      if (area && typeof area.update === 'function') {
        try {
          area.update('node');
          area.update('connection');
        } catch (updateErr) {
          logger.warn('clearEditor - erro ao atualizar área', {
            error: updateErr,
          });
        }
      }
      
      // 5. Notifica mudança de fluxo (editor vazio)
      onFlowChanged?.(editor);
      
      logger.debug('clearEditor - limpeza completa concluída');
    } catch (err) {
      logger.error('clearEditor - erro ao limpar editor', {
        error: err,
        errorMessage: err?.message,
      });
    }
  }

  /**
   * Atualiza inputs/outputs de um nó dinamicamente quando o config muda
   * Útil para nós com outputs dinâmicos (router, schedule_router) ou inputs de erro
   * @param {string} nodeId - ID do nó
   */
  function updateNodeIO(nodeId) {
    try {
      const node = editor.getNode(nodeId);
      if (!node) {
        logger.warn('updateNodeIO - nó não encontrado', { nodeId });
        return;
      }

      const nodeType = node.data?.type;
      if (!nodeType) {
        logger.warn('updateNodeIO - tipo de nó não encontrado', { nodeId });
        return;
      }

      // Usa funções importadas
      
      // Obtém inputs/outputs atualizados
      const newInputs = getNodeInputs(nodeType, node);
      const newOutputs = getNodeOutputs(nodeType, node);
      
      // Remove inputs antigos que não estão mais na lista
      const currentInputKeys = Object.keys(node.inputs || {});
      const newInputKeys = newInputs.map(inp => inp.key);
      
      currentInputKeys.forEach(key => {
        if (!newInputKeys.includes(key)) {
          try {
            node.removeInput(key);
          } catch (err) {
            logger.warn('updateNodeIO - erro ao remover input', { nodeId, key, error: err });
          }
        }
      });
      
      // Adiciona/atualiza inputs
      newInputs.forEach(inputDef => {
        if (!node.inputs[inputDef.key]) {
          const inputSocket = new ClassicPreset.Socket(
            inputDef.socketName || DEFAULT_SOCKET_NAME
          );
          node.addInput(
            inputDef.key,
            new ClassicPreset.Input(inputSocket, inputDef.label)
          );
        } else {
          // Atualiza label se mudou
          const existingInput = node.inputs[inputDef.key];
          if (existingInput && existingInput.label !== inputDef.label) {
            existingInput.label = inputDef.label;
          }
        }
      });
      
      // Remove outputs antigos que não estão mais na lista
      const currentOutputKeys = Object.keys(node.outputs || {});
      const newOutputKeys = newOutputs.map(out => out.key);
      
      currentOutputKeys.forEach(key => {
        if (!newOutputKeys.includes(key)) {
          try {
            // Remove conexões primeiro
            const connections = editor.getConnections();
            connections.forEach(conn => {
              if (conn.source === nodeId && conn.sourceOutput === key) {
                try {
                  editor.removeConnection(conn.id);
                } catch (err) {
                  logger.warn('updateNodeIO - erro ao remover conexão', { connectionId: conn.id, error: err });
                }
              }
            });
            node.removeOutput(key);
          } catch (err) {
            logger.warn('updateNodeIO - erro ao remover output', { nodeId, key, error: err });
          }
        }
      });
      
      // Adiciona/atualiza outputs
      newOutputs.forEach(outputDef => {
        if (!node.outputs[outputDef.key]) {
          const outputSocket = new ClassicPreset.Socket(
            outputDef.socketName || DEFAULT_SOCKET_NAME
          );
          node.addOutput(
            outputDef.key,
            new ClassicPreset.Output(outputSocket, outputDef.label)
          );
        } else {
          // Atualiza label se mudou
          const existingOutput = node.outputs[outputDef.key];
          if (existingOutput && existingOutput.label !== outputDef.label) {
            existingOutput.label = outputDef.label;
          }
        }
      });
      
      // Força atualização visual
      if (area && typeof area.update === 'function') {
        area.update('node', nodeId);
      }
      
      logger.debug('updateNodeIO - inputs/outputs atualizados', {
        nodeId,
        nodeType,
        inputsCount: newInputs.length,
        outputsCount: newOutputs.length,
      });
    } catch (err) {
      logger.error('updateNodeIO - erro ao atualizar inputs/outputs', {
        nodeId,
        error: err,
      });
    }
  }

  return {
    destroy: () => {
      resizeObserver.disconnect();
      // Remove event listeners
      container.removeEventListener('dragover', handleDragOver);
      container.removeEventListener('drop', handleDrop);
      window.removeEventListener('keydown', handleKeyDown);
      if (typeof window !== 'undefined') {
        window.removeEventListener('flow-runner-node-enter', handleFlowRunnerNodeEnter);
        window.removeEventListener('flow-runner-cleanup', handleFlowRunnerCleanup);
        window.removeEventListener('flow-node-config-updated', handleFlowNodeConfigUpdated);
      }
      
      // ✅ Seguindo padrão do reference: apenas area.destroy()
      // O area.destroy() já faz toda a limpeza de nós, conexões e plugins
      area.destroy();
    },
    editor,
    area,
    arrange,
    loadFromJson,
    toJSON,
    clearEditor,
    updateNodeIO,
    setBpmnVisualMode: (enabled) => {
      isBpmnVisualMode = Boolean(enabled);
      applyBpmnVisualModeToAllNodes();
    },
  };
}

