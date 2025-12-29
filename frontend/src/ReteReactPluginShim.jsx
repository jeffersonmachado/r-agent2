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
import React from 'react';
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
 * Componente React padrão para renderizar nós quando não há componente customizado.
 * Este componente lê `node.data.type` e `node.data.validation` para renderizar o nó.
 * Usa RefSocket e RefControl dos presets do Rete.js v2.
 */
function DefaultNodeComponent(props) {
  // O Rete.js v2 passa o nó como props.data, não props.node
  const { data: node, emit } = props;
  
  // Log para debug
  logger.debug('DefaultNodeComponent renderizado', {
    hasProps: !!props,
    hasData: !!props.data,
    hasNode: !!node,
    nodeId: node?.id,
    nodeType: node?.data?.type,
    propsKeys: props ? Object.keys(props) : [],
    hasInputs: !!node?.inputs,
    hasOutputs: !!node?.outputs,
  });
  
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
  const config = node?.data?.config || {};
  const validation = node?.data?.validation || {};
  const hasErrors = validation.status === 'invalid';
  const errors = validation.errors || [];

  // Classes CSS baseadas no estado
  const nodeClasses = [
    'flow-node',
    `flow-node--type-${nodeType}`,
    hasErrors ? 'flow-node--error' : '',
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
          <div className="flow-node__error-badge">{errors.length}</div>
        )}
        <div className="flow-node__id-badge">#{nodeId}</div>
      </div>
      <div className="flow-node__content">
        {nodeType === 'message' && config.text && (
          <div className="flow-node__preview">
            <div className="flow-node__preview-label">Texto:</div>
            <div className="flow-node__preview-value">{config.text}</div>
          </div>
        )}
        {nodeType === 'user_input' && config.variable && (
          <div className="flow-node__preview">
            <div className="flow-node__preview-label">Variável:</div>
            <div className="flow-node__preview-value">{config.variable}</div>
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
