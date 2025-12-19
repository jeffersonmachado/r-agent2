import React, { useEffect, useRef, useState, createContext, useContext } from 'react';
import { NodeEditor } from 'rete';
import { ClassicPreset } from 'rete';
import { AreaExtensions, AreaPlugin } from 'rete-area-plugin';
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';
import { ReactPlugin, Presets as ReactPresets } from 'rete-react-plugin';
import { createRoot } from 'react-dom/client';
import { useTheme, ThemeProvider } from './styles/themeContext';
import logger from './utils/logger';

// Contexto para passar selectedNodeId para os componentes de nó
const NodeSelectionContext = createContext(null);

// Refs globais para acessar tema e selectedNodeId do componente renderizado pelo ReactPlugin
// Isso é necessário porque o ReactPlugin cria seu próprio root React
const globalThemeRef = { current: null };
const globalSelectedNodeIdRef = { current: null };
const globalEditorRef = { current: null };
const globalAreaRef = { current: null };
const globalConnectionRef = { current: null };
const globalConnectionBindSocketRef = { current: null }; // Armazena o bindSocket do preset classic
const globalContainerRef = { current: null }; // Armazena referência ao container do editor

/**
 * Sockets genéricos.
 * Para um MVP, usamos apenas um tipo de socket, mas ainda
 * validamos conexões com base no tipo lógico do nó.
 */
const flowSocket = new ClassicPreset.Socket('flow');

/**
 * Renderiza conexões manualmente no SVG usando os sockets do cache
 * @param {NodeEditor} editor - Editor Rete
 * @param {ConnectionPlugin} connection - Plugin de conexão
 * @param {SVGElement} svgElement - Elemento SVG onde renderizar
 */
function renderConnectionsManually(editor, connection, svgElement) {
  if (!editor || !connection || !svgElement) {
    logger.warn('⚠️ Parâmetros inválidos para renderConnectionsManually', {
      hasEditor: !!editor,
      hasConnection: !!connection,
      hasSvgElement: !!svgElement
    });
    return;
  }

  try {
    const allConnections = editor.getConnections();
    const socketsCache = connection.socketsCache;
    
    if (!socketsCache || socketsCache.size === 0) {
      logger.warn('⚠️ socketsCache vazio, não é possível renderizar conexões manualmente');
      return;
    }

    logger.info('🎨 Renderizando conexões manualmente', {
      connectionsCount: allConnections.length,
      socketsCacheSize: socketsCache.size
    });

    // Remove paths existentes para evitar duplicatas
    const existingPaths = svgElement.querySelectorAll('path[data-connection-id]');
    existingPaths.forEach(path => path.remove());

    let renderedCount = 0;
    
    for (const conn of allConnections) {
      try {
        // Encontra os sockets no cache
        const sourceCacheKey = `${conn.source}-${conn.sourceOutput}-output`;
        const targetCacheKey = `${conn.target}-${conn.targetInput}-input`;
        
        const sourceSocketData = socketsCache.get(sourceCacheKey);
        const targetSocketData = socketsCache.get(targetCacheKey);
        
        if (!sourceSocketData || !targetSocketData) {
          logger.debug('Sockets não encontrados no cache para conexão', {
            connectionId: conn.id,
            sourceCacheKey,
            targetCacheKey,
            hasSource: !!sourceSocketData,
            hasTarget: !!targetSocketData
          });
          continue;
        }

        const sourceEl = sourceSocketData.element;
        const targetEl = targetSocketData.element;

        if (!sourceEl || !targetEl) {
          logger.debug('Elementos DOM não encontrados para sockets', {
            connectionId: conn.id,
            hasSourceEl: !!sourceEl,
            hasTargetEl: !!targetEl
          });
          continue;
        }

        // Obtém posições dos elementos
        const sourceRect = sourceEl.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const svgRect = svgElement.getBoundingClientRect();

        // Calcula posições relativas ao container do editor
        // IMPORTANTE: getBoundingClientRect retorna posições absolutas da viewport
        // O SVG está posicionado absolutamente dentro do container, então precisamos
        // calcular relativas ao container, não ao SVG
        const container = svgElement.parentElement;
        const containerRect = container ? container.getBoundingClientRect() : svgRect;
        
        // Calcula posições relativas ao container (onde o SVG está posicionado)
        const x1 = sourceRect.left + sourceRect.width / 2 - containerRect.left;
        const y1 = sourceRect.top + sourceRect.height / 2 - containerRect.top;
        const x2 = targetRect.left + targetRect.width / 2 - containerRect.left;
        const y2 = targetRect.top + targetRect.height / 2 - containerRect.top;
        
        // Verifica se as posições são válidas
        if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) {
          logger.warn('⚠️ Posições inválidas calculadas para conexão', {
            connectionId: conn.id,
            x1, y1, x2, y2,
            sourceRect: { left: sourceRect.left, top: sourceRect.top, width: sourceRect.width, height: sourceRect.height },
            targetRect: { left: targetRect.left, top: targetRect.top, width: targetRect.width, height: targetRect.height },
            containerRect: { left: containerRect.left, top: containerRect.top, width: containerRect.width, height: containerRect.height }
          });
          continue;
        }
        
        logger.debug('Posições calculadas para conexão', {
          connectionId: conn.id,
          sourcePos: { x: x1, y: y1 },
          targetPos: { x: x2, y: y2 }
        });

        // Cria path SVG com curva bezier
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const dx = x2 - x1;
        const dy = y2 - y1;
        const cp1x = x1 + dx * 0.5;
        const cp1y = y1;
        const cp2x = x2 - dx * 0.5;
        const cp2y = y2;
        
        path.setAttribute('d', `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`);
        path.setAttribute('stroke', 'var(--color-accent-primary, #3b82f6)');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('fill', 'none');
        path.setAttribute('data-connection-id', conn.id);
        path.setAttribute('class', 'connection-path');
        path.style.pointerEvents = 'stroke';
        path.style.cursor = 'pointer';

        svgElement.appendChild(path);
        renderedCount++;

        logger.debug('✅ Conexão renderizada manualmente', {
          connectionId: conn.id,
          source: conn.source,
          target: conn.target,
          path: path.getAttribute('d')
        });
      } catch (err) {
        logger.warn('Erro ao renderizar conexão individual', {
          connectionId: conn.id,
          error: err.message
        });
      }
    }

    logger.info('✅ Renderização manual concluída', {
      renderedCount,
      totalConnections: allConnections.length
    });
  } catch (err) {
    logger.error('❌ Erro ao renderizar conexões manualmente', {
      error: err.message,
      stack: err.stack
    });
  }
}

/**
 * Atualiza as posições das conexões quando os nós são movidos
 * @param {NodeEditor} editor - Editor Rete
 * @param {ConnectionPlugin} connection - Plugin de conexão
 * @param {SVGElement} svgElement - Elemento SVG onde as conexões estão renderizadas
 */
function updateConnectionPositions(editor, connection, svgElement) {
  if (!editor || !connection || !svgElement) {
    return;
  }

  try {
    const allConnections = editor.getConnections();
    const socketsCache = connection.socketsCache;
    
    if (!socketsCache || socketsCache.size === 0) {
      return;
    }

    // Atualiza cada conexão
    for (const conn of allConnections) {
      try {
        const path = svgElement.querySelector(`path[data-connection-id="${conn.id}"]`);
        if (!path) {
          // Se o path não existe, tenta criar novamente
          continue;
        }

        // Encontra os sockets no cache
        const sourceCacheKey = `${conn.source}-${conn.sourceOutput}-output`;
        const targetCacheKey = `${conn.target}-${conn.targetInput}-input`;
        
        const sourceSocketData = socketsCache.get(sourceCacheKey);
        const targetSocketData = socketsCache.get(targetCacheKey);
        
        if (!sourceSocketData || !targetSocketData) {
          continue;
        }

        const sourceEl = sourceSocketData.element;
        const targetEl = targetSocketData.element;

        if (!sourceEl || !targetEl) {
          continue;
        }

        // Obtém posições dos elementos
        const sourceRect = sourceEl.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const container = svgElement.parentElement;
        const containerRect = container ? container.getBoundingClientRect() : svgElement.getBoundingClientRect();

        // Calcula posições relativas ao container
        const x1 = sourceRect.left + sourceRect.width / 2 - containerRect.left;
        const y1 = sourceRect.top + sourceRect.height / 2 - containerRect.top;
        const x2 = targetRect.left + targetRect.width / 2 - containerRect.left;
        const y2 = targetRect.top + targetRect.height / 2 - containerRect.top;

        // Verifica se as posições são válidas
        if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) {
          continue;
        }

        // Atualiza o path SVG
        const dx = x2 - x1;
        const dy = y2 - y1;
        const cp1x = x1 + dx * 0.5;
        const cp1y = y1;
        const cp2x = x2 - dx * 0.5;
        const cp2y = y2;
        
        path.setAttribute('d', `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`);
      } catch (err) {
        // Ignora erros individuais e continua com as outras conexões
      }
    }
  } catch (err) {
    logger.warn('Erro ao atualizar posições das conexões', {
      error: err.message
    });
  }
}

/**
 * Mapa simples de regras de conexão por tipo de nó.
 * - Chave: tipo de nó origem
 * - Valor: array de tipos de nó de destino permitidos
 *
 * Decisão importante:
 * - A validação de conexões fica desacoplada da UI de Rete.
 * - Fica fácil evoluir as regras conforme o engine crescer.
 */
const CONNECTION_RULES = {
  start: ['message', 'user_input', 'router', 'set_variable', 'handoff', 'ai', 'end'],
  message: ['user_input', 'router', 'set_variable', 'handoff', 'ai', 'end'],
  user_input: ['router', 'message', 'set_variable', 'handoff', 'ai', 'end'],
  router: ['message', 'user_input', 'set_variable', 'handoff', 'ai', 'end'],
  set_variable: ['message', 'user_input', 'router', 'handoff', 'ai', 'end'],
  ai: ['message', 'user_input', 'router', 'set_variable', 'handoff', 'end'],
  handoff: ['end'],
  end: [],
};

/**
 * Wrapper que fornece os contextos necessários ao componente do nó
 * O ReactPlugin renderiza em um root separado, então precisamos fornecer os contextos
 */
function FlowNodeComponentWrapper(props) {
  // O ReactPlugin renderiza em um root separado, então os contextos não estão disponíveis
  // Usa as refs globais diretamente (são atualizadas pelo FlowEditor)
  
  // No Rete.js v2.0 com rete-react-plugin, as props podem incluir:
  // - data: informações do nó
  // - emit: função para emitir eventos
  // - bindSocket: função para vincular sockets (se o plugin passar)
  // - bindControl: função para vincular controls (se o plugin passar)
  // IMPORTANTE: Tenta obter bindSocket das props primeiro, depois do preset armazenado
  const pluginBindSocketFromProps = props?.bindSocket;
  const pluginBindSocket = pluginBindSocketFromProps || globalConnectionBindSocketRef.current;
  const { data, emit, bindControl: pluginBindControl } = props || {};
  
  // Se não tiver data, retorna null
  if (!data) {
    return null;
  }
  
  // Constrói o objeto node a partir de data
  // O data contém: id, label, inputs, outputs, controls, data (com type e config)
  // IMPORTANTE: inputs e outputs podem ser Maps ou objetos do Rete.js, precisamos converter
  // No Rete.js v2.0, o preset classic pode não passar inputs/outputs diretamente no data
  // Precisamos acessar o nó original do editor se disponível
  const editor = globalEditorRef.current;
  let reteNode = null;
  if (editor && data.id) {
    try {
      reteNode = editor.getNode(String(data.id));
    } catch (err) {
      logger.warn('Erro ao obter nó do editor', { nodeId: data.id, error: err.message });
    }
  }
  
  const convertIO = (io) => {
    if (!io) return {};
    // Se for Map, converte para objeto
    if (io instanceof Map) {
      const result = {};
      for (const [key, value] of io.entries()) {
        result[key] = value;
      }
      return result;
    }
    // Se já for objeto, retorna como está
    if (typeof io === 'object') {
      return io;
    }
    return {};
  };
  
  // Tenta obter inputs/outputs do nó original do editor primeiro
  // Se não estiver disponível, usa os do data
  const inputs = reteNode && reteNode.inputs ? convertIO(reteNode.inputs) : convertIO(data.inputs);
  const outputs = reteNode && reteNode.outputs ? convertIO(reteNode.outputs) : convertIO(data.outputs);
  
  // Debug: log para verificar se inputs/outputs estão sendo encontrados
  if (inputs && Object.keys(inputs).length > 0) {
    logger.debug('Inputs encontrados no wrapper', { 
      nodeId: data.id, 
      inputKeys: Object.keys(inputs),
      hasReteNode: !!reteNode
    });
  }
  if (outputs && Object.keys(outputs).length > 0) {
    logger.debug('Outputs encontrados no wrapper', { 
      nodeId: data.id, 
      outputKeys: Object.keys(outputs),
      hasReteNode: !!reteNode
    });
  }
  
  const node = {
    id: data.id,
    name: data.label || 'FlowNode',
    data: data.data || { type: 'unknown', config: {} },
    inputs: inputs,
    outputs: outputs,
    controls: convertIO(data.controls),
  };
  
  // Usa useState para forçar re-render quando selectedNodeId mudar
  // Como o ReactPlugin renderiza em root separado, precisamos usar um estado local
  // que é atualizado via polling ou evento customizado
  const [selectedNodeId, setSelectedNodeId] = React.useState(() => globalSelectedNodeIdRef.current);
  
  // Atualiza o estado quando a ref global mudar (polling a cada render)
  React.useEffect(() => {
    const checkSelected = () => {
      const currentSelected = globalSelectedNodeIdRef.current;
      if (currentSelected !== selectedNodeId) {
        setSelectedNodeId(currentSelected);
      }
    };
    
    // Verifica imediatamente
    checkSelected();
    
    // Configura polling para verificar mudanças (não ideal, mas necessário)
    const interval = setInterval(checkSelected, 100);
    
    return () => clearInterval(interval);
  }, [selectedNodeId]);
  
  try {
    const theme = globalThemeRef.current || {
      colors: {
        bg: { elevated: '#1a1a1a', secondary: '#2a2a2a', tertiary: '#3a3a3a', primary: '#0a0a0a' },
        text: { primary: '#ffffff', secondary: '#cccccc', tertiary: '#999999' },
        border: { default: '#444444' },
        accent: { primary: '#3b82f6', hover: '#2563eb' },
        status: { success: '#10b981' },
      },
    };
    
    // Garante que node.data existe
    if (!node.data) {
      node.data = { type: 'unknown', config: {} };
    }
    
    // Garante que node.id existe e converte para string para comparação
    const nodeId = node.id !== undefined ? String(node.id) : null;
    if (nodeId === null) {
      return <div style={{ padding: '10px', background: '#ff0000', color: '#fff' }}>Erro: ID do nó não existe</div>;
    }
    
    // Converte selectedNodeId para string para comparação consistente
    const selectedNodeIdStr = selectedNodeId !== null && selectedNodeId !== undefined ? String(selectedNodeId) : null;
    const isSelected = selectedNodeIdStr === nodeId;
    
    // Debug: log para verificar seleção (apenas quando selecionado ou quando há selectedNodeId)
    if (isSelected) {
      logger.debug('FlowNodeComponentWrapper - Nó SELECIONADO', {
        nodeId,
        selectedNodeIdStr,
        isSelected,
        nodeIdType: typeof nodeId,
        selectedNodeIdType: typeof selectedNodeId,
      });
    }
    
    // No Rete.js v2.0, o preset classic do ReactPlugin passa bindSocket através das props
    // Se não vier, criamos um fallback que usa o ConnectionPlugin diretamente
    // IMPORTANTE: Tenta usar o bindSocket armazenado do preset primeiro
    const bindSocket = pluginBindSocket || globalConnectionBindSocketRef.current || ((el, type, io) => {
      if (!el || !io) {
        logger.warn('bindSocket chamado sem elemento ou io', { hasEl: !!el, hasIo: !!io });
        return;
      }
      
      const editor = globalEditorRef.current;
      const area = globalAreaRef.current;
      const connection = globalConnectionRef.current;
      
      if (!editor || !area || !connection) {
        logger.warn('Editor, area ou connection não disponível para bindSocket', {
          hasEditor: !!editor,
          hasArea: !!area,
          hasConnection: !!connection
        });
        return;
      }
      
      try {
        // O io é um objeto com key, socket, etc. (vem de data.inputs[key] ou data.outputs[key])
        const socket = io.socket || flowSocket;
        const ioKey = io.key || (typeof io === 'string' ? io : null);
        const nodeId = String(node.id);
        const reteNode = editor.getNode(nodeId);
        
        if (!reteNode) {
          logger.warn('Nó não encontrado no editor para bindSocket', { nodeId });
          return;
        }
        
        // No Rete.js v2.0, o bindSocket é feito através do ConnectionPlugin
        // O ConnectionPlugin precisa que o elemento tenha os atributos corretos
        // e que seja vinculado através do método bindSocket do plugin
        
        // Primeiro, garante que o elemento tem os atributos necessários
        el.dataset.socketType = type; // 'input' ou 'output'
        el.dataset.socketKey = ioKey || 'in'; // 'in' para input, 'out' para output
        el.dataset.nodeId = nodeId;
        el.dataset.socketName = socket?.name || 'flow';
        
        // Adiciona classes CSS
        el.classList.add('socket');
        el.classList.add(`socket-${type}`);
        el.classList.add(`socket-${socket?.name || 'flow'}`);
        
        // No Rete.js v2.0, o bindSocket é feito através do preset classic do ConnectionPlugin
        // Primeiro, tenta usar o bindSocket armazenado do preset classic
        const storedBindSocket = globalConnectionBindSocketRef.current;
        if (storedBindSocket && typeof storedBindSocket === 'function') {
          try {
            // O bindSocket do preset classic pode receber: (element, socket, type) ou (element, io)
            // Tenta ambas as assinaturas
            try {
              storedBindSocket(el, socket, type);
              logger.debug('Socket vinculado via stored connection preset bindSocket (3 args)', { 
                nodeId, 
                type, 
                ioKey,
                socketName: socket?.name 
              });
              return;
            } catch (err1) {
              // Tenta com apenas o io
              storedBindSocket(el, io);
              logger.debug('Socket vinculado via stored connection preset bindSocket (2 args)', { 
                nodeId, 
                type, 
                ioKey,
                socketName: socket?.name 
              });
              return;
            }
          } catch (err) {
            logger.warn('Erro ao vincular socket via stored connection preset bindSocket', {
              nodeId,
              type,
              error: err.message
            });
          }
        }
        
        // CRÍTICO: No Rete.js v2, o preset classic do ReactPlugin fornece o bindSocket
        // quando o connection é passado. O bindSocket deve ser chamado aqui para
        // vincular o socket ao ConnectionPlugin.
        // O preset classic do ReactPlugin passa o bindSocket nas props, mas se não vier,
        // precisamos usar o fallback armazenado.
        
        // Tenta usar o socketsCache do ConnectionPlugin diretamente
        // O ConnectionPlugin mantém um cache de sockets vinculados
        if (connection && connection.socketsCache) {
          try {
            // O socketsCache é um Map que armazena elementos vinculados
            // Chave: string no formato "nodeId:ioKey:type"
            const cacheKey = `${nodeId}:${ioKey || (type === 'input' ? 'in' : 'out')}:${type}`;
            // IMPORTANTE: No Rete.js v2.0, inputs/outputs são objetos, não Maps
            const ioToBind = type === 'input' 
              ? (reteNode.inputs?.[ioKey || 'in'] || (reteNode.inputs instanceof Map ? reteNode.inputs.get(ioKey || 'in') : null))
              : (reteNode.outputs?.[ioKey || 'out'] || (reteNode.outputs instanceof Map ? reteNode.outputs.get(ioKey || 'out') : null));
            
            if (ioToBind) {
              // CRÍTICO: Armazena o elemento no cache do ConnectionPlugin
              // Isso é necessário para que o ConnectionPlugin possa renderizar conexões
              connection.socketsCache.set(cacheKey, {
                element: el,
                io: ioToBind,
                node: reteNode,
                socket: socket,
                type: type
              });
              
              // Adiciona atributos específicos que o ConnectionPlugin espera
              el.setAttribute('data-node-id', nodeId);
              el.setAttribute('data-io-key', ioKey || (type === 'input' ? 'in' : 'out'));
              el.setAttribute('data-socket', socket?.name || 'flow');
              el.setAttribute('data-socket-type', type);
              
              logger.info('✅ Socket adicionado ao cache do ConnectionPlugin', { 
                nodeId, 
                type, 
                ioKey,
                socketName: socket?.name,
                cacheKey,
                cacheSize: connection.socketsCache.size
              });
              
              // CRÍTICO: Força atualização do ConnectionPlugin para renderizar conexões
              // O ConnectionPlugin precisa saber sobre o socket para renderizar conexões
              if (connection.update && typeof connection.update === 'function') {
                try {
                  connection.update('socket', { element: el, io: ioToBind });
                  logger.debug('✅ ConnectionPlugin.update chamado após adicionar socket ao cache');
                } catch (updateErr) {
                  logger.warn('Erro ao atualizar connection após bind socket', { error: updateErr.message });
                }
              }
              
              // IMPORTANTE: Garante que o SVG existe após vincular o socket
              // O ConnectionPlugin pode precisar do SVG para renderizar conexões
              setTimeout(() => {
                const container = globalContainerRef.current;
                if (container) {
                  let svgElement = container.querySelector('svg');
                  if (!svgElement) {
                    // Cria o SVG se não existir
                    svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    svgElement.setAttribute('class', 'rete-connection-svg');
                    svgElement.style.position = 'absolute';
                    svgElement.style.top = '0';
                    svgElement.style.left = '0';
                    svgElement.style.width = '100%';
                    svgElement.style.height = '100%';
                    svgElement.style.pointerEvents = 'none';
                    svgElement.style.zIndex = '1';
                    container.appendChild(svgElement);
                    logger.debug('SVG criado após vincular socket', { nodeId, type });
                  }
                }
              }, 50);
              
              return;
            } else {
              logger.warn('⚠️ ioToBind não encontrado para adicionar ao cache', {
                nodeId,
                type,
                ioKey,
                hasInputs: !!reteNode.inputs,
                hasOutputs: !!reteNode.outputs
              });
            }
          } catch (err) {
            logger.warn('Erro ao vincular socket via connection.socketsCache', {
              nodeId,
              type,
              error: err.message
            });
          }
        } else {
          logger.warn('⚠️ ConnectionPlugin.socketsCache não disponível', {
            hasConnection: !!connection,
            hasSocketsCache: !!(connection && connection.socketsCache)
          });
        }
        
        // CRÍTICO: No Rete.js v2, o ConnectionPlugin não tem método bind direto
        // Os sockets são vinculados através do preset classic que é usado pelo ReactPlugin
        // O bindSocket vem do preset classic do ReactPlugin quando connection é passado
        // Por enquanto, apenas prepara o elemento com os atributos corretos
        // O preset classic do ReactPlugin fará o bind automaticamente
        
        // Fallback: tenta obter o bindSocket do preset do connection diretamente
        let connectionBindSocket = null;
        if (connection && connection.presets) {
          // O preset classic pode estar em connection.presets ou connection._presets
          const presets = connection.presets || connection._presets || [];
          for (const preset of presets) {
            if (preset && typeof preset.bindSocket === 'function') {
              connectionBindSocket = preset.bindSocket;
              break;
            }
          }
        }
        
        // Tenta usar o bindSocket do preset do ConnectionPlugin
        if (connectionBindSocket) {
          try {
            connectionBindSocket(el, socket, type);
            logger.debug('Socket vinculado via connection preset bindSocket', { 
              nodeId, 
              type, 
              ioKey,
              socketName: socket?.name 
            });
            return;
          } catch (err) {
            logger.warn('Erro ao vincular socket via connection preset bindSocket', {
              nodeId,
              type,
              error: err.message
            });
          }
        }
        
        // Fallback: tenta usar bindSocket direto do connection (pode não existir na v2.0)
        if (connection && typeof connection.bindSocket === 'function') {
          try {
            connection.bindSocket(el, socket, type);
            logger.debug('Socket vinculado via connection.bindSocket direto', { 
              nodeId, 
              type, 
              ioKey,
              socketName: socket?.name 
            });
            return;
          } catch (err) {
            logger.warn('Erro ao vincular socket via connection.bindSocket direto', {
              nodeId,
              type,
              error: err.message
            });
          }
        }
        
        // Fallback: tenta usar o bindSocket do area se disponível
        if (area && typeof area.bindSocket === 'function') {
          try {
            const ioObj = {
              key: ioKey,
              socket: socket,
              node: reteNode,
            };
            area.bindSocket(el, ioObj);
            logger.debug('Socket vinculado via area.bindSocket', { nodeId, type });
            return;
          } catch (err) {
            logger.warn('Erro ao vincular socket via area.bindSocket', {
              nodeId,
              type,
              error: err.message
            });
          }
        }
        
        // Último recurso: tenta usar o emit se disponível
        if (emit && typeof emit === 'function') {
          try {
            emit('bindsocket', { el, type, io, socket, nodeId });
            logger.debug('Emitido evento bindsocket', { nodeId, type });
          } catch (err) {
            logger.warn('Erro ao emitir evento bindsocket', {
              nodeId,
              type,
              error: err.message
            });
          }
        }
        
        // LOG CRÍTICO: Verifica se o socket foi vinculado corretamente
        // Aguarda um pouco para que o DOM seja atualizado
        setTimeout(() => {
          const socketInDom = document.querySelector(`[data-node-id="${nodeId}"][data-io-key="${ioKey}"][data-socket-type="${type}"]`);
          const socketClasses = el.className;
          const socketAttributes = {
            socketType: el.dataset.socketType,
            socketKey: el.dataset.socketKey,
            nodeId: el.dataset.nodeId,
            socketName: el.dataset.socketName,
          };
          
          logger.info('🔌 DIAGNÓSTICO DE SOCKET - Verificação pós-bindSocket', {
            nodeId,
            type,
            ioKey,
            socketName: socket?.name,
            socketNoDom: !!socketInDom,
            socketElement: {
              tagName: el.tagName,
              classes: socketClasses,
              attributes: socketAttributes,
              parentElement: el.parentElement?.tagName,
              isConnected: el.isConnected,
            },
            tentativasRealizadas: {
              storedBindSocket: !!storedBindSocket,
              connectionBind: !!connection?.bind,
              connectionBindSocket: !!connection?.bindSocket,
              areaBindSocket: !!area?.bindSocket,
              emit: !!emit,
            },
            connectionPlugin: {
              hasConnection: !!connection,
              connectionType: typeof connection,
              connectionKeys: connection ? Object.keys(connection) : [],
              hasPresets: !!(connection?.presets || connection?._presets),
            },
          });
        }, 100);
      } catch (error) {
        logger.error('Erro geral no bindSocket', {
          nodeId: node?.id,
          type,
          error: error.message,
          stack: error.stack
        });
      }
    });
    
    const bindControl = pluginBindControl || ((el, control) => {
      // Se o plugin não passar bindControl, apenas vincula o elemento ao control se necessário
      if (el && control && control.element !== undefined) {
        control.element = el;
      }
    });
    
    return (
      <FlowNodeComponent
        node={node}
        bindSocket={bindSocket}
        bindControl={bindControl}
        selected={isSelected}
        theme={theme}
      />
    );
  } catch (error) {
    console.error('Erro no FlowNodeComponentWrapper:', error, {
      node,
      hasNode: !!node,
      hasNodeData: !!node?.data,
      nodeId: node?.id
    });
    return (
      <div style={{ padding: '10px', background: '#ff0000', color: '#fff' }}>
        Erro ao renderizar nó: {error?.message || String(error)}
      </div>
    );
  }
}

