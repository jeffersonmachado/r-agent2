/**
 * Validador estrutural de fluxos com foco em fallback.
 * 
 * Validações obrigatórias:
 * - Todo fluxo deve conter pelo menos 1 FallbackNode
 * - Nenhum nó pode ficar órfão
 * - Todo caminho deve terminar em FallbackNode ou nó de término explícito
 * - Detectar loops estruturais simples
 * 
 * Este validador é usado pelo botão "Validar" do FlowEditor.
 */

/**
 * @typedef {Object} FlowValidationError
 * @property {string} code - Código de erro estável
 * @property {string} message - Mensagem técnica
 * @property {string} messageUi - Mensagem amigável para UI
 * @property {string} severity - Nível de severidade ("error", "warning", "info")
 * @property {string[]} [nodeIds] - Nós envolvidos no problema
 * @property {Object<string, any>} [details] - Dados extras
 */

/**
 * @typedef {Object} FlowValidationResult
 * @property {boolean} valid
 * @property {FlowValidationError[]} errors
 */

/**
 * Adiciona mensagem amigável (messageUi) a um erro de validação
 * 
 * @param {FlowValidationError} error - Erro com code, message, nodeIds
 * @returns {FlowValidationError & { messageUi: string, severity: string }}
 */
function addUiMessage(error) {
  const nodeIds = Array.isArray(error.nodeIds) ? error.nodeIds : [];
  const technicalMessage = error.message || 'Erro de validação';
  
  // Mapeamento de códigos para mensagens amigáveis
  const uiMessages = {
    NO_FALLBACK_NODE: 'O fluxo deve conter pelo menos um nó de Fallback.',
    ORPHAN_NODE: nodeIds.length > 0 
      ? `Nó órfão encontrado: ${nodeIds[0]}. Todos os nós devem estar conectados ao fluxo.`
      : 'Existem nós órfãos no fluxo. Todos os nós devem estar conectados.',
    PATH_WITHOUT_TERMINATION: 'Existe um caminho no fluxo que não termina adequadamente. Todos os caminhos devem terminar em um nó de Fallback ou Fim.',
    STRUCTURAL_LOOP: 'Loop estrutural detectado no fluxo. Verifique as conexões.',
    INVALID_FLOW_STRUCTURE: 'Estrutura do fluxo inválida.',
  };
  
  const messageUi = uiMessages[error.code] || technicalMessage;
  const severity = error.severity || 'error';
  
  return {
    ...error,
    messageUi,
    severity,
  };
}

/**
 * Normaliza o formato do fluxo para um formato unificado
 * Suporta tanto formato Rete.js (nodes como objeto) quanto formato engine (nodes como array)
 * 
 * @param {Object} flow - Fluxo a normalizar
 * @returns {{ nodes: Array, connections?: Array } | null}
 */
function normalizeFlowFormat(flow) {
  if (!flow || typeof flow !== 'object') {
    return null;
  }
  
  // Se nodes é um array (formato engine), retorna como está
  if (Array.isArray(flow.nodes)) {
    return {
      nodes: flow.nodes,
      connections: flow.connections,
    };
  }
  
  // Se nodes é um objeto (formato Rete.js), converte para array
  if (flow.nodes && typeof flow.nodes === 'object') {
    const nodesArray = Object.entries(flow.nodes).map(([id, node]) => ({
      id: id,
      type: node.data?.type || node.type,
      data: node.data || node,
      outputs: node.outputs, // Preserva outputs para extrair conexões
      inputs: node.inputs, // Preserva inputs
      ...node, // Preserva todos os outros campos
    }));
    
    return {
      nodes: nodesArray,
      connections: flow.connections,
    };
  }
  
  return null;
}

/**
 * Valida estrutura básica do fluxo
 * 
 * @param {Object} flow - Fluxo a validar
 * @returns {FlowValidationError[]}
 */
function validateFlowStructure(flow) {
  const errors = [];
  
  if (!flow || typeof flow !== 'object') {
    return [addUiMessage({
      code: 'INVALID_FLOW_STRUCTURE',
      message: 'Fluxo deve ser um objeto válido',
      nodeIds: [],
    })];
  }
  
  // Suporta tanto formato Rete.js (nodes como objeto) quanto formato engine (nodes como array)
  const isReteFormat = flow.nodes && typeof flow.nodes === 'object' && !Array.isArray(flow.nodes);
  const isEngineFormat = Array.isArray(flow.nodes);
  const nodeCount = isReteFormat ? Object.keys(flow.nodes).length : (isEngineFormat ? flow.nodes.length : 0);
  
  if (!isReteFormat && !isEngineFormat) {
    return [addUiMessage({
      code: 'INVALID_FLOW_STRUCTURE',
      message: 'Fluxo deve ter um campo "nodes" válido (objeto ou array)',
      nodeIds: [],
    })];
  }
  
  if (nodeCount === 0) {
    return [addUiMessage({
      code: 'INVALID_FLOW_STRUCTURE',
      message: 'Fluxo deve ter pelo menos um nó',
      nodeIds: [],
    })];
  }
  
  return errors;
}

