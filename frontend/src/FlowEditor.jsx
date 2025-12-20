import React, { useEffect, useRef, useState, createContext, useContext } from 'react';
import { NodeEditor } from 'rete';
import { ClassicPreset } from 'rete';
import { AreaExtensions, AreaPlugin } from 'rete-area-plugin';
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';
import { ReactPlugin, Presets as ReactPresets } from 'rete-react-plugin';
import { SelectableConnection } from './components/SelectableConnection';
import { createRoot } from 'react-dom/client';
import { ContextMenuPlugin, Presets as ContextMenuPresets } from 'rete-context-menu-plugin';
import { MinimapPlugin } from 'rete-minimap-plugin';
import { AutoArrangePlugin, Presets as ArrangePresets } from 'rete-auto-arrange-plugin';
import { useTheme, ThemeProvider } from './styles/themeContext';
import logger from './utils/logger';
import { NODE_TYPES } from './components/NodePalette';

// Importa RefSocket e RefControl dos presets para simplificar
const { RefSocket, RefControl } = ReactPresets.classic;

// Contexto para passar selectedNodeId para os componentes de nó
const NodeSelectionContext = createContext(null);

// Refs globais para acessar tema e selectedNodeId do componente renderizado pelo ReactPlugin
// Isso é necessário porque o ReactPlugin cria seu próprio root React
const globalThemeRef = { current: null };
const globalSelectedNodeIdRef = { current: null };
const globalEditorRef = { current: null };
const globalAreaRef = { current: null };
const globalConnectionRef = { current: null };
// NOTA: No projeto reference, não há refs globais para bindSocket - tudo vem das props do preset
const globalContainerRef = { current: null }; // Armazena referência ao container do editor

/**
 * Sockets genéricos.
 * Para um MVP, usamos apenas um tipo de socket, mas ainda
 * validamos conexões com base no tipo lógico do nó.
 */
const flowSocket = new ClassicPreset.Socket('flow');

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
  // O bindSocket vem das props do preset classic do ReactPlugin
  // NOTA: No Rete.js v2.0, o RefSocket já tem bindSocket interno, não precisa passar explicitamente
  const pluginBindSocket = props?.bindSocket;
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
  
  // NOTA: No projeto reference, não há logs de debug para inputs/outputs
  
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
    
    // O bindSocket vem do preset classic do ReactPlugin quando connection é passado
    const bindSocket = pluginBindSocket;
    
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
        emit={emit}
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
 * - Adaptado para usar RefSocket e RefControl dos presets (padrão Rete.js)
 */
