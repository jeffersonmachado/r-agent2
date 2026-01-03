import { ClassicPreset } from 'rete';
import { NODE_SCHEMAS, DEFAULT_SOCKET_NAME, getNodeInputs, getNodeOutputs } from './nodeSchemas';
import logger from '../utils/logger';

/**
 * Cria um nó do Rete.js baseado no tipo e schema
 * 
 * @param {string} nodeType - Tipo do nó (ex: 'message', 'router')
 * @param {Object} options - Opções adicionais
 * @param {Object} options.config - Configuração inicial do nó
 * @returns {ClassicPreset.Node} Nó criado
 */
export function createNode(nodeType, options = {}) {
  const { config = {} } = options;
  
  // Obtém o schema do nó
  const schema = NODE_SCHEMAS[nodeType];
  if (!schema) {
    logger.error('Tipo de nó não encontrado', { nodeType });
    throw new Error(`Tipo de nó não encontrado: ${nodeType}`);
  }

  // Cria o socket padrão
  const socket = new ClassicPreset.Socket(DEFAULT_SOCKET_NAME);

  // Cria o nó com o label do schema
  const node = new ClassicPreset.Node(schema.label);
  
  // Adiciona dados do nó (tipo e config)
  node.data = {
    type: nodeType,
    config: config,
  };

  // Obtém inputs (pode ser dinâmico baseado no node)
  const inputs = getNodeInputs(nodeType, node);
  
  // Adiciona inputs ao nó
  if (inputs && inputs.length > 0) {
    inputs.forEach(inputDef => {
      const inputSocket = new ClassicPreset.Socket(
        inputDef.socketName || DEFAULT_SOCKET_NAME
      );
      node.addInput(
        inputDef.key,
        new ClassicPreset.Input(inputSocket, inputDef.label)
      );
    });
  }

  // Obtém outputs (pode ser dinâmico baseado no node)
  const outputs = getNodeOutputs(nodeType, node);
  
  // Adiciona outputs ao nó
  if (outputs && outputs.length > 0) {
    outputs.forEach(outputDef => {
      const outputSocket = new ClassicPreset.Socket(
        outputDef.socketName || DEFAULT_SOCKET_NAME
      );
      node.addOutput(
        outputDef.key,
        new ClassicPreset.Output(outputSocket, outputDef.label)
      );
    });
  }

  logger.debug('Nó criado', {
    nodeType,
    nodeId: node.id,
    hasInputs: !!node.inputs && Object.keys(node.inputs).length > 0,
    hasOutputs: !!node.outputs && Object.keys(node.outputs).length > 0,
    inputsKeys: node.inputs ? Object.keys(node.inputs) : [],
    outputsKeys: node.outputs ? Object.keys(node.outputs) : [],
  });

  return node;
}

