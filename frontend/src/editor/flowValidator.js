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
    PROHIBITED_MULTIPLE_INPUTS: nodeIds.length > 0
      ? `Nó "${nodeIds[0]}" tem múltiplas entradas. Múltiplas entradas são permitidas apenas em nós de convergência simples (Fim, Transferência, Merge).`
      : 'Nós com múltiplas entradas detectados. Use apenas em nós de convergência simples (Fim, Transferência, Merge).',
    PROHIBITED_MULTIPLE_INPUTS_DECISION: nodeIds.length > 0
      ? `Nó decisório "${nodeIds[0]}" não pode ter múltiplas entradas. Nós decisórios (Roteador, Opções, Intenção) devem ter apenas uma entrada.`
      : 'Nós decisórios com múltiplas entradas detectados.',
    WARN_MULTIPLE_INPUTS_OUTPUTS: nodeIds.length > 0
      ? `Nó "${nodeIds[0]}" tem múltiplas entradas e saídas. Considere simplificar o fluxo.`
      : 'Nós com múltiplas entradas e saídas detectados.',
    WARN_ROUTER_CHAIN: 'Cadeia longa de roteadores detectada. Considere usar subfluxos.',
    WARN_LARGE_FLOW_WITHOUT_SUBFLOW: 'Fluxo grande sem subfluxos. Considere modularizar.',
    MULTI_OUTPUT_NODE_WITHOUT_FALLBACK: nodeIds.length > 0
      ? `Nó "${nodeIds[0]}" tem múltiplas saídas mas falta conexão de fallback.`
      : 'Nós com múltiplas saídas sem fallback detectados.',
    SUBFLOW_RECURSION: nodeIds.length > 0
      ? `Nó "${nodeIds[0]}" tenta chamar o próprio fluxo (recursão infinita).`
      : 'Recursão infinita detectada em subfluxos.',
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
 * Valida múltiplas entradas - bloqueia sincronização
 * 
 * @param {Object} flow - Fluxo a validar
 * @param {Array<{from: string, to: string}>} edges - Arestas do fluxo
 * @returns {FlowValidationError[]}
 */
function validateMultipleInputs(flow, edges) {
  const errors = [];
  
  const normalized = normalizeFlowFormat(flow);
  if (!normalized || !normalized.nodes || normalized.nodes.length === 0) {
    return errors;
  }
  
  // Conta entradas por nó
  const inputCounts = new Map();
  edges.forEach(edge => {
    const count = inputCounts.get(edge.to) || 0;
    inputCounts.set(edge.to, count + 1);
  });
  
  // Nós que permitem múltiplas entradas (apenas convergência simples, passivos)
  const allowedMultipleInputs = new Set(['end', 'handoff', 'merge']);
  
  // Nós decisórios (não podem ter múltiplas entradas)
  const decisionNodes = new Set(['router', 'schedule_router', 'options', 'ai_task']);
  
  inputCounts.forEach((count, nodeId) => {
    if (count > 1) {
      const node = normalized.nodes.find(n => String(n.id || '') === nodeId);
      const nodeType = node?.type || (node?.data && node.data.type);
      
      // BLOQUEAR: Nós decisórios com múltiplas entradas
      if (decisionNodes.has(nodeType)) {
        errors.push(addUiMessage({
          code: 'PROHIBITED_MULTIPLE_INPUTS_DECISION',
          message: `Nó decisório "${nodeId}" (tipo: ${nodeType}) tem ${count} entradas. Nós decisórios não podem ter múltiplas entradas.`,
          messageUi: `❌ Nó decisório "${nodeId}" não pode ter múltiplas entradas. Nós decisórios (Roteador, Opções, Intenção) devem ter apenas uma entrada.`,
          nodeIds: [nodeId],
          severity: 'error',
          details: { nodeType, inputCount: count },
        }));
        return; // Não continua validação para este nó
      }
      
      // BLOQUEAR: Nós que não podem ter múltiplas entradas
      if (!allowedMultipleInputs.has(nodeType)) {
        errors.push(addUiMessage({
          code: 'PROHIBITED_MULTIPLE_INPUTS',
          message: `Nó "${nodeId}" (tipo: ${nodeType}) tem ${count} entradas. Múltiplas entradas são permitidas apenas em nós de convergência simples (end, handoff, merge).`,
          messageUi: `❌ Nó "${nodeId}" tem múltiplas entradas. Isso não é permitido para sincronização. Use apenas em nós de convergência simples (Fim, Transferência, Merge).`,
          nodeIds: [nodeId],
          severity: 'error',
          details: { nodeType, inputCount: count },
        }));
      }
      
      // AVISAR: Nós com múltiplas entradas + múltiplas saídas (pode indicar problema)
      if (node && nodeType !== 'end' && allowedMultipleInputs.has(nodeType)) {
        const outputCount = edges.filter(e => e.from === nodeId).length;
        if (outputCount > 1) {
          errors.push(addUiMessage({
            code: 'WARN_MULTIPLE_INPUTS_OUTPUTS',
            message: `Nó "${nodeId}" tem ${count} entradas e ${outputCount} saídas. Isso pode indicar lógica complexa não suportada.`,
            messageUi: `⚠️ Nó "${nodeId}" tem múltiplas entradas e saídas. Considere simplificar o fluxo ou usar subfluxos.`,
            nodeIds: [nodeId],
            severity: 'warning',
            details: { inputCount: count, outputCount },
          }));
        }
      }
    }
  });
  
  return errors;
}