/**
 * Valida se o fluxo contém pelo menos um FallbackNode
 * 
 * @param {Object} flow - Fluxo a validar
 * @returns {FlowValidationError[]}
 */
function validateHasFallbackNode(flow) {
  const errors = [];
  
  const normalized = normalizeFlowFormat(flow);
  if (!normalized || !normalized.nodes || normalized.nodes.length === 0) {
    return errors;
  }
  
  const hasFallback = normalized.nodes.some(node => {
    const nodeType = node.type || (node.data && node.data.type);
    return nodeType === 'fallback';
  });
  
  if (!hasFallback) {
    errors.push(addUiMessage({
      code: 'NO_FALLBACK_NODE',
      message: 'Fluxo deve conter pelo menos um nó de Fallback',
      nodeIds: [],
      severity: 'error',
    }));
  }
  
  return errors;
}

/**
 * Constrói lista de arestas (edges) do fluxo
 * 
 * @param {Object} flow - Fluxo a validar
 * @returns {Array<{from: string, to: string}>}
 */
function buildEdges(flow) {
  const edges = [];
  
  const normalized = normalizeFlowFormat(flow);
  if (!normalized || !normalized.nodes || normalized.nodes.length === 0) {
    return edges;
  }
  
  // Se o fluxo tem connections (formato Rete.js)
  if (normalized.connections && Array.isArray(normalized.connections)) {
    normalized.connections.forEach(conn => {
      if (conn.source && conn.target) {
        edges.push({
          from: String(conn.source),
          to: String(conn.target),
        });
      }
    });
  }
  
  // Se o fluxo tem formato engine (nodes com next)
  normalized.nodes.forEach(node => {
    const nodeId = String(node.id || '');
    const next = node.next;
    
    if (next) {
      if (Array.isArray(next)) {
        next.forEach(targetId => {
          edges.push({
            from: nodeId,
            to: String(targetId),
          });
        });
      } else if (typeof next === 'string') {
        edges.push({
          from: nodeId,
          to: String(next),
        });
      }
    }
    
    // Para formato Rete.js, também verifica outputs com connections
    if (node.outputs && typeof node.outputs === 'object') {
      Object.values(node.outputs).forEach(output => {
        if (output.connections && Array.isArray(output.connections)) {
          output.connections.forEach(conn => {
            if (conn.node) {
              edges.push({
                from: nodeId,
                to: String(conn.node),
              });
            }
          });
        }
      });
    }
  });
  
  return edges;
}

/**
 * Valida se há nós órfãos (não alcançáveis a partir de nós de entrada)
 * 
 * @param {Object} flow - Fluxo a validar
 * @param {Array<{from: string, to: string}>} edges - Arestas do fluxo
 * @returns {FlowValidationError[]}
 */
function validateOrphanNodes(flow, edges) {
  const errors = [];
  
  const normalized = normalizeFlowFormat(flow);
  if (!normalized || !normalized.nodes || normalized.nodes.length === 0) {
    return errors;
  }
  
  // Encontra nós de entrada (start ou nós sem entrada)
  const entryNodeIds = new Set();
  normalized.nodes.forEach(node => {
    const nodeId = String(node.id || '');
    const nodeType = node.type || (node.data && node.data.type);
    if (nodeType === 'start') {
      entryNodeIds.add(nodeId);
    }
  });
  
  // Se não há nós de entrada, todos são órfãos
  if (entryNodeIds.size === 0) {
    const orphanIds = normalized.nodes.map(n => String(n.id || ''));
    if (orphanIds.length > 0) {
      errors.push(addUiMessage({
        code: 'ORPHAN_NODE',
        message: 'Fluxo não tem nós de entrada. Todos os nós são órfãos.',
        nodeIds: orphanIds,
        severity: 'error',
      }));
    }
    return errors;
  }
  
  // BFS a partir dos nós de entrada
  const reachable = new Set(entryNodeIds);
  const queue = Array.from(entryNodeIds);
  
  while (queue.length > 0) {
    const current = queue.shift();
    edges
      .filter(e => e.from === current)
      .forEach(e => {
        if (!reachable.has(e.to)) {
          reachable.add(e.to);
          queue.push(e.to);
        }
      });
  }
  
  // Encontra nós não alcançáveis
  const allNodeIds = new Set(normalized.nodes.map(n => String(n.id || '')));
  const orphanIds = Array.from(allNodeIds).filter(id => !reachable.has(id));
  
  if (orphanIds.length > 0) {
    errors.push(addUiMessage({
      code: 'ORPHAN_NODE',
      message: `Nós órfãos encontrados: ${orphanIds.join(', ')}`,
      nodeIds: orphanIds,
      severity: 'error',
    }));
  }
  
  return errors;
}

