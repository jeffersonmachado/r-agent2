/**
 * Validador estático de fluxos de chatbot.
 *
 * Objetivo:
 * - Detectar problemas estruturais ANTES da execução:
 *   - Nós desconectados (não alcançáveis a partir de um nó de entrada)
 *   - Loops inválidos (ciclos no grafo)
 *   - Tipos incompatíveis entre nós conectados
 *
 * Importante:
 * - Validação é puramente estática e determinística.
 * - Não depende de estado de sessão nem de IA.
 */

/**
 * @typedef {import('./flowTypes').FlowDefinition} FlowDefinition
 * @typedef {import('./flowTypes').FlowNode} FlowNode
 */

/**
 * @typedef {Object} FlowValidationError
 * @property {string} code           - Código de erro estável (ex.: "NODE_DISCONNECTED", "INVALID_LOOP", "TYPE_INCOMPATIBLE")
 * @property {string} message        - Mensagem legível
 * @property {string[]} [nodeIds]    - Nós envolvidos no problema
 * @property {Object<string, any>} [details] - Dados extras úteis (ex.: caminho do ciclo)
 */

/**
 * @typedef {Object} FlowValidationResult
 * @property {boolean} valid
 * @property {FlowValidationError[]} errors
 */

/**
 * Regras de compatibilidade básica entre tipos de nó.
 *
 * Decisão importante:
 * - Mantemos um mapa explícito de "de -> [para]" por tipo.
 * - Isso espelha (de forma independente) as regras de conexão
 *   usadas no editor visual, garantindo consistência entre
 *   o que o usuário pode desenhar e o que a engine aceita.
 */
