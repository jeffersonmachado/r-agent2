/**
 * Plugin de renderização React para Rete.js v2.
 * 
 * Este shim usa o ReactPlugin oficial do Rete.js v2 e apenas customiza
 * o preset para usar um componente padrão quando não há componente customizado.
 * 
 * Segue EXATAMENTE o padrão do Rete.js v2:
 * - Usa ReactPlugin oficial
 * - Usa sistema de presets
 * - Não usa métodos manuais
 */

import { ReactPlugin, Presets as ReactPresets } from 'rete-react-plugin';
import React, { useState, useCallback, useRef } from 'react';
import logger from './utils/logger';
import { getNodeSchema } from './editor/nodeSchemas';
import { SelectableConnection } from './components/SelectableConnection';

const { RefSocket, RefControl } = ReactPresets.classic;

/**
 * Funções auxiliares para obter ícone e label de nós
 * Usa schema centralizado (nodeSchemas.js)
 */
function getNodeIcon(type) {
  const schema = getNodeSchema(type);
  return schema?.icon || '●';
}

function getNodeLabel(type) {
  const schema = getNodeSchema(type);
  return schema?.label || type;
}

/**
 * Componente editável que só se torna editável com duplo clique
 */
function EditablePreviewValue({ value, onSave, className = '' }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const onSaveRef = useRef(onSave);
  const lastValueRef = useRef(value);

  // Atualiza a referência da função onSave sem causar re-render
  React.useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // Atualiza o valor local quando o valor externo muda (apenas se não estiver editando)
  React.useEffect(() => {
    if (!isEditing && value !== lastValueRef.current) {
      setEditValue(value);
      lastValueRef.current = value;
    }
  }, [value, isEditing]);

  const handleDoubleClick = () => {
    setIsEditing(true);
    setEditValue(value);
  };

  const handleBlur = useCallback(() => {
    if (editValue !== lastValueRef.current) {
      onSaveRef.current(editValue);
      lastValueRef.current = editValue;
    }
    setIsEditing(false);
  }, [editValue]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (editValue !== lastValueRef.current) {
        onSaveRef.current(editValue);
        lastValueRef.current = editValue;
      }
      setIsEditing(false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditValue(lastValueRef.current);
      setIsEditing(false);
    }
  }, [editValue]);

  if (isEditing) {
    return (
      <input
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={className}
        autoFocus
        style={{
          width: '100%',
          background: 'transparent',
          border: '1px solid var(--color-primary, #3b82f6)',
          borderRadius: '4px',
          padding: '2px 4px',
          font: 'inherit',
          fontWeight: 'inherit',
          color: 'inherit',
        }}
      />
    );
  }

  return (
    <div
      className={className}
      onDoubleClick={handleDoubleClick}
      style={{ cursor: 'text' }}
      title="Duplo clique para editar"
    >
      {value}
    </div>
  );
}

/**
 * Componente React padrão para renderizar nós quando não há componente customizado.
 * Este componente lê `node.data.type` e `node.data.validation` para renderizar o nó.
 * Usa RefSocket e RefControl dos presets do Rete.js v2.
 */
