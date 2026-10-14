const logPort = require('./shared/logger');
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
 * @property {string} message        - Mensagem técnica (para debug/logs)
 * @property {string} messageUi      - Mensagem amigável (para UI)
 * @property {string} severity       - Nível de severidade ("error", "warning", "info")
 * @property {string[]} [nodeIds]    - Nós envolvidos no problema
 * @property {Object<string, any>} [details] - Dados extras úteis (ex.: caminho do ciclo)
 */

/**
 * @typedef {Object} FlowValidationResult
 * @property {boolean} valid
 * @property {FlowValidationError[]} errors
 */

/**
 * Regras de compatibilidade de tipos importadas de módulo compartilhado.
 * 
 * Isso garante que as regras sejam as mesmas no backend (validação)
 * e no frontend (validação preventiva).
 */
const { TYPE_COMPATIBILITY } = require('./utils/typeCompatibility');

/**
 * Adiciona mensagem amigável (messageUi) a um erro de validação baseado no código.
 * 
 * @param {FlowValidationError} error - Erro com code, message, nodeIds
 * @returns {FlowValidationError & { messageUi: string, severity: string }} - Erro com messageUi adicionado
 */
function addUiMessage(error) {
  const nodeIds = Array.isArray(error.nodeIds) ? error.nodeIds : [];
  const technicalMessage = error.message || 'Erro de validação';
  
  // Mapeamento de códigos para mensagens amigáveis
  // ✅ getUiMessage agora recebe code e nodeIds como parâmetros explícitos
  const getUiMessage = (code, nodeIds) => {
    // Se já tem severity definido, usa ele
    if (error.severity) {
      // Mantém severity original
    }

    switch (code) {
      // Estrutura do Fluxo
      case 'INVALID_FLOW_STRUCTURE':
        return 'A estrutura do fluxo está incorreta. Verifique se o arquivo está no formato correto.';
      case 'INVALID_NODES_ARRAY':
        return 'A lista de nós do fluxo está incorreta. Verifique se está no formato de lista.';
      case 'EMPTY_FLOW':
        return 'O fluxo está vazio. Adicione pelo menos um nó para criar um fluxo válido.';
      case 'FLOW_TOO_LARGE':
        return 'O fluxo excede o limite máximo de 1000 nós. Remova alguns nós ou divida o fluxo em partes menores.';
      case 'INVALID_FLOW_ID':
        return 'O identificador do fluxo está inválido. Verifique se foi definido corretamente.';
      case 'INVALID_TENANT_ID':
        return 'O identificador do tenant está inválido. Verifique se foi definido corretamente.';
      case 'INVALID_VERSION':
        return 'A versão do fluxo está inválida. Deve ser um número inteiro maior ou igual a 1.';
      
      // Estrutura de Nós
      case 'INVALID_NODE_STRUCTURE':
        return 'Um ou mais nós têm estrutura inválida. Verifique se todos os nós estão configurados corretamente.';
      case 'INVALID_NODE_ID':
        return 'Um ou mais nós não têm um identificador válido. Cada nó deve ter um ID único e não vazio.';
      case 'INVALID_NODE_TYPE':
        return 'Um ou mais nós não têm um tipo válido. Verifique se o tipo do nó foi definido corretamente.';
      case 'UNKNOWN_NODE_TYPE':
        return 'Um ou mais nós têm um tipo desconhecido. Verifique se o tipo do nó é válido (start, message, user_input, router, set_variable, handoff, ai, end).';
      
      // Conexões e Topologia
      case 'NODE_DISCONNECTED':
        return nodeIds.length === 1
          ? 'Existe um nó que nunca será alcançado a partir do início do fluxo. Verifique as conexões para garantir que todos os nós estejam conectados.'
          : 'Existem nós que nunca serão alcançados a partir do início do fluxo. Verifique as conexões para garantir que todos os nós estejam conectados.';
      case 'INVALID_LOOP':
        return 'Foi detectado um loop no fluxo que pode causar execuções infinitas. Ajuste as conexões para evitar ciclos.';
      case 'TYPE_INCOMPATIBLE':
        return 'Uma conexão entre nós é incompatível com as regras do fluxo. Revise o tipo dos nós conectados e verifique se a conexão é permitida.';
      case 'NODE_TARGET_MISSING':
        return 'Uma conexão aponta para um nó que não existe. Verifique se todos os nós referenciados estão presentes no fluxo.';
      case 'DUPLICATE_NODE_ID':
        return nodeIds.length === 1
          ? 'Existe um nó com ID duplicado. Cada nó deve ter um ID único. Renomeie o nó para usar um identificador diferente.'
          : 'Existem nós com IDs duplicados. Cada nó deve ter um ID único. Renomeie os nós para usar identificadores diferentes.';
      
      // Nós Obrigatórios
      case 'MISSING_START_NODE':
        return 'O fluxo deve ter pelo menos um nó do tipo "start" para definir o ponto de entrada. Adicione um nó Start ao fluxo.';
      case 'MULTIPLE_START_NODES':
        return nodeIds.length === 2
          ? 'O fluxo deve ter exatamente um nó do tipo "start". Existem 2 nós de início. Remova um deles ou ajuste o fluxo para ter apenas um ponto de entrada.'
          : `O fluxo deve ter exatamente um nó do tipo "start". Existem ${nodeIds.length} nós de início. Remova os nós extras ou ajuste o fluxo para ter apenas um ponto de entrada.`;
      case 'MISSING_END_NODE':
        return 'O fluxo deve ter pelo menos um nó do tipo "end" para definir o ponto de saída. Adicione um nó End ao fluxo.';
      case 'START_MISSING_NEXT':
        return 'O nó start deve ter um campo "next" apontando para o próximo nó do fluxo.';
      case 'START_HAS_INPUTS':
        return 'O nó start não pode ter entradas. Deve ser o único ponto de entrada do fluxo.';
      case 'END_HAS_OUTPUTS':
        return 'O nó end não pode ter saídas. Nós end devem ser folhas do fluxo (sem campo "next").';
      case 'FLOW_WITHOUT_ACTIONS':
        return 'O fluxo deve ter pelo menos um nó de ação (message, user_input, ai_task, set_variable, handoff, ai, fallback, api, options, etc.). Fluxos apenas com nós estruturais (start, end, router) são inválidos.';
      
      // Nó Message
      case 'MESSAGE_MISSING_CONFIG':
        return 'O nó de mensagem não tem configuração. Adicione o texto da mensagem na configuração do nó.';
      case 'MESSAGE_MISSING_TEXT':
        return 'O nó de mensagem não tem texto definido. Adicione o texto que será exibido ao usuário na configuração do nó.';
      case 'MESSAGE_EMPTY_TEXT':
        return 'O nó de mensagem não pode ter texto vazio. Adicione uma mensagem válida na configuração do nó.';
      case 'MESSAGE_TEXT_TOO_LONG':
        return 'O texto da mensagem excede o limite de 10000 caracteres. Reduza o tamanho da mensagem ou divida em múltiplas mensagens.';
      case 'MESSAGE_VAR_NEVER_DEFINED':
        return 'Uma variável interpolada na mensagem nunca é definida no fluxo. Verifique se a variável é definida antes de ser usada.';
      
      // Nó User Input
      case 'USER_INPUT_MISSING_CONFIG':
        return 'O nó de entrada do usuário não tem configuração. Adicione o nome da variável onde a resposta será armazenada.';
      case 'USER_INPUT_INVALID_VARIABLE':
        return 'O nó de entrada do usuário não tem uma variável válida configurada. Defina o nome da variável onde a resposta do usuário será armazenada.';
      case 'USER_INPUT_INVALID_VARIABLE_NAME':
        return 'O nome da variável do nó de entrada é inválido. O nome deve começar com letra ou sublinhado (_) e conter apenas letras, números e sublinhados.';
      case 'USER_INPUT_INVALID_TYPE':
        return 'O tipo esperado do nó de entrada é inválido. Use: string, number ou intent.';
      
      // Nó Router
      case 'ROUTER_MISSING_CONFIG':
        return 'O nó roteador não tem configuração. Adicione as regras de roteamento na configuração do nó.';
      case 'ROUTER_MISSING_RULES':
        return 'O nó roteador não tem regras de roteamento. Adicione pelo menos uma regra para definir como o fluxo será direcionado.';
      case 'ROUTER_EMPTY_RULES':
        return 'O nó roteador não tem regras de roteamento. Adicione pelo menos uma regra para definir como o fluxo será direcionado.';
      case 'ROUTER_INVALID_RULE':
        return 'Uma das regras do roteador está inválida. Verifique se todas as regras estão configuradas corretamente.';
      case 'ROUTER_RULE_MISSING_CONDITION':
        return 'Uma regra do roteador não tem condição definida. Cada regra deve ter uma condição que determina quando ela será aplicada.';
      case 'ROUTER_INVALID_OPERATOR':
        return 'Uma regra do roteador tem um operador inválido. Use apenas os operadores permitidos (equals, not_equals, contains, not_contains, greater_than, less_than, always).';
      case 'ROUTER_RULE_MISSING_VAR':
        return 'Uma regra do roteador não tem variável definida. Quando o operador não é "always", é necessário especificar qual variável será verificada.';
      case 'ROUTER_RULE_MISSING_NEXT':
        return 'Uma regra do roteador não tem próximo nó definido. Cada regra deve especificar para qual nó o fluxo deve seguir quando a condição for verdadeira.';
      case 'ROUTER_MISSING_FALLBACK':
        return 'O nó roteador deve ter um fallback explícito. Adicione uma regra com op="always" OU defina um campo "next" padrão válido.';
      case 'ROUTER_VAR_NEVER_DEFINED':
        return 'Uma variável usada no roteador nunca é definida no fluxo. Verifique se a variável é definida antes de ser usada.';
      
      // Nó Set Variable
      case 'SET_VARIABLE_MISSING_CONFIG':
        return 'O nó de variável não tem configuração. Adicione as atribuições de variáveis na configuração do nó.';
      case 'SET_VARIABLE_MISSING_ASSIGNMENTS':
        return 'O nó de variável não tem atribuições definidas. Adicione pelo menos uma variável e seu valor na configuração do nó.';
      case 'SET_VARIABLE_INVALID_NAME':
        return 'O nome de uma variável no nó de variável é inválido. O nome deve começar com letra ou sublinhado (_) e conter apenas letras, números e sublinhados.';
      case 'SET_VARIABLE_EMPTY_ASSIGNMENTS':
        return 'O nó de variável deve ter pelo menos uma atribuição definida. Adicione pelo menos uma variável e seu valor na configuração do nó.';
      case 'SET_VARIABLE_UNDEFINED_VALUE':
        return 'O nó de variável não pode ter valores undefined. Use null para valores vazios.';
      case 'SET_VARIABLE_OVERWRITE':
        return 'Uma variável será sobrescrita. Verifique se isso é intencional.';
      
      // Nó Handoff
      case 'HANDOFF_INVALID_QUEUE':
        return 'O nó de handoff não tem uma fila válida configurada. Defina o nome da fila para onde a conversa será transferida.';
      
      // Nó Fallback
      case 'FALLBACK_INVALID_ESCALATION_MODE':
        return 'O nó de fallback tem modo de escalada inválido. Use "ticket" para escalada assíncrona ou "human" para atendimento em tempo real.';
      case 'FALLBACK_INVALID_QUEUE':
        return 'O nó de fallback tem fila inválida. Defina um nome de fila válido para escalada via ticket.';
      case 'FALLBACK_INVALID_MAX_ATTEMPTS':
        return 'O nó de fallback tem número máximo de tentativas inválido. Deve ser um número entre 1 e 10.';
      case 'FALLBACK_INVALID_THRESHOLD':
        return 'O nó de fallback tem threshold de confiança inválido. Deve ser um número entre 0.0 e 1.0.';
      
      // Nó AI
      case 'AI_MISSING_CONFIG':
        return 'O nó de IA não tem configuração. Adicione o template de prompt na configuração do nó.';
      case 'AI_MISSING_PROMPT_TEMPLATE':
        return 'O nó de IA não tem template de prompt definido. Adicione o prompt que será enviado para a IA na configuração do nó.';
      case 'AI_EMPTY_PROMPT_TEMPLATE':
        return 'O nó de IA não pode ter template de prompt vazio. Adicione um prompt válido na configuração do nó.';
      case 'AI_PROMPT_TOO_LONG':
        return 'O template de prompt do nó de IA excede o limite de 50000 caracteres. Reduza o tamanho do prompt ou divida em partes menores.';
      case 'AI_INVALID_OUTPUT_VARIABLE':
        return 'O nó de IA não tem variável de saída válida configurada. Defina o nome da variável onde a resposta da IA será armazenada.';
      case 'AI_INVALID_OUTPUT_VARIABLE_NAME':
        return 'O nome da variável de saída do nó de IA é inválido. O nome deve começar com letra ou sublinhado (_) e conter apenas letras, números e sublinhados.';
      
      // Nó Subflow
      case 'SUBFLOW_MISSING_CONFIG':
        return 'O nó de subfluxo não tem configuração. Preencha o campo "config.flowId".';
      case 'SUBFLOW_MISSING_FLOW_ID':
        return 'O nó de subfluxo precisa de um "config.flowId" (string não vazia).';
      case 'SUBFLOW_INVALID_TIMEOUT':
        return 'O nó de subfluxo tem timeout inválido. Use um número entre 0 e 300000ms.';

      // Nó Options
      case 'OPTIONS_MISSING_NEXT':
        return 'O nó de opções precisa estar conectado a um próximo nó (campo "next").';
      case 'OPTIONS_MISSING_OUT_PORT':
        return 'O nó de opções precisa ter um caminho principal. Defina next.out apontando para um nó existente.';
      case 'OPTIONS_MISSING_FALLBACK_PORT':
        return 'O nó de opções precisa ter um caminho de fallback. Defina next.fallback apontando para um nó existente.';

      // Nó Merge
      case 'MERGE_MISSING_NEXT':
        return 'O nó merge precisa ter um campo "next" apontando para o próximo nó.';

      default:
        return technicalMessage || 'Foi encontrado um problema na definição do fluxo. Revise a configuração dos nós destacados.';
    }
  };
  
  // ✅ Passa nodeIds como parâmetro explícito
  const messageUi = getUiMessage(error.code, nodeIds);
  
  return {
    ...error,
    message: technicalMessage,
    messageUi,
    severity: error.severity || 'error', // Usa severity do erro ou default 'error'
  };
}

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
      } else if (typeof node.next === 'object') {
        for (const rawNext of Object.values(node.next)) {
          if (!rawNext) continue;
          if (typeof rawNext === 'string') {
            edges.push({ from: node.id, to: rawNext });
          } else if (Array.isArray(rawNext)) {
            for (const nextId of rawNext) {
              if (typeof nextId === 'string') {
                edges.push({ from: node.id, to: nextId });
              }
            }
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

  // Debug: log das arestas construídas
  if (edges.length === 0 && (flow.nodes || []).length > 0) {
    logPort.warn('[validator] buildEdges - Nenhuma aresta construída', {
      nodeCount: (flow.nodes || []).length,
      nodes: (flow.nodes || []).map(n => ({
        id: n.id,
        type: n.type,
        next: n.next,
        hasNext: !!n.next,
      })),
    });
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

  // Debug: log detalhado quando há nós desconectados
  logPort.warn('[validator] validateDisconnectedNodes - Nós desconectados detectados', {
    disconnectedCount: disconnected.length,
    disconnectedNodes: disconnected,
    entryNodes: entries,
    edgesCount: edges.length,
    edges: edges,
    totalNodes: (flow.nodes || []).length,
    nodeIds: (flow.nodes || []).map(n => n.id),
    adjacencyList: Array.from(adj.entries()).map(([id, neighbors]) => ({
      nodeId: id,
      neighbors,
    })),
  });

  return [
    addUiMessage({
      code: 'NODE_DISCONNECTED',
      message: 'Existem nós não alcançáveis a partir de qualquer nó de entrada.',
      nodeIds: disconnected,
      details: {
        entryNodes: entries,
      },
    }),
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
  const nodeMap = buildNodeMap(flow);

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
   * Um loop é considerado "controlado" quando:
   * - existe pelo menos um nó do ciclo (router/options) com uma saída "limit_exceeded"
   * - e essa saída aponta para um nó FORA do próprio ciclo
   *
   * Isso permite casos intencionais como "voltar ao menu" sem risco de execução infinita.
   *
   * @param {string[]} cyclePath
   */
  function isControlledLoop(cyclePath) {
    const cycleSet = new Set(cyclePath);
    for (const id of cyclePath) {
      const node = nodeMap.get(id);
      const type = node?.type || null;
      if (type !== 'router' && type !== 'options') continue;
      const next = node?.next;
      if (!next || typeof next !== 'object' || Array.isArray(next)) continue;
      const target = next.limit_exceeded;
      if (typeof target !== 'string' || !target.trim()) continue;
      if (!cycleSet.has(target)) {
        return true;
      }
    }
    return false;
  }

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
      // Se o ciclo for controlado via saída limit_exceeded para fora do ciclo, aceitamos.
      if (!isControlledLoop(cyclePath)) {
        errors.push(addUiMessage({
          code: 'INVALID_LOOP',
          message: 'Loop inválido detectado no fluxo.',
          nodeIds: cyclePath,
          details: {
            cyclePath,
            hint: 'Para permitir um loop intencional, conecte o socket "limit_exceeded" de um nó do ciclo (router/options) para fora do ciclo e defina loopMaxAttempts.',
          },
        }));
      }
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
      errors.push(addUiMessage({
        code: 'TYPE_INCOMPATIBLE',
        message: `Tipo de nó incompatível: não é permitido conectar "${fromType}" -> "${toType}".`,
        nodeIds: [fromNode.id, toNode.id],
        details: {
          fromType,
          toType,
          allowedTargets,
        },
      }));
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
      errors.push(addUiMessage({
        code: 'NODE_TARGET_MISSING',
        message: `Conexão aponta para nó inexistente: "${e.to}".`,
        nodeIds: [e.from],
        details: {
          from: e.from,
          to: e.to,
        },
      }));
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
    addUiMessage({
      code: 'DUPLICATE_NODE_ID',
      message: 'Existem nós com IDs duplicados no fluxo.',
      nodeIds: duplicates,
      details: {
        duplicateIds: duplicates,
      },
    }),
  ];
}

/**
 * Valida se o fluxo tem pelo menos um nó de início e um nó de fim.
 * Também valida que não há múltiplos nós de início.
 *
 * @param {FlowDefinition} flow
 * @returns {FlowValidationError[]}
 */
function validateRequiredNodes(flow) {
  const errors = [];
  const nodes = flow.nodes || [];
  const startNodes = nodes.filter((n) => n && n.type === 'start');
  const hasStart = startNodes.length > 0;
  const hasEnd = nodes.some((n) => n && n.type === 'end');

  if (!hasStart) {
    errors.push(addUiMessage({
      code: 'MISSING_START_NODE',
      message: 'O fluxo deve ter pelo menos um nó do tipo "start".',
      nodeIds: [],
    }));
  } else if (startNodes.length > 1) {
    errors.push(addUiMessage({
      code: 'MULTIPLE_START_NODES',
      message: 'O fluxo deve ter exatamente um nó do tipo "start".',
      nodeIds: startNodes.map((n) => n.id),
      details: {
        startNodeCount: startNodes.length,
        startNodeIds: startNodes.map((n) => n.id),
      },
    }));
  }

  if (!hasEnd) {
    errors.push(addUiMessage({
      code: 'MISSING_END_NODE',
      message: 'O fluxo deve ter pelo menos um nó do tipo "end".',
      nodeIds: [],
    }));
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
      addUiMessage({
        code: 'INVALID_FLOW_STRUCTURE',
        message: 'O fluxo deve ser um objeto válido.',
        nodeIds: [],
      }),
    ];
  }

  if (!Array.isArray(flow.nodes)) {
    errors.push(addUiMessage({
      code: 'INVALID_NODES_ARRAY',
      message: 'O campo "nodes" deve ser um array.',
      nodeIds: [],
    }));
    return errors; // Não podemos continuar sem nodes
  }

  if (flow.nodes.length === 0) {
    errors.push(addUiMessage({
      code: 'EMPTY_FLOW',
      message: 'O fluxo deve ter pelo menos um nó.',
      nodeIds: [],
    }));
  }

  if (flow.nodes.length > 1000) {
    errors.push(addUiMessage({
      code: 'FLOW_TOO_LARGE',
      message: 'O fluxo excede o limite máximo de 1000 nós.',
      nodeIds: [],
      details: {
        nodeCount: flow.nodes.length,
        maxNodes: 1000,
      },
    }));
  }

  // Validação de campos obrigatórios
  if (!flow.id || typeof flow.id !== 'string' || flow.id.trim() === '') {
    errors.push(addUiMessage({
      code: 'INVALID_FLOW_ID',
      message: 'O fluxo deve ter um "id" válido (string não vazia).',
      nodeIds: [],
    }));
  }

  if (!flow.tenantId || typeof flow.tenantId !== 'string' || flow.tenantId.trim() === '') {
    errors.push(addUiMessage({
      code: 'INVALID_TENANT_ID',
      message: 'O fluxo deve ter um "tenantId" válido (string não vazia).',
      nodeIds: [],
    }));
  }

  if (typeof flow.version !== 'number' || flow.version < 1 || !Number.isInteger(flow.version)) {
    errors.push(addUiMessage({
      code: 'INVALID_VERSION',
      message: 'O campo "version" deve ser um número inteiro maior ou igual a 1.',
      nodeIds: [],
    }));
  }

  return errors;
}

/**
 * Valida regras semânticas do fluxo completo.
 *
 * @param {FlowDefinition} flow
 * @returns {FlowValidationError[]}
 */
function validateSemanticRules(flow) {
  const errors = [];
  const edges = buildEdges(flow);
  const nodeMap = buildNodeMap(flow);

  // Valida que start não tem entradas
  const startNodes = (flow.nodes || []).filter(n => n && n.type === 'start');
  for (const startNode of startNodes) {
    const hasIncoming = edges.some(e => e.to === startNode.id);
    if (hasIncoming) {
      errors.push(addUiMessage({
        code: 'START_HAS_INPUTS',
        message: `Nó start "${startNode.id}" não pode ter entradas (deve ser nó de entrada único).`,
        nodeIds: [startNode.id],
        severity: 'error',
      }));
    }
  }

  // Valida que end só pode ser folha (sem saídas)
  const endNodes = (flow.nodes || []).filter(n => n && n.type === 'end');
  for (const endNode of endNodes) {
    if (endNode.next) {
      errors.push(addUiMessage({
        code: 'END_HAS_OUTPUTS',
        message: `Nó end "${endNode.id}" não pode ter saídas (campo "next"). Nós end devem ser folhas do fluxo.`,
        nodeIds: [endNode.id],
        severity: 'error',
      }));
    }
  }

  // Valida que o fluxo tem pelo menos um nó de ação
  // Nós estruturais: start, end, router (apenas roteiam, não executam ações)
  // Nós de ação: todos os outros tipos (message, user_input, ai_task, set_variable, handoff, ai, fallback, api, options, etc.)
  const structuralNodeTypes = ['start', 'end', 'router', 'schedule_router'];
  const actionNodes = (flow.nodes || []).filter(n => n && n.type && !structuralNodeTypes.includes(n.type));
  
  if (actionNodes.length === 0) {
    errors.push(addUiMessage({
      code: 'FLOW_WITHOUT_ACTIONS',
      message: 'O fluxo deve ter pelo menos um nó de ação (message, user_input, ai_task, set_variable, handoff, ai, fallback, api, options, etc.). Fluxos apenas com nós estruturais (start, end, router) são inválidos.',
      nodeIds: [],
      severity: 'error',
    }));
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
    'merge',
    'router',
    'semantic_router',
    'schedule_router',
    'set_variable',
    'handoff',
    'ai',
    'rag_answer',
    'ai_task',
    'fallback',
    'options',
    'api',
    'business_entry',
    'subflow',
    // system/persistence nodes
    'get_flow_info',
    'get_queue_status',
    'get_config_value',
    'list_flows',
    'get_current_time',
    'generate_uuid',
    'delay',
    'format_date',
    'random_number',
    'get_user_info',
    'end',
  ];

  for (let i = 0; i < (flow.nodes || []).length; i += 1) {
    const node = flow.nodes[i];
    if (!node || typeof node !== 'object') {
      errors.push(addUiMessage({
        code: 'INVALID_NODE_STRUCTURE',
        message: `Nó na posição ${i} não é um objeto válido.`,
        nodeIds: [],
        details: {
          index: i,
        },
      }));
      continue;
    }

    if (!node.id || typeof node.id !== 'string' || node.id.trim() === '') {
      errors.push(addUiMessage({
        code: 'INVALID_NODE_ID',
        message: `Nó na posição ${i} não tem um "id" válido.`,
        nodeIds: [],
        details: {
          index: i,
        },
      }));
    }

    if (!node.type || typeof node.type !== 'string') {
      errors.push(addUiMessage({
        code: 'INVALID_NODE_TYPE',
        message: `Nó "${node.id || i}" não tem um "type" válido.`,
        nodeIds: node.id ? [node.id] : [],
        details: {
          index: i,
        },
      }));
    } else if (!validNodeTypes.includes(node.type)) {
      errors.push(addUiMessage({
        code: 'UNKNOWN_NODE_TYPE',
        message: `Nó "${node.id || i}" tem um tipo desconhecido: "${node.type}".`,
        nodeIds: node.id ? [node.id] : [],
        details: {
          index: i,
          type: node.type,
          validTypes: validNodeTypes,
        },
      }));
    }

    // Validação específica por tipo de nó (passa fluxo completo para análise de variáveis)
    const nodeErrors = validateNodeConfig(node, flow);
    errors.push(...nodeErrors);
  }

  return errors;
}

/**
 * Analisa o fluxo completo para detectar variáveis definidas e usadas.
 * Retorna um mapa de variáveis definidas (set_variable) e usadas (router, message).
 *
 * @param {FlowDefinition} flow
 * @returns {{defined: Set<string>, used: Map<string, string[]>}}
 */
function analyzeVariableUsage(flow) {
  const defined = new Set();
  const used = new Map(); // varName -> [nodeIds que usam]

  for (const node of flow.nodes || []) {
    // ----------------------------
    // Variáveis DEFINIDAS (fontes)
    // ----------------------------
    // Regra geral: qualquer nó que produz um valor e o armazena em uma variável deve
    // contar como "definido" para evitar falsos positivos em VAR_NEVER_DEFINED.

    // set_variable define 1..N variáveis
    if (node.type === 'set_variable' && node.config && node.config.assignments && typeof node.config.assignments === 'object') {
      for (const varName of Object.keys(node.config.assignments)) {
        defined.add(varName);
      }
    }

    // user_input captura texto do usuário para uma variável
    if (node.type === 'user_input' && node.config && typeof node.config.variable === 'string' && node.config.variable.trim()) {
      defined.add(node.config.variable.trim());
    }

    // options armazena a opção selecionada em uma variável
    if (node.type === 'options' && node.config && typeof node.config.variable === 'string' && node.config.variable.trim()) {
      defined.add(node.config.variable.trim());
    }

    // ai / api / system nodes podem escrever em outputVariable (quando suportado)
    const outputVar = node?.config && typeof node.config.outputVariable === 'string'
      ? node.config.outputVariable.trim()
      : '';
    if (outputVar) {
      defined.add(outputVar);
    }

    // Variáveis usadas em router
    if (node.type === 'router' && node.config && Array.isArray(node.config.rules)) {
      for (const rule of node.config.rules) {
        if (rule && rule.condition && rule.condition.var && rule.condition.op !== 'always') {
          const varName = rule.condition.var;
          if (!used.has(varName)) {
            used.set(varName, []);
          }
          used.get(varName).push(node.id);
        }
      }
    }

    // Variáveis usadas em message (interpolação {{var}})
    if (node.type === 'message' && node.config && node.config.text) {
      const text = String(node.config.text);
      const varMatches = text.match(/\{\{(\w+)\}\}/g);
      if (varMatches) {
        for (const match of varMatches) {
          const varName = match.replace(/\{\{|\}\}/g, '');
          if (!used.has(varName)) {
            used.set(varName, []);
          }
          used.get(varName).push(node.id);
        }
      }
    }
  }

  return { defined, used };
}

/**
 * Valida a configuração específica de um nó baseado no seu tipo.
 *
 * @param {FlowNode} node
 * @param {FlowDefinition} flow - Fluxo completo (para análise de variáveis)
 * @returns {FlowValidationError[]}
 */
function validateNodeConfig(node, flow = null) {
  const errors = [];
  const nodeId = node.id || 'unknown';

  switch (node.type) {
    case 'merge': {
      // Nó merge é estrutural/no-op: exige apenas next válido.
      const hasValidNext =
        typeof node.next === 'string' ||
        Array.isArray(node.next) ||
        (node.next && typeof node.next === 'object' && (node.next.out || Object.keys(node.next).length > 0));

      if (!node.next || !hasValidNext) {
        errors.push(addUiMessage({
          code: 'MERGE_MISSING_NEXT',
          message: `Nó merge "${nodeId}" deve ter um campo "next" apontando para o próximo nó.`,
          nodeIds: [nodeId],
        }));
      }
      break;
    }

    case 'message': {
      if (!node.config || typeof node.config !== 'object') {
        errors.push(addUiMessage({
          code: 'MESSAGE_MISSING_CONFIG',
          message: `Nó de mensagem "${nodeId}" deve ter um campo "config" com o texto da mensagem.`,
          nodeIds: [nodeId],
        }));
      } else if (!node.config.text || typeof node.config.text !== 'string') {
        errors.push(addUiMessage({
          code: 'MESSAGE_MISSING_TEXT',
          message: `Nó de mensagem "${nodeId}" deve ter "config.text" (string não vazia).`,
          nodeIds: [nodeId],
        }));
      } else if (node.config.text.trim().length === 0) {
        errors.push(addUiMessage({
          code: 'MESSAGE_EMPTY_TEXT',
          message: `Nó de mensagem "${nodeId}" não pode ter texto vazio.`,
          nodeIds: [nodeId],
        }));
      } else if (node.config.text.length > 10000) {
        errors.push(addUiMessage({
          code: 'MESSAGE_TEXT_TOO_LONG',
          message: `Nó de mensagem "${nodeId}" excede o limite de 10000 caracteres.`,
          nodeIds: [nodeId],
          details: {
            length: node.config.text.length,
            maxLength: 10000,
          },
        }));
      } else {
        // WARNING: Variáveis interpoladas não definidas
        if (flow) {
          const { defined } = analyzeVariableUsage(flow);
          const text = String(node.config.text);
          const varMatches = text.match(/\{\{(\w+)\}\}/g);
          if (varMatches) {
            for (const match of varMatches) {
              const varName = match.replace(/\{\{|\}\}/g, '');
              if (!defined.has(varName)) {
                errors.push(addUiMessage({
                  code: 'MESSAGE_VAR_NEVER_DEFINED',
                  message: `Variável "${varName}" interpolada na mensagem "${nodeId}" nunca é definida no fluxo.`,
                  nodeIds: [nodeId],
                  severity: 'warning',
                  details: {
                    variable: varName,
                  },
                }));
              }
            }
          }
        }
      }
      break;
    }

    case 'user_input': {
      if (!node.config || typeof node.config !== 'object') {
        errors.push(addUiMessage({
          code: 'USER_INPUT_MISSING_CONFIG',
          message: `Nó de entrada "${nodeId}" deve ter um campo "config" com "variable".`,
          nodeIds: [nodeId],
        }));
      } else if (!node.config.variable || typeof node.config.variable !== 'string' || node.config.variable.trim() === '') {
        errors.push(addUiMessage({
          code: 'USER_INPUT_INVALID_VARIABLE',
          message: `Nó de entrada "${nodeId}" deve ter "config.variable" (string não vazia).`,
          nodeIds: [nodeId],
        }));
      } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(node.config.variable)) {
        errors.push(addUiMessage({
          code: 'USER_INPUT_INVALID_VARIABLE_NAME',
          message: `Nó de entrada "${nodeId}" tem nome de variável inválido (deve começar com letra ou _ e conter apenas letras, números e _).`,
          nodeIds: [nodeId],
          details: {
            variable: node.config.variable,
          },
        }));
      }
      // Valida tipo esperado se fornecido
      if (node.config.expectedType && !['string', 'number', 'intent'].includes(node.config.expectedType)) {
        errors.push(addUiMessage({
          code: 'USER_INPUT_INVALID_TYPE',
          message: `Nó de entrada "${nodeId}" tem tipo esperado inválido. Use: string, number ou intent.`,
          nodeIds: [nodeId],
          details: {
            expectedType: node.config.expectedType,
          },
        }));
      }
      break;
    }

    case 'router': {
      if (!node.config || typeof node.config !== 'object') {
        errors.push(addUiMessage({
          code: 'ROUTER_MISSING_CONFIG',
          message: `Nó roteador "${nodeId}" deve ter um campo "config" com regras de roteamento.`,
          nodeIds: [nodeId],
        }));
      } else if (!Array.isArray(node.config.rules)) {
        errors.push(addUiMessage({
          code: 'ROUTER_MISSING_RULES',
          message: `Nó roteador "${nodeId}" deve ter "config.rules" (array de regras).`,
          nodeIds: [nodeId],
        }));
      } else if (node.config.rules.length === 0) {
        errors.push(addUiMessage({
          code: 'ROUTER_EMPTY_RULES',
          message: `Nó roteador "${nodeId}" deve ter pelo menos uma regra em "config.rules".`,
          nodeIds: [nodeId],
        }));
      } else {
        let hasAlwaysRule = false;
        let hasDefaultNext = false;
        
        // Valida cada regra
        for (let i = 0; i < node.config.rules.length; i += 1) {
          const rule = node.config.rules[i];
          if (!rule || typeof rule !== 'object') {
            errors.push(addUiMessage({
              code: 'ROUTER_INVALID_RULE',
              message: `Regra ${i + 1} do roteador "${nodeId}" não é um objeto válido.`,
              nodeIds: [nodeId],
              details: {
                ruleIndex: i,
              },
            }));
            continue;
          }

          if (!rule.condition || typeof rule.condition !== 'object') {
            errors.push(addUiMessage({
              code: 'ROUTER_RULE_MISSING_CONDITION',
              message: `Regra ${i + 1} do roteador "${nodeId}" deve ter um campo "condition".`,
              nodeIds: [nodeId],
              details: {
                ruleIndex: i,
              },
            }));
          } else {
            const op = rule.condition.op;
            const validOps = ['always', 'equals', 'contains', 'not_equals', 'not_contains', 'greater_than', 'less_than'];
            if (!op || !validOps.includes(op)) {
              errors.push(addUiMessage({
                code: 'ROUTER_INVALID_OPERATOR',
                message: `Regra ${i + 1} do roteador "${nodeId}" tem operador inválido. Use: ${validOps.join(', ')}.`,
                nodeIds: [nodeId],
                details: {
                  ruleIndex: i,
                  operator: op,
                  validOperators: validOps,
                },
              }));
            }

            if (op === 'always') {
              hasAlwaysRule = true;
            }

            if (op !== 'always' && (!rule.condition.var || typeof rule.condition.var !== 'string' || rule.condition.var.trim() === '')) {
              errors.push(addUiMessage({
                code: 'ROUTER_RULE_MISSING_VAR',
                message: `Regra ${i + 1} do roteador "${nodeId}" deve ter "condition.var" não vazio quando o operador não é "always".`,
                nodeIds: [nodeId],
                details: {
                  ruleIndex: i,
                },
              }));
            }
          }

          if (!rule.next || typeof rule.next !== 'string' || rule.next.trim() === '') {
            errors.push(addUiMessage({
              code: 'ROUTER_RULE_MISSING_NEXT',
              message: `Regra ${i + 1} do roteador "${nodeId}" deve ter um campo "next" (id do próximo nó).`,
              nodeIds: [nodeId],
              details: {
                ruleIndex: i,
              },
            }));
          }
        }

        // Validação de fallback explícito: deve ter regra com op=always OU defaultNext válido
        if (node.next) {
          if (typeof node.next === 'string' && node.next.trim() !== '') {
            hasDefaultNext = true;
          } else if (typeof node.next === 'object' && node.next.out && typeof node.next.out === 'string' && node.next.out.trim() !== '') {
            hasDefaultNext = true;
          }
        }

        if (!hasAlwaysRule && !hasDefaultNext) {
          errors.push(addUiMessage({
            code: 'ROUTER_MISSING_FALLBACK',
            message: `Nó roteador "${nodeId}" deve ter fallback explícito: regra com op="always" OU campo "next" padrão válido.`,
            nodeIds: [nodeId],
            details: {
              hasAlwaysRule,
              hasDefaultNext,
            },
          }));
        }

        // WARNING: Variáveis usadas em router que nunca são definidas
        if (flow) {
          const { defined, used } = analyzeVariableUsage(flow);
          for (const rule of node.config.rules) {
            if (rule && rule.condition && rule.condition.var && rule.condition.op !== 'always') {
              const varName = rule.condition.var;
              if (!defined.has(varName)) {
                errors.push(addUiMessage({
                  code: 'ROUTER_VAR_NEVER_DEFINED',
                  message: `Variável "${varName}" usada no roteador "${nodeId}" nunca é definida no fluxo.`,
                  nodeIds: [nodeId],
                  severity: 'warning',
                  details: {
                    variable: varName,
                  },
                }));
              }
            }
          }
        }
      }
      break;
    }

    case 'set_variable': {
      if (!node.config || typeof node.config !== 'object') {
        errors.push(addUiMessage({
          code: 'SET_VARIABLE_MISSING_CONFIG',
          message: `Nó de variável "${nodeId}" deve ter um campo "config" com "assignments".`,
          nodeIds: [nodeId],
        }));
      } else if (!node.config.assignments || typeof node.config.assignments !== 'object') {
        errors.push(addUiMessage({
          code: 'SET_VARIABLE_MISSING_ASSIGNMENTS',
          message: `Nó de variável "${nodeId}" deve ter "config.assignments" (objeto com pares chave-valor).`,
          nodeIds: [nodeId],
        }));
      } else {
        const assignments = node.config.assignments;
        const varNames = Object.keys(assignments);
        
        if (varNames.length === 0) {
          errors.push(addUiMessage({
            code: 'SET_VARIABLE_EMPTY_ASSIGNMENTS',
            message: `Nó de variável "${nodeId}" deve ter pelo menos uma atribuição em "config.assignments".`,
            nodeIds: [nodeId],
          }));
        } else {
          // Valida nomes de variáveis e valores
          for (const varName of varNames) {
            if (!varName || typeof varName !== 'string' || varName.trim() === '') {
              errors.push(addUiMessage({
                code: 'SET_VARIABLE_INVALID_NAME',
                message: `Nó de variável "${nodeId}" tem nome de variável inválido (vazio ou não string).`,
                nodeIds: [nodeId],
                details: {
                  variable: varName,
                },
              }));
            } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
              errors.push(addUiMessage({
                code: 'SET_VARIABLE_INVALID_NAME',
                message: `Nó de variável "${nodeId}" tem nome de variável inválido: "${varName}".`,
                nodeIds: [nodeId],
                details: {
                  variable: varName,
                },
              }));
            }
            
            // Valida que o valor não é undefined (null é permitido)
            if (assignments[varName] === undefined) {
              errors.push(addUiMessage({
                code: 'SET_VARIABLE_UNDEFINED_VALUE',
                message: `Nó de variável "${nodeId}" tem valor undefined para variável "${varName}". Use null para valores vazios.`,
                nodeIds: [nodeId],
                details: {
                  variable: varName,
                },
              }));
            }

            // WARNING: Sobrescrever variável existente (análise requer fluxo completo)
            if (flow) {
              const { defined } = analyzeVariableUsage(flow);
              // Verifica se variável já foi definida antes deste nó
              // (análise simplificada: se está no conjunto de definidas, pode ser sobrescrita)
              if (defined.has(varName)) {
                errors.push(addUiMessage({
                  code: 'SET_VARIABLE_OVERWRITE',
                  message: `Variável "${varName}" será sobrescrita no nó "${nodeId}".`,
                  nodeIds: [nodeId],
                  severity: 'warning',
                  details: {
                    variable: varName,
                  },
                }));
              }
            }
          }
        }
      }
      break;
    }

    case 'handoff': {
      if (node.config && node.config.queue) {
        if (typeof node.config.queue !== 'string' || node.config.queue.trim() === '') {
          errors.push(addUiMessage({
            code: 'HANDOFF_INVALID_QUEUE',
            message: `Nó de handoff "${nodeId}" deve ter "config.queue" como string não vazia.`,
            nodeIds: [nodeId],
          }));
        }
      }
      break;
    }

    case 'ai': {
      if (!node.config || typeof node.config !== 'object') {
        errors.push(addUiMessage({
          code: 'AI_MISSING_CONFIG',
          message: `Nó de IA "${nodeId}" deve ter um campo "config" com "promptTemplate".`,
          nodeIds: [nodeId],
        }));
      } else if (!node.config.promptTemplate || typeof node.config.promptTemplate !== 'string') {
        errors.push(addUiMessage({
          code: 'AI_MISSING_PROMPT_TEMPLATE',
          message: `Nó de IA "${nodeId}" deve ter "config.promptTemplate" (string não vazia).`,
          nodeIds: [nodeId],
        }));
      } else if (node.config.promptTemplate.trim().length === 0) {
        errors.push(addUiMessage({
          code: 'AI_EMPTY_PROMPT_TEMPLATE',
          message: `Nó de IA "${nodeId}" não pode ter promptTemplate vazio.`,
          nodeIds: [nodeId],
        }));
      } else if (node.config.promptTemplate.length > 50000) {
        errors.push(addUiMessage({
          code: 'AI_PROMPT_TOO_LONG',
          message: `Nó de IA "${nodeId}" excede o limite de 50000 caracteres no promptTemplate.`,
          nodeIds: [nodeId],
          details: {
            length: node.config.promptTemplate.length,
            maxLength: 50000,
          },
        }));
      }

      if (node.config && node.config.outputVariable) {
        if (typeof node.config.outputVariable !== 'string' || node.config.outputVariable.trim() === '') {
          errors.push(addUiMessage({
            code: 'AI_INVALID_OUTPUT_VARIABLE',
            message: `Nó de IA "${nodeId}" tem "config.outputVariable" inválido.`,
            nodeIds: [nodeId],
          }));
        } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(node.config.outputVariable)) {
          errors.push(addUiMessage({
            code: 'AI_INVALID_OUTPUT_VARIABLE_NAME',
            message: `Nó de IA "${nodeId}" tem nome de variável de saída inválido.`,
            nodeIds: [nodeId],
            details: {
              variable: node.config.outputVariable,
            },
          }));
        }
      }
      break;
    }

    case 'start': {
      // Valida que start não tem entradas (será validado em validateDisconnectedNodes)
      // Valida que start tem next definido (não pode ser nó final)
      const hasValidNext =
        typeof node.next === 'string' ||
        Array.isArray(node.next) ||
        (node.next && typeof node.next === 'object' && (node.next.out || Object.keys(node.next).length > 0));

      if (!node.next || !hasValidNext) {
        errors.push(addUiMessage({
          code: 'START_MISSING_NEXT',
          message: `Nó start "${nodeId}" deve ter um campo "next" apontando para o próximo nó.`,
          nodeIds: [nodeId],
        }));
      }
      break;
    }

    case 'end': {
      // Valida que end não tem saídas (nó folha)
      if (node.next) {
        errors.push(addUiMessage({
          code: 'END_HAS_OUTPUTS',
          message: `Nó end "${nodeId}" não pode ter saídas (campo "next"). Nós end devem ser folhas do fluxo.`,
          nodeIds: [nodeId],
        }));
      }
      break;
    }

    case 'ai_task': {
      if (!node.config || typeof node.config !== 'object') {
        errors.push(addUiMessage({
          code: 'AI_TASK_MISSING_CONFIG',
          message: `Nó ai_task "${nodeId}" deve ter campo "config"`,
          nodeIds: [nodeId],
        }));
        break;
      }

      const config = node.config;

      // Validação: task deve estar definida
      if (!config.task || typeof config.task !== 'string') {
        errors.push(addUiMessage({
          code: 'AI_TASK_MISSING_TASK',
          message: `Nó ai_task "${nodeId}" deve ter "config.task" (string)`,
          nodeIds: [nodeId],
        }));
      } else {
        // Validação: task deve ser uma das tarefas suportadas
        const { SUPPORTED_TASKS } = require('./utils/aiTaskExecutor');
        const supportedTasks = Object.values(SUPPORTED_TASKS);
        if (!supportedTasks.includes(config.task)) {
          errors.push(addUiMessage({
            code: 'AI_TASK_UNSUPPORTED_TASK',
            message: `Nó ai_task "${nodeId}" tem tarefa não suportada: "${config.task}". Tarefas suportadas: ${supportedTasks.join(', ')}`,
            nodeIds: [nodeId],
            details: {
              task: config.task,
              supportedTasks,
            },
          }));
        }
      }

      // Validação específica para intent_classification
      if (config.task === 'intent_classification') {
        // allowedOutputs deve ser um array não vazio
        if (!Array.isArray(config.allowedOutputs) || config.allowedOutputs.length === 0) {
          errors.push(addUiMessage({
            code: 'AI_TASK_MISSING_ALLOWED_OUTPUTS',
            message: `Nó ai_task "${nodeId}" (intent_classification) deve ter "config.allowedOutputs" (array não vazio)`,
            nodeIds: [nodeId],
          }));
        }

        // fallback deve estar definido
        if (config.fallback === undefined || config.fallback === null || config.fallback === '') {
          errors.push(addUiMessage({
            code: 'AI_TASK_MISSING_FALLBACK',
            message: `Nó ai_task "${nodeId}" (intent_classification) deve ter "config.fallback"`,
            nodeIds: [nodeId],
          }));
        }

        // confidenceThreshold deve ser um número válido entre 0 e 1
        if (config.confidenceThreshold !== undefined) {
          if (typeof config.confidenceThreshold !== 'number') {
            errors.push(addUiMessage({
              code: 'AI_TASK_INVALID_CONFIDENCE_THRESHOLD',
              message: `Nó ai_task "${nodeId}" tem "config.confidenceThreshold" inválido (deve ser número)`,
              nodeIds: [nodeId],
            }));
          } else if (config.confidenceThreshold < 0 || config.confidenceThreshold > 1) {
            errors.push(addUiMessage({
              code: 'AI_TASK_INVALID_CONFIDENCE_RANGE',
              message: `Nó ai_task "${nodeId}" tem "config.confidenceThreshold" fora do intervalo [0, 1]`,
              nodeIds: [nodeId],
              details: {
                confidenceThreshold: config.confidenceThreshold,
              },
            }));
          }
        }
      }

      // Validação: o nó deve ter um caminho de fallback (next)
      if (!node.next) {
        errors.push(addUiMessage({
          code: 'AI_TASK_NO_FALLBACK_PATH',
          message: `Nó ai_task "${nodeId}" deve ter um caminho de fallback definido (campo "next")`,
          nodeIds: [nodeId],
        }));
      }
      break;
    }

    case 'fallback': {
      if (node.config) {
        // Valida escalationMode
        if (node.config.escalationMode !== undefined) {
          const validModes = ['ticket', 'human'];
          if (!validModes.includes(node.config.escalationMode)) {
            errors.push(addUiMessage({
              code: 'FALLBACK_INVALID_ESCALATION_MODE',
              message: `Nó de fallback "${nodeId}" tem "escalationMode" inválido (deve ser "ticket" ou "human").`,
              nodeIds: [nodeId],
              details: {
                escalationMode: node.config.escalationMode,
                validModes,
              },
            }));
          }
        }
        
        // Valida queue quando escalationMode é 'ticket'
        if (node.config.escalationMode === 'ticket' || !node.config.escalationMode) {
          // Queue é opcional, mas se fornecido deve ser válido
          if (node.config.queue !== undefined) {
            if (typeof node.config.queue !== 'string' || node.config.queue.trim() === '') {
              errors.push(addUiMessage({
                code: 'FALLBACK_INVALID_QUEUE',
                message: `Nó de fallback "${nodeId}" tem "queue" inválido (deve ser string não vazia).`,
                nodeIds: [nodeId],
              }));
            }
          }
        }
        
        // Valida maxAttempts
        if (node.config.maxAttempts !== undefined) {
          const maxAttempts = Number(node.config.maxAttempts);
          if (Number.isNaN(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
            errors.push(addUiMessage({
              code: 'FALLBACK_INVALID_MAX_ATTEMPTS',
              message: `Nó de fallback "${nodeId}" tem "maxAttempts" inválido (deve ser entre 1 e 10).`,
              nodeIds: [nodeId],
              details: {
                maxAttempts: node.config.maxAttempts,
              },
            }));
          }
        }
        
        // Valida confidenceThreshold
        if (node.config.confidenceThreshold !== undefined) {
          const threshold = Number(node.config.confidenceThreshold);
          if (Number.isNaN(threshold) || threshold < 0 || threshold > 1) {
            errors.push(addUiMessage({
              code: 'FALLBACK_INVALID_THRESHOLD',
              message: `Nó de fallback "${nodeId}" tem "confidenceThreshold" inválido (deve ser entre 0.0 e 1.0).`,
              nodeIds: [nodeId],
              details: {
                confidenceThreshold: node.config.confidenceThreshold,
              },
            }));
          }
        }
      }
      break;
    }

    case 'subflow': {
      if (!node.config || typeof node.config !== 'object') {
        errors.push(addUiMessage({
          code: 'SUBFLOW_MISSING_CONFIG',
          message: `Nó de subfluxo "${nodeId}" deve ter um campo "config" com "flowId".`,
          nodeIds: [nodeId],
        }));
      } else if (!node.config.flowId || typeof node.config.flowId !== 'string' || node.config.flowId.trim() === '') {
        errors.push(addUiMessage({
          code: 'SUBFLOW_MISSING_FLOW_ID',
          message: `Nó de subfluxo "${nodeId}" deve ter "config.flowId" (string não vazia).`,
          nodeIds: [nodeId],
        }));
      }

      if (node.config && node.config.timeout !== undefined) {
        const timeout = Number(node.config.timeout);
        if (!Number.isFinite(timeout) || timeout < 0 || timeout > 300000) {
          errors.push(addUiMessage({
            code: 'SUBFLOW_INVALID_TIMEOUT',
            message: `Nó de subfluxo "${nodeId}" tem timeout inválido (deve ser entre 0 e 300000ms).`,
            nodeIds: [nodeId],
            details: { timeout: node.config.timeout },
          }));
        }
      }
      break;
    }

    case 'options': {
      // Regra hardening: options é um nó interativo e NÃO pode ficar sem next.
      // Se ficar sem next, o grafo tende a ficar desconectado (NODE_DISCONNECTED)
      // e a execução fica “presa” após a seleção.
      const hasOptions =
        !!node.config &&
        typeof node.config === 'object' &&
        Array.isArray(node.config.options) &&
        node.config.options.length > 0;

      // Só aplicamos a regra quando o nó está “de fato” configurado para uso.
      if (hasOptions) {
        if (!node.next) {
          errors.push(addUiMessage({
            code: 'OPTIONS_MISSING_NEXT',
            message: `Nó de opções "${nodeId}" deve ter um campo "next" (conexão de saída).`,
            nodeIds: [nodeId],
          }));
        } else if (typeof node.next === 'object' && !Array.isArray(node.next)) {
          // Port-map recomendado: exigir out e fallback quando o usuário escolhe por opções.
          const outVal = node.next.out;
          const fbVal = node.next.fallback;
          const hasOut = typeof outVal === 'string' ? outVal.trim() !== '' : Array.isArray(outVal) ? outVal.length > 0 : false;
          const hasFallback = typeof fbVal === 'string' ? fbVal.trim() !== '' : Array.isArray(fbVal) ? fbVal.length > 0 : false;

          if (!hasOut) {
            errors.push(addUiMessage({
              code: 'OPTIONS_MISSING_OUT_PORT',
              message: `Nó de opções "${nodeId}" deve ter next.out apontando para um próximo nó.`,
              nodeIds: [nodeId],
            }));
          }
          if (!hasFallback) {
            errors.push(addUiMessage({
              code: 'OPTIONS_MISSING_FALLBACK_PORT',
              message: `Nó de opções "${nodeId}" deve ter next.fallback apontando para um nó de fallback.`,
              nodeIds: [nodeId],
            }));
          }
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

  // Validações semânticas adicionais (requerem fluxo completo)
  errors = errors.concat(validateSemanticRules(flow));

  // Validações de grafo (requerem estrutura válida)
  const edges = buildEdges(flow);
  errors = errors.concat(validateMissingTargetNodes(flow, edges));
  errors = errors.concat(validateDisconnectedNodes(flow, edges));
  errors = errors.concat(validateInvalidLoops(flow, edges));
  errors = errors.concat(validateTypeCompatibility(flow, edges));

  // Filtra apenas erros (não warnings) para determinar se o fluxo é válido
  const actualErrors = errors.filter(e => e.severity !== 'warning');
  
  return {
    valid: actualErrors.length === 0,
    errors,
  };
}

module.exports = {
  validateFlow,
  addUiMessage, // Exporta para uso em api/server.js
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