const TYPE_COMPATIBILITY = {
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
 * Constrói um mapa de nós por id para acesso rápido.
 *
 * @param {FlowDefinition} flow
 * @returns {Map<string, FlowNode>}
 */
function buildNodeMap(flow) {
  const map = new Map();
  for (const node of flow.nodes || []) {
    if (!node || !node.id) continue;
    map.set(node.id, node);
  }
  return map;
}

/**
 * Constrói a lista de arestas (conexões lógicas) do fluxo.
 * - Para nós simples, usamos o campo "next" (suporta string ou array).
 * - Para routers, consideramos todos os "rules[].next" e também "next" padrão.
 *
 * @param {FlowDefinition} flow
 * @returns {Array<{ from: string, to: string }>}
 */
function buildEdges(flow) {
  const edges = [];

  for (const node of flow.nodes || []) {
    if (!node || !node.id) continue;

    // Conexão padrão via "next" - suporta múltiplas conexões
    if (node.next) {
      if (typeof node.next === 'string') {
        edges.push({ from: node.id, to: node.next });
      } else if (Array.isArray(node.next)) {
        for (const nextId of node.next) {
          if (typeof nextId === 'string') {
            edges.push({ from: node.id, to: nextId });
          }
        }
      }
    }

    // Conexões específicas de router
    if (node.type === 'router' && node.config && Array.isArray(node.config.rules)) {
      for (const rule of node.config.rules) {
        if (rule && rule.next) {
          edges.push({ from: node.id, to: rule.next });
        }
      }
    }
  }

  return edges;
}

/**
 * Encontra nós de entrada.
 *
 * Heurística:
 * - Se houver nós do tipo "start", usamos apenas eles.
 * - Caso contrário, usamos nós sem arestas de entrada.
 *
 * @param {FlowDefinition} flow
 * @param {Array<{from: string, to: string}>} edges
 * @returns {string[]} ids de nós de entrada
 */
function findEntryNodes(flow, edges) {
  const startNodes = (flow.nodes || []).filter((n) => n.type === 'start');
  if (startNodes.length > 0) {
    return startNodes.map((n) => n.id);
  }

  const withIncoming = new Set(edges.map((e) => e.to));
  const entries = [];
  for (const n of flow.nodes || []) {
    if (!withIncoming.has(n.id)) {
      entries.push(n.id);
    }
  }
  return entries;
}

/**
 * Detecta nós desconectados (não alcançáveis a partir de nenhum nó de entrada).
 *
 * @param {FlowDefinition} flow
 * @param {Array<{from: string, to: string}>} edges
 * @returns {FlowValidationError[]}
 */
function validateDisconnectedNodes(flow, edges) {
  const nodeMap = buildNodeMap(flow);
  const adj = new Map();
  for (const nodeId of nodeMap.keys()) {
    adj.set(nodeId, []);
  }
  for (const e of edges) {
    if (!adj.has(e.from)) {
      adj.set(e.from, []);
    }
    adj.get(e.from).push(e.to);
  }

  const entries = findEntryNodes(flow, edges);
  const visited = new Set();

  // BFS/DFS a partir de todos os nós de entrada
  const stack = [...entries];
  while (stack.length > 0) {
    const id = stack.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    const neighbors = adj.get(id) || [];
    for (const n of neighbors) {
      if (!visited.has(n)) stack.push(n);
    }
  }

  const disconnected = [];
  for (const node of flow.nodes || []) {
    if (!visited.has(node.id)) {
      disconnected.push(node.id);
    }
  }

  if (disconnected.length === 0) return [];

  return [
    {
      code: 'NODE_DISCONNECTED',
      message: 'Existem nós não alcançáveis a partir de qualquer nó de entrada.',
      nodeIds: disconnected,
      details: {
        entryNodes: entries,
      },
    },
  ];
}

/**
 * Detecta ciclos (loops) no grafo de nós.
 *
 * Decisão importante:
 * - Para manter o fluxo simples e previsível, consideramos
 *   QUALQUER ciclo como potencialmente inválido.
 * - No futuro, se loops controlados forem necessários, pode-se
 *   adicionar uma flag explícita no nó (ex.: allowLoop) e
 *   ajustar esta função.
 *
 * @param {FlowDefinition} flow
 * @param {Array<{from: string, to: string}>} edges
 * @returns {FlowValidationError[]}
 */
function validateInvalidLoops(flow, edges) {
  const nodeIds = new Set((flow.nodes || []).map((n) => n.id));

  const adj = new Map();
  for (const id of nodeIds) {
    adj.set(id, []);
  }
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e.to);
  }

  const errors = [];
  const visited = new Set();
  const stack = new Set();

  /**
   * DFS para encontrar ciclos.
   *
   * @param {string} nodeId
   * @param {string[]} path
   */
  function dfs(nodeId, path) {
    if (stack.has(nodeId)) {
      // Encontramos um ciclo. Extraímos o trecho do caminho a partir da
      // primeira ocorrência do nodeId até o final.
      const idx = path.indexOf(nodeId);
      const cyclePath = path.slice(idx);
      errors.push({
        code: 'INVALID_LOOP',
        message: 'Loop inválido detectado no fluxo.',
        nodeIds: cyclePath,
        details: {
          cyclePath,
        },
      });
      return;
    }
    if (visited.has(nodeId)) return;

    visited.add(nodeId);
    stack.add(nodeId);

    const neighbors = adj.get(nodeId) || [];
    for (const n of neighbors) {
      dfs(n, path.concat(n));
    }

    stack.delete(nodeId);
  }

  for (const id of nodeIds) {
    if (!visited.has(id)) {
      dfs(id, [id]);
    }
  }

  return errors;
}

/**
 * Valida compatibilidade de tipos entre nós conectados.
 *
 * @param {FlowDefinition} flow
 * @param {Array<{from: string, to: string}>} edges
 * @returns {FlowValidationError[]}
 */
function validateTypeCompatibility(flow, edges) {
  const nodeMap = buildNodeMap(flow);
  const errors = [];

  for (const e of edges) {
    const fromNode = nodeMap.get(e.from);
    const toNode = nodeMap.get(e.to);
    if (!fromNode || !toNode) continue;

    const fromType = fromNode.type || 'unknown';
    const toType = toNode.type || 'unknown';

    // Se o tipo não está no mapa, consideramos genérico (sem validação).
    if (!Object.prototype.hasOwnProperty.call(TYPE_COMPATIBILITY, fromType)) {
      continue;
    }

    const allowedTargets = TYPE_COMPATIBILITY[fromType] || [];
    if (!allowedTargets.includes(toType)) {
      errors.push({
        code: 'TYPE_INCOMPATIBLE',
        message: `Tipo de nó incompatível: não é permitido conectar "${fromType}" -> "${toType}".`,
        nodeIds: [fromNode.id, toNode.id],
        details: {
          fromType,
          toType,
          allowedTargets,
        },
      });
    }
  }

  return errors;
}