function DefaultNodeComponent(props) {
  // O Rete.js v2 passa o nó como props.data, não props.node
  const { data: node, emit } = props;
  
  // Verificação de segurança: se node não existe, retorna null
  if (!node) {
    logger.warn('DefaultNodeComponent recebeu node undefined', { 
      props,
      propsKeys: props ? Object.keys(props) : [],
      hasData: !!props.data,
    });
    return null;
  }
  
  const nodeType = node?.data?.type || 'unknown';
  const nodeId = String(node?.id || '');
  const nodeNumber = node?.data?.nodeNumber || null;
  const config = node?.data?.config || {};
  const validation = node?.data?.validation || {};
  const hasErrors = validation.status === 'invalid';
  const errors = validation.errors || [];
  const isActive = node?.data?.ui?.isActive;
  const isExecuted = node?.data?.ui?.isExecuted;
  const isSelected = !!node?.selected;

  // ✅ Formata mensagens de erro para o tooltip
  const errorTooltip = hasErrors && errors.length > 0
    ? errors.map((err, idx) => {
        // ✅ Usa messageUi (amigável) se disponível, senão usa message (técnica)
        const errorMessage = (typeof err === 'object' && err.messageUi) 
          ? err.messageUi 
          : ((typeof err === 'object' && err.message) 
            ? err.message 
            : (typeof err === 'string' ? err : 'Erro de validação'));
        return `${idx + 1}. ${errorMessage}`;
      }).join('\n')
    : '';

  // Classes CSS baseadas no estado
  const nodeClasses = [
    'flow-node',
    `flow-node--type-${nodeType}`,
    hasErrors ? 'flow-node--error' : '',
    isActive ? 'flow-node--active' : '',
    isExecuted ? 'flow-node--executed' : '', // Adiciona classe para nós executados
    isSelected ? 'flow-node--selected' : '',
  ].filter(Boolean).join(' ');

  // Verificações seguras para inputs e outputs
  const inputs = node?.inputs || {};
  const outputs = node?.outputs || {};

  return (
    <div className={nodeClasses}>
      <div className="flow-node__header">
        <div className="flow-node__icon">{getNodeIcon(nodeType)}</div>
        <div className="flow-node__title">{getNodeLabel(nodeType)}</div>
        {hasErrors && (
          <div 
            className="flow-node__error-badge"
            title={errorTooltip}
          >
            {errors.length}
          </div>
        )}
        <div className="flow-node__id-badge">
          {nodeNumber !== null ? `${nodeNumber}. ` : ''}#{nodeId}
        </div>
      </div>
      <div className="flow-node__content">
        {nodeType === 'message' && config.text && (
          <div className="flow-node__preview">
            <div className="flow-node__preview-label">Texto:</div>
            <EditablePreviewValue
              value={config.text}
              onSave={(newValue) => {
                // Só atualiza se o valor realmente mudou
                if (node && node.data && newValue !== config.text) {
                  node.data.config = { ...node.data.config, text: newValue };
                  // Dispara evento customizado para notificar mudança e forçar atualização
                  // Usa setTimeout para evitar atualizações síncronas que podem causar loops
                  setTimeout(() => {
                    if (typeof window !== 'undefined') {
                      window.dispatchEvent(
                        new CustomEvent('flow-node-config-updated', {
                          detail: { nodeId: node.id, config: { text: newValue } },
                        }),
                      );
                    }
                  }, 0);
                }
              }}
              className="flow-node__preview-value"
            />
          </div>
        )}
        {nodeType === 'user_input' && config.variable && (
          <div className="flow-node__preview">
            <div className="flow-node__preview-label">Variável:</div>
            <EditablePreviewValue
              value={config.variable}
              onSave={(newValue) => {
                // Só atualiza se o valor realmente mudou
                if (node && node.data && newValue !== config.variable) {
                  node.data.config = { ...node.data.config, variable: newValue };
                  // Dispara evento customizado para notificar mudança e forçar atualização
                  // Usa setTimeout para evitar atualizações síncronas que podem causar loops
                  setTimeout(() => {
                    if (typeof window !== 'undefined') {
                      window.dispatchEvent(
                        new CustomEvent('flow-node-config-updated', {
                          detail: { nodeId: node.id, config: { variable: newValue } },
                        }),
                      );
                    }
                  }, 0);
                }
              }}
              className="flow-node__preview-value"
            />
          </div>
        )}
      </div>
      <div className="flow-node__inputs">
        {Object.entries(inputs).map(([key, input]) => {
          const label = input?.label || (key === 'in' ? 'Anterior' : key);
          return (
            <div 
              key={key} 
              className="flow-node__io-row"
            >
              {input?.socket && (
                <RefSocket
                  name="input-socket"
                  side="input"
                  emit={emit}
                  socketKey={key}
                  nodeId={node.id}
                  payload={input.socket}
                />
              )}
              <div className="flow-node__io-label">{label}</div>
            </div>
          );
        })}
      </div>
      <div className="flow-node__outputs">
        {Object.entries(outputs).map(([key, output]) => {
          const label = output?.label || (key === 'out' ? 'Próximo' : key);
          return (
            <div 
              key={key} 
              className="flow-node__io-row"
            >
              <div className="flow-node__io-label">{label}</div>
              {output?.socket && (
                <RefSocket
                  name="output-socket"
                  side="output"
                  emit={emit}
                  socketKey={key}
                  nodeId={node.id}
                  payload={output.socket}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Cria um preset customizado que usa DefaultNodeComponent quando não há componente customizado.
 * 
 * Segue o padrão do Rete.js v2:
 * - Passa customize diretamente para ReactPresets.classic.setup()
 * - Customiza apenas o componente de nó
 */
function createCustomPreset(connection) {
  // Passa customize diretamente para ReactPresets.classic.setup()
  // Seguindo exatamente o padrão do Rete.js v2
  const preset = ReactPresets.classic.setup({
    connection,
    customize: {
      node(context) {
        const node = context?.payload;
        logger.debug('customize.node chamado', {
          hasContext: !!context,
          hasPayload: !!node,
          nodeId: node?.id,
          nodeType: node?.data?.type,
          hasComponent: !!node?.data?.component,
          hasInputs: !!node?.inputs,
          hasOutputs: !!node?.outputs,
          inputsKeys: node?.inputs ? Object.keys(node.inputs) : [],
          outputsKeys: node?.outputs ? Object.keys(node.outputs) : [],
          firstInputHasSocket: node?.inputs && Object.values(node.inputs)[0]?.socket,
          firstOutputHasSocket: node?.outputs && Object.values(node.outputs)[0]?.socket,
        });
        
        // Se o nó tem um componente customizado, usa ele
        if (node?.data?.component) {
          logger.debug('Usando componente customizado do nó', { nodeId: node.id });
          return node.data.component;
        }
        
        // Caso contrário, usa DefaultNodeComponent para nós que têm tipo definido
        if (node && node.data && node.data.type) {
          logger.debug('Usando DefaultNodeComponent para nó', {
            nodeId: node.id,
            nodeType: node.data.type,
          });
          return DefaultNodeComponent;
        }
        
        // Fallback para o componente padrão do preset
        logger.debug('Usando componente padrão do preset', { nodeId: node?.id });
        return ReactPresets.classic.Node;
      },
      connection() {
        // Usa componente customizado para conexões selecionáveis
        return SelectableConnection;
      },
    },
  });
  
  logger.debug('Preset criado', {
    hasPreset: !!preset,
    presetKeys: preset ? Object.keys(preset) : [],
  });
  
  return preset;
}

/**
 * Wrapper que cria um ReactPlugin oficial com preset customizado.
 * 
 * Segue EXATAMENTE o padrão do Rete.js v2:
 * - Cria ReactPlugin oficial
 * - Adiciona preset customizado usando addPreset
 * - Retorna o plugin pronto para uso
 */
function ReactRenderPlugin(options = {}) {
  // Cria o ReactPlugin oficial do Rete.js v2
  const reactPlugin = new ReactPlugin(options);
  
  // Retorna o plugin oficial diretamente
  // O preset será adicionado depois usando addPreset
  return reactPlugin;
}

/**
 * Cria e retorna um preset customizado pronto para uso.
 * Segue o padrão do Rete.js v2: ReactPresets.classic.setup()
 */
ReactRenderPlugin.createPreset = function createPreset(connection) {
  return createCustomPreset(connection);
};

export default ReactRenderPlugin;