/**
 * Valida se todos os caminhos terminam adequadamente
 * 
 * @param {Object} flow - Fluxo a validar
 * @param {Array<{from: string, to: string}>} edges - Arestas do fluxo
 * @returns {FlowValidationError[]}
 */
function validatePathTermination(flow, edges) {
  const errors = [];
  
  const normalized = normalizeFlowFormat(flow);
  if (!normalized || !normalized.nodes || normalized.nodes.length === 0) {
    return errors;
  }
  
  // Encontra nós de término válidos (end ou fallback)
  const terminationNodes = new Set();
  normalized.nodes.forEach(node => {
    const nodeId = String(node.id || '');
    const nodeType = node.type || (node.data && node.data.type);
    if (nodeType === 'end' || nodeType === 'fallback') {
      terminationNodes.add(nodeId);
    }
  });
  
  // Encontra nós sem saída (dead ends)
  const nodesWithOutput = new Set();
  edges.forEach(edge => {
    nodesWithOutput.add(edge.from);
  });
  
  const allNodeIds = new Set(normalized.nodes.map(n => String(n.id || '')));
  const deadEndNodes = Array.from(allNodeIds).filter(id => {
    if (terminationNodes.has(id)) {
      return false; // Nós de término são válidos
    }
    return !nodesWithOutput.has(id);
  });
  
  if (deadEndNodes.length > 0) {
    errors.push(addUiMessage({
      code: 'PATH_WITHOUT_TERMINATION',
      message: `Caminhos sem término adequado encontrados nos nós: ${deadEndNodes.join(', ')}`,
      nodeIds: deadEndNodes,
      severity: 'error',
    }));
  }
  
  return errors;
}

/**
 * Detecta loops estruturais simples (ciclos no grafo)
 * 
 * @param {Object} flow - Fluxo a validar
 * @param {Array<{from: string, to: string}>} edges - Arestas do fluxo
 * @returns {FlowValidationError[]}
 */
function validateStructuralLoops(flow, edges) {
  const errors = [];
  
  const normalized = normalizeFlowFormat(flow);
  if (!normalized || !normalized.nodes || normalized.nodes.length === 0) {
    return errors;
  }
  
  // DFS para detectar ciclos
  const visited = new Set();
  const recStack = new Set();
  const cycles = [];
  
  function hasCycle(nodeId, path = []) {
    if (recStack.has(nodeId)) {
      // Ciclo detectado
      const cycleStart = path.indexOf(nodeId);
      const cycle = path.slice(cycleStart).concat(nodeId);
      cycles.push(cycle);
      return true;
    }
    
    if (visited.has(nodeId)) {
      return false;
    }
    
    visited.add(nodeId);
    recStack.add(nodeId);
    
    const outgoingEdges = edges.filter(e => e.from === nodeId);
    for (const edge of outgoingEdges) {
      if (hasCycle(edge.to, [...path, nodeId])) {
        return true;
      }
    }
    
    recStack.delete(nodeId);
    return false;
  }
  
  const allNodeIds = normalized.nodes.map(n => String(n.id || ''));
  for (const nodeId of allNodeIds) {
    if (!visited.has(nodeId)) {
      hasCycle(nodeId);
    }
  }
  
  if (cycles.length > 0) {
    // Pega o primeiro ciclo encontrado
    const firstCycle = cycles[0];
    errors.push(addUiMessage({
      code: 'STRUCTURAL_LOOP',
      message: `Loop estrutural detectado: ${firstCycle.join(' -> ')}`,
      nodeIds: firstCycle,
      severity: 'warning', // Aviso, não erro crítico
      details: {
        cycle: firstCycle,
      },
    }));
  }
  
  return errors;
}

/**
 * Função principal de validação de fluxo
 * 
 * @param {Object} flow - Fluxo a validar (formato Rete.js ou engine)
 * @returns {FlowValidationResult}
 */
export function validateFlow(flow) {
  /** @type {FlowValidationError[]} */
  let errors = [];
  
  // Validações estruturais básicas (devem ser feitas primeiro)
  errors = errors.concat(validateFlowStructure(flow));
  
  // Se a estrutura básica está inválida, não continuamos
  if (errors.some(e => e.code === 'INVALID_FLOW_STRUCTURE')) {
    return {
      valid: false,
      errors,
    };
  }
  
  // Validação obrigatória: deve ter FallbackNode
  errors = errors.concat(validateHasFallbackNode(flow));
  
  // Constrói arestas do grafo
  const edges = buildEdges(flow);
  
  // Validações de grafo
  errors = errors.concat(validateOrphanNodes(flow, edges));
  errors = errors.concat(validatePathTermination(flow, edges));
  errors = errors.concat(validateStructuralLoops(flow, edges));
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Helper para obter erros de validação formatados para UI
 * 
 * @param {FlowValidationResult} result - Resultado da validação
 * @returns {FlowValidationError[]}
 */
export function getUiErrors(result) {
  return result.errors || [];
}