/**
 * Valida se todas as arestas apontam para nós existentes.
 *
 * - Detecta referências a nodeId inexistente em "next" ou regras
 *   de roteamento.
 *
 * @param {FlowDefinition} flow
 * @param {Array<{from: string, to: string}>} edges
 * @returns {FlowValidationError[]}
 */
function validateMissingTargetNodes(flow, edges) {
  const nodeMap = buildNodeMap(flow);
  const errors = [];

  for (const e of edges) {
    if (!nodeMap.has(e.to)) {
      errors.push({
        code: 'NODE_TARGET_MISSING',
        message: `Conexão aponta para nó inexistente: "${e.to}".`,
        nodeIds: [e.from],
        details: {
          from: e.from,
          to: e.to,
        },
      });
    }
  }

  return errors;
}

/**
 * Valida se há IDs de nós duplicados.
 *
 * @param {FlowDefinition} flow
 * @returns {FlowValidationError[]}
 */
function validateDuplicateNodeIds(flow) {
  const seen = new Set();
  const duplicates = [];

  for (const node of flow.nodes || []) {
    if (!node || !node.id) continue;
    if (seen.has(node.id)) {
      duplicates.push(node.id);
    } else {
      seen.add(node.id);
    }
  }

  if (duplicates.length === 0) return [];

  return [
    {
      code: 'DUPLICATE_NODE_ID',
      message: 'Existem nós com IDs duplicados no fluxo.',
      nodeIds: duplicates,
      details: {
        duplicateIds: duplicates,
      },
    },
  ];
}

/**
 * Valida se o fluxo tem pelo menos um nó de início e um nó de fim.
 *
 * @param {FlowDefinition} flow
 * @returns {FlowValidationError[]}
 */
function validateRequiredNodes(flow) {
  const errors = [];
  const nodes = flow.nodes || [];
  const hasStart = nodes.some((n) => n && n.type === 'start');
  const hasEnd = nodes.some((n) => n && n.type === 'end');

  if (!hasStart) {
    errors.push({
      code: 'MISSING_START_NODE',
      message: 'O fluxo deve ter pelo menos um nó do tipo "start".',
      nodeIds: [],
    });
  }

  if (!hasEnd) {
    errors.push({
      code: 'MISSING_END_NODE',
      message: 'O fluxo deve ter pelo menos um nó do tipo "end".',
      nodeIds: [],
    });
  }

  return errors;
}

/**
 * Valida a estrutura básica do FlowDefinition.
 *
 * @param {FlowDefinition} flow
 * @returns {FlowValidationError[]}
 */
function validateFlowStructure(flow) {
  const errors = [];

  if (!flow || typeof flow !== 'object') {
    return [
      {
        code: 'INVALID_FLOW_STRUCTURE',
        message: 'O fluxo deve ser um objeto válido.',
        nodeIds: [],
      },
    ];
  }

  if (!Array.isArray(flow.nodes)) {
    errors.push({
      code: 'INVALID_NODES_ARRAY',
      message: 'O campo "nodes" deve ser um array.',
      nodeIds: [],
    });
    return errors; // Não podemos continuar sem nodes
  }

  if (flow.nodes.length === 0) {
    errors.push({
      code: 'EMPTY_FLOW',
      message: 'O fluxo deve ter pelo menos um nó.',
      nodeIds: [],
    });
  }

  if (flow.nodes.length > 1000) {
    errors.push({
      code: 'FLOW_TOO_LARGE',
      message: 'O fluxo excede o limite máximo de 1000 nós.',
      nodeIds: [],
      details: {
        nodeCount: flow.nodes.length,
        maxNodes: 1000,
      },
    });
  }

  // Validação de campos obrigatórios
  if (!flow.id || typeof flow.id !== 'string' || flow.id.trim() === '') {
    errors.push({
      code: 'INVALID_FLOW_ID',
      message: 'O fluxo deve ter um "id" válido (string não vazia).',
      nodeIds: [],
    });
  }

  if (!flow.tenantId || typeof flow.tenantId !== 'string' || flow.tenantId.trim() === '') {
    errors.push({
      code: 'INVALID_TENANT_ID',
      message: 'O fluxo deve ter um "tenantId" válido (string não vazia).',
      nodeIds: [],
    });
  }

  if (typeof flow.version !== 'number' || flow.version < 1 || !Number.isInteger(flow.version)) {
    errors.push({
      code: 'INVALID_VERSION',
      message: 'O campo "version" deve ser um número inteiro maior ou igual a 1.',
      nodeIds: [],
    });
  }

  return errors;
}

