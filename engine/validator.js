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
 * Função principal de validação de fluxo.
 *
 * @param {FlowDefinition} flow
 * @returns {FlowValidationResult}
 */
function validateFlow(flow) {
  const edges = buildEdges(flow);

  /** @type {FlowValidationError[]} */
  let errors = [];

  errors = errors.concat(validateDisconnectedNodes(flow, edges));
  errors = errors.concat(validateInvalidLoops(flow, edges));
  errors = errors.concat(validateTypeCompatibility(flow, edges));
   errors = errors.concat(validateMissingTargetNodes(flow, edges));

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
  },
};