/**
 * Valida cadeias de roteadores (muitos roteadores encadeados)
 * 
 * @param {Object} flow - Fluxo a validar
 * @param {Array<{from: string, to: string}>} edges - Arestas do fluxo
 * @returns {FlowValidationError[]}
 */
function validateRouterChains(flow, edges) {
  const errors = [];
  
  const normalized = normalizeFlowFormat(flow);
  if (!normalized || !normalized.nodes || normalized.nodes.length === 0) {
    return errors;
  }
  
  // Encontra todos os roteadores
  const routerNodes = new Set();
  normalized.nodes.forEach(node => {
    const nodeType = node.type || (node.data && node.data.type);
    if (nodeType === 'router' || nodeType === 'schedule_router') {
      routerNodes.add(String(node.id || ''));
    }
  });
  
  // Detecta cadeias de roteadores (router -> router -> router)
  const MAX_ROUTER_CHAIN = 3; // Limite recomendado
  
  routerNodes.forEach(routerId => {
    const chain = [];
    let current = routerId;
    let visited = new Set();
    
    while (current && routerNodes.has(current) && !visited.has(current)) {
      visited.add(current);
      chain.push(current);
      
      // Encontra próximo roteador na cadeia
      const nextRouters = edges
        .filter(e => e.from === current && routerNodes.has(e.to))
        .map(e => e.to);
      
      if (nextRouters.length > 0) {
        current = nextRouters[0]; // Pega o primeiro
      } else {
        break;
      }
    }
    
    if (chain.length > MAX_ROUTER_CHAIN) {
      errors.push(addUiMessage({
        code: 'WARN_ROUTER_CHAIN',
        message: `Cadeia de ${chain.length} roteadores encadeados detectada: ${chain.join(' -> ')}. Considere usar subfluxos para simplificar.`,
        messageUi: `⚠️ Cadeia longa de roteadores (${chain.length}). Considere usar subfluxos para melhorar a legibilidade.`,
        nodeIds: chain,
        severity: 'warning',
        details: { chain, length: chain.length },
      }));
    }
  });
  
  return errors;
}

/**
 * Valida fluxos grandes sem subfluxo
 * 
 * @param {Object} flow - Fluxo a validar
 * @returns {FlowValidationError[]}
 */
function validateLargeFlowsWithoutSubflow(flow) {
  const errors = [];
  
  const normalized = normalizeFlowFormat(flow);
  if (!normalized || !normalized.nodes || normalized.nodes.length === 0) {
    return errors;
  }
  
  const nodeCount = normalized.nodes.length;
  const LARGE_FLOW_THRESHOLD = 20; // Limite recomendado
  
  // Verifica se há subfluxos
  const hasSubflow = normalized.nodes.some(node => {
    const nodeType = node.type || (node.data && node.data.type);
    return nodeType === 'subflow';
  });
  
  if (nodeCount >= LARGE_FLOW_THRESHOLD && !hasSubflow) {
    errors.push(addUiMessage({
      code: 'WARN_LARGE_FLOW_WITHOUT_SUBFLOW',
      message: `Fluxo tem ${nodeCount} nós e não usa subfluxos. Considere modularizar usando subfluxos para melhorar a legibilidade.`,
      messageUi: `⚠️ Fluxo grande (${nodeCount} nós) sem subfluxos. Considere usar "Chamar Subfluxo" para modularizar e melhorar a legibilidade.`,
      nodeIds: [],
      severity: 'warning',
      details: { nodeCount, threshold: LARGE_FLOW_THRESHOLD },
    }));
  }
  
  return errors;
}

/**
 * Valida nós multi-saída sem fallback
 * 
 * @param {Object} flow - Fluxo a validar
 * @param {Array<{from: string, to: string}>} edges - Arestas do fluxo
 * @returns {FlowValidationError[]}
 */