/**
 * Valida a estrutura de cada nó individual.
 *
 * @param {FlowDefinition} flow
 * @returns {FlowValidationError[]}
 */
function validateNodeStructures(flow) {
  const errors = [];
  const validNodeTypes = [
    'start',
    'message',
    'user_input',
    'router',
    'set_variable',
    'handoff',
    'ai',
    'end',
  ];

  for (let i = 0; i < (flow.nodes || []).length; i += 1) {
    const node = flow.nodes[i];
    if (!node || typeof node !== 'object') {
      errors.push({
        code: 'INVALID_NODE_STRUCTURE',
        message: `Nó na posição ${i} não é um objeto válido.`,
        nodeIds: [],
        details: {
          index: i,
        },
      });
      continue;
    }

    if (!node.id || typeof node.id !== 'string' || node.id.trim() === '') {
      errors.push({
        code: 'INVALID_NODE_ID',
        message: `Nó na posição ${i} não tem um "id" válido.`,
        nodeIds: [],
        details: {
          index: i,
        },
      });
    }

    if (!node.type || typeof node.type !== 'string') {
      errors.push({
        code: 'INVALID_NODE_TYPE',
        message: `Nó "${node.id || i}" não tem um "type" válido.`,
        nodeIds: node.id ? [node.id] : [],
        details: {
          index: i,
        },
      });
    } else if (!validNodeTypes.includes(node.type)) {
      errors.push({
        code: 'UNKNOWN_NODE_TYPE',
        message: `Nó "${node.id || i}" tem um tipo desconhecido: "${node.type}".`,
        nodeIds: node.id ? [node.id] : [],
        details: {
          index: i,
          type: node.type,
          validTypes: validNodeTypes,
        },
      });
    }

    // Validação específica por tipo de nó
    const nodeErrors = validateNodeConfig(node);
    errors.push(...nodeErrors);
  }

  return errors;
}

/**
 * Valida a configuração específica de um nó baseado no seu tipo.
 *
 * @param {FlowNode} node
 * @returns {FlowValidationError[]}
 */
