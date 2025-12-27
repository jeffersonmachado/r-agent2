import logger from '../../utils/logger';

export function runFlowValidation(editor) {
    if (!editor) return;
  
    const nodes = editor.getNodes();
    
    logger.debug('runFlowValidation - iniciando validação', {
      nodeCount: nodes.length,
    });
  
    for (const node of nodes) {
      const errors = validateNode(node);
      
      // ✅ Se o nó não faz parte do fluxo atual, adiciona erro especial
      if (node.data?._notInCurrentFlow) {
        logger.debug('runFlowValidation - nó marcado como não pertencente ao fluxo', {
          nodeId: node.id,
          nodeType: node.data?.type,
          hasFlag: true,
        });
        errors.push('Este nó não faz parte do fluxo carregado. Remova-o ou salve o fluxo atual antes de carregar outro.');
      }
  
      node.data.validation = {
        status: errors.length ? 'invalid' : 'valid',
        errors
      };
      
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
  