function FlowNodeComponent({ node, bindSocket, bindControl, selected, theme, emit }) {
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
      onPointerDown={(e) => {
        // CRÍTICO: Não permite movimento do nó se o clique foi em um socket
        // O Rete.js usa pointerdown, não mousedown
        // Verifica se o target é um socket ou está dentro de um socket
        const isSocket = e.target.classList.contains('socket') || 
                         e.target.closest('.socket') ||
                         e.target.classList.contains('input-socket') ||
                         e.target.classList.contains('output-socket');
        
        if (isSocket) {
          // Se for um socket, não permite movimento do nó
          e.stopPropagation();
          return;
        }
        
        // Também verifica se está dentro de .inputs ou .outputs (mas não no socket)
        if (e.target === e.currentTarget || e.target.closest('.inputs, .outputs')) {
          return;
        }
      }}
      onMouseDown={(e) => {
        // Fallback para mousedown também
        const isSocket = e.target.classList.contains('socket') || 
                         e.target.closest('.socket') ||
                         e.target.classList.contains('input-socket') ||
                         e.target.classList.contains('output-socket');
        
        if (isSocket) {
          e.stopPropagation();
          return;
        }
        
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
          position: 'relative',
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
        {/* ID do nó - Badge no canto superior direito */}
        <div
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            padding: '4px 8px',
            borderRadius: '6px',
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            backdropFilter: 'blur(4px)',
            fontSize: '10px',
            fontFamily: 'monospace',
            color: 'rgba(255, 255, 255, 0.8)',
            fontWeight: 500,
            letterSpacing: '0.5px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          }}
          title={`ID: ${node.id}`}
        >
          {String(node.id)}
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
              {/* Usa RefSocket dos presets - muito mais simples e aderente ao Rete.js */}
              {/* O RefSocket já tem bindSocket interno, não precisa passar explicitamente */}
              {emit && RefSocket ? (
                <div style={{ position: 'relative' }}>
                  <RefSocket
                    name="input-socket"
                    side="input"
                    emit={emit}
                    socketKey={key}
                    nodeId={node.id}
                    payload={input.socket}
                    {...(bindSocket && { bindSocket })}
                  />
                  {/* Estilos customizados aplicados via CSS global */}
                  <style>{`
                    [data-node-id="${node.id}"][data-socket-key="${key}"].socket,
                    [data-node-id="${node.id}"][data-socket-key="${key}"].socket > * {
                      width: 18px !important;
                      height: 18px !important;
                      border-radius: 50% !important;
                      background-color: ${safeTheme.colors?.accent?.primary || '#5e6ad2'} !important;
                      border: 3px solid ${safeTheme.colors?.bg?.elevated || safeTheme.colors?.bg?.tertiary || '#1a1a1a'} !important;
                      cursor: pointer !important;
                      transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1) !important;
                      box-shadow: 0 2px 6px rgba(94, 106, 210, 0.4) !important;
                      position: relative !important;
                      z-index: 10 !important;
                      pointer-events: auto !important;
                    }
                    [data-node-id="${node.id}"][data-socket-key="${key}"].socket:hover,
                    [data-node-id="${node.id}"][data-socket-key="${key}"].socket:hover > * {
                      transform: scale(1.4) !important;
                      background-color: ${safeTheme.colors?.accent?.hover || '#6b77e0'} !important;
                      box-shadow: 0 4px 12px rgba(94, 106, 210, 0.6) !important;
                    }
                  `}</style>
                </div>
              ) : (
                // Fallback para versão antiga se emit não estiver disponível
                <span
                  ref={(el) => {
                    if (el && bindSocket) {
                      setTimeout(() => {
                        try {
                          if (input && typeof input === 'object') {
                            bindSocket(el, input);
                          } else {
                            bindSocket(el, input?.socket || flowSocket, 'input');
                          }
                        } catch (err) {
                          logger.warn('Erro ao vincular socket de input', { error: err.message });
                        }
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
                    pointerEvents: 'auto',
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  className="socket input-socket"
                />
              )}
              <span
                style={{
                  fontSize: '14px',
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
              // NOTA: No projeto reference, não há logs de renderização
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
                  fontSize: '14px',
                  color: safeTheme.colors?.text?.secondary || '#a0a0a0',
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                {output.label || key}
              </span>
              {/* Usa RefSocket dos presets - muito mais simples e aderente ao Rete.js */}
              {/* O RefSocket já tem bindSocket interno, não precisa passar explicitamente */}
              {emit && RefSocket ? (
                <div style={{ position: 'relative' }}>
                  <RefSocket
                    name="output-socket"
                    side="output"
                    emit={emit}
                    socketKey={key}
                    nodeId={node.id}
                    payload={output.socket}
                    {...(bindSocket && { bindSocket })}
                  />
                  {/* Estilos customizados aplicados via CSS global */}
                  <style>{`
                    [data-node-id="${node.id}"][data-socket-key="${key}"].socket,
                    [data-node-id="${node.id}"][data-socket-key="${key}"].socket > * {
                      width: 18px !important;
                      height: 18px !important;
                      border-radius: 50% !important;
                      background-color: ${safeTheme.colors?.status?.success || '#10b981'} !important;
                      border: 3px solid ${safeTheme.colors?.bg?.elevated || safeTheme.colors?.bg?.tertiary || '#1a1a1a'} !important;
                      cursor: pointer !important;
                      transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1) !important;
                      box-shadow: 0 2px 6px rgba(16, 185, 129, 0.4) !important;
                      position: relative !important;
                      z-index: 10 !important;
                      pointer-events: auto !important;
                    }
                    [data-node-id="${node.id}"][data-socket-key="${key}"].socket:hover,
                    [data-node-id="${node.id}"][data-socket-key="${key}"].socket:hover > * {
                      transform: scale(1.4) !important;
                      background-color: ${safeTheme.colors?.status?.success || '#14b8a6'} !important;
                      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.6) !important;
                    }
                  `}</style>
                </div>
              ) : (
                // Fallback para versão antiga se emit não estiver disponível
                <span
                  ref={(el) => {
                    if (el && bindSocket) {
                      setTimeout(() => {
                        try {
                          if (output && typeof output === 'object') {
                            bindSocket(el, output);
                          } else {
                            bindSocket(el, output?.socket || flowSocket, 'output');
                          }
                        } catch (err) {
                          logger.warn('Erro ao vincular socket de output', { error: err.message });
                        }
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
                    pointerEvents: 'auto',
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
                    const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
                    mouseDownPositionRef.current = {
                      x: clientX,
                      y: clientY,
                      time: Date.now(),
                    };
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="socket output-socket"
                />
              )}
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
// Componente interno (será memoizado no final)
function FlowEditorComponent({ initialFlowJson, onFlowChanged, onNodeSelected, onEvent, editorRef: externalEditorRef, selectedNodeId, onUpdateNodeConfig, showToast }) {
  const { theme } = useTheme();
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const areaRef = useRef(null); // Armazena referência do AreaPlugin
  const reactRenderPluginRef = useRef(null); // Referência ao plugin ReactRenderPlugin
  const editorReadyRef = useRef(false); // Rastreia se o editor está pronto (usando ref para evitar re-renderizações)
  const lastLoadedJsonRef = useRef(null); // Rastreia o último JSON carregado para evitar loops
  const isLoadingJsonRef = useRef(false); // Flag para desabilitar notifyChange durante carregamento
  const selectedNodeIdRef = useRef(selectedNodeId);
  const onUpdateNodeConfigRef = useRef(onUpdateNodeConfig);
  const notifyChangeRef = useRef(null); // Ref para a função notifyChange
  
  // Armazena callbacks em refs para evitar re-inicializações
  const onFlowChangedRef = useRef(onFlowChanged);
  const onNodeSelectedRef = useRef(onNodeSelected);
  const onEventRef = useRef(onEvent);
  const showToastRef = useRef(showToast);
  
  // Atualiza as refs globais para que o componente renderizado pelo ReactPlugin possa acessá-las
  // useTheme retorna { theme, themeName, toggleTheme, setTheme }, então precisamos pegar theme.theme
  useEffect(() => {
    // useTheme retorna um objeto com a propriedade 'theme'
    const themeObject = theme.theme || theme;
    globalThemeRef.current = themeObject;
    globalSelectedNodeIdRef.current = selectedNodeId;
    
    // Debug: log para verificar atualização
    // NOTA: No projeto reference, não há logs de atualização de refs
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
    showToastRef.current = showToast;
  }, [onFlowChanged, onNodeSelected, onEvent, showToast]);
  
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
        createConnection: async (sourceNodeId, targetNodeId, sourceOutput = 'out', targetInput = 'in') => {
          /**
           * Cria uma nova conexão entre dois nós.
           * 
           * @param {string|number} sourceNodeId - ID do nó de origem
           * @param {string|number} targetNodeId - ID do nó de destino
           * @param {string} [sourceOutput='out'] - Nome do output do nó de origem (padrão: 'out')
           * @param {string} [targetInput='in'] - Nome do input do nó de destino (padrão: 'in')
           * @returns {Promise<ClassicPreset.Connection|null>} A conexão criada ou null se falhar
           * 
           * @example
           * // Criar conexão básica entre dois nós
           * await editorRef.current.createConnection('node1', 'node2');
           * 
           * @example
           * // Criar conexão com outputs/inputs específicos
           * await editorRef.current.createConnection('node1', 'node2', 'output1', 'input1');
           */
          if (!editorRef.current) {
            logger.warn('Editor não disponível para criar conexão');
            return null;
          }

          try {
            const editor = editorRef.current;
            
            // Converte IDs para string para comparação
            const sourceIdStr = String(sourceNodeId);
            const targetIdStr = String(targetNodeId);
            
            // Obtém os nós
            const sourceNode = editor.getNode(sourceIdStr);
            const targetNode = editor.getNode(targetIdStr);
            
            if (!sourceNode) {
              logger.warn('Nó de origem não encontrado', { sourceNodeId: sourceIdStr });
              return null;
            }
            
            if (!targetNode) {
              logger.warn('Nó de destino não encontrado', { targetNodeId: targetIdStr });
              return null;
            }
            
            // Verifica se os nós têm os outputs/inputs necessários
            if (!sourceNode.outputs || !sourceNode.outputs[sourceOutput]) {
              logger.warn('Nó de origem não tem o output especificado', {
                sourceNodeId: sourceIdStr,
                sourceOutput,
                availableOutputs: Object.keys(sourceNode.outputs || {})
              });
              return null;
            }
            
            if (!targetNode.inputs || !targetNode.inputs[targetInput]) {
              logger.warn('Nó de destino não tem o input especificado', {
                targetNodeId: targetIdStr,
                targetInput,
                availableInputs: Object.keys(targetNode.inputs || {})
              });
              return null;
            }
            
            // Verifica se já existe uma conexão entre esses nós
            const existingConnections = editor.getConnections();
            const duplicate = existingConnections.find(conn => 
              String(conn.source) === sourceIdStr &&
              String(conn.target) === targetIdStr &&
              conn.sourceOutput === sourceOutput &&
              conn.targetInput === targetInput
            );
            
            if (duplicate) {
              logger.warn('Conexão já existe entre esses nós', {
                sourceNodeId: sourceIdStr,
                targetNodeId: targetIdStr,
                sourceOutput,
                targetInput,
                connectionId: duplicate.id
              });
              return duplicate;
            }
            
            // Cria a conexão usando ClassicPreset.Connection
            const connection = new ClassicPreset.Connection(
              sourceNode,
              sourceOutput,
              targetNode,
              targetInput
            );
            
            logger.info('Criando nova conexão', {
              connectionId: connection.id,
              sourceNodeId: sourceIdStr,
              targetNodeId: targetIdStr,
              sourceOutput,
              targetInput
            });
            
            // Adiciona a conexão ao editor
            await editor.addConnection(connection);
            
            // Notifica o ConnectionPlugin sobre a nova conexão para renderização
            const connectionPlugin = globalConnectionRef.current;
            if (connectionPlugin) {
              try {
                if (typeof connectionPlugin.update === 'function') {
                  connectionPlugin.update('connection', connection);
                  
                  // Aguarda um pouco e força atualização geral
                  setTimeout(() => {
                    if (connectionPlugin && typeof connectionPlugin.update === 'function') {
                      connectionPlugin.update();
                    }
                  }, 50);
                }
              } catch (err) {
                logger.warn('Erro ao notificar ConnectionPlugin sobre nova conexão', {
                  connectionId: connection.id,
                  error: err.message
                });
              }
            }
            
            // Força notificação de mudança
            if (notifyChangeRef.current) {
              notifyChangeRef.current();
            }
            
            logger.info('✅ Conexão criada com sucesso', {
              connectionId: connection.id,
              sourceNodeId: sourceIdStr,
              targetNodeId: targetIdStr
            });
            
            return connection;
          } catch (err) {
            logger.error('Erro ao criar conexão', {
              sourceNodeId,
              targetNodeId,
              sourceOutput,
              targetInput,
              error: err.message,
              stack: err.stack
            });
            return null;
          }
        },
      };
    }
  }, [externalEditorRef]);

  // Inicializa o editor apenas uma vez (sem dependências que mudam frequentemente)
  const keyDownHandlerRef = useRef(null);
  
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
    let dropHandler = null;
    let dragOverHandler = null;

    async function init() {
      // Na v2.0, o NodeEditor não recebe container no construtor
      const editor = new NodeEditor();
      editorRef.current = editor;
      globalEditorRef.current = editor;

      const area = new AreaPlugin(containerRef.current);
      areaRef.current = area;
      
      // Adiciona listener direto no AreaPlugin para eventos de movimento
      console.log('📝 Configurando listeners no AreaPlugin para eventos de movimento');
      
      // Tenta ouvir eventos do AreaPlugin diretamente
      if (area && typeof area.addPipe === 'function') {
        area.addPipe(context => {
          if (context.type === 'nodetranslated' || context.type === 'nodetranslate') {
            const nodeId = context.data?.id;
            const nodeView = area.nodeViews?.get(nodeId);
            const actualPosition = nodeView?.position;
            
            // Log apenas quando o movimento termina (nodetranslated) para não poluir
            if (context.type === 'nodetranslated') {
              const logData = {
                type: context.type,
                nodeId: nodeId,
                positionFromEvent: context.data?.position,
                actualPosition: actualPosition ? { x: actualPosition.x, y: actualPosition.y } : null,
                positionArray: actualPosition ? [actualPosition.x, actualPosition.y] : null
              };
              
              console.log('📍 Nó movido - posição final (AreaPlugin pipe)', logData);
              logger.info('📍 Nó movido - posição final (AreaPlugin pipe)', logData);
              
              // Chama notifyChange para salvar a posição
              // Usa setTimeout para garantir que a posição foi atualizada no nodeView
              setTimeout(() => {
                if (notifyChangeRef.current) {
                  notifyChangeRef.current();
                }
              }, 50);
            }
          }
          return context;
        });
      }
      
      // Também tenta ouvir eventos via eventos DOM se disponível
      if (area && area.container) {
        // Observa mudanças no DOM dos nós
        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
              const target = mutation.target;
              if (target.hasAttribute('data-node-id')) {
                const nodeId = target.getAttribute('data-node-id');
                const nodeView = area.nodeViews?.get(nodeId);
                if (nodeView?.position) {
                  const pos = nodeView.position;
                  console.log('📍 Posição do nó detectada via MutationObserver', {
                    nodeId: nodeId,
                    position: { x: pos.x, y: pos.y },
                    positionArray: [pos.x, pos.y]
                  });
                }
              }
            }
          });
        });
        
        observer.observe(area.container, {
          attributes: true,
          attributeFilter: ['style'],
          subtree: true
        });
        
        console.log('✅ MutationObserver configurado para detectar mudanças de posição');
      }
      globalAreaRef.current = area;
      const connection = new ConnectionPlugin();
      globalConnectionRef.current = connection;
      const reactRender = new ReactPlugin({ createRoot });

      // Ordem correta na v2.0:
      // 1. IMPORTANTE: O AreaPlugin precisa ser usado no editor PRIMEIRO
      // para ter um parent antes de usar outros plugins nele
      editor.use(area);
      
      // 2. Adiciona presets aos plugins ANTES de usá-los no area
      // IMPORTANTE: No Rete.js v2.0, o preset classic do ConnectionPlugin
      // 2. Configura o preset classic do ConnectionPlugin
      // IMPORTANTE: No projeto reference, ConnectionPresets.classic.setup() é chamado SEM parâmetros
      // O preset classic gerencia a renderização de conexões automaticamente
      connection.addPreset(ConnectionPresets.classic.setup());
      
      // Configura o preset classic do ReactPlugin com componentes customizados
      reactRender.addPreset(ReactPresets.classic.setup({
        customize: {
          node(context) {
            // Usa o componente customizado FlowNodeComponentWrapper
            // O context contém informações sobre o nó, mas o componente recebe props do preset automaticamente
            return FlowNodeComponentWrapper;
          },
          connection() {
            return SelectableConnection;
          },
        },
      }));
      
      // 3. Depois, os outros plugins são usados através do AreaPlugin
      // IMPORTANTE: ConnectionPlugin deve ser usado ANTES do ReactPlugin
      // para que as conexões sejam renderizadas corretamente
      // CRÍTICO: A ordem é importante - connection primeiro, depois reactRender
      area.use(connection);
      area.use(reactRender);
      
      // NOTA: No projeto reference, não há CSS customizado - usa estilos padrão do Rete.js
      
      // 3.1. Context Menu Plugin - Permite criar nós via clique direito
      const contextMenu = new ContextMenuPlugin({
        items: ContextMenuPresets.classic.setup(
          NODE_TYPES.map(nodeType => [
            nodeType.label,
            () => createFlowNode({ type: nodeType.type })
          ])
        ),
      });
      area.use(contextMenu);
      reactRender.addPreset(ReactPresets.contextMenu.setup());
      
      // 3.2. Minimap Plugin - Visão geral do grafo
      const minimap = new MinimapPlugin();
      area.use(minimap);
      reactRender.addPreset(ReactPresets.minimap.setup());
      
      // 3.3. Auto Arrange Plugin - Organização automática de nós
      const arrange = new AutoArrangePlugin();
      arrange.addPreset(ArrangePresets.classic.setup());
      
      // Envolve o layout em um handler de erro para evitar crashes
      const originalLayout = arrange.layout.bind(arrange);
      arrange.layout = async function(...args) {
        try {
          return await originalLayout(...args);
        } catch (err) {
          // Log do erro mas não propaga - evita que o plugin quebre o editor
          logger.warn('Erro no AutoArrangePlugin.layout (suprimido)', {
            error: err?.message || String(err),
            stack: err?.stack
          });
          // Retorna uma promise resolvida para não quebrar o fluxo
          return Promise.resolve();
        }
      };
      
      area.use(arrange);
      if (externalEditorRef) {
        externalEditorRef.current = externalEditorRef.current || {};
        externalEditorRef.current.arrange = arrange;
        externalEditorRef.current.area = area;
      }
      
      // 4. Configura seleção de nós usando AreaExtensions (padrão Rete.js)
      try {
        const selector = AreaExtensions.selector();
        const accumulating = AreaExtensions.accumulateOnCtrl();
        AreaExtensions.selectableNodes(area, selector, { accumulating });
      } catch (err) {
        logger.warn('Erro ao configurar AreaExtensions.selectableNodes', { error: err.message });
      }
      
      // Armazena referências dos plugins para uso posterior
      reactRenderPluginRef.current = reactRender;
      areaRef.current = area;
      
      // NOTA: O ConnectionPlugin do Rete.js gerencia automaticamente a renderização
      // e atualização de conexões quando nós são movidos. Não precisamos de código manual.

      // Ref para armazenar conexão selecionada (declarada antes do pipe para estar disponível)
      const selectedConnectionRef = { current: null };
      
      // Função para lidar com clique em conexão (será chamada pelo componente SelectableConnection)
      const handleConnectionClick = (connection) => {
        if (!connection) return;
        
        selectedConnectionRef.current = connection;
        globalSelectedNodeIdRef.current = null;
        if (typeof onNodeSelectedRef.current === 'function') {
          onNodeSelectedRef.current(null);
        }
        
        // Marca a conexão como selecionada
        connection.selected = true;
        
        // Remove seleção de outras conexões
        const allConnections = editor.getConnections();
        allConnections.forEach(conn => {
          if (conn.id !== connection.id) {
            conn.selected = false;
          }
        });
        
        // Dispara evento customizado para notificar componentes sobre mudança de seleção
        // Isso força o ReactPlugin a re-renderizar as conexões
        try {
          // Dispara evento customizado no window para os componentes ouvirem
          const event = new CustomEvent('connectionselectionchanged', {
            detail: {
              selectedConnection: connection,
              allConnections: allConnections
            }
          });
          window.dispatchEvent(event);
          
          // Também tenta atualizar via ReactPlugin se disponível
          if (reactRenderPluginRef.current) {
            // Força atualização de todas as conexões
            allConnections.forEach(conn => {
              try {
                // Tenta diferentes métodos de atualização
                if (reactRenderPluginRef.current.update) {
                  reactRenderPluginRef.current.update('connection', conn.id);
                } else if (reactRenderPluginRef.current.render) {
                  reactRenderPluginRef.current.render('connection', conn.id);
                }
              } catch (err) {
                // Ignora erros individuais
              }
            });
          }
        } catch (err) {
          logger.warn('Erro ao atualizar conexões no ReactPlugin', { error: err.message });
        }
        
        logger.info('✅ Conexão selecionada - Pressione Delete/Backspace para deletar', {
          connectionId: connection.id,
          source: connection.source,
          target: connection.target
        });
      };
      
      // Expõe a função globalmente para o componente SelectableConnection usar
      window.__reteConnectionClickHandler = handleConnectionClick;
      
      // Flag para rastrear se está arrastando um nó
      let isDraggingNode = false;
      let dragStartTime = 0;
      let dragTimeout = null;
      
      // Listener para detectar quando nós são movidos
      // O Rete.js v2.0 pode não disparar 'nodetranslated' automaticamente,
      // então usamos um listener no container para detectar quando o drag termina
      if (containerRef.current) {
        const handleMouseDown = (e) => {
          // Verifica se o clique foi em um nó (não em conexão)
          const target = e.target;
          const isNode = target.closest('[data-node-id]') || target.closest('.rete-node');
          const isConnection = target.tagName === 'path' && target.closest('svg');
          
          if (isNode && !isConnection) {
            const nodeElement = target.closest('[data-node-id]') || target.closest('.rete-node');
            const nodeId = nodeElement?.getAttribute('data-node-id') || 'unknown';
            console.log('🖱️ MouseDown em nó - iniciando drag', { nodeId, target: target.tagName });
            isDraggingNode = true;
            dragStartTime = Date.now();
          }
        };
        
        const handleMouseUp = (e) => {
          const target = e.target;
          const isConnection = target.tagName === 'path' && target.closest('svg');
          
          // Se foi clique em conexão, não atualiza posição de nó
          if (isConnection) {
            isDraggingNode = false;
            if (dragTimeout) {
              clearTimeout(dragTimeout);
              dragTimeout = null;
            }
            return;
          }
          
          // Só atualiza se realmente estava arrastando um nó
          if (isDraggingNode) {
            const dragDuration = Date.now() - dragStartTime;
            // Só atualiza se o drag durou mais de 50ms (evita cliques simples)
            if (dragDuration > 50) {
              if (dragTimeout) {
                clearTimeout(dragTimeout);
              }
              dragTimeout = setTimeout(() => {
                if (notifyChangeRef.current) {
                  // Obtém a posição atual do nó que foi movido
                  const area = areaRef.current;
                  if (area) {
                    const allNodes = editor.getNodes();
                    allNodes.forEach(node => {
                      const nodeView = area.nodeViews?.get(node.id);
                      if (nodeView?.position) {
                        const pos = nodeView.position;
                        const logData = {
                          nodeId: node.id,
                          position: { x: pos.x, y: pos.y },
                          positionArray: [pos.x, pos.y]
                        };
                        // Log em ambos os sistemas para garantir que apareça
                        console.log('📍 Posição do nó após movimento (mouseup)', logData);
                        logger.info('📍 Posição do nó após movimento (mouseup)', logData);
                      }
                    });
                  }
                  logger.debug('Atualizando editorJson após movimento de nó');
                  notifyChangeRef.current();
                }
                isDraggingNode = false;
              }, 100); // Delay para garantir que a posição foi atualizada no AreaPlugin
            } else {
              isDraggingNode = false;
            }
          }
        };
        
        const handleMouseLeave = () => {
          // Se o mouse sair do container durante o drag, atualiza
          if (isDraggingNode) {
            if (dragTimeout) {
              clearTimeout(dragTimeout);
            }
            dragTimeout = setTimeout(() => {
              if (notifyChangeRef.current) {
                // Obtém a posição atual do nó que foi movido
                const area = areaRef.current;
                if (area) {
                  const allNodes = editor.getNodes();
                  allNodes.forEach(node => {
                    const nodeView = area.nodeViews?.get(node.id);
                    if (nodeView?.position) {
                      const pos = nodeView.position;
                      const logData = {
                        nodeId: node.id,
                        position: { x: pos.x, y: pos.y },
                        positionArray: [pos.x, pos.y]
                      };
                      // Log em ambos os sistemas para garantir que apareça
                      console.log('📍 Posição do nó após movimento (mouseleave)', logData);
                      logger.info('📍 Posição do nó após movimento (mouseleave)', logData);
                    }
                  });
                }
                logger.debug('Atualizando editorJson após movimento de nó (mouse saiu)');
                notifyChangeRef.current();
              }
              isDraggingNode = false;
            }, 100);
          }
        };
        
        console.log('📝 Registrando listeners de mouse para detecção de movimento de nós', {
          hasContainer: !!containerRef.current,
          containerTag: containerRef.current?.tagName
        });
        
        containerRef.current.addEventListener('mousedown', handleMouseDown);
        containerRef.current.addEventListener('mouseup', handleMouseUp);
        containerRef.current.addEventListener('mouseleave', handleMouseLeave);
        
        // Adiciona também listener de mousemove para detectar movimento em tempo real
        const handleMouseMove = (e) => {
          if (isDraggingNode) {
            // Log apenas ocasionalmente para não poluir o console
            if (Math.random() < 0.1) { // 10% das vezes
              console.log('🔄 MouseMove durante drag', {
                isDragging: isDraggingNode,
                dragDuration: Date.now() - dragStartTime
              });
            }
          }
        };
        
        containerRef.current.addEventListener('mousemove', handleMouseMove);
        
        console.log('✅ Listeners de mouse registrados com sucesso');
        
        // Limpa o listener quando o componente é desmontado
        // (será limpo pelo useEffect cleanup)
      } else {
        console.warn('⚠️ containerRef.current não está disponível para registrar listeners de mouse');
      }

      // Configura seleção de nós via AreaPlugin
      // Usa AreaExtensions.selectableNodes que já foi configurado acima
      // O selector gerencia a seleção automaticamente, mas precisamos ouvir os eventos
      area.addPipe((context) => {
        // Log de todos os eventos relacionados a conexões para debug
        if (context.type && context.type.includes('connection')) {
          logger.debug('Evento de conexão detectado no area pipe', {
            type: context.type,
            data: context.data,
            hasConnection: !!(context.data?.connection || context.data?.id)
          });
        }
        
        // Detecta clique/seleção de conexões
        // IMPORTANTE: No Rete.js v2.0, os eventos de conexão podem ter nomes diferentes
        if (context.type === 'connectionpick' || 
            context.type === 'connectionclick' || 
            context.type === 'connectionselected' ||
            context.type === 'connectionpicked' ||
            context.type === 'clickconnection' ||
            (context.type === 'click' && (context.data?.connection || context.data?.id))) {
          const connection = context.data?.connection || context.data;
          if (connection && connection.id) {
            selectedConnectionRef.current = connection;
            // Deseleciona nó quando uma conexão é selecionada
            globalSelectedNodeIdRef.current = null;
            if (typeof onNodeSelectedRef.current === 'function') {
              onNodeSelectedRef.current(null);
            }
            logger.info('✅ Conexão selecionada - Pressione Delete/Backspace para deletar', {
              connectionId: connection.id,
              source: connection.source,
              target: connection.target,
              eventType: context.type,
              connectionData: connection
            });
          } else {
            logger.debug('Evento de conexão detectado mas sem dados válidos', {
              type: context.type,
              data: context.data
            });
          }
          return context;
        }
        
        // Também tenta detectar clique duplo em conexões para deletar
        if (context.type === 'connectiondblclick' || 
            (context.type === 'dblclick' && (context.data?.connection || context.data?.id))) {
          const connection = context.data?.connection || context.data;
          if (connection && connection.id && editor) {
            logger.info('Conexão clicada duas vezes - deletando', {
              connectionId: connection.id,
              source: connection.source,
              target: connection.target
            });
            try {
              editor.removeConnection(connection.id);
              selectedConnectionRef.current = null;
              if (notifyChangeRef.current) {
                notifyChangeRef.current();
              }
            } catch (err) {
              logger.warn('Erro ao deletar conexão via duplo clique', {
                connectionId: connection.id,
                error: err.message
              });
            }
          }
          return context;
        }
        
        // Detecta seleção de nós via AreaExtensions
        // O selector emite eventos quando nós são selecionados/deselecionados
        if (context.type === 'nodepicked' || context.type === 'nodeclick' || context.type === 'nodeselected') {
          // Deseleciona conexão quando um nó é selecionado
          selectedConnectionRef.current = null;
          
          const nodeFromEvent = context.data?.node || context.data || context.data?.id;
          if (nodeFromEvent && typeof onNodeSelectedRef.current === 'function') {
            // IMPORTANTE: O Rete.js v2.0 pode retornar apenas o ID no evento
            // Precisamos buscar o nó completo do editor usando getNode
            const nodeId = nodeFromEvent.id || nodeFromEvent;
            const node = editor.getNode(nodeId);
            
            if (!node) {
              logger.warn('Nó não encontrado no editor', { nodeId });
              return context;
            }
            
            // Garante que o config seja lido corretamente do nó
            const nodeConfig = node.data?.config || {};
            const nodeData = {
              id: String(node.id),
              type: node.data?.type || 'unknown',
              config: nodeConfig,
            };
            logger.debug('Nó selecionado via AreaExtensions', {
              nodeData,
              nodeId: node.id,
              nodeType: node.data?.type,
              eventType: context.type,
            });
            onNodeSelectedRef.current(nodeData);
          }
        }
        // Detecta deseleção de nós
        if (context.type === 'nodedeselected' || context.type === 'click') {
          // Se o clique foi no background (não em um nó ou conexão), deseleciona tudo
          const isBackgroundClick = !context.data?.node && !context.data?.id && !context.data?.connection;
          if (isBackgroundClick) {
            selectedConnectionRef.current = null;
            if (typeof onNodeSelectedRef.current === 'function') {
              logger.debug('Deselecionando nó (clique no background)');
              onNodeSelectedRef.current(null);
            }
          }
        }
        return context;
      });
      
      // NOTA: A seleção de nós é gerenciada automaticamente pelo AreaExtensions.selectableNodes
      // Apenas precisamos ouvir os eventos de seleção para atualizar o estado
      
      // Handler para deletar nós ou conexões com Delete/Backspace
      const handleKeyDown = (e) => {
        // Verifica se é Delete ou Backspace
        if (e.key === 'Delete' || e.key === 'Backspace') {
          // Verifica se não está digitando em um input/textarea
          const isInputElement = e.target.tagName === 'INPUT' || 
                                e.target.tagName === 'TEXTAREA' ||
                                e.target.isContentEditable;
          
          if (isInputElement) {
            // Se está digitando, não deleta
            return;
          }
          
          // Primeiro verifica se há uma conexão selecionada
          if (selectedConnectionRef.current && editor) {
            try {
              const connection = selectedConnectionRef.current;
              logger.debug('Deletando conexão via teclado', {
                connectionId: connection.id,
                source: connection.source,
                target: connection.target,
                key: e.key,
                hasConnection: !!connection,
                connectionIdValid: !!connection.id
              });
              
              // Verifica se a conexão ainda existe no editor
              const allConnections = editor.getConnections();
              const connectionExists = allConnections.some(c => c.id === connection.id);
              
              if (!connectionExists) {
                logger.warn('Conexão não encontrada no editor', {
                  connectionId: connection.id
                });
                selectedConnectionRef.current = null;
                return;
              }
              
              editor.removeConnection(connection.id);
              selectedConnectionRef.current = null;
              
              // Atualiza o editorJson após deletar
              if (notifyChangeRef.current) {
                notifyChangeRef.current();
              }
              
              // Previne comportamento padrão
              e.preventDefault();
              e.stopPropagation();
              return;
            } catch (err) {
              logger.warn('Erro ao deletar conexão via teclado', {
                connectionId: selectedConnectionRef.current?.id,
                error: err.message,
                stack: err.stack
              });
            }
          }
          
          // Log para debug - verifica se há conexão selecionada mas não foi deletada
          if (!selectedConnectionRef.current) {
            logger.debug('Tentativa de deletar conexão, mas nenhuma conexão está selecionada', {
              selectedNodeId: globalSelectedNodeIdRef.current,
              key: e.key
            });
          }
          
          // Se não há conexão selecionada, verifica se há um nó selecionado
          const selectedNodeId = globalSelectedNodeIdRef.current;
          if (selectedNodeId && editor) {
            try {
              const node = editor.getNode(selectedNodeId);
              if (node) {
                logger.debug('Deletando nó via teclado', { 
                  nodeId: selectedNodeId,
                  nodeType: node.data?.type,
                  key: e.key
                });
                
                // IMPORTANTE: Remove todas as conexões relacionadas ao nó antes de deletá-lo
                const allConnections = editor.getConnections();
                const connectionsToRemove = allConnections.filter(conn => 
                  conn.source === selectedNodeId || conn.target === selectedNodeId
                );
                
                logger.debug('Removendo conexões relacionadas ao nó', {
                  nodeId: selectedNodeId,
                  connectionsCount: connectionsToRemove.length,
                  connections: connectionsToRemove.map(c => ({
                    id: c.id,
                    source: c.source,
                    target: c.target
                  }))
                });
                
                // Remove todas as conexões relacionadas
                for (const connection of connectionsToRemove) {
                  try {
                    editor.removeConnection(connection.id);
                  } catch (connErr) {
                    logger.warn('Erro ao remover conexão ao deletar nó', {
                      connectionId: connection.id,
                      error: connErr.message
                    });
                  }
                }
                
                // Remove o nó
                editor.removeNode(selectedNodeId);
                
                // Deseleciona o nó após deletar
                if (typeof onNodeSelectedRef.current === 'function') {
                  onNodeSelectedRef.current(null);
                }
                
                // Previne comportamento padrão (não deleta texto, etc)
                e.preventDefault();
                e.stopPropagation();
              }
            } catch (err) {
              logger.warn('Erro ao deletar nó via teclado', {
                nodeId: selectedNodeId,
                error: err.message
              });
            }
          }
        }
      };
      keyDownHandlerRef.current = handleKeyDown;
      
      // Adiciona listener de teclado para deletar nós
      document.addEventListener('keydown', handleKeyDown, true);
      logger.debug('Listener de teclado adicionado');
      
      // Marca o editor como pronto (usando ref para evitar re-renderização)
      logger.debug('Marcando editor como pronto');
      lastLoadedJsonRef.current = null; // Reset para permitir carregamento inicial
      editorReadyRef.current = true;
      logger.debug('Editor marcado como pronto');

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
          
          // Log das posições coletadas
          const positionsLog = nodes.reduce((acc, node) => {
            const nodeView = area?.nodeViews?.get(node.id);
            const position = nodeView?.position ? [nodeView.position.x, nodeView.position.y] : [0, 0];
            acc[node.id] = position;
            return acc;
          }, {});
          
          logger.debug('Editor JSON atualizado', { 
            nodeCount: nodes.length,
            positions: positionsLog
          });
          onFlowChangedRef.current(data);
        }
      }
      
      // Expõe notifyChange para uso externo
      notifyChangeRef.current = notifyChange;

      // Na v2.0, os eventos são tratados via pipes (signals)
      // IMPORTANTE: Este pipe deve retornar o context para não bloquear outros pipes
      console.log('📝 Configurando pipe do editor para capturar eventos');
      editor.addPipe((context) => {
        // Log TODOS os eventos para debug (temporário)
        if (context.type && (context.type.includes('node') || context.type.includes('translate') || context.type.includes('drag') || context.type.includes('move'))) {
          console.log('🔔 Evento no pipe do editor (filtrado)', {
            type: context.type,
            hasData: !!context.data,
            dataKeys: context.data ? Object.keys(context.data) : [],
            data: context.data
          });
        }
        // Log de depuração para eventos de conexão
        if (context.type === 'connectioncreated' || context.type === 'connectionremoved' || 
            context.type === 'connectionpick' || context.type === 'connectionclick') {
          logger.debug('Evento de conexão detectado no editor pipe', {
            type: context.type,
            data: context.data
          });
        }
        
        if (context.type === 'nodecreated') {
          emit('NODE_CREATED', serializeNode(context.data));
          notifyChange();
        } else if (context.type === 'noderemoved') {
          emit('NODE_REMOVED', serializeNode(context.data));
          notifyChange();
        } else if (context.type === 'connectioncreated') {
          // NOTA: O ConnectionPlugin atualiza automaticamente quando uma conexão é criada
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
          
          const validationResult = validateConnection(context.data);
          if (!validationResult.valid) {
            // Remove conexão inválida imediatamente
            const sourceNode = editor.getNode(context.data?.source);
            const targetNode = editor.getNode(context.data?.target);
            logger.warn('❌ Conexão inválida removida', {
              connectionId: context.data?.id,
              source: context.data?.source,
              target: context.data?.target,
              sourceType: sourceNode?.data?.type,
              targetType: targetNode?.data?.type,
              reason: validationResult.reason,
              allowedTargets: validationResult.allowedTargets || [],
            });
            
            // Mostra toast com o motivo da rejeição
            if (showToastRef.current && validationResult.reason) {
              showToastRef.current(validationResult.reason, 'error', 5000);
            }
            
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
            
            // NOTA: O ConnectionPlugin renderiza conexões automaticamente - não precisamos forçar atualização
          }
        } else if (context.type === 'connectionremoved') {
          // O ConnectionPlugin atualiza automaticamente quando uma conexão é removida
          logger.debug('Conexão removida', {
            connectionId: context.data?.id,
          });
          emit('CONNECTION_REMOVED', serializeConnection(context.data));
          notifyChange();
        } else if (context.type === 'nodetranslated' || context.type === 'nodetranslate') {
          // Quando um nó é movido, atualiza o editorJson com a nova posição
          const nodeId = context.data?.id;
          const area = areaRef.current;
          const nodeView = area?.nodeViews?.get(nodeId);
          const actualPosition = nodeView?.position;
          
          const logData = {
            nodeId: nodeId,
            type: context.type,
            positionFromEvent: context.data?.position,
            actualPosition: actualPosition ? { x: actualPosition.x, y: actualPosition.y } : null,
            positionArray: actualPosition ? [actualPosition.x, actualPosition.y] : null
          };
          
          // Log apenas quando o movimento termina (nodetranslated) para não poluir
          if (context.type === 'nodetranslated') {
            console.log('📍 Nó movido (nodetranslated) - pipe do editor', logData);
            logger.info('📍 Nó movido (nodetranslated) - pipe do editor', logData);
            notifyChange();
          }
        }
        
        // Log de todos os eventos para debug (pode ser removido depois)
        if (context.type && (context.type.includes('node') || context.type.includes('translate') || context.type.includes('drag'))) {
          console.log('🔔 Evento relacionado a nó detectado', {
            type: context.type,
            data: context.data
          });
          logger.debug('Evento relacionado a nó detectado', {
            type: context.type,
            data: context.data
          });
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
        
        if (!sourceNode) {
          return {
            valid: false,
            reason: `Nó de origem não encontrado (ID: ${connection.source})`,
            allowedTargets: [],
          };
        }
        
        if (!targetNode) {
          return {
            valid: false,
            reason: `Nó de destino não encontrado (ID: ${connection.target})`,
            allowedTargets: [],
          };
        }
        
        const fromType = sourceNode.data?.type;
        const toType = targetNode.data?.type;

        if (!fromType) {
          return {
            valid: false,
            reason: `Nó de origem não tem tipo definido (ID: ${connection.source})`,
            allowedTargets: [],
          };
        }

        if (!toType) {
          return {
            valid: false,
            reason: `Nó de destino não tem tipo definido (ID: ${connection.target})`,
            allowedTargets: [],
          };
        }

        const allowedTargets = CONNECTION_RULES[fromType] || [];
        
        if (allowedTargets.length === 0) {
          return {
            valid: false,
            reason: `Tipo de nó '${fromType}' não permite conexões (nenhum destino permitido)`,
            allowedTargets: [],
          };
        }

        if (!allowedTargets.includes(toType)) {
          return {
            valid: false,
            reason: `Conexão de '${fromType}' para '${toType}' não é permitida. Tipos permitidos para '${fromType}': ${allowedTargets.join(', ')}`,
            allowedTargets,
          };
        }

        return {
          valid: true,
          reason: null,
          allowedTargets,
        };
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
      // Flag para evitar processamento duplicado do drop (usando ref para persistir entre renders)
      const isProcessingDropRef = { current: false };
      const lastDropTimeRef = { current: 0 };
      
      const handleDrop = async (e) => {
        // CRÍTICO: Para o evento imediatamente para evitar processamento múltiplo
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation(); // Impede que outros listeners processem o evento
        
        // Evita processamento duplicado - verifica se já está processando ou se foi processado recentemente
        const now = Date.now();
        if (isProcessingDropRef.current || (now - lastDropTimeRef.current < 300)) {
          logger.debug('Drop já está sendo processado ou foi processado recentemente, ignorando', {
            isProcessing: isProcessingDropRef.current,
            timeSinceLastDrop: now - lastDropTimeRef.current
          });
          return;
        }
        
        isProcessingDropRef.current = true;
        lastDropTimeRef.current = now;

        try {
          const nodeType = e.dataTransfer.getData('application/node-type') || e.dataTransfer.getData('text/plain');
          if (!nodeType) {
            isProcessingDropRef.current = false;
            return;
          }

          // Verifica se o drop foi no container correto
          if (!containerRef.current || !containerRef.current.contains(e.target)) {
            logger.debug('Drop não foi no container do editor, ignorando');
            isProcessingDropRef.current = false;
            return;
          }

          const rect = containerRef.current.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;

          // Converter coordenadas da viewport para coordenadas do editor
          const area = areaRef.current;
          if (!area) {
            isProcessingDropRef.current = false;
            return;
          }
          
          const transform = area.area.transform;
          const zoom = transform.k || 1;
          const panX = transform.x || 0;
          const panY = transform.y || 0;

          const editorX = (x - panX) / zoom;
          const editorY = (y - panY) / zoom;

          logger.debug('Criando nó via drag and drop', {
            nodeType,
            position: { x: editorX, y: editorY },
            mousePosition: { x, y }
          });

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
        } catch (err) {
          logger.error('Erro ao processar drop', err);
        } finally {
          // Libera a flag após um pequeno delay para evitar processamento duplicado
          setTimeout(() => {
            isProcessingDropRef.current = false;
          }, 200);
        }
      };

      const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
      };

      const container = containerRef.current;
      if (container) {
        // Remove listeners antigos se existirem (caso o useEffect seja executado múltiplas vezes)
        if (dropHandler) {
          container.removeEventListener('drop', dropHandler);
        }
        if (dragOverHandler) {
          container.removeEventListener('dragover', dragOverHandler);
        }
        
        // Armazena referências dos handlers para cleanup
        dropHandler = handleDrop;
        dragOverHandler = handleDragOver;
        
        // Adiciona listeners com capture: false e once: false
        // Usa capture: false para evitar captura em múltiplos níveis
        container.addEventListener('drop', dropHandler, false);
        container.addEventListener('dragover', dragOverHandler, false);
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
      editorReadyRef.current = false; // Reset quando o editor é destruído (usando ref para evitar re-renderização)
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
      
      // Remove listener de teclado
      if (keyDownHandlerRef.current) {
        document.removeEventListener('keydown', keyDownHandlerRef.current, true);
        keyDownHandlerRef.current = null;
      }
      
      // Remove listeners de drag and drop
      const container = containerRef.current;
      if (container && dropHandler && dragOverHandler) {
        container.removeEventListener('drop', dropHandler, false);
        container.removeEventListener('dragover', dragOverHandler, false);
        dropHandler = null;
        dragOverHandler = null;
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
    
    globalSelectedNodeIdRef.current = selectedNodeId;
    
    // NOTA: No projeto reference, não há código que força re-renderização manualmente
    // O ReactPlugin gerencia re-renderização automaticamente
  }, [selectedNodeId]);

  // NOTA: No projeto reference, não há estilos CSS customizados injetados dinamicamente
  // Os estilos padrão do Rete.js são usados diretamente
  // Removemos os estilos customizados excessivos para seguir o padrão do reference

  // Carrega o JSON quando initialFlowJson mudar e editor estiver pronto
  useEffect(() => {
    if (!editorReadyRef.current || !editorRef.current || !initialFlowJson) {
      // Aguardando inicialização do editor
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

      // Verifica se já carregamos este JSON recentemente (evita loops e re-renderizações)
      // Compara apenas o ID do fluxo e a estrutura básica, não o JSON completo
      const currentNodes = editor.getNodes();
      const flowId = initialFlowJson.id || JSON.stringify(initialFlowJson);
      const jsonString = JSON.stringify(initialFlowJson);
      const nodeCount = initialFlowJson.nodes ? Object.keys(initialFlowJson.nodes).length : 0;
      
      // Se já carregamos este JSON exato, não recarrega (evita loops)
      if (lastLoadedJsonRef.current === jsonString) {
        return;
      }
      
      // Se o editor já tem nós e o JSON tem a mesma quantidade, pode ser apenas uma atualização
      // Nesse caso, não recarrega tudo, apenas atualiza se necessário
      if (currentNodes.length > 0 && currentNodes.length === nodeCount) {
        // Verifica se é realmente o mesmo fluxo comparando IDs dos nós
        const editorNodeIds = new Set(currentNodes.map(n => String(n.id)));
        const jsonNodeIds = new Set(Object.keys(initialFlowJson.nodes || {}).map(id => String(id)));
        
        // Se os IDs são os mesmos, provavelmente é apenas uma atualização de estado, não precisa recarregar
        if (editorNodeIds.size === jsonNodeIds.size && 
            [...editorNodeIds].every(id => jsonNodeIds.has(id))) {
          // É o mesmo fluxo, apenas atualiza o estado sem recarregar
          lastLoadedJsonRef.current = jsonString;
          return;
        }
      }
      
      try {
        // Desabilita notificações durante carregamento
        isLoadingJsonRef.current = true;
        
        // CRÍTICO: Limpa conexões e paths SVG antes de remover nós
        // Isso garante que não haja conexões órfãs ou paths SVG antigos
        const existingConnections = editor.getConnections();
        // Limpa conexões antigas
        
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
        // Limpa nós antigos
        
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
          // socketsCache limpo
        }
        
        // Aguarda um pouco para garantir que a limpeza foi processada
        await new Promise(resolve => setTimeout(resolve, 50));

        if (!initialFlowJson.nodes || Object.keys(initialFlowJson.nodes).length === 0) {
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
            
            // Nó criado
            
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
          
          await editor.addNode(node);
          
          if (area && position && position.length === 2) {
            try {
              // Aguarda um pouco para garantir que o nó foi renderizado
              await new Promise(resolve => setTimeout(resolve, 100));
              
              // Aplica a posição usando translate
              await area.translate(node.id, { x: position[0], y: position[1] });
              
              // Verifica se a posição foi aplicada corretamente
              await new Promise(resolve => setTimeout(resolve, 50));
              const nodeView = area.nodeViews?.get(node.id);
              const actualPosition = nodeView?.position;
              
              logger.debug('Posição aplicada ao nó', {
                nodeId: node.id,
                expectedPosition: position,
                actualPosition: actualPosition ? [actualPosition.x, actualPosition.y] : null,
                match: actualPosition && 
                       Math.abs(actualPosition.x - position[0]) < 1 && 
                       Math.abs(actualPosition.y - position[1]) < 1
              });
            } catch (err) {
              logger.warn('Erro ao traduzir nó para posição', { 
                nodeId: node.id, 
                position,
                error: err.message 
              });
            }
          }
        }
        
        // NOTA: No projeto reference, não há código que força atualização manualmente
        // O ReactPlugin gerencia renderização automaticamente
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Aguarda um pouco para que os nós sejam renderizados antes de criar conexões
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Reaplica as posições após os nós serem totalmente renderizados
        // Isso garante que as posições salvas sejam mantidas mesmo após renderização
        for (const node of nodesToAdd) {
          const nodeData = initialFlowJson.nodes[node.id];
          const position = nodeData?.position || [0, 0];
          
          if (area && position && position.length === 2) {
            try {
              const nodeView = area.nodeViews?.get(node.id);
              if (nodeView) {
                await area.translate(node.id, { x: position[0], y: position[1] });
                logger.debug('Posição reaplicada após renderização', {
                  nodeId: node.id,
                  position
                });
              }
            } catch (err) {
              logger.warn('Erro ao reaplicar posição do nó', { 
                nodeId: node.id, 
                position,
                error: err.message 
              });
            }
          }
        }
        
        // Aguarda um pouco mais antes de criar conexões
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Faz zoom APÓS aplicar as posições para não alterá-las
        // IMPORTANTE: zoomAt deve ser chamado DEPOIS de aplicar as posições
        if (area) {
          try {
            area.resize();
            const loadedNodes = editor.getNodes();
            if (loadedNodes.length > 0) {
              AreaExtensions.zoomAt(area, loadedNodes);
            }
          } catch (err) {
            logger.warn('Erro ao fazer resize/zoom da área', { error: err.message });
          }
        }
        
        // Aguarda um pouco após o zoom antes de criar conexões
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Restaura as conexões
        let connectionsCreated = 0;
        let connectionsFailed = 0;
        
        for (const [nodeId, nodeData] of Object.entries(initialFlowJson.nodes)) {
          const sourceNode = nodeMap.get(String(nodeData.id));
          if (!sourceNode || !nodeData.outputs) {
            continue;
          }

          for (const [outputKey, output] of Object.entries(nodeData.outputs)) {
            if (!output.connections || !Array.isArray(output.connections)) {
              continue;
            }
            
            for (const conn of output.connections) {
              const targetNode = nodeMap.get(String(conn.node));
              if (!targetNode) {
                connectionsFailed++;
                continue;
              }

              try {
                const sourceOutput = sourceNode.outputs?.[outputKey];
                const targetInputKey = conn.input || 'in';
                const targetInput = targetNode.inputs?.[targetInputKey];
                
                if (sourceNode && targetNode && sourceOutput) {
                  const connection = new ClassicPreset.Connection(
                    sourceNode,
                    outputKey,
                    targetNode,
                    targetInputKey
                  );
                  
                  await editor.addConnection(connection);
                  connectionsCreated++;
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
        
        // NOTA: O ConnectionPlugin renderiza conexões automaticamente
        // O zoomAt já foi chamado anteriormente após aplicar as posições
        
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // NOTA: No projeto reference, não há código que força renderização manual de conexões
        // O ConnectionPlugin gerencia renderização automaticamente
        
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
  }, [initialFlowJson]); // Removido editorReady das dependências - usando ref ao invés de state

  // Aplica estilos do tema no container (usando useEffect para evitar re-renderizações)
  useEffect(() => {
    if (!containerRef.current) return;
    
    const canvasBgColor = theme.name === 'light' ? '#F6F7F9' : '#1a1a1a';
    const gridColor = theme.name === 'light' ? '#E8EAED' : '#2a2a2a';
    
    containerRef.current.style.background = canvasBgColor;
    containerRef.current.style.backgroundImage = `
      linear-gradient(${gridColor} 1px, transparent 1px),
      linear-gradient(90deg, ${gridColor} 1px, transparent 1px)
    `;
    containerRef.current.style.backgroundSize = '24px 24px';
  }, [theme]);

  return (
    <NodeSelectionContext.Provider value={selectedNodeId}>
      <div
        ref={containerRef}
        style={{
          flex: 1,
          minWidth: 200,
          minHeight: 0,
          position: 'relative',
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

// Exporta o componente memoizado para evitar re-renderizações desnecessárias
// Comparação customizada: só re-renderiza se props realmente importantes mudaram
export const FlowEditor = React.memo(FlowEditorComponent, (prevProps, nextProps) => {
  // Se o selectedNodeId mudou, precisa re-renderizar
  if (prevProps.selectedNodeId !== nextProps.selectedNodeId) {
    return false; // Re-renderizar
  }
  
  // Se o initialFlowJson mudou (comparando IDs e estrutura básica)
  const prevFlowId = prevProps.initialFlowJson?.id;
  const nextFlowId = nextProps.initialFlowJson?.id;
  if (prevFlowId !== nextFlowId) {
    return false; // Re-renderizar
  }
  
  // Se o número de nós mudou, precisa re-renderizar
  const prevNodeCount = prevProps.initialFlowJson?.nodes ? Object.keys(prevProps.initialFlowJson.nodes).length : 0;
  const nextNodeCount = nextProps.initialFlowJson?.nodes ? Object.keys(nextProps.initialFlowJson.nodes).length : 0;
  if (prevNodeCount !== nextNodeCount) {
    return false; // Re-renderizar
  }
  
  // Se as referências dos callbacks mudaram, não precisa re-renderizar
  // (os callbacks são armazenados em refs internamente e atualizados via useEffect)
  
  // Se o editorRef mudou, não precisa re-renderizar (é uma ref)
  
  // Por padrão, não re-renderiza (retorna true = props são iguais)
  return true;
});



