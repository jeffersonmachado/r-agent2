export function runFlowValidation(editor) {
    if (!editor) return;
  
    const nodes = editor.getNodes();
  
    for (const node of nodes) {
      const errors = validateNode(node);
  
      node.data.validation = {
        status: errors.length ? 'invalid' : 'valid',
        errors
      };
    }
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
  