/**
 * Conversor de Fluxo para Gravação RPA
 * 
 * Responsabilidades:
 * - Converte um FlowDefinition em uma gravação RPA de teste
 * - Mapeia tipos de nós para ações RPA
 * - Inclui asserts obrigatórios
 * - Registra o caminho percorrido
 * - Adiciona metadata sobre dependências resolvidas
 */

const logger = require('../api/utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * @typedef {Object} RpaRecording
 * @property {string} id - ID único da gravação
 * @property {string} name - Nome da gravação
 * @property {string} flowId - ID do fluxo original
 * @property {string} flowName - Nome do fluxo original
 * @property {Array} steps - Passos da gravação RPA
 * @property {Object} data - Dados da gravação
 * @property {Object} metadata - Metadados (dependências resolvidas, seeds executados, etc)
 */

/**
 * Converte um fluxo em uma gravação RPA de teste.
 * 
 * @param {Object} flow - FlowDefinition
 * @param {Object} options - Opções de conversão
 * @param {Object} options.dependencyResolution - Resultado da resolução de dependências
 * @param {string[]} options.executedSeeds - Seeds RPA que foram executados
 * @param {Object} options.snapshot - Snapshot do ambiente
 * @returns {RpaRecording}
 */
function convertFlowToRpaRecording(flow, options = {}) {
  if (!flow || !flow.nodes) {
    throw new Error('Fluxo inválido: deve ter nodes');
  }

  logger.info('[FlowToRpaConverter] Convertendo fluxo para gravação RPA', {
    flowId: flow.id,
    flowName: flow.name,
    nodeCount: flow.nodes.length,
  });

  const steps = [];
  const visitedNodes = new Set();
  const path = [];

  // Encontra o nó inicial
  const startNode = flow.nodes.find(n => n.type === 'start');
  if (!startNode) {
    throw new Error('Fluxo deve ter um nó start');
  }

  // Converte o fluxo em passos RPA
  convertNodeToSteps(startNode, flow, steps, visitedNodes, path);

  // Cria a gravação RPA
  const recording = {
    id: `rpa-${flow.id}-${Date.now()}`,
    name: `Teste RPA - ${flow.name}`,
    flowId: flow.id,
    flowName: flow.name,
    flowVersion: flow.version || 1,
    steps,
    data: {
      flowId: flow.id,
      flowName: flow.name,
      tenantId: flow.tenantId,
      variables: {},
    },
    metadata: {
      generated: true,
      generatedAt: new Date().toISOString(),
      generatedBy: 'flow-to-rpa-converter',
      dependenciasResolvidas: options.dependencyResolution?.allSatisfied || false,
      seedsExecutados: options.executedSeeds || [],
      snapshot: options.snapshot || null,
      path: path,
      nodeCount: flow.nodes.length,
      stepsCount: steps.length,
    },
  };

  logger.info('[FlowToRpaConverter] Conversão concluída', {
    flowId: flow.id,
    stepsCount: steps.length,
    pathLength: path.length,
  });

  return recording;
}

/**
 * Converte um nó e seus sucessores em passos RPA.
 */
function convertNodeToSteps(node, flow, steps, visitedNodes, path) {
  if (!node || visitedNodes.has(node.id)) {
    return;
  }

  visitedNodes.add(node.id);
  path.push({
    nodeId: node.id,
    nodeType: node.type,
    timestamp: new Date().toISOString(),
  });

  // Converte o nó atual em passos RPA
  const nodeSteps = convertNodeTypeToSteps(node, flow);
  steps.push(...nodeSteps);

  // Processa próximos nós
  const nextNodeIds = getNextNodeIds(node);
  for (const nextNodeId of nextNodeIds) {
    const nextNode = flow.nodes.find(n => n.id === nextNodeId);
    if (nextNode) {
      convertNodeToSteps(nextNode, flow, steps, visitedNodes, path);
    }
  }
}

/**
 * Converte um nó específico em passos RPA baseado no tipo.
 */
function convertNodeTypeToSteps(node, flow) {
  const steps = [];

  switch (node.type) {
    case 'start':
      steps.push({
        type: 'navigate',
        url: '/flows',
        description: 'Navegar para página de fluxos',
        assert: {
          type: 'url_contains',
          value: '/flows',
        },
      });
      break;

    case 'message':
      if (node.config?.text) {
        steps.push({
          type: 'wait',
          selector: '[data-testid="chat-message"]',
          timeout: 5000,
          description: `Aguardar mensagem: ${node.config.text.substring(0, 50)}`,
        });
        steps.push({
          type: 'assert',
          selector: '[data-testid="chat-message"]',
          text: node.config.text,
          description: `Verificar mensagem: ${node.config.text.substring(0, 50)}`,
        });
      }
      break;

    case 'user_input':
      if (node.config?.variable) {
        steps.push({
          type: 'wait',
          selector: 'input[type="text"], textarea',
          timeout: 5000,
          description: `Aguardar campo de entrada para variável: ${node.config.variable}`,
        });
        steps.push({
          type: 'fill',
          selector: 'input[type="text"], textarea',
          value: `{{${node.config.variable}}}`,
          description: `Preencher variável: ${node.config.variable}`,
        });
      }
      break;

    case 'router':
      if (node.config?.rules) {
        steps.push({
          type: 'wait',
          selector: 'body',
          timeout: 2000,
          description: 'Aguardar processamento de roteamento',
        });
        // Router não tem ação visual direta, apenas validação
        steps.push({
          type: 'assert',
          type: 'variable_exists',
          variable: node.config.rules[0]?.condition?.var,
          description: `Verificar variável de roteamento: ${node.config.rules[0]?.condition?.var}`,
        });
      }
      break;

    case 'ai_task':
      steps.push({
        type: 'wait',
        selector: 'body',
        timeout: 10000,
        description: `Aguardar processamento de IA: ${node.config?.task || 'task'}`,
      });
      if (node.config?.allowedOutputs) {
        steps.push({
          type: 'assert',
          type: 'variable_in_list',
          variable: node.config.outputVariable || 'ai_result',
          values: node.config.allowedOutputs,
          description: `Verificar saída de IA está em: ${node.config.allowedOutputs.join(', ')}`,
        });
      }
      break;

    case 'handoff':
      if (node.config?.queue) {
        steps.push({
          type: 'wait',
          selector: '[data-testid="ticket-created"]',
          timeout: 5000,
          description: `Aguardar criação de ticket na fila: ${node.config.queue}`,
        });
        steps.push({
          type: 'assert',
          selector: '[data-testid="ticket-created"]',
          text: node.config.queue,
          description: `Verificar ticket criado na fila: ${node.config.queue}`,
        });
      }
      break;

    case 'ai':
      steps.push({
        type: 'wait',
        selector: 'body',
        timeout: 10000,
        description: 'Aguardar resposta de IA',
      });
      if (node.config?.outputVariable) {
        steps.push({
          type: 'assert',
          type: 'variable_exists',
          variable: node.config.outputVariable,
          description: `Verificar variável de saída: ${node.config.outputVariable}`,
        });
      }
      break;

    case 'set_variable':
      if (node.config?.assignments) {
        const vars = Object.keys(node.config.assignments);
        for (const varName of vars) {
          steps.push({
            type: 'assert',
            type: 'variable_equals',
            variable: varName,
            value: node.config.assignments[varName],
            description: `Verificar variável ${varName} = ${node.config.assignments[varName]}`,
          });
        }
      }
      break;

    case 'fallback':
      steps.push({
        type: 'wait',
        selector: 'body',
        timeout: 5000,
        description: 'Aguardar processamento de fallback',
      });
      if (node.config?.escalationMode === 'ticket' && node.config?.queue) {
        steps.push({
          type: 'assert',
          selector: '[data-testid="ticket-created"]',
          description: `Verificar ticket criado via fallback na fila: ${node.config.queue}`,
        });
      }
      break;

    case 'end':
      steps.push({
        type: 'assert',
        type: 'flow_ended',
        description: 'Verificar que o fluxo foi finalizado',
      });
      break;

    default:
      logger.warn('[FlowToRpaConverter] Tipo de nó não mapeado', {
        nodeId: node.id,
        nodeType: node.type,
      });
      steps.push({
        type: 'wait',
        selector: 'body',
        timeout: 1000,
        description: `Aguardar processamento de nó: ${node.type}`,
      });
  }

  return steps;
}

/**
 * Obtém os IDs dos próximos nós a partir do nó atual.
 */
function getNextNodeIds(node) {
  if (!node.next) {
    return [];
  }

  if (typeof node.next === 'string') {
    return [node.next];
  }

  if (Array.isArray(node.next)) {
    return node.next;
  }

  return [];
}

module.exports = {
  convertFlowToRpaRecording,
};