function validateNodeConfig(node) {
  const errors = [];
  const nodeId = node.id || 'unknown';

  switch (node.type) {
    case 'message': {
      if (!node.config || typeof node.config !== 'object') {
        errors.push({
          code: 'MESSAGE_MISSING_CONFIG',
          message: `Nó de mensagem "${nodeId}" deve ter um campo "config" com o texto da mensagem.`,
          nodeIds: [nodeId],
        });
      } else if (!node.config.text || typeof node.config.text !== 'string') {
        errors.push({
          code: 'MESSAGE_MISSING_TEXT',
          message: `Nó de mensagem "${nodeId}" deve ter "config.text" (string não vazia).`,
          nodeIds: [nodeId],
        });
      } else if (node.config.text.trim().length === 0) {
        errors.push({
          code: 'MESSAGE_EMPTY_TEXT',
          message: `Nó de mensagem "${nodeId}" não pode ter texto vazio.`,
          nodeIds: [nodeId],
        });
      } else if (node.config.text.length > 10000) {
        errors.push({
          code: 'MESSAGE_TEXT_TOO_LONG',
          message: `Nó de mensagem "${nodeId}" excede o limite de 10000 caracteres.`,
          nodeIds: [nodeId],
          details: {
            length: node.config.text.length,
            maxLength: 10000,
          },
        });
      }
      break;
    }

    case 'user_input': {
      if (node.config && node.config.variable) {
        if (typeof node.config.variable !== 'string' || node.config.variable.trim() === '') {
          errors.push({
            code: 'USER_INPUT_INVALID_VARIABLE',
            message: `Nó de entrada "${nodeId}" tem "config.variable" inválido (deve ser string não vazia).`,
            nodeIds: [nodeId],
          });
        } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(node.config.variable)) {
          errors.push({
            code: 'USER_INPUT_INVALID_VARIABLE_NAME',
            message: `Nó de entrada "${nodeId}" tem nome de variável inválido (deve começar com letra ou _ e conter apenas letras, números e _).`,
            nodeIds: [nodeId],
            details: {
              variable: node.config.variable,
            },
          });
        }
      }
      break;
    }

    case 'router': {
      if (!node.config || typeof node.config !== 'object') {
        errors.push({
          code: 'ROUTER_MISSING_CONFIG',
          message: `Nó roteador "${nodeId}" deve ter um campo "config" com regras de roteamento.`,
          nodeIds: [nodeId],
        });
      } else if (!Array.isArray(node.config.rules)) {
        errors.push({
          code: 'ROUTER_MISSING_RULES',
          message: `Nó roteador "${nodeId}" deve ter "config.rules" (array de regras).`,
          nodeIds: [nodeId],
        });
      } else if (node.config.rules.length === 0) {
        errors.push({
          code: 'ROUTER_EMPTY_RULES',
          message: `Nó roteador "${nodeId}" deve ter pelo menos uma regra em "config.rules".`,
          nodeIds: [nodeId],
        });
      } else {
        // Valida cada regra
        for (let i = 0; i < node.config.rules.length; i += 1) {
          const rule = node.config.rules[i];
          if (!rule || typeof rule !== 'object') {
            errors.push({
              code: 'ROUTER_INVALID_RULE',
              message: `Regra ${i + 1} do roteador "${nodeId}" não é um objeto válido.`,
              nodeIds: [nodeId],
              details: {
                ruleIndex: i,
              },
            });
            continue;
          }

          if (!rule.condition || typeof rule.condition !== 'object') {
            errors.push({
              code: 'ROUTER_RULE_MISSING_CONDITION',
              message: `Regra ${i + 1} do roteador "${nodeId}" deve ter um campo "condition".`,
              nodeIds: [nodeId],
              details: {
                ruleIndex: i,
              },
            });
          } else {
            const op = rule.condition.op;
            const validOps = ['always', 'equals', 'contains'];
            if (!op || !validOps.includes(op)) {
              errors.push({
                code: 'ROUTER_INVALID_OPERATOR',
                message: `Regra ${i + 1} do roteador "${nodeId}" tem operador inválido. Use: ${validOps.join(', ')}.`,
                nodeIds: [nodeId],
                details: {
                  ruleIndex: i,
                  operator: op,
                  validOperators: validOps,
                },
              });
            }

            if (op !== 'always' && (!rule.condition.var || typeof rule.condition.var !== 'string')) {
              errors.push({
                code: 'ROUTER_RULE_MISSING_VAR',
                message: `Regra ${i + 1} do roteador "${nodeId}" deve ter "condition.var" quando o operador não é "always".`,
                nodeIds: [nodeId],
                details: {
                  ruleIndex: i,
                },
              });
            }
          }

          if (!rule.next || typeof rule.next !== 'string' || rule.next.trim() === '') {
            errors.push({
              code: 'ROUTER_RULE_MISSING_NEXT',
              message: `Regra ${i + 1} do roteador "${nodeId}" deve ter um campo "next" (id do próximo nó).`,
              nodeIds: [nodeId],
              details: {
                ruleIndex: i,
              },
            });
          }
        }
      }
      break;
    }

    case 'set_variable': {
      if (!node.config || typeof node.config !== 'object') {
        errors.push({
          code: 'SET_VARIABLE_MISSING_CONFIG',
          message: `Nó de variável "${nodeId}" deve ter um campo "config" com "assignments".`,
          nodeIds: [nodeId],
        });
      } else if (!node.config.assignments || typeof node.config.assignments !== 'object') {
        errors.push({
          code: 'SET_VARIABLE_MISSING_ASSIGNMENTS',
          message: `Nó de variável "${nodeId}" deve ter "config.assignments" (objeto com pares chave-valor).`,
          nodeIds: [nodeId],
        });
      } else {
        // Valida nomes de variáveis
        for (const varName of Object.keys(node.config.assignments)) {
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
            errors.push({
              code: 'SET_VARIABLE_INVALID_NAME',
              message: `Nó de variável "${nodeId}" tem nome de variável inválido: "${varName}".`,
              nodeIds: [nodeId],
              details: {
                variable: varName,
              },
            });
          }
        }
      }
      break;
    }

    case 'handoff': {
      if (node.config && node.config.queue) {
        if (typeof node.config.queue !== 'string' || node.config.queue.trim() === '') {
          errors.push({
            code: 'HANDOFF_INVALID_QUEUE',
            message: `Nó de handoff "${nodeId}" deve ter "config.queue" como string não vazia.`,
            nodeIds: [nodeId],
          });
        }
      }
      break;
    }

    case 'ai': {
      if (!node.config || typeof node.config !== 'object') {
        errors.push({
          code: 'AI_MISSING_CONFIG',
          message: `Nó de IA "${nodeId}" deve ter um campo "config" com "promptTemplate".`,
          nodeIds: [nodeId],
        });
      } else if (!node.config.promptTemplate || typeof node.config.promptTemplate !== 'string') {
        errors.push({
          code: 'AI_MISSING_PROMPT_TEMPLATE',
          message: `Nó de IA "${nodeId}" deve ter "config.promptTemplate" (string não vazia).`,
          nodeIds: [nodeId],
        });
      } else if (node.config.promptTemplate.trim().length === 0) {
        errors.push({
          code: 'AI_EMPTY_PROMPT_TEMPLATE',
          message: `Nó de IA "${nodeId}" não pode ter promptTemplate vazio.`,
          nodeIds: [nodeId],
        });
      } else if (node.config.promptTemplate.length > 50000) {
        errors.push({
          code: 'AI_PROMPT_TOO_LONG',
          message: `Nó de IA "${nodeId}" excede o limite de 50000 caracteres no promptTemplate.`,
          nodeIds: [nodeId],
          details: {
            length: node.config.promptTemplate.length,
            maxLength: 50000,
          },
        });
      }

      if (node.config && node.config.outputVariable) {
        if (typeof node.config.outputVariable !== 'string' || node.config.outputVariable.trim() === '') {
          errors.push({
            code: 'AI_INVALID_OUTPUT_VARIABLE',
            message: `Nó de IA "${nodeId}" tem "config.outputVariable" inválido.`,
            nodeIds: [nodeId],
          });
        } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(node.config.outputVariable)) {
          errors.push({
            code: 'AI_INVALID_OUTPUT_VARIABLE_NAME',
            message: `Nó de IA "${nodeId}" tem nome de variável de saída inválido.`,
            nodeIds: [nodeId],
            details: {
              variable: node.config.outputVariable,
            },
          });
        }
      }
      break;
    }

    default:
      // Outros tipos de nó não têm validação específica de config
      break;
  }

  return errors;
}

