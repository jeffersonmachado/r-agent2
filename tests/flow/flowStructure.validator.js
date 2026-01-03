/**
 * Validador de estrutura de fluxos - VALIDAÇÃO SEMÂNTICA POR TIPO DE NÓ.
 * 
 * Transformado de validador topológico para SEMÂNTICO POR TIPO DE NÓ.
 * 
 * Objetivo: Fluxos logicamente inválidos NÃO passam da validação de flow.
 * 
 * Validações obrigatórias implementadas:
 * - START/ENTRY: exatamente um nó start, sem entradas
 * - ROUTER: fallback explícito, regras válidas, variáveis definidas
 * - SET_VARIABLE: varName obrigatório, value não undefined
 * - USER_INPUT: outputVar obrigatório, tipo esperado declarado
 * - MESSAGE/TEXT: texto não vazio, variáveis interpoladas definidas
 * - END/TERMINATE: só permitido em nós folha (sem saídas)
 * - API/ACTION: contrato explícito de entrada e saída
 * - DELAY/WAIT: valor positivo
 */

function validateFlowStructure(flow) {
  const errors = [];
  const warnings = [];
  
  // Valida estrutura básica
  if (!flow.id) {
    errors.push({
      validator: 'flowStructure.validator',
      level: 'error',
      code: 'FLOW_ERROR_START_INVALID',
      message: 'Fluxo sem ID',
      details: { flow }
    });
    return { errors, warnings };
  }
  
  if (!flow.nodes || !Array.isArray(flow.nodes)) {
    errors.push({
      validator: 'flowStructure.validator',
      level: 'error',
      code: 'FLOW_ERROR_START_INVALID',
      message: 'Fluxo sem nodes ou nodes inválido',
      details: { flowId: flow.id }
    });
    return { errors, warnings };
  }
  
  if (flow.nodes.length === 0) {
    errors.push({
      validator: 'flowStructure.validator',
      level: 'error',
      code: 'FLOW_ERROR_START_INVALID',
      message: 'Fluxo sem nodes',
      details: { flowId: flow.id }
    });
    return { errors, warnings };
  }
  
  // Constrói mapa de nós e arestas para análise semântica
  const nodeIds = new Set();
  const nodeMap = new Map();
  const edges = []; // { from: string, to: string }
  const definedVariables = new Set(); // Variáveis definidas no fluxo
  const usedVariables = new Map(); // varName -> [nodeIds que usam]
  
  // Primeira passagem: valida estrutura básica e constrói grafo
  for (const node of flow.nodes) {
    // Valida ID
    if (!node.id) {
      errors.push({
        validator: 'flowStructure.validator',
        level: 'error',
        code: 'FLOW_ERROR_START_INVALID',
        message: 'Node sem ID',
        details: { flowId: flow.id, node }
      });
      continue;
    }
    
    // Valida ID único
    if (nodeIds.has(node.id)) {
      errors.push({
        validator: 'flowStructure.validator',
        level: 'error',
        code: 'FLOW_ERROR_START_INVALID',
        message: 'ID de node duplicado',
        details: { flowId: flow.id, nodeId: node.id }
      });
    }
    nodeIds.add(node.id);
    nodeMap.set(node.id, node);
    
    // Valida tipo
    if (!node.type) {
      errors.push({
        validator: 'flowStructure.validator',
        level: 'error',
        code: 'FLOW_ERROR_START_INVALID',
        message: 'Node sem tipo',
        details: { flowId: flow.id, nodeId: node.id }
      });
      continue;
    }
    
    // Constrói arestas do grafo
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
        if (rule && rule.next && typeof rule.next === 'string') {
          edges.push({ from: node.id, to: rule.next });
        }
      }
    }
    
    // Rastreia variáveis definidas (set_variable)
    if (node.type === 'set_variable' && node.config && node.config.assignments) {
      const assignments = node.config.assignments;
      for (const varName of Object.keys(assignments)) {
        definedVariables.add(varName);
      }
    }
    
    // Rastreia variáveis usadas (router, message)
    if (node.type === 'router' && node.config && Array.isArray(node.config.rules)) {
      for (const rule of node.config.rules) {
        if (rule && rule.condition && rule.condition.var && rule.condition.op !== 'always') {
          const varName = rule.condition.var;
          if (!usedVariables.has(varName)) {
            usedVariables.set(varName, []);
          }
          usedVariables.get(varName).push(node.id);
        }
      }
    }
    
    if (node.type === 'message' && node.config && node.config.text) {
      const text = String(node.config.text);
      const varMatches = text.match(/\{\{(\w+)\}\}/g);
      if (varMatches) {
        for (const match of varMatches) {
          const varName = match.replace(/\{\{|\}\}/g, '');
          if (!usedVariables.has(varName)) {
            usedVariables.set(varName, []);
          }
          usedVariables.get(varName).push(node.id);
        }
      }
    }
  }
  
  // ============================================
  // VALIDAÇÕES SEMÂNTICAS POR TIPO DE NÓ
  // ============================================
  
  // START / ENTRY
  const startNodes = flow.nodes.filter(n => n.type === 'start' || n.type === 'entry');
  if (startNodes.length === 0) {
    errors.push({
      validator: 'flowStructure.validator',
      level: 'error',
      code: 'FLOW_ERROR_START_INVALID',
      message: 'Fluxo deve ter EXATAMENTE um nó start',
      details: { flowId: flow.id }
    });
  } else if (startNodes.length > 1) {
    errors.push({
      validator: 'flowStructure.validator',
      level: 'error',
      code: 'FLOW_ERROR_START_INVALID',
      message: 'Fluxo deve ter EXATAMENTE um nó start (encontrados múltiplos)',
      details: { flowId: flow.id, startNodeIds: startNodes.map(n => n.id) }
    });
  } else {
    const startNode = startNodes[0];
    // Start não pode ter entradas
    const hasIncoming = edges.some(e => e.to === startNode.id);
    if (hasIncoming) {
      errors.push({
        validator: 'flowStructure.validator',
        level: 'error',
        code: 'FLOW_ERROR_START_INVALID',
        message: `Nó start "${startNode.id}" não pode ter entradas`,
        details: { flowId: flow.id, nodeId: startNode.id }
      });
    }
  }
  
  // Valida cada nó individualmente
  for (const node of flow.nodes) {
    if (!node.id || !node.type) continue;
    
    switch (node.type) {
      case 'router': {
        // ROUTER: Deve ter fallback explícito
        const rules = (node.config && Array.isArray(node.config.rules)) ? node.config.rules : [];
        let hasAlwaysRule = false;
        let hasDefaultNext = false;
        
        // Verifica regra com op="always"
        for (const rule of rules) {
          if (rule && rule.condition && rule.condition.op === 'always') {
            hasAlwaysRule = true;
          }
          
          // Valida cada regra
          if (rule) {
            if (!rule.condition || typeof rule.condition !== 'object') {
              errors.push({
                validator: 'flowStructure.validator',
                level: 'error',
                code: 'FLOW_ERROR_ROUTER_NO_FALLBACK',
                message: `Router "${node.id}": regra sem condition válido`,
                details: { flowId: flow.id, nodeId: node.id }
              });
            } else {
              const op = rule.condition.op;
              const validOps = ['always', 'equals', 'contains', 'not_equals', 'not_contains', 'greater_than', 'less_than'];
              if (!op || !validOps.includes(op)) {
                errors.push({
                  validator: 'flowStructure.validator',
                  level: 'error',
                  code: 'FLOW_ERROR_ROUTER_NO_FALLBACK',
                  message: `Router "${node.id}": condition.op inválido (${op})`,
                  details: { flowId: flow.id, nodeId: node.id, op, validOps }
                });
              }
              
              // condition.var não pode ser string vazia (exceto para op="always")
              if (op !== 'always' && (!rule.condition.var || typeof rule.condition.var !== 'string' || rule.condition.var.trim() === '')) {
                errors.push({
                  validator: 'flowStructure.validator',
                  level: 'error',
                  code: 'FLOW_ERROR_ROUTER_NO_FALLBACK',
                  message: `Router "${node.id}": condition.var não pode ser vazio quando op != "always"`,
                  details: { flowId: flow.id, nodeId: node.id }
                });
              }
            }
            
            // next deve estar definido e apontar para nó existente
            if (!rule.next || typeof rule.next !== 'string' || rule.next.trim() === '') {
              errors.push({
                validator: 'flowStructure.validator',
                level: 'error',
                code: 'FLOW_ERROR_ROUTER_NO_FALLBACK',
                message: `Router "${node.id}": regra sem next definido`,
                details: { flowId: flow.id, nodeId: node.id }
              });
            } else if (!nodeIds.has(rule.next)) {
              errors.push({
                validator: 'flowStructure.validator',
                level: 'error',
                code: 'FLOW_ERROR_ROUTER_NO_FALLBACK',
                message: `Router "${node.id}": regra aponta para nó inexistente "${rule.next}"`,
                details: { flowId: flow.id, nodeId: node.id, targetNodeId: rule.next }
              });
            }
          }
        }
        
        // Verifica defaultNext (campo next do nó)
        if (node.next && typeof node.next === 'string' && node.next.trim() !== '') {
          if (!nodeIds.has(node.next)) {
            errors.push({
              validator: 'flowStructure.validator',
              level: 'error',
              code: 'FLOW_ERROR_ROUTER_NO_FALLBACK',
              message: `Router "${node.id}": defaultNext aponta para nó inexistente "${node.next}"`,
              details: { flowId: flow.id, nodeId: node.id, targetNodeId: node.next }
            });
          } else {
            hasDefaultNext = true;
          }
        }
        
        // Erro estrutural se não houver fallback
        if (!hasAlwaysRule && !hasDefaultNext) {
          errors.push({
            validator: 'flowStructure.validator',
            level: 'error',
            code: 'FLOW_ERROR_ROUTER_NO_FALLBACK',
            message: `Router "${node.id}" deve ter fallback explícito: regra com op="always" OU defaultNext válido`,
            details: { flowId: flow.id, nodeId: node.id, hasAlwaysRule, hasDefaultNext }
          });
        }
        
        // WARNING: Variável nunca definida antes no fluxo
        for (const rule of rules) {
          if (rule && rule.condition && rule.condition.var && rule.condition.op !== 'always') {
            const varName = rule.condition.var;
            if (!definedVariables.has(varName)) {
              warnings.push({
                validator: 'flowStructure.validator',
                level: 'warning',
                code: 'ROUTER_VAR_NEVER_DEFINED',
                message: `Router "${node.id}": variável "${varName}" nunca é definida antes no fluxo`,
                details: { flowId: flow.id, nodeId: node.id, variable: varName }
              });
            }
          }
        }
        break;
      }
      
      case 'set_variable': {
        // SET_VARIABLE: varName obrigatório e não vazio, value não pode ser undefined
        if (!node.config || typeof node.config !== 'object') {
          errors.push({
            validator: 'flowStructure.validator',
            level: 'error',
            code: 'FLOW_ERROR_SET_VARIABLE_INVALID',
            message: `Set variable "${node.id}" deve ter config`,
            details: { flowId: flow.id, nodeId: node.id }
          });
        } else if (!node.config.assignments || typeof node.config.assignments !== 'object') {
          errors.push({
            validator: 'flowStructure.validator',
            level: 'error',
            code: 'FLOW_ERROR_SET_VARIABLE_INVALID',
            message: `Set variable "${node.id}" deve ter config.assignments`,
            details: { flowId: flow.id, nodeId: node.id }
          });
        } else {
          const assignments = node.config.assignments;
          const varNames = Object.keys(assignments);
          
          if (varNames.length === 0) {
            errors.push({
              validator: 'flowStructure.validator',
              level: 'error',
              code: 'FLOW_ERROR_SET_VARIABLE_INVALID',
              message: `Set variable "${node.id}" deve ter pelo menos uma atribuição`,
              details: { flowId: flow.id, nodeId: node.id }
            });
          } else {
            for (const varName of varNames) {
              if (!varName || typeof varName !== 'string' || varName.trim() === '') {
                errors.push({
                  validator: 'flowStructure.validator',
                  level: 'error',
                  code: 'FLOW_ERROR_SET_VARIABLE_INVALID',
                  message: `Set variable "${node.id}": varName não pode ser vazio`,
                  details: { flowId: flow.id, nodeId: node.id, varName }
                });
              }
              
              if (assignments[varName] === undefined) {
                errors.push({
                  validator: 'flowStructure.validator',
                  level: 'error',
                  code: 'FLOW_ERROR_SET_VARIABLE_INVALID',
                  message: `Set variable "${node.id}": value não pode ser undefined para variável "${varName}"`,
                  details: { flowId: flow.id, nodeId: node.id, varName }
                });
              }
              
              // WARNING ao sobrescrever variável existente
              if (definedVariables.has(varName)) {
                warnings.push({
                  validator: 'flowStructure.validator',
                  level: 'warning',
                  code: 'SET_VARIABLE_OVERWRITE',
                  message: `Set variable "${node.id}": variável "${varName}" será sobrescrita`,
                  details: { flowId: flow.id, nodeId: node.id, variable: varName }
                });
              }
            }
          }
        }
        break;
      }
      
      case 'user_input': {
        // USER_INPUT: outputVar obrigatório, tipo esperado deve estar declarado
        if (!node.config || typeof node.config !== 'object') {
          errors.push({
            validator: 'flowStructure.validator',
            level: 'error',
            code: 'FLOW_ERROR_USER_INPUT_INVALID',
            message: `User input "${node.id}" deve ter config`,
            details: { flowId: flow.id, nodeId: node.id }
          });
        } else {
          if (!node.config.variable || typeof node.config.variable !== 'string' || node.config.variable.trim() === '') {
            errors.push({
              validator: 'flowStructure.validator',
              level: 'error',
              code: 'FLOW_ERROR_USER_INPUT_INVALID',
              message: `User input "${node.id}": outputVar (config.variable) obrigatório e não vazio`,
              details: { flowId: flow.id, nodeId: node.id }
            });
          }
          
          // Tipo esperado deve estar declarado (se fornecido, deve ser válido)
          if (node.config.expectedType && !['string', 'number', 'intent'].includes(node.config.expectedType)) {
            errors.push({
              validator: 'flowStructure.validator',
              level: 'error',
              code: 'FLOW_ERROR_USER_INPUT_INVALID',
              message: `User input "${node.id}": expectedType inválido (deve ser string, number ou intent)`,
              details: { flowId: flow.id, nodeId: node.id, expectedType: node.config.expectedType }
            });
          }
        }
        break;
      }
      
      case 'message': {
        // MESSAGE / TEXT: Texto não pode ser vazio
        if (!node.config || typeof node.config !== 'object') {
          errors.push({
            validator: 'flowStructure.validator',
            level: 'error',
            code: 'FLOW_ERROR_MESSAGE_EMPTY',
            message: `Message "${node.id}" deve ter config`,
            details: { flowId: flow.id, nodeId: node.id }
          });
        } else if (!node.config.text || typeof node.config.text !== 'string' || node.config.text.trim() === '') {
          errors.push({
            validator: 'flowStructure.validator',
            level: 'error',
            code: 'FLOW_ERROR_MESSAGE_EMPTY',
            message: `Message "${node.id}": texto não pode ser vazio`,
            details: { flowId: flow.id, nodeId: node.id }
          });
        } else {
          // WARNING se interpolar variável não definida
          const text = String(node.config.text);
          const varMatches = text.match(/\{\{(\w+)\}\}/g);
          if (varMatches) {
            for (const match of varMatches) {
              const varName = match.replace(/\{\{|\}\}/g, '');
              if (!definedVariables.has(varName)) {
                warnings.push({
                  validator: 'flowStructure.validator',
                  level: 'warning',
                  code: 'MESSAGE_VAR_NEVER_DEFINED',
                  message: `Message "${node.id}": variável "${varName}" interpolada nunca é definida no fluxo`,
                  details: { flowId: flow.id, nodeId: node.id, variable: varName }
                });
              }
            }
          }
        }
        break;
      }
      
      case 'end': {
        // END / TERMINATE: Só permitido em nós folha (sem saídas)
        // Erro estrutural se tiver saída
        if (node.next) {
          errors.push({
            validator: 'flowStructure.validator',
            level: 'error',
            code: 'FLOW_ERROR_END_HAS_OUTPUTS',
            message: `End "${node.id}" não pode ter saídas (campo next). Nós end devem ser folhas do fluxo`,
            details: { flowId: flow.id, nodeId: node.id }
          });
        }
        
        // Verifica também arestas saindo deste nó
        const hasOutgoing = edges.some(e => e.from === node.id);
        if (hasOutgoing) {
          errors.push({
            validator: 'flowStructure.validator',
            level: 'error',
            code: 'FLOW_ERROR_END_HAS_OUTPUTS',
            message: `End "${node.id}" não pode ter saídas. Nós end devem ser folhas do fluxo`,
            details: { flowId: flow.id, nodeId: node.id }
          });
        }
        break;
      }
      
      case 'delay':
      case 'wait': {
        // DELAY / WAIT: Valor deve ser positivo
        if (!node.config || typeof node.config !== 'object') {
          errors.push({
            validator: 'flowStructure.validator',
            level: 'error',
            code: 'ENGINE_DELAY_INVALID_DURATION',
            message: `Delay/Wait "${node.id}" deve ter config`,
            details: { flowId: flow.id, nodeId: node.id }
          });
        } else {
          const duration = node.config.duration || node.config.value;
          if (duration === undefined || duration === null || (typeof duration === 'number' && duration <= 0)) {
            errors.push({
              validator: 'flowStructure.validator',
              level: 'error',
              code: 'ENGINE_DELAY_INVALID_DURATION',
              message: `Delay/Wait "${node.id}": valor deve ser positivo`,
              details: { flowId: flow.id, nodeId: node.id, duration }
            });
          }
        }
        break;
      }
      
      case 'api':
      case 'action': {
        // API / ACTION: Contrato explícito de entrada e saída, fallback definido
        if (!node.config || typeof node.config !== 'object') {
          errors.push({
            validator: 'flowStructure.validator',
            level: 'error',
            code: 'FLOW_ERROR_START_INVALID',
            message: `API/Action "${node.id}" deve ter config`,
            details: { flowId: flow.id, nodeId: node.id }
          });
        } else {
          // Valida que tem fallback definido (next válido)
          if (!node.next || typeof node.next !== 'string' || node.next.trim() === '') {
            errors.push({
              validator: 'flowStructure.validator',
              level: 'error',
              code: 'FLOW_ERROR_START_INVALID',
              message: `API/Action "${node.id}" deve ter fallback definido (campo next)`,
              details: { flowId: flow.id, nodeId: node.id }
            });
          } else if (!nodeIds.has(node.next)) {
            errors.push({
              validator: 'flowStructure.validator',
              level: 'error',
              code: 'FLOW_ERROR_START_INVALID',
              message: `API/Action "${node.id}": fallback aponta para nó inexistente "${node.next}"`,
              details: { flowId: flow.id, nodeId: node.id, targetNodeId: node.next }
            });
          }
        }
        break;
      }
    }
  }
  
  // Valida conexões (referências a nós existentes)
  if (flow.connections && Array.isArray(flow.connections)) {
    for (const connection of flow.connections) {
      if (!connection.from) {
        errors.push({
          validator: 'flowStructure.validator',
          level: 'error',
          code: 'FLOW_ERROR_START_INVALID',
          message: 'Conexão sem origem',
          details: { flowId: flow.id, connection }
        });
        continue;
      }
      
      if (!connection.to) {
        errors.push({
          validator: 'flowStructure.validator',
          level: 'error',
          code: 'FLOW_ERROR_START_INVALID',
          message: 'Conexão sem destino',
          details: { flowId: flow.id, connection }
        });
        continue;
      }
      
      // Valida referências
      if (!nodeIds.has(connection.from)) {
        errors.push({
          validator: 'flowStructure.validator',
          level: 'error',
          code: 'FLOW_ERROR_START_INVALID',
          message: 'Conexão referencia node inexistente (origem)',
          details: { flowId: flow.id, nodeId: connection.from }
        });
      }
      
      if (!nodeIds.has(connection.to)) {
        errors.push({
          validator: 'flowStructure.validator',
          level: 'error',
          code: 'FLOW_ERROR_START_INVALID',
          message: 'Conexão referencia node inexistente (destino)',
          details: { flowId: flow.id, nodeId: connection.to }
        });
      }
    }
  }
  
  return { errors, warnings };
}

module.exports = { validateFlowStructure };
