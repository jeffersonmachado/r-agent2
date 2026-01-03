/**
 * Detector de erros RPA.
 * 
 * Detecta e classifica erros durante execução de ações.
 */

const { classifyError } = require('../helpers/errorClassifier');

class ErrorDetector {
  constructor() {
    this.errorPatterns = {
      elementNotFound: /element.*not found|selector.*not found|timeout.*waiting for/i,
      timeout: /timeout|timed out|waiting for/i,
      networkError: /network|failed.*request|connection.*refused/i,
      validationError: /validation|expected.*but.*received|does not match/i,
      permissionError: /permission|unauthorized|forbidden/i,
      javascriptError: /javascript|syntax error|reference error/i,
    };
  }

  /**
   * Detecta e classifica erro.
   * 
   * @param {Error|string} error - Erro a detectar
   * @param {Object} action - Ação que causou o erro
   * @param {Object} page - Página do Playwright
   */
  detect(error, action, page) {
    const errorMessage = typeof error === 'string' ? error : error.message || String(error);
    const errorType = this.classifyErrorType(errorMessage);
    
    const detected = {
      type: errorType,
      message: errorMessage,
      action: {
        type: action.type,
        selector: action.selector || action.url || null,
      },
      timestamp: new Date().toISOString(),
      details: {},
    };

    // Adiciona detalhes específicos por tipo
    switch (errorType) {
      case 'element_not_found':
        detected.details = {
          selector: action.selector || action.url,
          suggestion: this.suggestSelectorFix(action.selector),
        };
        break;
      case 'timeout':
        detected.details = {
          timeout: action.timeout,
          suggestion: 'Aumentar timeout ou verificar se elemento aparece',
        };
        break;
      case 'network_error':
        detected.details = {
          url: action.url,
          suggestion: 'Verificar conexão e URL',
        };
        break;
      case 'validation_error':
        detected.details = {
          expected: action.validate?.value || action.text || action.value,
          suggestion: 'Verificar dados de entrada',
        };
        break;
    }

    return detected;
  }

  /**
   * Classifica tipo de erro.
   * 
   * @param {string} errorMessage - Mensagem de erro
   */
  classifyErrorType(errorMessage) {
    const lowerMessage = errorMessage.toLowerCase();

    if (this.errorPatterns.elementNotFound.test(lowerMessage)) {
      return 'element_not_found';
    }
    if (this.errorPatterns.timeout.test(lowerMessage)) {
      return 'timeout';
    }
    if (this.errorPatterns.networkError.test(lowerMessage)) {
      return 'network_error';
    }
    if (this.errorPatterns.validationError.test(lowerMessage)) {
      return 'validation_error';
    }
    if (this.errorPatterns.permissionError.test(lowerMessage)) {
      return 'permission_error';
    }
    if (this.errorPatterns.javascriptError.test(lowerMessage)) {
      return 'javascript_error';
    }

    return 'unknown_error';
  }

  /**
   * Sugere correção para seletor.
   * 
   * @param {string} selector - Seletor que falhou
   */
  suggestSelectorFix(selector) {
    if (!selector) return 'Verificar seletor';

    const suggestions = [];

    // Seletor muito específico
    if (selector.split('>').length > 3) {
      suggestions.push('Considerar usar seletor mais genérico');
    }

    // Seletor com IDs dinâmicos
    if (selector.includes('[id*=') || selector.match(/id="[^"]*\d+[^"]*"/)) {
      suggestions.push('IDs podem ser dinâmicos, considerar usar classes ou atributos data-*');
    }

    // Seletor com classes muito específicas
    if (selector.split('.').length > 4) {
      suggestions.push('Classes podem mudar, considerar usar atributos data-* ou texto');
    }

    return suggestions.length > 0 ? suggestions.join('; ') : 'Verificar se elemento existe na página';
  }

  /**
   * Verifica se erro é recuperável.
   * 
   * @param {Object} detectedError - Erro detectado
   */
  isRecoverable(detectedError) {
    const recoverableTypes = [
      'element_not_found',
      'timeout',
      'validation_error',
    ];

    return recoverableTypes.includes(detectedError.type);
  }
}

module.exports = { ErrorDetector };