/**
 * Componente visual de nó em React - estilo moderno e elegante
 * - Usado pelo ReactRenderPlugin para renderizar nós do Rete.
 */
function FlowNodeComponent({ node, bindSocket, bindControl, selected, theme }) {
  // Validação de entrada
  if (!node || !node.data) {
    console.error('FlowNodeComponent: node ou node.data não existe', { node });
    return <div>Erro: Nó inválido</div>;
  }
  
  // Garante que o tema tenha a estrutura esperada
  const safeTheme = theme || {
    colors: {
      bg: { elevated: '#1a1a1a', secondary: '#2a2a2a', tertiary: '#3a3a3a', primary: '#0a0a0a' },
      text: { primary: '#ffffff', secondary: '#cccccc', tertiary: '#999999' },
      border: { default: '#444444' },
      accent: { primary: '#3b82f6', hover: '#2563eb' },
      status: { success: '#10b981' },
    },
  };
  
  const { type } = node.data || {};
  const config = node.data?.config || {};

  // Cores suaves conforme diretrizes: tons suaves, nunca vibrantes
  const nodeTypeColors = {
    start: '#4A90E2',        // Azul suave (Start/Entrada)
    message: '#52C9A2',      // Verde suave (Mensagem)
    user_input: '#52C9A2',   // Verde suave (Input)
    router: '#F5A623',       // Amarelo suave (Decisão/Router)
    set_variable: '#7B68EE', // Roxo suave (Variável)
    handoff: '#9B59B6',      // Roxo suave (Humano/Escalonamento)
    ai: '#16A085',           // Verde-água suave (AI)
    end: '#95A5A6',          // Cinza suave (End)
  };

  const nodeTypeLabels = {
    start: 'Start',
    message: 'Message',
    user_input: 'Input',
    router: 'Router',
    set_variable: 'Variable',
    handoff: 'Handoff',
    ai: 'AI',
    end: 'End',
  };

  const nodeTypeIcons = {
    start: '▶',
    message: '💬',
    user_input: '⌨️',
    router: '🔀',
    set_variable: '📝',
    handoff: '👤',
    ai: '🤖',
    end: '⏹',
  };

  const color = nodeTypeColors[type] || '#6b7280';
  const label = nodeTypeLabels[type] || type;
  const icon = nodeTypeIcons[type] || '●';

  // Cores com opacidade para gradientes e efeitos
  const colorWithOpacity = (opacity) => {
    const hex = color.replace('#', '');
    // Suporta tanto 3 quanto 6 dígitos hexadecimais
    const r = hex.length === 3 
      ? parseInt(hex[0] + hex[0], 16)
      : parseInt(hex.substring(0, 2), 16);
    const g = hex.length === 3
      ? parseInt(hex[1] + hex[1], 16)
      : parseInt(hex.substring(2, 4), 16);
    const b = hex.length === 3
      ? parseInt(hex[2] + hex[2], 16)
      : parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  };

  // Estilo quando selecionado - parecido com hover mas com detalhe sutil
  const isSelected = selected;
  const borderWidth = isSelected ? '3px' : '2px'; // Borda um pouco mais espessa que o hover
  const borderColor = isSelected ? color : colorWithOpacity(0.3);
  // Sombra similar ao hover, mas com glow sutil da cor do nó
  const boxShadow = isSelected 
    ? `0 8px 24px ${colorWithOpacity(0.3)}, 0 4px 8px rgba(0, 0, 0, 0.4), 0 0 0 1px ${colorWithOpacity(0.2)}` // Glow sutil ao redor
    : `0 4px 12px ${colorWithOpacity(0.15)}, 0 2px 4px rgba(0, 0, 0, 0.3)`;
  // Transform similar ao hover, mas sem translateY para manter posição fixa
  const transform = isSelected ? 'translateY(-2px) scale(1.01)' : 'scale(1)';
  const zIndex = isSelected ? 1000 : 'auto';

  // Largura fixa conforme diretrizes (220px), altura automática
  return (
    <div
      data-node-id={node.id}
      className="p-0 cursor-move select-none overflow-hidden relative text-text-primary transition-all duration-200 ease-out"
      style={{
        width: '220px', // Largura fixa conforme diretrizes
        minHeight: 'auto', // Altura automática
        borderRadius: '12px', // Cantos 10-14px (usando 12px)
        border: `${borderWidth} solid ${borderColor}`,
        background: safeTheme.name === 'light'
          ? '#FFFFFF' // Fundo branco no light mode para contraste
          : `linear-gradient(135deg, ${safeTheme.colors?.bg?.elevated || '#1a1a1a'} 0%, ${safeTheme.colors?.bg?.tertiary || '#3a3a3a'} 100%)`,
        boxShadow: isSelected 
          ? boxShadow
          : safeTheme.name === 'light'
          ? `0 2px 8px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.05)` // Sombra mais suave no light
          : `0 2px 8px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.08)`, // Sombra leve e consistente
        transform,
        zIndex,
        // Outline sutil apenas para selecionado (diferença sutil do hover)
        outline: isSelected ? `2px solid ${colorWithOpacity(0.25)}` : 'none',
        outlineOffset: isSelected ? '1px' : '0',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget || e.target.closest('.inputs, .outputs')) {
          return;
        }
      }}
      onClick={(e) => {
        // Dispara evento customizado para facilitar detecção
        e.stopPropagation();
        const customEvent = new CustomEvent('nodeclick', {
          detail: { nodeId: node.id, node },
          bubbles: true,
          cancelable: true,
        });
        e.currentTarget.dispatchEvent(customEvent);
        
        // Também chama diretamente o callback se disponível
        // Tenta acessar via window (ref global temporária)
        const nodeSelectedRef = typeof window !== 'undefined' ? window.__reteNodeSelectedRef : null;
        if (nodeSelectedRef && typeof nodeSelectedRef.current === 'function') {
          // Garante que o config seja lido corretamente do nó
          const nodeConfig = node.data?.config || {};
          const nodeData = {
            id: String(node.id),
            type: node.data?.type || 'unknown',
            config: nodeConfig,
          };
          logger.debug('Nó clicado diretamente no componente', {
            nodeData,
            nodeId: node.id,
            nodeType: node.data?.type,
            hasConfig: !!node.data?.config,
            configKeys: Object.keys(nodeConfig),
            configValue: nodeConfig,
          });
          nodeSelectedRef.current(nodeData);
        }
      }}
      onMouseEnter={(e) => {
        if (!isSelected) {
          // Hover: elevação e borda colorida
          e.currentTarget.style.borderColor = color;
          e.currentTarget.style.borderWidth = '2px';
          e.currentTarget.style.boxShadow = `0 8px 24px ${colorWithOpacity(0.25)}, 0 4px 8px rgba(0, 0, 0, 0.4)`;
          e.currentTarget.style.transform = 'translateY(-2px) scale(1.01)';
          e.currentTarget.style.outline = 'none';
        } else {
          // Se já está selecionado, apenas intensifica levemente o glow
          e.currentTarget.style.boxShadow = `0 8px 24px ${colorWithOpacity(0.35)}, 0 4px 8px rgba(0, 0, 0, 0.4), 0 0 0 1px ${colorWithOpacity(0.3)}`;
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          // Volta ao estado normal
          e.currentTarget.style.borderColor = colorWithOpacity(0.3);
          e.currentTarget.style.borderWidth = '2px';
          e.currentTarget.style.boxShadow = safeTheme.name === 'light'
            ? `0 2px 8px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.05)`
            : `0 4px 12px ${colorWithOpacity(0.15)}, 0 2px 4px rgba(0, 0, 0, 0.3)`;
          e.currentTarget.style.transform = 'translateY(0) scale(1)';
        } else {
          // Mantém o estilo de selecionado (com outline sutil)
          e.currentTarget.style.borderColor = color;
          e.currentTarget.style.borderWidth = '3px';
          e.currentTarget.style.boxShadow = boxShadow;
          e.currentTarget.style.transform = 'translateY(-2px) scale(1.01)';
          e.currentTarget.style.outline = `2px solid ${colorWithOpacity(0.25)}`;
          e.currentTarget.style.outlineOffset = '1px';
        }
      }}
    >
      {/* Barra superior colorida - Ícone, Título curto */}
      <div
        style={{
          background: `linear-gradient(135deg, ${color} 0%, ${colorWithOpacity(0.85)} 100%)`,
          padding: '16px 18px', // Padding generoso conforme diretrizes
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          borderBottom: `1px solid ${colorWithOpacity(0.25)}`,
        }}
      >
        <div
          className="w-10 h-10 rounded-lg bg-white/25 flex items-center justify-center text-xl backdrop-blur-sm flex-shrink-0 shadow-md"
          style={{
            boxShadow: `0 2px 8px ${colorWithOpacity(0.4)}, inset 0 1px 0 rgba(255, 255, 255, 0.1)`,
          }}
          title={`Tipo: ${type}`}
        >
          {icon}
        </div>
        <div className="flex-1 flex flex-col gap-1 min-w-0">
          <div className="font-semibold text-[16px] text-white leading-tight tracking-tight" style={{ fontSize: '16px' }}>
            {label}
          </div>
        </div>
      </div>

      {/* Conteúdo do nó - Preview de conteúdo (1 linha) */}
      <div className="px-5 py-4" style={{ padding: '18px' }}> {/* Padding generoso conforme diretrizes */}

        {/* Preview de conteúdo (1 linha) conforme diretrizes */}
        {type === 'message' && config.text && (
          <div
            style={{
              fontSize: '14px', // Mínimo 14px conforme diretrizes
              color: safeTheme.colors?.text?.primary || (safeTheme.name === 'light' ? '#1F2937' : '#ffffff'),
              lineHeight: 1.5,
              marginBottom: '12px',
              padding: '12px 14px',
              backgroundColor: safeTheme.name === 'light' 
                ? '#F9FAFB' 
                : (safeTheme.colors?.bg?.secondary || '#2a2a2a'),
              borderRadius: '8px',
              border: `1px solid ${safeTheme.colors?.border?.default || (safeTheme.name === 'light' ? '#E1E4E8' : '#444444')}`,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', // Preview de 1 linha conforme diretrizes
              fontWeight: 400,
            }}
            title={config.text}
          >
            {config.text}
          </div>
        )}

        {type === 'user_input' && config.variable && (
          <div
            style={{
              fontSize: '14px', // Mínimo 14px
              color: safeTheme.colors?.text?.secondary || (safeTheme.name === 'light' ? '#4B5563' : '#cccccc'),
              lineHeight: 1.5,
              marginBottom: '12px',
              padding: '12px 14px',
              backgroundColor: safeTheme.name === 'light' 
                ? '#F9FAFB' 
                : (safeTheme.colors?.bg?.secondary || '#2a2a2a'),
              borderRadius: '8px',
              border: `1px solid ${safeTheme.colors?.border?.default || (safeTheme.name === 'light' ? '#E1E4E8' : '#444444')}`,
              fontFamily: 'monospace',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', // Preview de 1 linha
            }}
            title={config.variable}
          >
            <span style={{ color: safeTheme.colors?.text?.tertiary || (safeTheme.name === 'light' ? '#6B7280' : '#999999'), fontSize: '12px', fontWeight: 500 }}>Variável: </span>
            <span style={{ color: color, fontWeight: '600' }}>
              {config.variable}
            </span>
          </div>
        )}

        {type === 'router' && config.rules && Array.isArray(config.rules) && (
          <div
            style={{
              fontSize: '14px', // Mínimo 14px
              color: safeTheme.colors?.text?.secondary || (safeTheme.name === 'light' ? '#4B5563' : '#cccccc'),
              lineHeight: 1.5,
              marginBottom: '12px',
              padding: '12px 14px',
              backgroundColor: safeTheme.name === 'light' 
                ? '#F9FAFB' 
                : (safeTheme.colors?.bg?.secondary || '#2a2a2a'),
              borderRadius: '8px',
              border: `1px solid ${safeTheme.colors?.border?.default || (safeTheme.name === 'light' ? '#E1E4E8' : '#444444')}`,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', // Preview de 1 linha
            }}
            title={`${config.rules.length} regra${config.rules.length !== 1 ? 's' : ''}`}
          >
            <span style={{ fontSize: '16px', lineHeight: 1, marginRight: '6px' }}>🔀</span>
            <span style={{ fontWeight: 500 }}>
              {config.rules.length} regra{config.rules.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {type === 'set_variable' && config.assignments && Object.keys(config.assignments).length > 0 && (
          <div
            style={{
              fontSize: '14px', // Mínimo 14px
              color: safeTheme.colors?.text?.secondary || (safeTheme.name === 'light' ? '#4B5563' : '#cccccc'),
              lineHeight: 1.5,
              marginBottom: '12px',
              padding: '12px 14px',
              backgroundColor: safeTheme.name === 'light' 
                ? '#F9FAFB' 
                : (safeTheme.colors?.bg?.secondary || '#2a2a2a'),
              borderRadius: '8px',
              border: `1px solid ${safeTheme.colors?.border?.default || (safeTheme.name === 'light' ? '#E1E4E8' : '#444444')}`,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', // Preview de 1 linha
            }}
            title={`${Object.keys(config.assignments).length} variável${Object.keys(config.assignments).length !== 1 ? 's' : ''}`}
          >
            <span style={{ fontSize: '16px', lineHeight: 1, marginRight: '6px' }}>📝</span>
            <span style={{ fontWeight: 500 }}>
              {Object.keys(config.assignments).length} variável{Object.keys(config.assignments).length !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {type === 'handoff' && config.queue && (
          <div
            style={{
              fontSize: '14px', // Mínimo 14px
              color: safeTheme.colors?.text?.secondary || (safeTheme.name === 'light' ? '#4B5563' : '#cccccc'),
              lineHeight: 1.5,
              marginBottom: '12px',
              padding: '12px 14px',
              backgroundColor: safeTheme.name === 'light' 
                ? '#F9FAFB' 
                : (safeTheme.colors?.bg?.secondary || '#2a2a2a'),
              borderRadius: '8px',
              border: `1px solid ${safeTheme.colors?.border?.default || (safeTheme.name === 'light' ? '#E1E4E8' : '#444444')}`,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', // Preview de 1 linha
            }}
            title={config.queue}
          >
            <span style={{ color: safeTheme.colors?.text?.tertiary || (safeTheme.name === 'light' ? '#6B7280' : '#999999'), fontSize: '12px', fontWeight: 500 }}>Fila: </span>
            <span style={{ color: color, fontWeight: '600' }}>
              {config.queue}
            </span>
          </div>
        )}

        {type === 'ai' && config.outputVariable && (
          <div
            style={{
              fontSize: '14px', // Mínimo 14px
              color: safeTheme.colors?.text?.secondary || (safeTheme.name === 'light' ? '#4B5563' : '#cccccc'),
              lineHeight: 1.5,
              marginBottom: '12px',
              padding: '12px 14px',
              backgroundColor: safeTheme.name === 'light' 
                ? '#F9FAFB' 
                : (safeTheme.colors?.bg?.secondary || '#2a2a2a'),
              borderRadius: '8px',
              border: `1px solid ${safeTheme.colors?.border?.default || (safeTheme.name === 'light' ? '#E1E4E8' : '#444444')}`,
              fontFamily: 'monospace',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', // Preview de 1 linha
            }}
            title={config.outputVariable}
          >
            <span style={{ color: safeTheme.colors?.text?.tertiary || (safeTheme.name === 'light' ? '#6B7280' : '#999999'), fontSize: '12px', fontWeight: 500 }}>Saída: </span>
            <span style={{ color: color, fontWeight: '600' }}>
              {config.outputVariable}
            </span>
          </div>
        )}

        {/* Inputs */}
        <div className="inputs" style={{ 
          marginTop: (type === 'message' && config.text) || 
                     (type === 'user_input' && config.variable) ||
                     (type === 'router' && config.rules) ||
                     (type === 'set_variable' && config.assignments) ||
                     (type === 'handoff' && config.queue) ||
                     (type === 'ai' && config.outputVariable) ? '4px' : '0' 
        }}>
          {(() => {
            const inputs = node.inputs || {};
            const inputEntries = Object.entries(inputs);
            if (inputEntries.length === 0 && type !== 'start') {
              logger.warn('Nó sem inputs renderizado', { 
                nodeId: node.id, 
                type, 
                hasInputs: !!node.inputs,
                inputsType: typeof node.inputs,
                inputsIsMap: node.inputs instanceof Map
              });
            } else if (inputEntries.length > 0) {
              logger.debug('Renderizando inputs do nó', { 
                nodeId: node.id, 
                type, 
                inputCount: inputEntries.length,
                inputKeys: inputEntries.map(([k]) => k)
              });
            }
            return inputEntries;
          })().map(([key, input]) => (
            <div
              key={key}
              style={{
                marginBottom: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <span
                ref={(el) => {
                  if (el && bindSocket) {
                    // Usa setTimeout para garantir que o elemento está completamente no DOM
                    setTimeout(() => {
                      bindSocket(el, 'input', input);
                    }, 0);
                  }
                }}
                style={{
                  display: 'inline-block',
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  backgroundColor: safeTheme.colors?.accent?.primary || '#5e6ad2',
                  border: `3px solid ${safeTheme.colors?.bg?.elevated || safeTheme.colors?.bg?.tertiary || '#1a1a1a'}`,
                  cursor: 'pointer',
                  transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                  boxShadow: `0 2px 6px ${safeTheme.colors?.accent?.primary || '#5e6ad2'}40`,
                  position: 'relative',
                  zIndex: 10,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.4)';
                  e.currentTarget.style.backgroundColor = safeTheme.colors?.accent?.hover || '#6b77e0';
                  e.currentTarget.style.boxShadow = `0 4px 12px ${safeTheme.colors?.accent?.primary || '#5e6ad2'}80`;
                  e.currentTarget.style.zIndex = '100';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = safeTheme.colors?.accent?.primary || '#5e6ad2';
                  e.currentTarget.style.boxShadow = `0 2px 6px ${safeTheme.colors?.accent?.primary || '#5e6ad2'}40`;
                  e.currentTarget.style.zIndex = '10';
                }}
                data-socket={input.socket?.name || 'flow'}
                data-socket-type="input"
                data-node-id={node.id}
                data-io-key={key}
                className="socket input-socket"
              />
              <span
                style={{
                  fontSize: '14px', // Mínimo 14px
                  color: safeTheme.colors?.text?.secondary || '#a0a0a0',
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                {input.label || key}
              </span>
            </div>
          ))}
        </div>

        {/* Outputs */}
        <div className="outputs" style={{ marginTop: '10px' }}>
          {(() => {
            const outputs = node.outputs || {};
            const outputEntries = Object.entries(outputs);
            if (outputEntries.length === 0 && type !== 'end') {
              logger.warn('Nó sem outputs renderizado', { 
                nodeId: node.id, 
                type, 
                hasOutputs: !!node.outputs,
                outputsType: typeof node.outputs,
                outputsIsMap: node.outputs instanceof Map
              });
            } else if (outputEntries.length > 0) {
              logger.debug('Renderizando outputs do nó', { 
                nodeId: node.id, 
                type, 
                outputCount: outputEntries.length,
                outputKeys: outputEntries.map(([k]) => k)
              });
            }
            return outputEntries;
          })().map(([key, output]) => (
            <div
              key={key}
              style={{
                marginBottom: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                justifyContent: 'flex-end',
              }}
            >
              <span
                style={{
                  fontSize: '14px', // Mínimo 14px
                  color: safeTheme.colors?.text?.secondary || '#a0a0a0',
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                {output.label || key}
              </span>
              <span
                ref={(el) => {
                  if (el && bindSocket) {
                    // Usa setTimeout para garantir que o elemento está completamente no DOM
                    setTimeout(() => {
                      bindSocket(el, 'output', output);
                    }, 0);
                  }
                }}
                style={{
                  display: 'inline-block',
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  backgroundColor: safeTheme.colors?.status?.success || '#10b981',
                  border: `3px solid ${safeTheme.colors?.bg?.elevated || safeTheme.colors?.bg?.tertiary || '#1a1a1a'}`,
                  cursor: 'pointer',
                  transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                  boxShadow: `0 2px 6px ${safeTheme.colors?.status?.success || '#10b981'}40`,
                  position: 'relative',
                  zIndex: 10,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.4)';
                  e.currentTarget.style.backgroundColor = safeTheme.colors?.status?.success || '#14b8a6';
                  e.currentTarget.style.boxShadow = `0 4px 12px ${safeTheme.colors?.status?.success || '#10b981'}80`;
                  e.currentTarget.style.zIndex = '100';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.backgroundColor = safeTheme.colors?.status?.success || '#10b981';
                  e.currentTarget.style.boxShadow = `0 2px 6px ${safeTheme.colors?.status?.success || '#10b981'}40`;
                  e.currentTarget.style.zIndex = '10';
                }}
                data-socket={output.socket?.name || 'flow'}
                data-socket-type="output"
                data-node-id={node.id}
                data-io-key={key}
                className="socket output-socket"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Função auxiliar para criar nós de fluxo.
 * Na v2.0, não há mais Component, então usamos uma função factory.
 * 
 * @param {{ type: string, config?: any }} data
 * @returns {ClassicPreset.Node}
 */
function createFlowNode(data) {
  const node = new ClassicPreset.Node('FlowNode');
  const nodeType = data.type || 'unknown';
  
  node.data = {
    type: nodeType,
    config: data.config || {},
  };
  
  // Nó start não tem entrada
  if (nodeType !== 'start') {
    node.addInput('in', new ClassicPreset.Input(flowSocket, 'Anterior'));
  }
  
  // Nó end não tem saída
  if (nodeType !== 'end') {
    node.addOutput('out', new ClassicPreset.Output(flowSocket, 'Próximo'));
  }
  
  return node;
}

/**
 * Editor visual de fluxo baseado em Rete.
 *
 * Props:
 * - initialFlowJson?: JSON de fluxo para carregar
 * - onFlowChanged(json): chamado quando o grafo mudar
 * - onNodeSelected(nodeData): chamado quando um nó é selecionado
 * - onEvent(evento): emite eventos padronizados do editor
 */
export function FlowEditor({ initialFlowJson, onFlowChanged, onNodeSelected, onEvent, editorRef: externalEditorRef, selectedNodeId, onUpdateNodeConfig }) {
  const { theme } = useTheme();
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const areaRef = useRef(null); // Armazena referência do AreaPlugin
  const reactRenderPluginRef = useRef(null); // Referência ao plugin ReactRenderPlugin
  const [editorReady, setEditorReady] = useState(false); // Rastreia se o editor está pronto
  const lastLoadedJsonRef = useRef(null); // Rastreia o último JSON carregado para evitar loops
  const isLoadingJsonRef = useRef(false); // Flag para desabilitar notifyChange durante carregamento
  const selectedNodeIdRef = useRef(selectedNodeId);
  const onUpdateNodeConfigRef = useRef(onUpdateNodeConfig);
  const notifyChangeRef = useRef(null); // Ref para a função notifyChange
  
  // Armazena callbacks em refs para evitar re-inicializações
  const onFlowChangedRef = useRef(onFlowChanged);
  const onNodeSelectedRef = useRef(onNodeSelected);
  const onEventRef = useRef(onEvent);
  
  // Atualiza as refs globais para que o componente renderizado pelo ReactPlugin possa acessá-las
  // useTheme retorna { theme, themeName, toggleTheme, setTheme }, então precisamos pegar theme.theme
  useEffect(() => {
    // useTheme retorna um objeto com a propriedade 'theme'
    const themeObject = theme.theme || theme;
    globalThemeRef.current = themeObject;
    globalSelectedNodeIdRef.current = selectedNodeId;
    
    // Debug: log para verificar atualização
    logger.debug('FlowEditor - Atualizando globalSelectedNodeIdRef', {
      selectedNodeId,
      selectedNodeIdType: typeof selectedNodeId,
      hasEditor: !!editorRef.current,
      nodeCount: editorRef.current ? editorRef.current.getNodes().length : 0,
    });
  }, [theme, selectedNodeId]);
  
  // Expõe onNodeSelectedRef para uso no componente do nó
  // Usando uma ref global temporária (não ideal, mas necessário para acesso do componente)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__reteNodeSelectedRef = onNodeSelectedRef;
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete window.__reteNodeSelectedRef;
      }
    };
  }, []);
  
  // Atualiza refs quando props mudam
  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
    onUpdateNodeConfigRef.current = onUpdateNodeConfig;
  }, [selectedNodeId, onUpdateNodeConfig]);
  
  // Atualiza refs quando callbacks mudam
  useEffect(() => {
    onFlowChangedRef.current = onFlowChanged;
    onNodeSelectedRef.current = onNodeSelected;
    onEventRef.current = onEvent;
  }, [onFlowChanged, onNodeSelected, onEvent]);
  
  // Expõe o editor e funções auxiliares para uso externo
  useEffect(() => {
    if (externalEditorRef) {
      externalEditorRef.current = {
        editor: editorRef,
        updateNodeConfig: (nodeId, newConfig) => {
          if (!editorRef.current) return;
          const node = editorRef.current.getNode(nodeId);
          if (node) {
            node.data.config = { ...node.data.config, ...newConfig };
            
            // Força atualização do componente React
            if (reactRenderPluginRef.current) {
              // O ReactPlugin v2.0 pode ter um método update
              if (typeof reactRenderPluginRef.current.update === 'function') {
                try {
                  reactRenderPluginRef.current.update('node', node.id);
                } catch (err) {
                  logger.warn('Erro ao atualizar nó via ReactPlugin.update', { nodeId, error: err });
                }
              }
            }
            
            // Tenta forçar atualização via área também
            if (areaRef.current) {
              const nodeView = areaRef.current.nodeViews?.get(node.id);
              if (nodeView && typeof nodeView.update === 'function') {
                try {
                  nodeView.update();
                } catch (err) {
                  logger.warn('Erro ao atualizar view do nó', { nodeId, error: err });
                }
              }
            }
            
            // Força notificação de mudança
            if (notifyChangeRef.current) {
              notifyChangeRef.current();
            }
          }
        },
        zoomToFit: () => {
          // Faz zoom para mostrar todos os nós no editor
          if (!editorRef.current || !areaRef.current) {
            logger.warn('Editor ou area não disponível para zoomToFit');
            return;
          }
          
          try {
            const nodes = editorRef.current.getNodes();
            if (nodes.length === 0) {
              logger.debug('Nenhum nó para fazer zoom');
              return;
            }
            
            // Usa AreaExtensions.zoomAt para fazer zoom em todos os nós
            AreaExtensions.zoomAt(areaRef.current, nodes);
            logger.debug('Zoom aplicado para mostrar todos os nós', { 
              nodeCount: nodes.length 
            });
          } catch (err) {
            logger.warn('Erro ao fazer zoom para mostrar todos os nós', { error: err.message });
          }
        },
      };
    }
  }, [externalEditorRef]);

  // Inicializa o editor apenas uma vez (sem dependências que mudam frequentemente)
  const containerClickHandlerRef = useRef(null);
  const mouseDownHandlerRef = useRef(null);
  const lastClickPositionRef = useRef({ x: 0, y: 0, time: 0 });
  const mouseDownPositionRef = useRef({ x: 0, y: 0, time: 0 });
  
  useEffect(() => {
    if (!containerRef.current) return;
    
    // Atualiza a ref global do container
    globalContainerRef.current = containerRef.current;
    
    if (editorRef.current) {
      // Editor já inicializado, não reinicializar
      logger.debug('Editor já inicializado, pulando reinicialização');
      return;
    }

    let destroyed = false;

    async function init() {
      logger.debug('Iniciando inicialização do editor Rete v2.0');
      
      // Na v2.0, o NodeEditor não recebe container no construtor
      const editor = new NodeEditor();
      editorRef.current = editor;
      globalEditorRef.current = editor; // Atualiza ref global
      logger.debug('Editor Rete criado', { hasEditor: !!editor });

      // Na v2.0, os plugins são instanciados
      // IMPORTANTE: A ordem de uso dos plugins é crítica
      // 1. AreaPlugin primeiro (fornece o container)
      // 2. ConnectionPlugin segundo (gerencia conexões)
      // 3. ReactPlugin por último (renderiza tudo)
      const area = new AreaPlugin(containerRef.current);
      areaRef.current = area;
      globalAreaRef.current = area; // Atualiza ref global
      const connection = new ConnectionPlugin();
      globalConnectionRef.current = connection; // Atualiza ref global
      // Passa createRoot para usar React 18 API em vez de ReactDOM.render
      const reactRender = new ReactPlugin({ createRoot });
      
      logger.debug('Plugins criados', { 
        hasArea: !!area,
        hasConnection: !!connection,
        hasReactRender: !!reactRender
      });

      // Ordem correta na v2.0:
      // 1. IMPORTANTE: O AreaPlugin precisa ser usado no editor PRIMEIRO
      // para ter um parent antes de usar outros plugins nele
      editor.use(area);
      
      // 2. Adiciona presets aos plugins ANTES de usá-los no area
      // IMPORTANTE: No Rete.js v2.0, o preset classic do ConnectionPlugin
      // precisa ser configurado DEPOIS que o area for usado no editor
      // O preset classic precisa do area para criar o SVG e vincular sockets
      // O preset classic retorna uma FUNÇÃO que precisa ser chamada
      let connectionPreset = null;
      try {
        const presetSetup = ConnectionPresets.classic.setup({ area });
        // Se presetSetup é uma função, chama ela para obter o preset
        if (typeof presetSetup === 'function') {
          connectionPreset = presetSetup();
          logger.debug('Preset classic chamado como função', { 
            presetType: typeof connectionPreset,
            isObject: typeof connectionPreset === 'object',
            presetKeys: connectionPreset && typeof connectionPreset === 'object' ? Object.keys(connectionPreset) : []
          });
        } else {
          connectionPreset = presetSetup;
        }
        
        // CRÍTICO: No Rete.js v2.0, o preset pode precisar ser adicionado como função
        // que retorna o preset, ou como objeto diretamente
        // Tenta ambas as formas
        try {
          if (typeof connectionPreset === 'function') {
            connection.addPreset(connectionPreset);
          } else {
            // Se é um objeto, pode precisar ser uma função que retorna o objeto
            connection.addPreset(() => connectionPreset);
          }
        } catch (err) {
          // Se falhar, tenta adicionar diretamente
          logger.warn('Erro ao adicionar preset como função, tentando como objeto', { error: err.message });
          try {
            connection.addPreset(connectionPreset);
          } catch (err2) {
            logger.error('Erro ao adicionar preset como objeto', { error: err2.message });
          }
        }
        
        // IMPORTANTE: O preset classic retorna um objeto com métodos, incluindo bindSocket
        // Precisamos extrair o bindSocket do preset
        if (connectionPreset && typeof connectionPreset === 'object') {
          // O preset classic pode ter bindSocket diretamente ou em uma propriedade
          if (typeof connectionPreset.bindSocket === 'function') {
            globalConnectionBindSocketRef.current = connectionPreset.bindSocket;
            logger.debug('bindSocket extraído do preset classic', { hasBindSocket: true });
          }
        }
      } catch (err) {
        logger.error('Erro ao configurar preset classic do ConnectionPlugin', { 
          error: err.message,
          stack: err.stack
        });
        // Tenta criar o preset sem o area como fallback
        try {
          const fallbackPreset = ConnectionPresets.classic.setup();
          if (typeof fallbackPreset === 'function') {
            connectionPreset = fallbackPreset();
          } else {
            connectionPreset = fallbackPreset;
          }
          connection.addPreset(connectionPreset);
        } catch (err2) {
          logger.error('Erro ao criar preset classic sem area', { error: err2.message });
        }
      }
      
      // IMPORTANTE: O preset classic do ConnectionPlugin fornece um bindSocket
      // Precisamos armazená-lo para usar no fallback
      // Log detalhado para entender a estrutura do preset
      logger.debug('ConnectionPlugin preset estrutura', {
        hasPreset: !!connectionPreset,
        presetType: typeof connectionPreset,
        presetKeys: connectionPreset && typeof connectionPreset === 'object' ? Object.keys(connectionPreset) : [],
        hasBindSocket: connectionPreset && typeof connectionPreset.bindSocket === 'function',
        hasSetup: connectionPreset && typeof connectionPreset.setup === 'function',
      });
      
      if (connectionPreset && typeof connectionPreset === 'object') {
        // O preset classic pode ter bindSocket como propriedade ou método
        if (typeof connectionPreset.bindSocket === 'function') {
          globalConnectionBindSocketRef.current = connectionPreset.bindSocket;
          logger.debug('bindSocket do preset classic armazenado', {
            hasBindSocket: true
          });
        } else if (connectionPreset.setup && typeof connectionPreset.setup === 'function') {
          // Pode ser que o setup retorne um objeto com bindSocket
          try {
            const setupResult = connectionPreset.setup({ area });
            if (setupResult && typeof setupResult.bindSocket === 'function') {
              globalConnectionBindSocketRef.current = setupResult.bindSocket;
              logger.debug('bindSocket do preset classic (via setup) armazenado', {
                hasBindSocket: true
              });
            }
          } catch (err) {
            logger.warn('Erro ao chamar setup do preset', { error: err.message });
          }
        }
        
        // Tenta encontrar bindSocket em outras propriedades comuns
        if (!globalConnectionBindSocketRef.current) {
          const possibleKeys = ['bind', 'bindSocket', 'socket', 'connect'];
          for (const key of possibleKeys) {
            if (connectionPreset[key] && typeof connectionPreset[key] === 'function') {
              logger.debug(`Encontrado método ${key} no preset`, { key });
              // Tenta usar como bindSocket se for 'bind' ou 'bindSocket'
              if (key === 'bindSocket' || key === 'bind') {
                globalConnectionBindSocketRef.current = connectionPreset[key];
                logger.debug(`bindSocket armazenado do preset usando chave ${key}`);
                break;
              }
            }
          }
        }
      }
      
      // CRÍTICO: Se ainda não temos bindSocket, cria um customizado usando o ConnectionPlugin
      if (!globalConnectionBindSocketRef.current) {
        logger.warn('bindSocket não encontrado no preset, criando função customizada');
        // Cria uma função bindSocket customizada que funciona com diferentes assinaturas
        // Pode receber: (el, socket, type) ou (el, io)
        globalConnectionBindSocketRef.current = (el, socketOrIo, typeOrUndefined) => {
          if (!el) return;
          
          const connection = globalConnectionRef.current;
          const editor = globalEditorRef.current;
          
          try {
            // Determina se é (el, socket, type) ou (el, io)
            let socket, type, io, nodeId, ioKey;
            if (typeOrUndefined !== undefined) {
              // Assinatura: (el, socket, type)
              socket = socketOrIo;
              // CRÍTICO: Garante que type seja 'input' ou 'output'
              if (typeof typeOrUndefined === 'string' && (typeOrUndefined === 'input' || typeOrUndefined === 'output')) {
                type = typeOrUndefined;
              } else {
                // Tenta inferir do elemento ou assume input
                const elType = el.getAttribute('data-socket-type') || el.dataset.socketType;
                type = (elType === 'input' || elType === 'output') ? elType : 'input';
              }
              // Tenta obter nodeId e ioKey do elemento
              nodeId = el.getAttribute('data-node-id');
              ioKey = el.getAttribute('data-io-key') || el.dataset.ioKey || (type === 'input' ? 'in' : 'out');
            } else if (socketOrIo && socketOrIo.socket) {
              // Assinatura: (el, io) onde io tem propriedade socket
              io = socketOrIo;
              socket = io.socket || flowSocket;
              // CRÍTICO: Tenta inferir o tipo do io ou do elemento
              if (typeof io.type === 'string' && (io.type === 'input' || io.type === 'output')) {
                type = io.type;
              } else {
                // Tenta inferir do elemento ou do contexto
                const elType = el.getAttribute('data-socket-type') || el.dataset.socketType;
                if (elType === 'input' || elType === 'output') {
                  type = elType;
                } else {
                  // Tenta inferir do ioKey
                  const inferredIoKey = io.key || el.getAttribute('data-io-key') || el.dataset.ioKey;
                  type = (inferredIoKey === 'in' || inferredIoKey === 'input') ? 'input' : 'output';
                }
              }
              nodeId = io.node ? String(io.node.id) : el.getAttribute('data-node-id');
              ioKey = io.key || el.getAttribute('data-io-key') || el.dataset.ioKey;
            } else if (socketOrIo && socketOrIo.node) {
              // Assinatura: (el, io) onde io tem propriedade node
              io = socketOrIo;
              socket = flowSocket;
              // Tenta inferir o tipo
              const elType = el.getAttribute('data-socket-type') || el.dataset.socketType;
              type = (elType === 'input' || elType === 'output') ? elType : 'input';
              nodeId = String(io.node.id);
              ioKey = io.key || 'in';
            } else {
              // Fallback: assume que socketOrIo é o socket
              socket = socketOrIo || flowSocket;
              // Tenta inferir o tipo do elemento
              const elType = el.getAttribute('data-socket-type') || el.dataset.socketType;
              type = (elType === 'input' || elType === 'output') ? elType : 'input';
              nodeId = el.getAttribute('data-node-id');
              ioKey = el.getAttribute('data-io-key') || el.dataset.ioKey || 'in';
            }
            
            // CRÍTICO: Garante que type seja sempre 'input' ou 'output'
            if (type !== 'input' && type !== 'output') {
              logger.warn('⚠️ Tipo inválido detectado, corrigindo', { originalType: type, nodeId, ioKey });
              // Tenta inferir do ioKey como último recurso
              const inferredIoKey = ioKey || el.getAttribute('data-io-key') || el.dataset.ioKey;
              type = (inferredIoKey === 'in' || inferredIoKey === 'input') ? 'input' : 'output';
            }
            
            // CRÍTICO: Se temos nodeId mas não temos io, tenta obter do editor
            if (nodeId && !io && editor) {
              const reteNode = editor.getNode(nodeId);
              if (reteNode) {
                const ioToGet = type === 'input' 
                  ? (reteNode.inputs?.[ioKey] || (reteNode.inputs instanceof Map ? reteNode.inputs.get(ioKey) : null))
                  : (reteNode.outputs?.[ioKey] || (reteNode.outputs instanceof Map ? reteNode.outputs.get(ioKey) : null));
                if (ioToGet) {
                  io = ioToGet;
                  logger.debug('io obtido do editor para bindSocket customizado', { nodeId, ioKey, type });
                }
              }
            }
            
            // Adiciona atributos necessários
            // IMPORTANTE: Garante que socket.name seja uma string válida
            let socketName = 'flow';
            if (socket) {
              if (typeof socket === 'string') {
                socketName = socket;
              } else if (typeof socket === 'object') {
                // Tenta extrair o nome do socket de forma segura
                if (socket.name) {
                  const name = socket.name;
                  // Se name é uma string não vazia, usa ela
                  if (typeof name === 'string' && name.trim()) {
                    socketName = name.trim();
                  } else if (typeof name === 'object' && name.name) {
                    // Se name é um objeto com propriedade name, tenta usar
                    const nestedName = name.name;
                    socketName = (typeof nestedName === 'string' && nestedName.trim()) ? nestedName.trim() : 'flow';
                  }
                }
              }
            }
            
            // Garante que socketName seja sempre uma string válida para CSS
            // Remove caracteres inválidos para classes CSS
            socketName = String(socketName || 'flow').replace(/[^a-zA-Z0-9-_]/g, '') || 'flow';
            
            // CRÍTICO: type já foi validado acima como 'input' ou 'output'
            // Usa diretamente o type validado
            const typeStr = type; // type já é 'input' ou 'output' após validação acima
            
            el.dataset.socketType = typeStr;
            el.dataset.socketName = socketName;
            // IMPORTANTE: Define data-io-key se tivermos io
            if (io && io.key) {
              el.dataset.ioKey = String(io.key);
            } else if (type === 'input') {
              el.dataset.ioKey = 'in';
            } else if (type === 'output') {
              el.dataset.ioKey = 'out';
            }
            // CRÍTICO: Se temos nodeId mas não temos io, tenta obter do editor
            if (nodeId && !io && editor) {
              const reteNode = editor.getNode(nodeId);
              if (reteNode) {
                const ioToGet = typeStr === 'input' 
                  ? (reteNode.inputs?.[ioKey] || (reteNode.inputs instanceof Map ? reteNode.inputs.get(ioKey) : null))
                  : (reteNode.outputs?.[ioKey] || (reteNode.outputs instanceof Map ? reteNode.outputs.get(ioKey) : null));
                if (ioToGet) {
                  io = ioToGet;
                  logger.debug('io obtido do editor para bindSocket customizado', { nodeId, ioKey, type: typeStr });
                }
              }
            }
            
            // Também define como atributo para garantir compatibilidade
            // Tenta obter nodeId do elemento se já tiver o atributo, senão tenta do io
            if (!nodeId) {
              nodeId = el.getAttribute('data-node-id');
            }
            if (!nodeId && io && io.node) {
              nodeId = String(io.node.id);
            } else if (!nodeId && io && typeof io === 'object') {
              // Tenta encontrar o nodeId de outras formas
              if (editor) {
                // Se o elemento já está no DOM, tenta encontrar o nó pai
                let parent = el.parentElement;
                while (parent && !nodeId) {
                  nodeId = parent.getAttribute('data-node-id');
                  parent = parent.parentElement;
                }
              }
            }
            if (nodeId) {
              el.setAttribute('data-node-id', String(nodeId));
            }
            if (!ioKey) {
              ioKey = el.dataset.ioKey || el.getAttribute('data-io-key') || (typeStr === 'input' ? 'in' : 'out');
            }
            el.setAttribute('data-io-key', ioKey);
            el.classList.add('socket');
            el.classList.add(`socket-${typeStr}`);
            el.classList.add(`socket-${socketName}`);
            
            // CRÍTICO: Adiciona o socket ao socketsCache do ConnectionPlugin
            // Isso é necessário para que o ConnectionPlugin possa renderizar as conexões
            const connection = globalConnectionRef.current;
            if (connection && connection.socketsCache) {
              try {
                // Cria uma chave única para o socket no cache
                // Formato: `${nodeId}-${ioKey}-${typeStr}`
                const cacheKey = nodeId ? `${nodeId}-${ioKey}-${typeStr}` : `${el.id || Date.now()}-${ioKey}-${typeStr}`;
                
                // Adiciona ao cache
                connection.socketsCache.set(cacheKey, {
                  element: el,
                  socket: socket || flowSocket,
                  type: typeStr,
                  io: io,
                  nodeId: nodeId,
                  ioKey: ioKey
                });
                
                logger.info('✅ Socket adicionado ao cache do ConnectionPlugin', {
                  cacheKey,
                  nodeId,
                  ioKey,
                  type: typeStr,
                  cacheSize: connection.socketsCache.size
                });
                
                // CRÍTICO: Força atualização do ConnectionPlugin para renderizar conexões
                if (connection.update && typeof connection.update === 'function') {
                  try {
                    connection.update('socket', { element: el, io: io });
                    logger.debug('✅ ConnectionPlugin.update chamado após adicionar socket ao cache (bindSocket customizado)');
                  } catch (updateErr) {
                    logger.warn('Erro ao atualizar connection após adicionar socket ao cache', { 
                      error: updateErr.message,
                      nodeId,
                      ioKey
                    });
                  }
                }
              } catch (err) {
                logger.warn('Erro ao adicionar socket ao cache', {
                  error: err.message,
                  nodeId,
                  ioKey
                });
              }
            } else {
              logger.warn('⚠️ ConnectionPlugin ou socketsCache não disponível para adicionar socket', {
                hasConnection: !!connection,
                hasSocketsCache: !!(connection && connection.socketsCache)
              });
            }
            
            logger.debug('Socket preparado e adicionado ao cache', {
              socketType: typeStr,
              socketName: socket?.name,
              hasIo: !!io,
              nodeId,
              ioKey,
              cacheSize: connection?.socketsCache?.size || 0
            });
          } catch (err) {
            logger.warn('Erro ao criar bindSocket customizado', { error: err.message });
          }
        };
        logger.debug('bindSocket customizado criado');
      }
      
      logger.debug('ConnectionPlugin preset adicionado', {
        hasPreset: !!connectionPreset,
        presetType: typeof connectionPreset,
        hasStoredBindSocket: !!globalConnectionBindSocketRef.current,
      });
      
      // Configura o ReactPlugin para usar nosso componente customizado
      // No Rete.js v2.0, o preset classic do ReactPlugin precisa receber o connection
      // para poder passar o bindSocket corretamente E renderizar as conexões
      // CRÍTICO: O preset classic do ReactPlugin renderiza conexões automaticamente
      // quando o connection é passado, mas apenas se os sockets estiverem vinculados
      const reactPreset = ReactPresets.classic.setup({
        connection, // CRÍTICO: Passa o connection para o preset classic renderizar conexões
        customize: {
          node(context) {
            // No Rete.js v2.0, o context.payload É o nó (contém id, data, inputs, outputs, etc.)
            // O preset classic passa bindSocket e bindControl através das props
            // Retornamos uma função que recebe as props e repassa para o wrapper
            return (props) => {
              // O preset classic passa: { data, emit, bindSocket, bindControl }
              // CRÍTICO: O bindSocket vem do preset classic do ReactPlugin quando connection é passado
              // Se não vier, usamos o fallback armazenado
              let bindSocketToUse = props.bindSocket;
              if (typeof bindSocketToUse !== 'function') {
                // Tenta usar o bindSocket armazenado do preset classic do ConnectionPlugin
                bindSocketToUse = globalConnectionBindSocketRef.current;
                if (typeof bindSocketToUse === 'function') {
                  logger.debug('Usando bindSocket do ConnectionPlugin preset como fallback');
                } else {
                  logger.warn('⚠️ bindSocket não disponível nem nas props nem no preset', {
                    hasData: !!props.data,
                    hasBindControl: typeof props.bindControl === 'function',
                    hasEmit: typeof props.emit === 'function',
                    propsKeys: Object.keys(props),
                  });
                }
              } else {
                logger.debug('✅ bindSocket recebido do ReactPlugin preset', {
                  hasData: !!props.data,
                  hasBindSocket: true,
                });
                // CRÍTICO: Armazena o bindSocket do ReactPlugin preset para uso futuro
                if (!globalConnectionBindSocketRef.current) {
                  globalConnectionBindSocketRef.current = bindSocketToUse;
                  logger.info('✅ bindSocket do ReactPlugin preset armazenado globalmente');
                }
              }
              // Repassamos todas as props para o wrapper, garantindo que bindSocket esteja presente
              return <FlowNodeComponentWrapper {...props} bindSocket={bindSocketToUse} />;
            };
          },
          // IMPORTANTE: O preset classic do ReactPlugin renderiza conexões automaticamente
          // quando o connection é passado. Não precisamos customizar a renderização de conexões.
        },
      });
      
      // IMPORTANTE: O preset deve ser adicionado ANTES de usar o plugin no area
      reactRender.addPreset(reactPreset);
      
      // Log para debug
      logger.debug('ReactPlugin preset configurado', {
        hasReactRender: !!reactRender,
        hasPreset: !!reactPreset,
        wrapperName: FlowNodeComponentWrapper?.name || 'FlowNodeComponentWrapper',
        presetType: typeof reactPreset,
      });
      
      // 3. Depois, os outros plugins são usados através do AreaPlugin
      // IMPORTANTE: ConnectionPlugin deve ser usado ANTES do ReactPlugin
      // para que as conexões sejam renderizadas corretamente
      // CRÍTICO: A ordem é importante - connection primeiro, depois reactRender
      area.use(connection);
      area.use(reactRender);
      
      // IMPORTANTE: Após usar os plugins, força atualização inicial
      // Isso garante que o ConnectionPlugin esteja pronto para renderizar conexões
      if (connection && typeof connection.update === 'function') {
        try {
          // Pequeno delay para garantir que tudo está inicializado
          setTimeout(() => {
            connection.update();
            logger.debug('ConnectionPlugin.update chamado após inicialização');
          }, 50);
        } catch (err) {
          logger.warn('Erro ao chamar connection.update na inicialização', { error: err.message });
        }
      }
      
      // IMPORTANTE: Após usar os plugins, verifica se o SVG foi criado
      // O ConnectionPlugin deve criar um elemento SVG para renderizar as conexões
      setTimeout(() => {
        const container = containerRef.current;
        if (container) {
          let svgElement = container.querySelector('svg');
          if (!svgElement) {
            logger.warn('SVG não foi criado pelo ConnectionPlugin, criando manualmente');
            // Cria o SVG manualmente se o ConnectionPlugin não o criou
            svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svgElement.setAttribute('class', 'rete-connection-svg');
            svgElement.style.position = 'absolute';
            svgElement.style.top = '0';
            svgElement.style.left = '0';
            svgElement.style.width = '100%';
            svgElement.style.height = '100%';
            svgElement.style.pointerEvents = 'none';
            svgElement.style.zIndex = '1';
            // Adiciona o SVG ao container
            container.appendChild(svgElement);
            logger.info('SVG criado manualmente', {
              svgId: svgElement.id,
              svgClasses: svgElement.className,
              container: container.tagName
            });
            
            // CRÍTICO: Notifica o ConnectionPlugin sobre o SVG criado manualmente
            // O ConnectionPlugin precisa saber onde renderizar as conexões
            if (connection && typeof connection.parent === 'object') {
              try {
                // Tenta definir o parent do ConnectionPlugin
                if (connection.parent !== svgElement) {
                  connection.parent = svgElement;
                  logger.debug('ConnectionPlugin.parent definido para SVG criado manualmente');
                }
              } catch (err) {
                logger.warn('Erro ao definir connection.parent', { error: err.message });
              }
            }
            
            // IMPORTANTE: Não tenta usar setParent com SVG criado manualmente
            // O ConnectionPlugin espera um tipo específico de elemento como parent
            // Se o SVG foi criado manualmente, apenas aguardamos que o ConnectionPlugin
            // crie seu próprio SVG ou use o que foi criado
            // Não chamamos setParent para evitar o erro "actual parent is not instance of type"
            
            // Força atualização do ConnectionPlugin após criar o SVG
            if (connection && typeof connection.update === 'function') {
              try {
                connection.update();
                logger.debug('ConnectionPlugin.update chamado após criar SVG manualmente');
              } catch (err) {
                logger.warn('Erro ao chamar connection.update', { error: err.message });
              }
            }
          } else {
            logger.debug('SVG criado pelo ConnectionPlugin', {
              svgId: svgElement.id,
              svgClasses: svgElement.className,
              svgChildren: svgElement.children.length
            });
          }
        }
      }, 100);
      
      // IMPORTANTE: Após usar os plugins no area, precisamos garantir que
      // o ConnectionPlugin esteja configurado para renderizar conexões
      // O ConnectionPlugin renderiza conexões automaticamente quando os sockets estão vinculados
      // Mas precisamos garantir que ele esteja ativo
      logger.info('🔧 DIAGNÓSTICO DE PLUGINS - Após usar no area', {
        hasReactPreset: !!reactRender,
        hasConnectionPreset: !!connection,
        connectionMethods: connection ? Object.keys(connection).filter(k => typeof connection[k] === 'function') : [],
        areaPlugins: area.plugins ? Array.from(area.plugins.keys()) : [],
        connectionActive: connection && connection.active !== false,
        connectionPlugin: {
          type: typeof connection,
          keys: connection ? Object.keys(connection) : [],
          hasPresets: !!(connection?.presets || connection?._presets),
          presetsCount: connection?.presets ? connection.presets.length : 0,
          hasBind: typeof connection?.bind === 'function',
          hasBindSocket: typeof connection?.bindSocket === 'function',
          hasUpdate: typeof connection?.update === 'function',
        },
        area: {
          type: typeof area,
          hasContainer: !!area.container,
          containerElement: area.container?.tagName,
          hasPlugins: !!area.plugins,
          pluginsCount: area.plugins ? area.plugins.size || Object.keys(area.plugins).length : 0,
        },
        container: {
          hasContainer: !!containerRef.current,
          containerVisible: containerRef.current ? 
            (containerRef.current.offsetWidth > 0 && containerRef.current.offsetHeight > 0) : false,
          containerSize: containerRef.current ? {
            width: containerRef.current.offsetWidth,
            height: containerRef.current.offsetHeight
          } : null,
        },
      });
      
      // Armazena referências dos plugins para uso posterior
      reactRenderPluginRef.current = reactRender;
      areaRef.current = area;
      
      // Na v2.0, não há mais registro de componentes
      // Os nós são criados diretamente usando a função factory
      logger.debug('Sistema de nós configurado para v2.0');
      
      // CRÍTICO: Listener para atualizar conexões quando nós são movidos
      // Usa requestAnimationFrame para otimizar atualizações durante o arrasto
      let rafId = null;
      let isUpdating = false;
      const updateConnectionsOnNodeMove = () => {
        if (isUpdating) return; // Evita múltiplas atualizações simultâneas
        if (rafId) {
          cancelAnimationFrame(rafId);
        }
        rafId = requestAnimationFrame(() => {
          isUpdating = true;
          const connection = globalConnectionRef.current;
          const container = globalContainerRef.current;
          if (connection && container) {
            const svgElement = container.querySelector('svg');
            if (svgElement && editor) {
              updateConnectionPositions(editor, connection, svgElement);
            }
          }
          isUpdating = false;
          rafId = null;
        });
      };

      // Escuta eventos de movimento de nós no AreaPlugin
      area.addPipe((context) => {
        // Detecta quando um nó está sendo arrastado ou movido
        if (context.type === 'nodetranslate' || context.type === 'nodepicked' || 
            (context.type === 'pointermove' && context.data?.type === 'node') ||
            context.type === 'pointerdown' || context.type === 'pointerup') {
          updateConnectionsOnNodeMove();
        }
        return context;
      });

      // Escuta eventos de movimento do mouse durante o arrasto
      if (containerRef.current) {
        let isDragging = false;
        let dragTarget = null;
        
        containerRef.current.addEventListener('mousedown', (e) => {
          // Verifica se o clique foi em um nó
          const nodeElement = e.target.closest('[data-node-id]');
          if (nodeElement) {
            isDragging = true;
            dragTarget = nodeElement;
            updateConnectionsOnNodeMove();
          }
        }, true);

        containerRef.current.addEventListener('mousemove', (e) => {
          if (isDragging) {
            updateConnectionsOnNodeMove();
          }
        }, true);

        containerRef.current.addEventListener('mouseup', () => {
          if (isDragging) {
            isDragging = false;
            dragTarget = null;
            // Atualiza uma última vez quando soltar
            updateConnectionsOnNodeMove();
          }
        }, true);

        // Também escuta eventos de touch para dispositivos móveis
        containerRef.current.addEventListener('touchmove', () => {
          if (isDragging) {
            updateConnectionsOnNodeMove();
          }
        }, true);
      }

      // CRÍTICO: Usa requestAnimationFrame durante o arrasto para atualizar conexões
      // Isso garante que as conexões sejam atualizadas suavemente enquanto o nó é arrastado
      let updateAnimationFrameId = null;
      const startConnectionUpdates = () => {
        if (updateAnimationFrameId) return; // Já está atualizando
        
        const updateLoop = () => {
          const connection = globalConnectionRef.current;
          const container = globalContainerRef.current;
          if (connection && container) {
            const svgElement = container.querySelector('svg');
            if (svgElement && editor) {
              updateConnectionPositions(editor, connection, svgElement);
            }
          }
          
          // Continua o loop enquanto estiver arrastando
          if (updateAnimationFrameId) {
            updateAnimationFrameId = requestAnimationFrame(updateLoop);
          }
        };
        
        updateAnimationFrameId = requestAnimationFrame(updateLoop);
      };
      
      const stopConnectionUpdates = () => {
        if (updateAnimationFrameId) {
          cancelAnimationFrame(updateAnimationFrameId);
          updateAnimationFrameId = null;
          // Atualiza uma última vez quando parar
          updateConnectionsOnNodeMove();
        }
      };

      // Escuta eventos de início e fim de arrasto
      if (containerRef.current) {
        containerRef.current.addEventListener('mousedown', (e) => {
          const nodeElement = e.target.closest('[data-node-id]');
          if (nodeElement) {
            startConnectionUpdates();
          }
        }, true);

        containerRef.current.addEventListener('mouseup', () => {
          stopConnectionUpdates();
        }, true);

        // Também para quando o mouse sai do container
        containerRef.current.addEventListener('mouseleave', () => {
          stopConnectionUpdates();
        }, true);
      }

      // Configura seleção de nós via AreaPlugin
      // O AreaPlugin tem eventos de seleção que podemos usar
      area.addPipe((context) => {
        // Detecta cliques em nós
        if (context.type === 'nodepicked' || context.type === 'nodeclick') {
          const nodeFromEvent = context.data?.node || context.data;
          if (nodeFromEvent && typeof onNodeSelectedRef.current === 'function') {
            // IMPORTANTE: O Rete.js v2.0 pode retornar apenas o ID no evento
            // Precisamos buscar o nó completo do editor usando getNode
            const nodeId = nodeFromEvent.id || nodeFromEvent;
            const node = editor.getNode(nodeId);
            
            if (!node) {
              logger.warn('Nó não encontrado no editor', { nodeId });
              return context;
            }
            
            // Log detalhado do nó completo para debug
            logger.debug('Nó completo ao selecionar', {
              nodeId: node.id,
              nodeKeys: Object.keys(node),
              hasData: !!node.data,
              dataKeys: node.data ? Object.keys(node.data) : [],
              dataType: node.data?.type,
              dataConfig: node.data?.config,
              nodeFromEvent: nodeFromEvent,
            });
            
            // Garante que o config seja lido corretamente do nó
            const nodeConfig = node.data?.config || {};
            const nodeData = {
              id: String(node.id),
              type: node.data?.type || 'unknown',
              config: nodeConfig,
            };
            logger.debug('Nó selecionado', {
              nodeData,
              nodeId: node.id,
              nodeType: node.data?.type,
              hasConfig: !!node.data?.config,
              configKeys: Object.keys(nodeConfig),
              configValue: nodeConfig,
            });
            onNodeSelectedRef.current(nodeData);
          }
        }
        return context;
      });
      
      // Rastreia posição do mouse para detectar cliques reais vs toques acidentais
      const handleMouseDown = (e) => {
        mouseDownPositionRef.current = {
          x: e.clientX,
          y: e.clientY,
          time: Date.now(),
        };
      };
      mouseDownHandlerRef.current = handleMouseDown;
      
      // Escuta eventos de clique diretamente no container para detectar seleção de nós
      const handleContainerClick = (e) => {
        // Verifica se é um clique real (não apenas um toque acidental)
        const now = Date.now();
        const timeSinceMouseDown = now - mouseDownPositionRef.current.time;
        const distance = Math.sqrt(
          Math.pow(e.clientX - mouseDownPositionRef.current.x, 2) +
          Math.pow(e.clientY - mouseDownPositionRef.current.y, 2)
        );
        
        // Ignora se foi um movimento muito grande (arraste) ou muito rápido (toque acidental)
        // ou se passou muito tempo desde o mousedown (não é um clique válido)
        if (distance > 5 || timeSinceMouseDown > 500 || timeSinceMouseDown < 0) {
          logger.debug('Clique ignorado (movimento muito grande ou muito rápido)', {
            distance,
            timeSinceMouseDown,
            mouseDown: mouseDownPositionRef.current,
            click: { x: e.clientX, y: e.clientY }
          });
          return;
        }
        
        logger.debug('Clique detectado no container', { 
          target: e.target?.tagName, 
          className: e.target?.className,
          closestNode: e.target?.closest('[data-node-id]')?.getAttribute('data-node-id'),
          distance,
          timeSinceMouseDown
        });
        
        // Primeiro, verifica se o clique está dentro de um nó (incluindo elementos filhos como inputs/outputs)
        // Procura por data-node-id em qualquer elemento pai (incluindo elementos mais distantes)
        let nodeElement = e.target.closest('[data-node-id]');
        
        // Se não encontrou, tenta verificar todos os elementos pais manualmente
        // (pode ser que o Rete.js renderize em uma estrutura diferente)
        if (!nodeElement) {
          let current = e.target;
          let depth = 0;
          const maxDepth = 10; // Limita a profundidade para evitar loops infinitos
          
          while (current && depth < maxDepth) {
            if (current.hasAttribute && current.hasAttribute('data-node-id')) {
              nodeElement = current;
              logger.debug('Nó encontrado em elemento pai', { 
                depth, 
                tagName: current.tagName,
                className: current.className,
                nodeId: current.getAttribute('data-node-id')
              });
              break;
            }
            current = current.parentElement;
            depth++;
          }
        }
        
        // Ignora cliques em sockets ou conexões (mas não deseleciona se estiver dentro de um nó)
        if (e.target.closest('.socket') || e.target.closest('.connection')) {
          logger.debug('Clique ignorado (socket ou conexão)');
          return;
        }
        
        // Primeiro, tenta detectar evento customizado do componente
        if (e.detail && e.detail.nodeId) {
          const node = editor.getNode(e.detail.nodeId);
          if (node && typeof onNodeSelectedRef.current === 'function') {
            // Garante que o config seja lido corretamente do nó
            const nodeConfig = node.data?.config || {};
            const nodeData = {
              id: String(node.id),
              type: node.data?.type || 'unknown',
              config: nodeConfig,
            };
            logger.debug('Nó selecionado via evento customizado', {
              nodeData,
              nodeId: node.id,
              nodeType: node.data?.type,
              hasConfig: !!node.data?.config,
              configKeys: Object.keys(nodeConfig),
              configValue: nodeConfig,
            });
            onNodeSelectedRef.current(nodeData);
            e.stopPropagation();
            return;
          }
        }
        
        // Fallback: Encontra o elemento do nó clicado
        if (nodeElement) {
          const nodeId = nodeElement.getAttribute('data-node-id');
          logger.debug('Elemento do nó encontrado', { nodeId, element: nodeElement, targetClass: e.target?.className });
          if (nodeId) {
            const node = editor.getNode(nodeId);
            if (node && typeof onNodeSelectedRef.current === 'function') {
              // Garante que o config seja lido corretamente do nó
              const nodeConfig = node.data?.config || {};
              const nodeData = {
                id: String(node.id),
                type: node.data?.type || 'unknown',
                config: nodeConfig,
              };
              logger.debug('Nó selecionado via closest', {
                nodeData,
                nodeId: node.id,
                nodeType: node.data?.type,
                hasConfig: !!node.data?.config,
                configKeys: Object.keys(nodeConfig),
                configValue: nodeConfig,
              });
              onNodeSelectedRef.current(nodeData);
              e.stopPropagation(); // Evita que o evento continue propagando
            } else {
              logger.warn('Nó não encontrado ou callback não disponível', { nodeId, hasNode: !!node, hasCallback: typeof onNodeSelectedRef.current === 'function' });
            }
          }
          // Se encontrou um nó, não deseleciona (mesmo que seja um elemento filho como input/output)
          return;
        }
        
        // Verifica se está dentro de qualquer parte de um nó (inputs, outputs, title, etc)
        // Procura por elementos que são claramente parte de um nó
        // Verifica também elementos renderizados pelo ReactPlugin que podem não ter data-node-id direto
        let isInsideNode = false;
        
        // Verifica se está dentro de um elemento com data-node-id
        if (e.target.closest('[data-node-id]')) {
          isInsideNode = true;
        }
        
        // Verifica se o próprio elemento ou seus pais têm classes que indicam que são parte de um nó
        // Isso é importante porque o ReactPlugin pode renderizar em uma estrutura diferente
        const targetClass = typeof e.target?.className === 'string' ? e.target.className : '';
        const isNodeElement = targetClass.includes('output') || 
                             targetClass.includes('input') || 
                             targetClass.includes('title') ||
                             targetClass === 'title' ||
                             targetClass === 'output' ||
                             targetClass === 'input';
        
        if (isNodeElement) {
          // Se é um elemento que só existe dentro de nós, verifica se há um nó em qualquer lugar acima
          let checkParent = e.target.parentElement;
          let checkDepth = 0;
          while (checkParent && checkDepth < 20) {
            if (checkParent.hasAttribute && checkParent.hasAttribute('data-node-id')) {
              isInsideNode = true;
              logger.debug('Nó encontrado acima de elemento do nó', {
                depth: checkDepth,
                tagName: checkParent.tagName,
                className: checkParent.className,
                nodeId: checkParent.getAttribute('data-node-id'),
                targetClass
              });
              break;
            }
            checkParent = checkParent.parentElement;
            checkDepth++;
          }
          
          // Se não encontrou, mas é um elemento que só existe dentro de nós, assume que está dentro de um nó
          // (elementos output/input/title só existem dentro de nós)
          if (!isInsideNode) {
            logger.debug('Elemento do nó detectado, assumindo que está dentro de nó', {
              targetClass,
              checkedDepth: checkDepth
            });
            isInsideNode = true; // Assume que está dentro de um nó
          }
        }
        
        // Verifica se está dentro de elementos que são parte de um nó (inputs, outputs)
        if (e.target.closest('.inputs, .outputs')) {
          isInsideNode = true;
        }
        
        // Verifica recursivamente nos elementos pais (pode ser que o ReactPlugin renderize em estrutura diferente)
        if (!isInsideNode) {
          let checkParent = e.target.parentElement;
          let checkDepth = 0;
          while (checkParent && checkDepth < 20) {
            if (checkParent.hasAttribute && checkParent.hasAttribute('data-node-id')) {
              isInsideNode = true;
              logger.debug('Nó encontrado em verificação recursiva', {
                depth: checkDepth,
                tagName: checkParent.tagName,
                className: checkParent.className
              });
              break;
            }
            // Verifica se o elemento pai tem classes que indicam que é parte de um nó
            const parentClass = checkParent.className || '';
            if (typeof parentClass === 'string' && (
              parentClass.includes('inputs') ||
              parentClass.includes('outputs') ||
              parentClass.includes('title') ||
              parentClass.includes('node')
            )) {
              // Se encontrou um elemento com essas classes, verifica se há um nó acima
              const nodeAbove = checkParent.closest('[data-node-id]');
              if (nodeAbove) {
                isInsideNode = true;
                logger.debug('Nó encontrado acima de elemento com classe de nó', {
                  depth: checkDepth,
                  parentClass,
                  nodeId: nodeAbove.getAttribute('data-node-id')
                });
                break;
              }
            }
            checkParent = checkParent.parentElement;
            checkDepth++;
          }
        }
        
        if (!isInsideNode && typeof onNodeSelectedRef.current === 'function') {
          logger.debug('Deselecionando nó (clique fora)', {
            target: e.target?.tagName,
            className: e.target?.className,
            parent: e.target?.parentElement?.tagName,
            parentClass: e.target?.parentElement?.className
          });
          onNodeSelectedRef.current(null);
        } else {
          logger.debug('Clique ignorado (dentro de elemento do nó)', { 
            isInsideNode,
            targetClass: e.target?.className,
            targetTag: e.target?.tagName,
            parentTag: e.target?.parentElement?.tagName,
            parentClass: e.target?.parentElement?.className
          });
        }
      };
      
      // Adiciona listeners no container
      if (containerRef.current) {
        containerClickHandlerRef.current = handleContainerClick;
        // Adiciona listener de mousedown para rastrear posição inicial
        containerRef.current.addEventListener('mousedown', handleMouseDown, true);
        // Adiciona listener de clique
        containerRef.current.addEventListener('click', containerClickHandlerRef.current, true); // Use capture phase
        // Também escuta eventos customizados
        containerRef.current.addEventListener('nodeclick', handleContainerClick, true);
        logger.debug('Listeners de clique adicionados ao container');
      }
      
      // Marca o editor como pronto
      logger.debug('Marcando editor como pronto');
      lastLoadedJsonRef.current = null; // Reset para permitir carregamento inicial
      setEditorReady(true);
      logger.debug('Editor marcado como pronto', { 
        editorReady: true
      });

      // Eventos padronizados
      const emit = (type, payload) => {
        if (typeof onEventRef.current === 'function') {
          onEventRef.current({ type, payload, timestamp: new Date().toISOString() });
        }
      };

      function notifyChange() {
        // Não notifica mudanças durante carregamento de JSON para evitar loops
        if (isLoadingJsonRef.current) {
          return;
        }
        if (typeof onFlowChangedRef.current === 'function') {
          // Na v2.0, precisamos construir o JSON manualmente
          const nodes = editor.getNodes();
          const connections = editor.getConnections();
          const area = areaRef.current;
          
          const data = {
            id: 'chatbot-flow@0.1.0',
            nodes: nodes.reduce((acc, node) => {
              // Na v2.0, a posição é obtida do nodeView do AreaPlugin
              const nodeView = area?.nodeViews?.get(node.id);
              // O nodeView tem uma propriedade position que é um objeto {x, y}
              const position = nodeView?.position ? [nodeView.position.x, nodeView.position.y] : [0, 0];
              
              acc[node.id] = {
                id: node.id,
                data: node.data,
                inputs: Object.fromEntries(
                  Object.entries(node.inputs || {}).map(([key]) => [
                    key,
                    {
                      connections: connections
                        .filter(c => c.target === node.id && c.targetInput === key)
                        .map(c => ({ node: c.source, input: c.sourceOutput }))
                    }
                  ])
                ),
                outputs: Object.fromEntries(
                  Object.entries(node.outputs || {}).map(([key]) => [
                    key,
                    {
                      connections: connections
                        .filter(c => c.source === node.id && c.sourceOutput === key)
                        .map(c => ({ node: c.target, input: c.targetInput }))
                    }
                  ])
                ),
                position,
                name: 'FlowNode'
              };
              return acc;
            }, {})
          };
          
          logger.debug('Editor JSON atualizado', { 
            nodeCount: nodes.length 
          });
          onFlowChangedRef.current(data);
        }
      }
      
      // Expõe notifyChange para uso externo
      notifyChangeRef.current = notifyChange;

      // Na v2.0, os eventos são tratados via pipes (signals)
      editor.addPipe((context) => {
        if (context.type === 'nodecreated') {
          emit('NODE_CREATED', serializeNode(context.data));
          notifyChange();
        } else if (context.type === 'noderemoved') {
          emit('NODE_REMOVED', serializeNode(context.data));
          notifyChange();
        } else if (context.type === 'connectioncreated') {
          logger.info('🔗 CONEXÃO CRIADA - Evento detectado', {
            connectionId: context.data?.id,
            source: context.data?.source,
            target: context.data?.target,
            sourceOutput: context.data?.sourceOutput,
            targetInput: context.data?.targetInput,
            connectionData: context.data,
          });
          
          // DEBUG: Verifica estado do editor e plugins
          const allConnections = editor.getConnections();
          logger.debug('🔍 Estado antes da validação', {
            totalConnections: allConnections.length,
            connectionIds: allConnections.map(c => c.id),
            hasConnectionPlugin: !!globalConnectionRef.current,
            hasArea: !!globalAreaRef.current,
            hasReactPlugin: !!reactRenderPluginRef.current,
          });
          
          const valid = validateConnection(context.data);
          if (!valid) {
            // Remove conexão inválida imediatamente
            logger.warn('❌ Conexão inválida removida', {
              connectionId: context.data?.id,
              source: context.data?.source,
              target: context.data?.target,
              sourceType: editor.getNode(context.data?.source)?.data?.type,
              targetType: editor.getNode(context.data?.target)?.data?.type,
            });
            editor.removeConnection(context.data.id);
            emit('CONNECTION_REJECTED', serializeConnection(context.data));
          } else {
            logger.info('✅ Conexão válida criada', {
              connectionId: context.data?.id,
              source: context.data?.source,
              target: context.data?.target,
              sourceOutput: context.data?.sourceOutput,
              targetInput: context.data?.targetInput,
            });
            emit('CONNECTION_CREATED', serializeConnection(context.data));
            notifyChange();
            
            // DEBUG DETALHADO: Verifica renderização da conexão
            setTimeout(() => {
              const container = globalContainerRef.current;
              if (!container) {
                logger.error('❌ Container não encontrado para verificar renderização');
                return;
              }
              
              const connection = globalConnectionRef.current;
              const area = globalAreaRef.current;
              
              // Verifica múltiplas formas de encontrar a conexão renderizada
              const connectionElement = container.querySelector(`[data-connection-id="${context.data?.id}"]`);
              const svgElement = container.querySelector('svg');
              const svgPaths = container.querySelectorAll('svg path');
              const svgGConnections = container.querySelectorAll('svg g.connection, svg g[class*="connection"]');
              const allSvgChildren = svgElement ? Array.from(svgElement.children) : [];
              
              // Verifica estilos CSS que podem estar ocultando
              const svgStyles = svgElement ? {
                display: window.getComputedStyle(svgElement).display,
                visibility: window.getComputedStyle(svgElement).visibility,
                opacity: window.getComputedStyle(svgElement).opacity,
                zIndex: window.getComputedStyle(svgElement).zIndex,
                position: window.getComputedStyle(svgElement).position,
              } : null;
              
              // Verifica paths individuais
              const pathStyles = svgPaths.length > 0 ? Array.from(svgPaths).slice(0, 3).map(path => ({
                display: window.getComputedStyle(path).display,
                visibility: window.getComputedStyle(path).visibility,
                opacity: window.getComputedStyle(path).opacity,
                stroke: window.getComputedStyle(path).stroke,
                strokeWidth: window.getComputedStyle(path).strokeWidth,
              })) : [];
              
              logger.info('🔍 DIAGNÓSTICO COMPLETO DE RENDERIZAÇÃO', {
                connectionId: context.data?.id,
                // Elementos encontrados
                hasConnectionElement: !!connectionElement,
                hasSvg: !!svgElement,
                svgPathsCount: svgPaths.length,
                svgGConnectionsCount: svgGConnections.length,
                allSvgChildrenCount: allSvgChildren.length,
                // Estado do editor
                allConnections: editor.getConnections().length,
                connectionExists: editor.getConnections().some(c => c.id === context.data?.id),
                // Estado dos plugins
                hasConnectionPlugin: !!connection,
                connectionPluginActive: connection?.active !== false,
                connectionPresetsCount: connection?.presets?.length || 0,
                hasArea: !!area,
                // Estilos CSS
                svgStyles,
                pathStyles: pathStyles.length > 0 ? pathStyles : 'Nenhum path encontrado',
                // Estrutura SVG
                svgChildrenTypes: allSvgChildren.map(child => ({
                  tagName: child.tagName,
                  className: child.className,
                  id: child.id,
                })),
                // Verifica se há elementos com classe connection
                connectionElements: container.querySelectorAll('.connection').length || 0,
                // Verifica atributos data
                dataConnectionElements: container.querySelectorAll('[data-connection-id]').length || 0,
              });
              
              // CRÍTICO: Se não há conexões SVG renderizadas, força renderização
              // No Rete.js v2, o preset classic do ReactPlugin deve renderizar conexões
              // mas pode precisar de um trigger manual
              if (svgPaths.length === 0) {
                logger.warn('⚠️ Nenhuma conexão SVG encontrada, forçando renderização', {
                  connectionId: context.data?.id,
                });
                
                // CRÍTICO: Força atualização do ConnectionPlugin para renderizar
                // O ConnectionPlugin precisa saber sobre a conexão para renderizá-la
                if (connection && typeof connection.update === 'function') {
                  try {
                    // Atualiza com a conexão específica
                    connection.update('connection', context.data);
                    logger.debug('✅ ConnectionPlugin.update chamado com conexão específica');
                    
                    // Aguarda um pouco e atualiza novamente para garantir
                    setTimeout(() => {
                      if (connection && typeof connection.update === 'function') {
                        connection.update();
                        logger.debug('✅ ConnectionPlugin.update() chamado novamente');
                      }
                    }, 100);
                  } catch (err) {
                    logger.warn('❌ Erro ao chamar connection.update', { error: err.message });
                  }
                }
                
                // Força atualização do area também
                if (areaRef.current && typeof areaRef.current.update === 'function') {
                  try {
                    areaRef.current.update('connection', context.data);
                    logger.debug('✅ AreaPlugin.update chamado com conexão específica');
                  } catch (err) {
                    logger.warn('❌ Erro ao chamar area.update', { error: err.message });
                  }
                }
                
                // CRÍTICO: Força re-renderização do ReactPlugin para garantir que as conexões sejam renderizadas
                // O ReactPlugin deve renderizar conexões automaticamente quando o connection é passado
                // Mas pode precisar de um trigger manual através do area
                if (areaRef.current) {
                  try {
                    const allConnections = editor.getConnections();
                    logger.debug('Forçando re-renderização através do area', {
                      connectionsCount: allConnections.length
                    });
                    
                    // Força atualização do area que deve triggerar o ReactPlugin
                    if (typeof areaRef.current.update === 'function') {
                      areaRef.current.update();
                      logger.debug('✅ AreaPlugin.update() chamado para forçar renderização');
                    }
                  } catch (err) {
                    logger.warn('Erro ao forçar atualização do area', { error: err.message });
                  }
                }
              } else if (svgPaths.length > 0) {
                logger.info('✅ Conexões SVG encontradas!', {
                  count: svgPaths.length,
                  connectionId: context.data?.id,
                });
              } else {
                // Se ainda não há paths após 200ms, tenta renderizar manualmente
                setTimeout(() => {
                  const connection = globalConnectionRef.current;
                  const svgEl = container.querySelector('svg');
                  if (connection && svgEl && editor) {
                    try {
                      renderConnectionsManually(editor, connection, svgEl);
                    } catch (err) {
                      logger.warn('Erro ao renderizar conexões manualmente após criar', { error: err.message });
                    }
                  }
                }, 300);
              }
            }, 200);
          }
        } else if (context.type === 'connectionremoved') {
          logger.debug('Conexão removida', {
            connectionId: context.data?.id,
          });
          emit('CONNECTION_REMOVED', serializeConnection(context.data));
          notifyChange();
        }
        return context;
      });

      function serializeNode(node) {
        return {
          id: node.id,
          type: node.data.type || 'unknown',
          config: node.data.config || {},
        };
      }

      function serializeConnection(connection) {
        return {
          id: connection.id,
          from: {
            nodeId: connection.source,
            output: connection.sourceOutput,
          },
          to: {
            nodeId: connection.target,
            input: connection.targetInput,
          },
        };
      }

      function validateConnection(connection) {
        const sourceNode = editor.getNode(connection.source);
        const targetNode = editor.getNode(connection.target);
        
        if (!sourceNode || !targetNode) return false;
        
        const fromType = sourceNode.data?.type;
        const toType = targetNode.data?.type;

        const allowedTargets = CONNECTION_RULES[fromType] || [];
        return allowedTargets.includes(toType);
      }

      function getDefaultConfig(nodeType) {
        const defaults = {
          message: { text: '' },
          user_input: { variable: 'user_input' },
          handoff: { queue: 'default' },
          router: { rules: [] },
          set_variable: { assignments: {} },
          ai: { promptTemplate: '', outputVariable: 'ai_output' },
        };
        return defaults[nodeType] || {};
      }

      // Suporte para drag and drop de nós
      const handleDrop = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const nodeType = e.dataTransfer.getData('application/node-type') || e.dataTransfer.getData('text/plain');
        if (!nodeType) return;

        const rect = containerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Converter coordenadas da viewport para coordenadas do editor
        const area = areaRef.current;
        if (!area) return;
        
        const transform = area.area.transform;
        const zoom = transform.k || 1;
        const panX = transform.x || 0;
        const panY = transform.y || 0;

        const editorX = (x - panX) / zoom;
        const editorY = (y - panY) / zoom;

        // Criar novo nó usando a função factory
        const node = createFlowNode({
          type: nodeType,
          config: getDefaultConfig(nodeType),
        });

        // Na v2.0, a posição é definida via translate
        await editor.addNode(node);
        
        // Traduz o nó para a posição correta
        if (areaRef.current) {
          await areaRef.current.translate(node.id, { x: editorX, y: editorY });
        }
        
        notifyChange();
      };

      const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
      };

      if (containerRef.current) {
        containerRef.current.addEventListener('drop', handleDrop);
        containerRef.current.addEventListener('dragover', handleDragOver);
      }

      // Garante que o container está visível antes de fazer resize
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        logger.debug('Container do editor', {
          width: rect.width,
          height: rect.height,
          visible: rect.width > 0 && rect.height > 0
        });
      }
      
      // Na v2.0, o resize é feito no AreaPlugin
      if (area) {
        area.resize();
      }
      
      // Aguarda um frame para garantir que o DOM está pronto
      await new Promise(resolve => setTimeout(resolve, 50));
      
      logger.debug('Inicialização do editor concluída');
    }

    init().catch((err) => {
      logger.error('Erro durante inicialização do editor', err);
    });

    return () => {
      destroyed = true;
      setEditorReady(false); // Reset quando o editor é destruído
      lastLoadedJsonRef.current = null; // Reset para permitir recarregamento
      
      // Na v2.0, não há método destroy()
      // Apenas limpamos as referências
      // Os plugins serão limpos automaticamente quando o componente for desmontado
      if (editorRef.current) {
        // Limpa todos os nós e conexões
        const nodes = editorRef.current.getNodes();
        const connections = editorRef.current.getConnections();
        
        for (const connection of connections) {
          try {
            editorRef.current.removeConnection(connection.id);
          } catch (err) {
            // Ignora erros ao remover conexões
          }
        }
        
        for (const node of nodes) {
          try {
            editorRef.current.removeNode(node.id);
          } catch (err) {
            // Ignora erros ao remover nós
          }
        }
        
        editorRef.current = null;
      }
      
      // Remove listeners do container
      if (containerRef.current) {
        if (containerClickHandlerRef.current) {
          containerRef.current.removeEventListener('click', containerClickHandlerRef.current, true);
          containerRef.current.removeEventListener('nodeclick', containerClickHandlerRef.current, true);
          containerClickHandlerRef.current = null;
        }
        if (mouseDownHandlerRef.current) {
          containerRef.current.removeEventListener('mousedown', mouseDownHandlerRef.current, true);
          mouseDownHandlerRef.current = null;
        }
      }
      
      // Limpa referências dos plugins
      reactRenderPluginRef.current = null;
      areaRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Executa apenas uma vez na montagem

  // Força re-renderização dos nós quando selectedNodeId mudar
  useEffect(() => {
    if (!reactRenderPluginRef.current || !editorRef.current || !areaRef.current) return;
    
    // IMPORTANTE: Atualiza a ref global ANTES de forçar re-renderização
    globalSelectedNodeIdRef.current = selectedNodeId;
    
    logger.debug('Forçando re-renderização para selectedNodeId', { 
      selectedNodeId, 
      selectedNodeIdType: typeof selectedNodeId,
      hasReactRender: !!reactRenderPluginRef.current,
      hasEditor: !!editorRef.current,
      hasArea: !!areaRef.current,
    });
    
    // Força atualização de todos os nós para refletir mudança de seleção
    // O ReactPlugin deve re-renderizar automaticamente quando o contexto muda
    // Mas forçamos uma atualização explícita para garantir
    const nodes = editorRef.current.getNodes();
    
    nodes.forEach(node => {
      try {
        const nodeIdStr = String(node.id);
        const selectedIdStr = selectedNodeId ? String(selectedNodeId) : null;
        const isNodeSelected = selectedIdStr === nodeIdStr;
        
        // Tenta atualizar via ReactPlugin se disponível
        if (reactRenderPluginRef.current && typeof reactRenderPluginRef.current.update === 'function') {
          reactRenderPluginRef.current.update('node', node.id);
        }
        // Também tenta forçar atualização via área
        const nodeView = areaRef.current.nodeViews?.get(node.id);
        if (nodeView && typeof nodeView.update === 'function') {
          nodeView.update();
        }
        
        if (isNodeSelected) {
          logger.debug('Nó selecionado encontrado, forçando atualização', { 
            nodeId: node.id, 
            nodeIdStr,
            selectedIdStr,
          });
        }
      } catch (err) {
        // Ignora erros se o método não existir
        logger.debug('Erro ao atualizar nó', { nodeId: node.id, error: err });
      }
    });
    
    logger.debug('Re-renderização forçada concluída', { 
      selectedNodeId, 
      nodeCount: nodes.length,
    });
  }, [selectedNodeId]);

  // Aplica estilos do tema quando o tema mudar
  useEffect(() => {
    if (!containerRef.current) return;
    
    // Remove estilos antigos
    const oldStyle = containerRef.current.querySelector('style[data-theme-styles]');
    if (oldStyle) {
      oldStyle.remove();
    }
    
    // Adiciona novos estilos
    const style = document.createElement('style');
    style.setAttribute('data-theme-styles', 'true');
    style.textContent = `
      /* Conectores: curvas suaves (Bezier), estados visuais melhorados */
      .connection,
      .connection path,
      path.connection {
        stroke: ${theme.colors.accent.primary} !important;
        stroke-width: 2.5px !important;
        fill: none !important;
        transition: stroke-width 0.2s cubic-bezier(0.4, 0, 0.2, 1), 
                    stroke 0.2s cubic-bezier(0.4, 0, 0.2, 1),
                    opacity 0.2s ease !important;
        opacity: 0.85 !important;
        pointer-events: stroke !important;
        cursor: pointer !important;
      }
      
      .connection:hover,
      .connection:hover path,
      path.connection:hover {
        stroke: ${theme.colors.accent.hover} !important;
        stroke-width: 3.5px !important;
        opacity: 1 !important;
        filter: drop-shadow(0 0 3px ${theme.colors.accent.primary}60) !important;
      }
      
      .connection.selected,
      .connection.selected path,
      path.connection.selected {
        stroke: ${theme.colors.accent.primary} !important;
        stroke-width: 3.5px !important;
        opacity: 1 !important;
        filter: drop-shadow(0 0 6px ${theme.colors.accent.primary}80) !important;
        animation: connection-pulse 2s ease-in-out infinite !important;
      }
      
      @keyframes connection-pulse {
        0%, 100% {
          opacity: 1;
          filter: drop-shadow(0 0 6px ${theme.colors.accent.primary}80);
        }
        50% {
          opacity: 0.9;
          filter: drop-shadow(0 0 8px ${theme.colors.accent.primary}60);
        }
      }
      
      .connection.error,
      .connection.error path,
      path.connection.error {
        stroke: ${theme.colors.status.error} !important;
        stroke-width: 3px !important;
        stroke-dasharray: 8,4 !important;
        opacity: 0.9 !important;
        animation: connection-error-pulse 1.5s ease-in-out infinite !important;
      }
      
      @keyframes connection-error-pulse {
        0%, 100% {
          opacity: 0.9;
        }
        50% {
          opacity: 0.6;
        }
      }
      
      /* Caminho da conexão (path SVG) */
      .connection-path,
      path.connection-path {
        fill: none !important;
        stroke: ${theme.colors.accent.primary} !important;
        stroke-width: 2.5px !important;
        transition: stroke-width 0.2s cubic-bezier(0.4, 0, 0.2, 1), 
                    stroke 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
        opacity: 0.85 !important;
        pointer-events: stroke !important;
      }
      
      .connection-path:hover,
      path.connection-path:hover {
        stroke: ${theme.colors.accent.hover} !important;
        stroke-width: 3.5px !important;
        opacity: 1 !important;
      }
      
      /* Pontos de conexão (endpoints) */
      .connection-point,
      circle.connection-point {
        fill: ${theme.colors.accent.primary} !important;
        stroke: ${theme.colors.bg.elevated || theme.colors.bg.tertiary} !important;
        stroke-width: 2.5px !important;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
        cursor: pointer !important;
        r: 4 !important;
      }
      
      .connection-point:hover,
      circle.connection-point:hover {
        fill: ${theme.colors.accent.hover} !important;
        transform: scale(1.3) !important;
        r: 5 !important;
        filter: drop-shadow(0 0 4px ${theme.colors.accent.primary}80) !important;
      }
      
      /* Sockets - melhorados para usar tema */
      .socket {
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
        cursor: pointer !important;
      }
      
      .socket.input-socket,
      .socket[data-socket-type="input"] {
        background-color: ${theme.colors.accent.primary} !important;
        border-color: ${theme.colors.bg.elevated || theme.colors.bg.tertiary} !important;
      }
      
      .socket.output-socket,
      .socket[data-socket-type="output"] {
        background-color: ${theme.colors.status.success} !important;
        border-color: ${theme.colors.bg.elevated || theme.colors.bg.tertiary} !important;
      }
      
      .socket:hover {
        transform: scale(1.4) !important;
        box-shadow: 0 4px 12px rgba(94, 106, 210, 0.6) !important;
        z-index: 100 !important;
      }
      
      .socket.input-socket:hover,
      .socket[data-socket-type="input"]:hover {
        background-color: ${theme.colors.accent.hover} !important;
        box-shadow: 0 4px 12px ${theme.colors.accent.primary}80 !important;
      }
      
      .socket.output-socket:hover,
      .socket[data-socket-type="output"]:hover {
        background-color: ${theme.colors.status.success} !important;
        box-shadow: 0 4px 12px ${theme.colors.status.success}80 !important;
      }
      
      /* Linha temporária durante arraste de conexão */
      .connection-temp,
      path.connection-temp {
        stroke: ${theme.colors.accent.primary} !important;
        stroke-width: 2.5px !important;
        stroke-dasharray: 5,5 !important;
        opacity: 0.7 !important;
        fill: none !important;
        pointer-events: none !important;
      }
      
      /* Melhorias para light mode */
      ${(theme && theme.name === 'light') ? `
        .connection,
        .connection path,
        path.connection {
          opacity: 0.75 !important;
        }
        .connection:hover,
        .connection:hover path,
        path.connection:hover {
          opacity: 1 !important;
        }
      ` : ''}
      
      :root {
        --node-bg: ${theme.colors.bg.tertiary};
        --node-text: ${theme.colors.text.primary};
        --node-text-secondary: ${theme.colors.text.tertiary};
        --node-border: ${theme.colors.border.default};
        --socket-color: ${theme.colors.accent.primary};
        --socket-hover: ${theme.colors.accent.hover};
        --connection-color: ${theme.colors.accent.primary};
        --connection-hover: ${theme.colors.accent.hover};
      }
    `;
    containerRef.current.appendChild(style);
  }, [theme]);

  // Carrega o JSON quando initialFlowJson mudar e editor estiver pronto
  useEffect(() => {
    if (!editorReady || !editorRef.current || !initialFlowJson) {
      if (initialFlowJson && (!editorReady || !editorRef.current)) {
        logger.debug('Aguardando inicialização do editor antes de carregar JSON', {
          editorReady,
          hasEditor: !!editorRef.current
        });
      }
      return;
    }
    
    async function loadJson() {
      const editor = editorRef.current;
      const area = areaRef.current;
      
      if (!editor || !area) {
        logger.warn('Editor ou área não disponível ao tentar carregar JSON', {
          hasEditor: !!editor,
          hasArea: !!area
        });
        return;
      }
      
      // Verifica se o container está visível e aguarda se necessário
      if (containerRef.current) {
        let containerRect = containerRef.current.getBoundingClientRect();
        if (containerRect.width === 0 || containerRect.height === 0) {
          logger.warn('Container do editor não está visível, aguardando...', {
            width: containerRect.width,
            height: containerRect.height
          });
          
          // Aguarda até que o container esteja visível (máximo 5 segundos)
          let attempts = 0;
          const maxAttempts = 50; // 50 tentativas * 100ms = 5 segundos
          
          while ((containerRect.width === 0 || containerRect.height === 0) && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 100));
            if (containerRef.current) {
              containerRect = containerRef.current.getBoundingClientRect();
              if (containerRect.width > 0 && containerRect.height > 0) {
                logger.debug('Container do editor agora está visível', {
                  width: containerRect.width,
                  height: containerRect.height,
                  attempts
                });
                break;
              }
            }
            attempts++;
          }
          
          if (attempts >= maxAttempts) {
            logger.warn('Container do editor ainda não está visível após aguardar, continuando mesmo assim', {
              width: containerRect.width,
              height: containerRect.height
            });
          }
        } else {
          logger.debug('Container do editor está visível', {
            width: containerRect.width,
            height: containerRect.height
          });
        }
      }

      // Verifica se já carregamos este JSON recentemente (evita loops)
      // Mas permite carregar se o editor estiver vazio ou se o ID do fluxo mudou
      const currentNodes = editor.getNodes();
      const flowId = initialFlowJson.id || JSON.stringify(initialFlowJson);
      const jsonString = JSON.stringify(initialFlowJson);
      
      // Se o editor está vazio, sempre carrega
      if (currentNodes.length === 0) {
        logger.debug('Editor vazio, carregando JSON', {
          flowId: initialFlowJson.id,
          nodeCount: initialFlowJson.nodes ? Object.keys(initialFlowJson.nodes).length : 0
        });
      } else if (lastLoadedJsonRef.current === jsonString) {
        // Se já carregamos exatamente este JSON, não recarrega (evita loops)
        logger.debug('JSON já carregado, pulando recarregamento', {
          flowId: initialFlowJson.id,
          nodeCount: initialFlowJson.nodes ? Object.keys(initialFlowJson.nodes).length : 0,
          editorNodesCount: currentNodes.length
        });
        return;
      } else {
        logger.debug('JSON diferente detectado, recarregando', {
          flowId: initialFlowJson.id,
          nodeCount: initialFlowJson.nodes ? Object.keys(initialFlowJson.nodes).length : 0,
          editorNodesCount: currentNodes.length
        });
      }

      logger.debug('Carregando JSON no editor Rete', { 
        hasNodes: !!initialFlowJson.nodes,
        nodeCount: initialFlowJson.nodes ? Object.keys(initialFlowJson.nodes).length : 0,
        nodeIds: initialFlowJson.nodes ? Object.keys(initialFlowJson.nodes) : [],
        firstNode: initialFlowJson.nodes ? Object.values(initialFlowJson.nodes)[0] : null,
        jsonStructure: {
          hasId: !!initialFlowJson.id,
          id: initialFlowJson.id,
          nodesType: typeof initialFlowJson.nodes,
          nodesIsObject: initialFlowJson.nodes && typeof initialFlowJson.nodes === 'object',
        }
      });
      
      try {
        // Desabilita notificações durante carregamento
        isLoadingJsonRef.current = true;
        
        // CRÍTICO: Limpa conexões e paths SVG antes de remover nós
        // Isso garante que não haja conexões órfãs ou paths SVG antigos
        const existingConnections = editor.getConnections();
        logger.debug('Limpando conexões antigas antes de carregar novo fluxo', {
          connectionsCount: existingConnections.length
        });
        
        // Remove todas as conexões
        for (const connection of existingConnections) {
          try {
            await editor.removeConnection(connection.id);
          } catch (err) {
            logger.warn('Erro ao remover conexão durante limpeza', {
              connectionId: connection.id,
              error: err.message
            });
          }
        }
        
        // CRÍTICO: Limpa paths SVG do DOM
        if (containerRef.current) {
          const svgElement = containerRef.current.querySelector('svg');
          if (svgElement) {
            // Remove todos os paths de conexões
            const existingPaths = svgElement.querySelectorAll('path[data-connection-id]');
            existingPaths.forEach(path => path.remove());
            logger.debug('Paths SVG antigos removidos', {
              pathsRemoved: existingPaths.length
            });
          }
        }
        
        // Limpa nós existentes antes de carregar
        const existingNodes = editor.getNodes();
        logger.debug('Limpando nós antigos antes de carregar novo fluxo', {
          nodesCount: existingNodes.length
        });
        
        for (const node of existingNodes) {
          try {
            await editor.removeNode(node.id);
          } catch (err) {
            logger.warn('Erro ao remover nó durante limpeza', {
              nodeId: node.id,
              error: err.message
            });
          }
        }
        
        // CRÍTICO: Limpa o socketsCache do ConnectionPlugin
        // Isso garante que sockets antigos não interfiram com os novos
        const connection = globalConnectionRef.current;
        if (connection && connection.socketsCache) {
          connection.socketsCache.clear();
          logger.debug('socketsCache limpo', {
            cacheSize: connection.socketsCache.size
          });
        }
        
        // Aguarda um pouco para garantir que a limpeza foi processada
        await new Promise(resolve => setTimeout(resolve, 50));

        if (!initialFlowJson.nodes || Object.keys(initialFlowJson.nodes).length === 0) {
          logger.debug('JSON sem nós para carregar');
          if (area) {
            area.resize();
          }
          isLoadingJsonRef.current = false;
          return;
        }

        // Cria os nós manualmente usando a função factory
        const nodesToAdd = [];
        const nodeMap = new Map(); // Mapeia IDs antigos para novos nós
        
        for (const [nodeId, nodeData] of Object.entries(initialFlowJson.nodes)) {
          try {
            // Cria o nó usando a função factory
            const nodeConfig = nodeData.data?.config || {};
            const node = createFlowNode({
              type: nodeData.data?.type || 'unknown',
              config: nodeConfig,
            });
            
            // Define o ID
            node.id = String(nodeData.id);
            
            // Verifica se o componente foi definido corretamente
            logger.debug(`Nó criado`, { 
              id: node.id, 
              type: node.data?.type,
              position: nodeData.position,
              hasConfig: !!node.data?.config,
              configKeys: Object.keys(node.data?.config || {}),
              configValue: node.data?.config,
              originalConfig: nodeConfig,
            });
            
            nodesToAdd.push(node);
            nodeMap.set(String(nodeData.id), node);
          } catch (err) {
            logger.error(`Erro ao criar nó ${nodeId}`, err);
          }
        }

        // Adiciona todos os nós ao editor
        for (const node of nodesToAdd) {
          const nodeData = initialFlowJson.nodes[node.id];
          const position = nodeData?.position || [0, 0];
          
          // Log antes de adicionar ao editor
          logger.debug('Nó antes de adicionar ao editor', {
            nodeId: node.id,
            nodeType: node.data?.type,
            nodeConfig: node.data?.config,
            hasData: !!node.data,
            dataKeys: node.data ? Object.keys(node.data) : [],
          });
          
          await editor.addNode(node);
          
          // Log após adicionar ao editor para verificar se o data foi preservado
          const nodeAfterAdd = editor.getNode(node.id);
          logger.debug('Nó após adicionar ao editor', {
            nodeId: node.id,
            nodeType: nodeAfterAdd?.data?.type,
            nodeConfig: nodeAfterAdd?.data?.config,
            hasData: !!nodeAfterAdd?.data,
            dataKeys: nodeAfterAdd?.data ? Object.keys(nodeAfterAdd.data) : [],
          });
          
          // Na v2.0, a posição é definida via translate no AreaPlugin
          // IMPORTANTE: Precisa aguardar um pouco para que a view do nó seja criada
          if (area && position && position.length === 2) {
            try {
              // Aguarda um pouco para garantir que a view foi criada
              await new Promise(resolve => setTimeout(resolve, 50));
              await area.translate(node.id, { x: position[0], y: position[1] });
            } catch (err) {
              logger.warn('Erro ao traduzir nó para posição', { 
                nodeId: node.id, 
                position,
                error: err.message 
              });
            }
          }
          
          logger.debug('Nó adicionado ao editor', { 
            nodeId: node.id, 
            type: node.data?.type,
            position: nodeData?.position,
          });
        }
        
        // Aguarda um pouco para que as views sejam criadas pelo AreaPlugin
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Verifica se o ReactPlugin está criando views
        const allNodesBefore = editor.getNodes();
        const areaNodeViewKeys = area?.nodeViews ? Array.from(area.nodeViews.keys()) : [];
        logger.debug('Verificação antes de forçar atualização', {
          totalNodes: allNodesBefore.length,
          nodesWithView: allNodesBefore.filter(n => n.view).length,
          areaNodeViews: areaNodeViewKeys,
          areaNodeViewsTypes: areaNodeViewKeys.map(k => typeof k),
          nodeIds: allNodesBefore.map(n => ({ id: n.id, idType: typeof n.id })),
          reactRenderPlugin: !!reactRenderPluginRef.current,
        });
        
        // Força atualização dos nós via ReactPlugin para garantir que sejam renderizados
        if (reactRenderPluginRef.current) {
          const allNodes = editor.getNodes();
          for (const node of allNodes) {
            try {
              // Tenta atualizar via ReactPlugin se disponível
              if (typeof reactRenderPluginRef.current.update === 'function') {
                reactRenderPluginRef.current.update('node', node.id);
              }
              // Também tenta forçar atualização via área
              // Verifica se area.nodeViews é um Map ou um objeto
              if (area && area.nodeViews) {
                let nodeView = null;
                const nodeIdStr = String(node.id);
                
                // Tenta diferentes formas de acessar a view
                if (area.nodeViews instanceof Map) {
                  nodeView = area.nodeViews.get(nodeIdStr);
                  if (!nodeView) {
                    nodeView = area.nodeViews.get(Number(node.id));
                  }
                } else if (typeof area.nodeViews === 'object') {
                  // Se for um objeto, tenta acessar como propriedade
                  nodeView = area.nodeViews[nodeIdStr];
                  if (!nodeView) {
                    nodeView = area.nodeViews[Number(node.id)];
                  }
                } else if (typeof area.nodeViews.get === 'function') {
                  // Se tiver método get, tenta usar
                  nodeView = area.nodeViews.get(nodeIdStr);
                  if (!nodeView) {
                    nodeView = area.nodeViews.get(Number(node.id));
                  }
                }
                
                if (nodeView && typeof nodeView.update === 'function') {
                  nodeView.update();
                  logger.debug('View do nó atualizada', { nodeId: node.id });
                } else {
                  // Tenta acessar a view usando diferentes formatos de ID
                  // O Rete.js pode usar string ou número como chave
                  const nodeIdVariants = [
                    String(node.id),
                    Number(node.id),
                    node.id,
                    `node-${node.id}`,
                    node.id.toString()
                  ];
                  
                  let foundView = null;
                  for (const variant of nodeIdVariants) {
                    if (area.nodeViews instanceof Map) {
                      foundView = area.nodeViews.get(variant);
                    } else if (typeof area.nodeViews === 'object') {
                      foundView = area.nodeViews[variant];
                    }
                    if (foundView) break;
                  }
                  
                  if (foundView && typeof foundView.update === 'function') {
                    foundView.update();
                    logger.debug('View do nó encontrada e atualizada', { nodeId: node.id });
                  } else {
                    // Não é crítico se a view não for encontrada imediatamente
                    // O ReactPlugin pode criar a view depois
                    logger.debug('View do nó ainda não disponível (pode ser criada depois)', { 
                      nodeId: node.id,
                      nodeIdType: typeof node.id
                    });
                  }
                }
              }
            } catch (err) {
              logger.warn('Erro ao forçar atualização do nó', { nodeId: node.id, error: err });
            }
          }
        }
        
        // Aguarda mais um pouco para que as views sejam criadas
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Log de verificação após adicionar todos os nós
        const allNodes = editor.getNodes();
        const container = containerRef.current;
        const svgElement = container?.querySelector('svg');
        const allSockets = container?.querySelectorAll('.socket, [data-socket-type]');
        
        logger.info('📊 DIAGNÓSTICO GERAL - Após adicionar todos os nós', {
          totalNodes: allNodes.length,
          nodesWithView: allNodes.filter(n => n.view).length,
          nodesWithComponent: allNodes.filter(n => n.data?.component).length,
          containerVisible: container ? 
            (container.offsetWidth > 0 && container.offsetHeight > 0) : false,
          containerSize: container ? {
            width: container.offsetWidth,
            height: container.offsetHeight
          } : null,
          sockets: {
            totalSockets: allSockets?.length || 0,
            inputSockets: container?.querySelectorAll('[data-socket-type="input"]').length || 0,
            outputSockets: container?.querySelectorAll('[data-socket-type="output"]').length || 0,
          },
          svg: {
            hasSvg: !!svgElement,
            svgChildren: svgElement ? svgElement.children.length : 0,
            svgPaths: svgElement ? svgElement.querySelectorAll('path').length : 0,
          },
          nodes: allNodes.map(n => ({
            id: n.id,
            type: n.data?.type,
            hasInputs: !!n.inputs,
            inputsCount: n.inputs ? (n.inputs instanceof Map ? n.inputs.size : Object.keys(n.inputs).length) : 0,
            hasOutputs: !!n.outputs,
            outputsCount: n.outputs ? (n.outputs instanceof Map ? n.outputs.size : Object.keys(n.outputs).length) : 0,
          })),
        });

        // CRÍTICO: Aguarda que todos os sockets estejam no DOM e vinculados antes de criar conexões
        // O ConnectionPlugin precisa que os sockets estejam vinculados para renderizar conexões
        // Aguarda mais tempo para garantir que o ReactPlugin renderize todos os nós e sockets
        logger.debug('Aguardando sockets estarem no DOM antes de criar conexões');
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Verifica se os sockets estão no DOM (reutiliza variáveis já declaradas acima)
        // container e allSockets já foram declarados acima, apenas atualizamos
        const currentSockets = container?.querySelectorAll('.socket, [data-socket-type]');
        logger.debug('Verificação de sockets no DOM', {
          totalSockets: currentSockets?.length || 0,
          inputSockets: container?.querySelectorAll('[data-socket-type="input"]').length || 0,
          outputSockets: container?.querySelectorAll('[data-socket-type="output"]').length || 0,
        });
        
        // Se não houver sockets, aguarda mais um pouco
        if (!currentSockets || currentSockets.length === 0) {
          logger.warn('Nenhum socket encontrado no DOM, aguardando mais tempo');
          await new Promise(resolve => setTimeout(resolve, 500));
          // Atualiza a referência após aguardar
          const updatedSockets = container?.querySelectorAll('.socket, [data-socket-type]');
          if (updatedSockets && updatedSockets.length > 0) {
            // Usa os sockets atualizados
          }
        }
        
        // CRÍTICO: Verifica se os sockets estão vinculados ao ConnectionPlugin
        // O ConnectionPlugin precisa que os sockets estejam no cache para renderizar conexões
        // Reutiliza a variável connection já declarada acima
        if (connection && connection.socketsCache) {
          const socketsCacheSize = connection.socketsCache.size;
          logger.debug('Verificação de sockets no cache do ConnectionPlugin', {
            socketsCacheSize,
            socketsInDOM: container?.querySelectorAll('.socket, [data-socket-type]').length || 0
          });
          
          // No Rete.js v2, os sockets são vinculados automaticamente pelo ReactPlugin preset
          // quando os nós são renderizados. Se não estão no cache, pode ser que ainda
          // não foram renderizados ou o preset não está configurado corretamente.
          if (socketsCacheSize === 0 && currentSockets && currentSockets.length > 0) {
            logger.warn('⚠️ Sockets no DOM mas não no cache do ConnectionPlugin', {
              socketsCount: currentSockets.length,
              hint: 'Isso pode ser normal se os sockets ainda não foram vinculados pelo ReactPlugin preset'
            });
            // Não tenta vincular manualmente - o ReactPlugin preset fará isso
          }
        }
        
        // Restaura as conexões
        let connectionsCreated = 0;
        let connectionsFailed = 0;
        
        logger.debug('Iniciando restauração de conexões', {
          totalNodes: Object.keys(initialFlowJson.nodes).length,
          nodeMapSize: nodeMap.size,
          socketsInDOM: container?.querySelectorAll('.socket, [data-socket-type]').length || 0
        });
        
        for (const [nodeId, nodeData] of Object.entries(initialFlowJson.nodes)) {
          const sourceNode = nodeMap.get(String(nodeData.id));
          if (!sourceNode || !nodeData.outputs) {
            logger.debug('Pulando nó sem outputs ou não encontrado no map', {
              nodeId: nodeData.id,
              hasSourceNode: !!sourceNode,
              hasOutputs: !!nodeData.outputs
            });
            continue;
          }

          for (const [outputKey, output] of Object.entries(nodeData.outputs)) {
            if (!output.connections || !Array.isArray(output.connections)) {
              logger.debug('Output sem conexões', {
                nodeId: nodeData.id,
                outputKey,
                hasConnections: !!output.connections,
                isArray: Array.isArray(output.connections)
              });
              continue;
            }
            
            logger.debug('Processando conexões do output', {
              nodeId: nodeData.id,
              outputKey,
              connectionsCount: output.connections.length
            });
            
            for (const conn of output.connections) {
              const targetNode = nodeMap.get(String(conn.node));
              if (!targetNode) {
                logger.warn(`Nó de destino não encontrado para conexão`, { 
                  sourceId: nodeData.id, 
                  targetId: conn.node,
                  nodeMapKeys: Array.from(nodeMap.keys())
                });
                connectionsFailed++;
                continue;
              }

              try {
                // Na v2.0, inputs e outputs são objetos, não Maps
                const sourceOutput = sourceNode.outputs?.[outputKey];
                const targetInputKey = conn.input || 'in';
                const targetInput = targetNode.inputs?.[targetInputKey];
                
                logger.debug('Tentando conectar nós', {
                  sourceId: nodeData.id,
                  targetId: conn.node,
                  outputKey,
                  inputKey: targetInputKey,
                  hasSourceOutput: !!sourceOutput,
                  hasTargetInput: !!targetInput,
                  sourceNodeType: sourceNode.data?.type,
                  targetNodeType: targetNode.data?.type
                });
                
                if (sourceNode && targetNode && sourceOutput) {
                  // CRÍTICO: Verifica se os sockets estão no DOM antes de criar a conexão
                  // Tenta múltiplas formas de encontrar os sockets
                  const sourceSocketSelectors = [
                    `[data-node-id="${sourceNode.id}"][data-socket-type="output"][data-io-key="${outputKey}"]`,
                    `[data-node-id="${sourceNode.id}"].socket-output[data-io-key="${outputKey}"]`,
                    `[data-node-id="${sourceNode.id}"][data-socket-type="output"]`,
                    `[data-node-id="${sourceNode.id}"].socket-output`
                  ];
                  
                  const targetSocketSelectors = [
                    `[data-node-id="${targetNode.id}"][data-socket-type="input"][data-io-key="${targetInputKey}"]`,
                    `[data-node-id="${targetNode.id}"].socket-input[data-io-key="${targetInputKey}"]`,
                    `[data-node-id="${targetNode.id}"][data-socket-type="input"]`,
                    `[data-node-id="${targetNode.id}"].socket-input`
                  ];
                  
                  let sourceSocket = null;
                  let targetSocket = null;
                  
                  for (const selector of sourceSocketSelectors) {
                    sourceSocket = container?.querySelector(selector);
                    if (sourceSocket) break;
                  }
                  
                  for (const selector of targetSocketSelectors) {
                    targetSocket = container?.querySelector(selector);
                    if (targetSocket) break;
                  }
                  
                  // No Rete.js v2, os sockets devem ser vinculados pelo ReactPlugin preset
                  // Se não foram encontrados, aguarda um pouco para que sejam renderizados
                  // Não tenta vincular manualmente pois connection.bind não existe
                  
                  if (!sourceSocket || !targetSocket) {
                    logger.warn('⚠️ Sockets não encontrados no DOM, aguardando...', {
                      sourceId: sourceNode.id,
                      targetId: targetNode.id,
                      hasSourceSocket: !!sourceSocket,
                      hasTargetSocket: !!targetSocket,
                      outputKey,
                      inputKey: targetInputKey,
                      // Debug: lista todos os sockets disponíveis
                      allSockets: container?.querySelectorAll('.socket, [data-socket-type]').length || 0
                    });
                    // Aguarda um pouco e tenta novamente
                    await new Promise(resolve => setTimeout(resolve, 200));
                    // Verifica novamente com os seletores
                    for (const selector of sourceSocketSelectors) {
                      sourceSocket = container?.querySelector(selector);
                      if (sourceSocket) break;
                    }
                    for (const selector of targetSocketSelectors) {
                      targetSocket = container?.querySelector(selector);
                      if (targetSocket) break;
                    }
                    if (!sourceSocket || !targetSocket) {
                      logger.warn('❌ Sockets ainda não encontrados após retry, pulando conexão', {
                        sourceId: sourceNode.id,
                        targetId: targetNode.id,
                        hasSourceSocket: !!sourceSocket,
                        hasTargetSocket: !!targetSocket
                      });
                      connectionsFailed++;
                      continue;
                    }
                  }
                  
                  // Na v2.0, as conexões são criadas usando ClassicPreset.Connection
                  const connection = new ClassicPreset.Connection(
                    sourceNode,
                    outputKey,
                    targetNode,
                    targetInputKey
                  );
                  
                  // LOG CRÍTICO: Verifica estado antes de criar conexão
                  logger.info('🔗 DIAGNÓSTICO DE CONEXÃO - Antes de criar', {
                    sourceId: nodeData.id,
                    targetId: conn.node,
                    outputKey,
                    inputKey: targetInputKey,
                    connectionObject: {
                      id: connection.id,
                      source: connection.source,
                      target: connection.target,
                      sourceOutput: connection.sourceOutput,
                      targetInput: connection.targetInput,
                    },
                    sourceNode: {
                      id: sourceNode.id,
                      hasOutputs: !!sourceNode.outputs,
                      outputKeys: Object.keys(sourceNode.outputs || {}),
                      hasOutput: !!sourceNode.outputs?.[outputKey],
                    },
                    targetNode: {
                      id: targetNode.id,
                      hasInputs: !!targetNode.inputs,
                      inputKeys: Object.keys(targetNode.inputs || {}),
                      hasInput: !!targetNode.inputs?.[targetInputKey],
                    },
                    editorConnections: editor.getConnections().length,
                    areaConnectionPlugin: {
                      hasArea: !!areaRef.current,
                      hasConnectionPlugin: !!globalConnectionRef.current,
                    },
                  });
                  
                  await editor.addConnection(connection);
                  connectionsCreated++;
                  
                  // CRÍTICO: Notifica o ConnectionPlugin sobre a nova conexão
                  // O ConnectionPlugin precisa ser notificado para renderizar a conexão no SVG
                  const connectionPlugin = globalConnectionRef.current;
                  if (connectionPlugin) {
                    try {
                      // CRÍTICO: Força atualização do ConnectionPlugin com a conexão específica
                      if (typeof connectionPlugin.update === 'function') {
                        connectionPlugin.update('connection', connection);
                        logger.info('✅ ConnectionPlugin.update chamado com conexão', {
                          connectionId: connection.id,
                          source: connection.source,
                          target: connection.target
                        });
                      }
                      
                      // Aguarda um pouco e força atualização geral
                      setTimeout(() => {
                        if (connectionPlugin && typeof connectionPlugin.update === 'function') {
                          connectionPlugin.update();
                          logger.debug('✅ ConnectionPlugin.update() chamado após criar conexão');
                        }
                      }, 50);
                    } catch (err) {
                      logger.warn('❌ Erro ao notificar ConnectionPlugin sobre nova conexão', {
                        connectionId: connection.id,
                        error: err.message,
                        stack: err.stack
                      });
                    }
                  } else {
                    logger.error('❌ ConnectionPlugin não disponível para notificar sobre conexão');
                  }
                  
                  // LOG CRÍTICO: Verifica estado após criar conexão
                  const connectionsAfter = editor.getConnections();
                  const createdConnection = connectionsAfter.find(c => 
                    c.source === String(sourceNode.id) && 
                    c.target === String(targetNode.id)
                  );
                  
                  logger.info('🔗 DIAGNÓSTICO DE CONEXÃO - Após criar', {
                    sourceId: nodeData.id,
                    targetId: conn.node,
                    totalCreated: connectionsCreated,
                    connectionCreated: {
                      id: createdConnection?.id,
                      source: createdConnection?.source,
                      target: createdConnection?.target,
                      exists: !!createdConnection,
                    },
                    totalConnections: connectionsAfter.length,
                    allConnections: connectionsAfter.map(c => ({
                      id: c.id,
                      source: c.source,
                      target: c.target,
                    })),
                  });
                  
                  // Verifica renderização após um delay
                  setTimeout(() => {
                    const container = globalContainerRef.current;
                    if (!container) return;
                    
                    const svgElement = container.querySelector('svg');
                    const svgPaths = container.querySelectorAll('svg path');
                    const svgConnections = container.querySelectorAll('svg .connection, svg g.connection');
                    const connectionElements = container.querySelectorAll('.connection');
                    const connectionById = container.querySelector(`[data-connection-id="${createdConnection?.id}"]`);
                    
                    logger.info('🔗 DIAGNÓSTICO DE CONEXÃO - Verificação de renderização', {
                      connectionId: createdConnection?.id,
                      sourceId: nodeData.id,
                      targetId: conn.node,
                      dom: {
                        hasSvg: !!svgElement,
                        svgChildren: svgElement ? svgElement.children.length : 0,
                        svgPathsCount: svgPaths.length,
                        svgConnectionsCount: svgConnections.length,
                        connectionElementsCount: connectionElements.length,
                        connectionById: !!connectionById,
                      },
                      svgStructure: svgElement ? {
                        viewBox: svgElement.getAttribute('viewBox'),
                        width: svgElement.getAttribute('width'),
                        height: svgElement.getAttribute('height'),
                        children: Array.from(svgElement.children).map(child => ({
                          tagName: child.tagName,
                          className: child.className,
                          id: child.id,
                        })),
                      } : null,
                    });
                  }, 500);
                  
                  logger.debug('Conexão criada com sucesso', {
                    sourceId: nodeData.id,
                    targetId: conn.node,
                    totalCreated: connectionsCreated
                  });
                } else {
                  logger.warn('Não foi possível conectar nós - output ou input não encontrado', {
                    sourceId: nodeData.id,
                    targetId: conn.node,
                    hasSourceOutput: !!sourceOutput,
                    hasTargetInput: !!targetInput,
                    sourceOutputs: Object.keys(sourceNode.outputs || {}),
                    targetInputs: Object.keys(targetNode.inputs || {}),
                    sourceNodeHasOutputs: Object.keys(sourceNode.outputs || {}).length > 0,
                    targetNodeHasInputs: Object.keys(targetNode.inputs || {}).length > 0
                  });
                  connectionsFailed++;
                }
              } catch (err) {
                logger.error(`Erro ao conectar nós`, { 
                  sourceId: nodeData.id, 
                  targetId: conn.node,
                  error: err.message,
                  stack: err.stack
                });
                connectionsFailed++;
              }
            }
          }
        }
        
        logger.info('Restauração de conexões concluída', {
          created: connectionsCreated,
          failed: connectionsFailed,
          totalExpected: Object.values(initialFlowJson.nodes).reduce((sum, node) => {
            if (!node.outputs) return sum;
            return sum + Object.values(node.outputs).reduce((s, out) => {
              return s + (Array.isArray(out.connections) ? out.connections.length : 0);
            }, 0);
          }, 0)
        });
        
        // CRÍTICO: Força renderização das conexões após criar todas
        // O ConnectionPlugin pode não renderizar automaticamente quando as conexões
        // são criadas programaticamente
        if (connectionsCreated > 0 && globalConnectionRef.current) {
          // Aguarda um pouco para garantir que todas as conexões foram processadas
          await new Promise(resolve => setTimeout(resolve, 300));
          
          const connection = globalConnectionRef.current;
          if (!connection) {
            logger.warn('ConnectionPlugin não disponível para renderização');
          } else {
            // CRÍTICO: Verifica se o preset classic está configurado
            // O preset classic é necessário para renderizar as conexões
            const hasPreset = connection.presets && connection.presets.length > 0;
            if (!hasPreset) {
              logger.warn('ConnectionPlugin não tem preset configurado, tentando reconfigurar');
              // Tenta reconfigurar o preset classic
              try {
                const presetSetup = ConnectionPresets.classic.setup({ area: areaRef.current });
                const connectionPreset = typeof presetSetup === 'function' ? presetSetup() : presetSetup;
                if (connectionPreset) {
                  if (typeof connectionPreset === 'function') {
                    connection.addPreset(connectionPreset);
                  } else {
                    connection.addPreset(() => connectionPreset);
                  }
                  logger.info('Preset classic reconfigurado');
                }
              } catch (err) {
                logger.error('Erro ao reconfigurar preset classic', { error: err.message });
              }
            }
            // Força atualização do ConnectionPlugin para renderizar todas as conexões
            try {
              // Primeiro, atualiza o plugin inteiro
              if (typeof connection.update === 'function') {
                connection.update();
                logger.debug('ConnectionPlugin.update chamado após restaurar conexões', {
                  connectionsCount: connectionsCreated
                });
              }
              
              // Tenta forçar renderização de todas as conexões
              const allConnections = editor.getConnections();
              logger.debug('Tentando renderizar conexões', {
                totalConnections: allConnections.length,
                connectionsCreated
              });
              
              if (allConnections.length > 0) {
                // Notifica o ConnectionPlugin sobre cada conexão
                allConnections.forEach(conn => {
                  try {
                    if (typeof connection.update === 'function') {
                      connection.update('connection', conn);
                    }
                  } catch (err) {
                    logger.warn('Erro ao atualizar conexão individual', {
                      connectionId: conn.id,
                      error: err.message
                    });
                  }
                });
                
                // Força atualização do area também
                if (areaRef.current && typeof areaRef.current.update === 'function') {
                  areaRef.current.update();
                }
                
                logger.debug('Tentativa de atualizar todas as conexões concluída', {
                  totalConnections: allConnections.length
                });
              }
              
              // Verifica se as conexões foram renderizadas no DOM
              setTimeout(() => {
                const container = globalContainerRef.current;
                if (!container) return;
                
                const svgElement = container.querySelector('svg');
                const svgPaths = container.querySelectorAll('svg path');
                const svgConnections = container.querySelectorAll('svg .connection, svg g.connection');
                
                logger.info('🔗 Verificação final de renderização de conexões', {
                  hasSvg: !!svgElement,
                  svgPathsCount: svgPaths?.length || 0,
                  svgConnectionsCount: svgConnections?.length || 0,
                  editorConnections: editor.getConnections().length,
                  connectionsCreated
                });
                
                // Se não houver conexões renderizadas, tenta renderizar manualmente
                if ((!svgPaths || svgPaths.length === 0) && allConnections.length > 0) {
                  logger.warn('Nenhuma conexão renderizada no SVG, tentando renderizar manualmente');
                  
                  // CRÍTICO: Tenta renderizar conexões manualmente usando os sockets do cache
                  const svgEl = svgElement || container.querySelector('svg');
                  if (connection && connection.socketsCache && connection.socketsCache.size > 0 && svgEl) {
                    try {
                      renderConnectionsManually(editor, connection, svgEl);
                    } catch (err) {
                      logger.warn('Erro ao renderizar conexões manualmente', { error: err.message });
                    }
                  }
                  
                  // Tenta forçar atualização também
                  if (typeof connection.update === 'function') {
                    connection.update();
                  }
                  if (areaRef.current && typeof areaRef.current.update === 'function') {
                    areaRef.current.update();
                  }
                }
              }, 500);
            } catch (err) {
              logger.warn('Erro ao forçar renderização de conexões', {
                error: err.message,
                stack: err.stack
              });
            }
          }
        }
        
        // LOG CRÍTICO: Verificação final do estado das conexões após restauração
        setTimeout(() => {
          const container = containerRef.current;
          if (!container) {
            logger.warn('Container não disponível para diagnóstico final');
            return;
          }
          
          const allConnections = editor.getConnections();
          const svgElement = container.querySelector('svg');
          const svgPaths = container.querySelectorAll('svg path');
          const svgConnections = container.querySelectorAll('svg .connection, svg g.connection');
          const allSockets = container.querySelectorAll('.socket, [data-socket-type]');
          
          logger.info('🎯 DIAGNÓSTICO FINAL - Estado completo das conexões', {
            connections: {
              total: allConnections.length,
              connections: allConnections.map(c => ({
                id: c.id,
                source: c.source,
                target: c.target,
                sourceOutput: c.sourceOutput,
                targetInput: c.targetInput,
              })),
            },
            dom: {
              hasSvg: !!svgElement,
              svgElement: svgElement ? {
                viewBox: svgElement.getAttribute('viewBox'),
                width: svgElement.getAttribute('width'),
                height: svgElement.getAttribute('height'),
                style: svgElement.getAttribute('style'),
                childrenCount: svgElement.children.length,
                children: Array.from(svgElement.children).map((child, idx) => ({
                  index: idx,
                  tagName: child.tagName,
                  className: child.className,
                  id: child.id,
                  d: child.tagName === 'path' ? child.getAttribute('d') : null,
                  stroke: child.tagName === 'path' ? child.getAttribute('stroke') : null,
                })),
              } : null,
              svgPathsCount: svgPaths.length,
              svgConnectionsCount: svgConnections.length,
              socketsCount: allSockets.length,
            },
            connectionPlugin: {
              hasConnection: !!globalConnectionRef.current,
              hasPresets: !!(globalConnectionRef.current?.presets || globalConnectionRef.current?._presets),
              hasStoredBindSocket: !!globalConnectionBindSocketRef.current,
            },
            area: {
              hasArea: !!areaRef.current,
              hasPlugins: !!areaRef.current?.plugins,
              pluginsCount: areaRef.current?.plugins ? 
                (areaRef.current.plugins.size || Object.keys(areaRef.current.plugins).length) : 0,
            },
          });
        }, 1000);
        
        // Verifica quantos nós foram realmente carregados
        // Na v2.0, os nós são acessados via editor.getNodes()
        const loadedNodes = editor.getNodes();
        const connections = editor.getConnections();
        
        logger.debug('JSON carregado no editor Rete', { 
          editorNodesCount: loadedNodes.length,
          editorNodeIds: loadedNodes.map(n => n.id),
          connectionsCount: connections.length,
          connections: connections.map(c => ({
            from: c.source,
            to: c.target,
            sourceOutput: c.sourceOutput,
            targetInput: c.targetInput
          }))
        });
        
        if (loadedNodes.length === 0 && initialFlowJson.nodes && Object.keys(initialFlowJson.nodes).length > 0) {
          logger.error('Nós não foram carregados no editor', {
            expectedCount: Object.keys(initialFlowJson.nodes).length,
            actualCount: loadedNodes.length,
            jsonNodes: initialFlowJson.nodes,
          });
        }
        
        // Força atualização da área do editor
        if (area) {
          try {
            area.resize();
          } catch (err) {
            logger.warn('Erro ao fazer resize da área', { error: err.message });
          }
        }
        
        // Zoom para mostrar todos os nós
        // Na v2.0, usa AreaExtensions.zoomAt
        try {
          if (area && loadedNodes.length > 0) {
            AreaExtensions.zoomAt(area, loadedNodes);
            logger.debug('Zoom aplicado para mostrar todos os nós', { 
              nodeCount: loadedNodes.length 
            });
          }
        } catch (err) {
          logger.warn('Erro ao fazer zoom no editor', { error: err.message });
        }
        
        // Aguarda um frame para garantir que a renderização foi concluída
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Log final de verificação
        const finalNodes = editor.getNodes();
        const finalConnections = editor.getConnections();
        logger.info('Carregamento de JSON concluído', {
          expectedNodes: Object.keys(initialFlowJson.nodes || {}).length,
          loadedNodes: finalNodes.length,
          nodeIds: finalNodes.map(n => n.id),
          connectionsCount: finalConnections.length,
          areaVisible: area ? (containerRef.current?.offsetWidth > 0) : false
        });
        
        // CRÍTICO: Força renderização manual das conexões após carregar o novo fluxo
        // Isso garante que as conexões sejam renderizadas mesmo se o preset classic não funcionar
        if (finalConnections.length > 0 && containerRef.current) {
          setTimeout(() => {
            const connection = globalConnectionRef.current;
            const container = globalContainerRef.current;
            if (connection && container) {
              const svgElement = container.querySelector('svg');
              if (svgElement && editor) {
                const allConnections = editor.getConnections();
                const svgPaths = svgElement.querySelectorAll('path[data-connection-id]');
                
                // Se há conexões mas não há paths, ou se há menos paths que conexões, renderiza manualmente
                if (allConnections.length > 0 && (svgPaths.length === 0 || svgPaths.length < allConnections.length)) {
                  logger.warn('⚠️ Conexões não renderizadas completamente após carregar fluxo, renderizando manualmente', {
                    connectionsCount: allConnections.length,
                    svgPathsCount: svgPaths.length
                  });
                  try {
                    renderConnectionsManually(editor, connection, svgElement);
                  } catch (err) {
                    logger.warn('Erro ao renderizar conexões manualmente após carregar fluxo', {
                      error: err.message
                    });
                  }
                }
              }
            }
          }, 1200); // Aguarda 1.2 segundos para garantir que tudo foi renderizado
        }
        
        // Marca este JSON como carregado para evitar recarregamentos
        lastLoadedJsonRef.current = jsonString;
        
        // Reabilita notificações após carregamento
        isLoadingJsonRef.current = false;
      } catch (err) {
        logger.error('Erro ao carregar JSON no editor Rete', err);
        // Reabilita notificações mesmo em caso de erro
        isLoadingJsonRef.current = false;
      }
    }

    loadJson();
  }, [initialFlowJson, editorReady]);

  // Canvas: fundo neutro conforme diretrizes (#F6F7F9 ou similar), grid sutil
  const canvasBgColor = theme.name === 'light' ? '#F6F7F9' : '#1a1a1a';
  const gridColor = theme.name === 'light' ? '#E8EAED' : '#2a2a2a'; // Grid sutil e discreto

  return (
    <NodeSelectionContext.Provider value={selectedNodeId}>
      <div
        ref={containerRef}
        style={{
          flex: 1,
          minWidth: 200,
          minHeight: 0,
          position: 'relative',
          background: canvasBgColor, // Fundo neutro conforme diretrizes
          backgroundImage: `
            linear-gradient(${gridColor} 1px, transparent 1px),
            linear-gradient(90deg, ${gridColor} 1px, transparent 1px)
          `,
          backgroundSize: '24px 24px', // Grid mais espaçado e sutil
          overflow: 'hidden',
        }}
      />
    </NodeSelectionContext.Provider>
  );
}

/**
 * APIs auxiliares para integração externa:
 * - createNewNode(editor, type, position)
 * - exportToEngineJson(editorData)
 * - importFromEngineJson(flow)
 *
 * Mantidas como funções puras ou quase-puras para facilitar uso
 * fora do React se necessário.
 */



