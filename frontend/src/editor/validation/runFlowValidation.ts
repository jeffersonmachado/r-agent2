import logger from '../../utils/logger';

/**
 * Aplica erros de validação do backend aos nós do editor
 * @param {any} editor - Instância do editor Rete.js
 * @param {any} area - Instância do AreaPlugin
 * @param {Array<{ nodeIds?: string[], message: string }>} backendErrors - Erros do backend com nodeIds (IDs do engine)
 */
export function applyBackendValidationErrors(editor, area, backendErrors) {
  if (!editor || !backendErrors || !Array.isArray(backendErrors)) return;
  
  // Cria mapa de engineId -> nodeId do editor
  // Os nodeIds do backend são os IDs numéricos do JSON Rete (ex: "1", "2", "3")
  // Precisamos mapear para os IDs reais dos nós no editor
  // ✅ CORREÇÃO: Garante que usamos a mesma ordem que o toJSON() usa
  // O toJSON() itera sobre editor.getNodes() usando forEach com índice
  // Precisamos garantir que usamos Array.from() para manter ordem consistente
  const engineIdToEditorNode = new Map();
  
  // Obtém nós do editor e converte para array para garantir ordem consistente
  // Isso garante que a ordem seja a mesma que o toJSON() usa
  const nodes = Array.from(editor.getNodes());
  
  // Cria mapeamento: para cada nó, calcula qual seria seu ID no JSON Rete
  // Segue a mesma lógica de toJSON() em createEditor.js (linha 112-115)
  nodes.forEach((node, index) => {
    const jsonId = String(index + 1); // ID no JSON Rete (1, 2, 3...)
    engineIdToEditorNode.set(jsonId, node);
  });
  
  logger.debug('applyBackendValidationErrors - mapeamento criado', {
    totalNodes: nodes.length,
    mappedIds: Array.from(engineIdToEditorNode.keys()),
    nodeIds: nodes.map(n => n.id),
  });
  
  // ✅ Se backendErrors está vazio, limpa todos os erros do backend dos nós
  // Se tem erros, limpa erros do backend existentes antes de aplicar novos
  if (backendErrors.length === 0) {
    // Limpa todos os erros que têm code (erros do backend)
    nodes.forEach((node) => {
      if (node.data?.validation?.errors) {
        // Remove apenas erros que têm code (vindos do backend)
        const localErrors = node.data.validation.errors.filter((err) => {
          // Mantém apenas strings (erros locais) ou objetos sem code
          if (typeof err === 'string') return true;
          if (typeof err === 'object' && !err.code) return true;
          return false; // Remove objetos com code (erros do backend)
        });
        
        node.data.validation.errors = localErrors;
        node.data.validation.status = localErrors.length > 0 ? 'invalid' : 'valid';
        
        if (area && typeof area.update === 'function') {
          try {
            area.update('node', node.id);
          } catch (err) {
            logger.warn('Erro ao atualizar nó via area.update', { nodeId: node.id, error: err });
          }
        }
      }
    });
    return; // Não há erros para aplicar
  }
  
  // ✅ Limpa erros do backend existentes (mantém apenas erros locais)
  nodes.forEach((node) => {
    if (node.data?.validation?.errors) {
      // Remove apenas erros que têm code (vindos do backend)
      const localErrors = node.data.validation.errors.filter((err) => {
        // Mantém apenas strings (erros locais) ou objetos sem code
        if (typeof err === 'string') return true;
        if (typeof err === 'object' && !err.code) return true;
        return false; // Remove objetos com code (erros do backend)
      });
      
      node.data.validation.errors = localErrors;
    }
  });
  
  // ✅ Aplica novos erros do backend
  const nodesWithErrors = new Set();
  const globalErrors = []; // Erros globais (sem nodeIds ou com nodeIds vazio)
  
  backendErrors.forEach((error) => {
    // Verifica se é erro global (sem nodeIds ou com array vazio)
    if (!error.nodeIds || !Array.isArray(error.nodeIds) || error.nodeIds.length === 0) {
      globalErrors.push(error);
      logger.debug('applyBackendValidationErrors - erro global detectado', {
        code: error.code,
        message: error.message || error.messageUi,
      });
      return; // Erros globais não são aplicados a nós específicos, apenas exibidos no painel
    }
    
    error.nodeIds.forEach((engineId) => {
      const editorNode = engineIdToEditorNode.get(String(engineId));
      if (editorNode) {
        if (!editorNode.data) {
          editorNode.data = {};
        }
        if (!editorNode.data.validation) {
          editorNode.data.validation = { status: 'valid', errors: [] };
        }
        
        // Adiciona erro do backend como objeto com code, message (técnica) e messageUi (amigável)
        const errorCode = error.code || 'VALIDATION_ERROR';
        const errorMessage = error.message || 'Erro de validação';
        const errorMessageUi = error.messageUi || errorMessage; // Usa messageUi se disponível, senão usa message
        
        // Verifica se o erro já existe (evita duplicatas)
        const errorExists = editorNode.data.validation.errors.some(
          (err) => (typeof err === 'object' && err.code === errorCode && err.message === errorMessage) ||
                   (typeof err === 'string' && err === errorMessage)
        );
        
        if (!errorExists) {
          editorNode.data.validation.errors.push({
            code: errorCode,
            message: errorMessage, // ✅ Mensagem técnica original
            messageUi: errorMessageUi, // ✅ Mensagem amigável
          });
        }
        
        editorNode.data.validation.status = 'invalid';
        nodesWithErrors.add(editorNode.id);
        
        logger.debug('applyBackendValidationErrors - erro aplicado ao nó', {
          engineId,
          editorNodeId: editorNode.id,
          nodeType: editorNode.data?.type,
          errorMessage,
        });
      } else {
        logger.warn('applyBackendValidationErrors - nó não encontrado para engineId', {
          engineId,
          availableIds: Array.from(engineIdToEditorNode.keys()),
        });
      }
    });
  });
  
  // Atualiza visualização dos nós afetados
  nodesWithErrors.forEach((nodeId) => {
    if (area && typeof area.update === 'function') {
      try {
        area.update('node', nodeId);
      } catch (err) {
        logger.warn('Erro ao atualizar nó via area.update', { nodeId, error: err });
      }
    }
  });
  
  logger.debug('applyBackendValidationErrors - erros aplicados', {
    errorCount: backendErrors.length,
    globalErrorsCount: globalErrors.length,
    nodeSpecificErrorsCount: backendErrors.length - globalErrors.length,
    nodesAffected: nodesWithErrors.size,
    nodeIds: Array.from(nodesWithErrors),
    globalErrorCodes: globalErrors.map(e => e.code),
  });
}