function validateMultiOutputNodesWithoutFallback(flow, edges) {
  const errors = [];
  
  const normalized = normalizeFlowFormat(flow);
  if (!normalized || !normalized.nodes || normalized.nodes.length === 0) {
    return errors;
  }
  
  // Nós que podem ter múltiplas saídas
  const multiOutputNodes = new Set(['router', 'schedule_router', 'options', 'ai_task']);
  
  normalized.nodes.forEach(node => {
    const nodeId = String(node.id || '');
    const nodeType = node.type || (node.data && node.data.type);
    
    if (multiOutputNodes.has(nodeType)) {
      // Conta saídas deste nó
      const outputCount = edges.filter(e => e.from === nodeId).length;
      
      if (outputCount > 1) {
        // Verifica se há conexão de fallback ou padrão
        const hasFallbackConnection = edges.some(e => {
          if (e.from !== nodeId) return false;
          
          // Para router/schedule_router, verifica se há conexão padrão
          if (nodeType === 'router' || nodeType === 'schedule_router') {
            // Verifica se há regra "always" no config
            const config = node.config || (node.data && node.data.config);
            if (config && Array.isArray(config.rules)) {
              const hasAlwaysRule = config.rules.some(rule => 
                rule && rule.condition && rule.condition.op === 'always'
              );
              if (hasAlwaysRule) return true;
            }
            // Verifica se há conexão padrão (next)
            if (node.next) return true;
          }
          
          // Para outros nós, verifica se há saída "fallback" conectada
          return true; // Simplificado - validação mais detalhada no schema do nó
        });
        
        if (!hasFallbackConnection) {
          errors.push(addUiMessage({
            code: 'MULTI_OUTPUT_NODE_WITHOUT_FALLBACK',
            message: `Nó "${nodeId}" (tipo: ${nodeType}) tem ${outputCount} saídas mas não tem conexão de fallback.`,
            messageUi: `❌ Nó "${nodeId}" tem múltiplas saídas mas falta conexão de fallback. Conecte a saída "Fallback" ou "Padrão" a outro nó.`,
            nodeIds: [nodeId],
            severity: 'error',
            details: { nodeType, outputCount },
          }));
        }
      }
    }
  });
  
  return errors;
}

/**
 * Valida recursão infinita em subfluxos
 * 
 * @param {Object} flow - Fluxo a validar
 * @param {Array<{from: string, to: string}>} edges - Arestas do fluxo
 * @returns {FlowValidationError[]}
 */
function validateSubflowRecursion(flow, edges) {
  const errors = [];
  
  const normalized = normalizeFlowFormat(flow);
  if (!normalized || !normalized.nodes || normalized.nodes.length === 0) {
    return errors;
  }
  
  // Encontra todos os nós subflow
  const subflowNodes = normalized.nodes.filter(node => {
    const nodeType = node.type || (node.data && node.data.type);
    return nodeType === 'subflow';
  });
  
  if (subflowNodes.length === 0) {
    return errors;
  }
  
  // Obtém o flowId atual (se disponível)
  const currentFlowId = flow.id || flow.flowId || null;
  
  // Valida cada nó subflow
  subflowNodes.forEach(node => {
    const nodeId = String(node.id || '');
    const config = node.config || (node.data && node.data.config);
    const subflowId = config?.flowId;
    
    if (!subflowId || typeof subflowId !== 'string') {
      return; // Validação de config é feita no schema do nó
    }
    
    // BLOQUEAR: Subfluxo chamando o próprio fluxo (recursão direta)
    if (currentFlowId && subflowId === currentFlowId) {
      errors.push(addUiMessage({
        code: 'SUBFLOW_RECURSION',
        message: `Nó subflow "${nodeId}" tenta chamar o próprio fluxo "${subflowId}" (recursão infinita).`,
        messageUi: `❌ Nó "${nodeId}" tenta chamar o próprio fluxo. Isso causaria recursão infinita. Use um fluxo diferente.`,
        nodeIds: [nodeId],
        severity: 'error',
        details: { subflowId, currentFlowId },
      }));
    }
  });
  
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
  
  // Validações de arquitetura (múltiplas entradas, roteadores, subfluxos)
  errors = errors.concat(validateMultipleInputs(flow, edges));
  errors = errors.concat(validateRouterChains(flow, edges));
  errors = errors.concat(validateLargeFlowsWithoutSubflow(flow));
  errors = errors.concat(validateMultiOutputNodesWithoutFallback(flow, edges));
  errors = errors.concat(validateSubflowRecursion(flow, edges));
  
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