/**
 * Função principal de validação de fluxo.
 *
 * @param {FlowDefinition} flow
 * @returns {FlowValidationResult}
 */
function validateFlow(flow) {
  /** @type {FlowValidationError[]} */
  let errors = [];

  // Validações estruturais básicas (devem ser feitas primeiro)
  errors = errors.concat(validateFlowStructure(flow));

  // Se a estrutura básica está inválida, não continuamos com validações mais profundas
  if (errors.some((e) => e.code === 'INVALID_FLOW_STRUCTURE' || e.code === 'INVALID_NODES_ARRAY')) {
    return {
      valid: false,
      errors,
    };
  }

  // Validações de nós individuais
  errors = errors.concat(validateNodeStructures(flow));
  errors = errors.concat(validateDuplicateNodeIds(flow));
  errors = errors.concat(validateRequiredNodes(flow));

  // Validações de grafo (requerem estrutura válida)
  const edges = buildEdges(flow);
  errors = errors.concat(validateMissingTargetNodes(flow, edges));
  errors = errors.concat(validateDisconnectedNodes(flow, edges));
  errors = errors.concat(validateInvalidLoops(flow, edges));
  errors = errors.concat(validateTypeCompatibility(flow, edges));

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  validateFlow,
  // Exportamos também funções internas para facilitar testes unitários.
  _internal: {
    buildEdges,
    findEntryNodes,
    validateDisconnectedNodes,
    validateInvalidLoops,
    validateTypeCompatibility,
    validateMissingTargetNodes,
    validateDuplicateNodeIds,
    validateRequiredNodes,
    validateFlowStructure,
    validateNodeStructures,
    validateNodeConfig,
  },
};