export function runFlowValidation(editor, area?: any) {
    if (!editor) return;
  
    const nodes = editor.getNodes();
    
    logger.debug('runFlowValidation - iniciando validação', {
      nodeCount: nodes.length,
    });
  
    for (const node of nodes) {
      const errors = validateNode(node);
  
      // ✅ Usa erros exatamente como estão (sem transformação)
      // Erros locais são strings, erros do backend são objetos com code e message
      node.data.validation = {
        status: errors.length ? 'invalid' : 'valid',
        errors: errors
      };
      
      // ✅ Usa area.update() para forçar re-render do React (padrão do Rete.js v2)
      // Isso garante que a classe CSS 'flow-node--error' seja aplicada
      // Referência: https://github.com/retejs/reference/blob/main/src/rete/default.ts#L191
      if (area && typeof area.update === 'function') {
        try {
          area.update('node', node.id);
        } catch (err) {
          logger.warn('Erro ao atualizar nó via area.update', { nodeId: node.id, error: err });
        }
      }
      
      if (errors.length > 0) {
        logger.debug('runFlowValidation - nó marcado como inválido', {
          nodeId: node.id,
          nodeType: node.data?.type,
          errorCount: errors.length,
          errors: errors,
        });
      }
    }
    
    logger.debug('runFlowValidation - validação concluída', {
      nodeCount: nodes.length,
      invalidCount: nodes.filter(n => n.data?.validation?.status === 'invalid').length,
    });
  }
  
  /**
   * Validação PURA de um nó
   * - Não acessa editor
   * - Não acessa DOM
   */
  function validateNode(node) {
    const errors: string[] = [];
  
    if (node.type === 'message') {
      if (!node.data?.text || node.data.text.trim() === '') {
        errors.push('Mensagem vazia');
      }
    }
  
    if (node.type === 'condition') {
      if (!node.data?.expression) {
        errors.push('Condição não configurada');
      }
    }
  
    return errors;
  }
  