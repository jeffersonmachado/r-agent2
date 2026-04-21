/**
 * Recuperação automática de erros RPA.
 * 
 * Tenta recuperar automaticamente de erros durante execução.
 */

const config = require('./rpaConfig');

class ErrorRecovery {
  constructor() {
    this.recoveryStrategies = {
      element_not_found: this.recoverElementNotFound.bind(this),
      timeout: this.recoverTimeout.bind(this),
      validation_error: this.recoverValidationError.bind(this),
    };
  }

  /**
   * Tenta recuperar de erro.
   * 
   * @param {Object} detectedError - Erro detectado
   * @param {Object} action - Ação que causou o erro
   * @param {Object} page - Página do Playwright
   */
  async recover(detectedError, action, page) {
    const strategy = this.recoveryStrategies[detectedError.type];
    
    if (!strategy) {
      return {
        success: false,
        reason: 'Estratégia de recuperação não disponível para este tipo de erro',
      };
    }

    try {
      return await strategy(detectedError, action, page);
    } catch (error) {
      return {
        success: false,
        reason: `Erro durante recuperação: ${error.message}`,
      };
    }
  }

  /**
   * Recupera erro de elemento não encontrado.
   */
  async recoverElementNotFound(detectedError, action, page) {
    const selector = action.selector || action.url;
    
    // Estratégia 1: Aguardar mais tempo
    try {
      await page.waitForSelector(selector, { 
        timeout: (action.timeout || 30000) * 2,
        state: 'visible',
      });
      return { success: true, strategy: 'increased_timeout' };
    } catch (error) {
      // Continua para próxima estratégia
    }

    // Estratégia 2: Tentar seletor alternativo
    const alternativeSelectors = this.generateAlternativeSelectors(selector);
    for (const altSelector of alternativeSelectors) {
      try {
        const exists = await page.locator(altSelector).count() > 0;
        if (exists) {
          // Atualiza ação com seletor alternativo
          action.selector = altSelector;
          return { success: true, strategy: 'alternative_selector', newSelector: altSelector };
        }
      } catch (error) {
        // Continua tentando
      }
    }

    // Estratégia 3: Scroll para elemento
    try {
      await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, selector);
      
      await page.waitForSelector(selector, { timeout: 5000 });
      return { success: true, strategy: 'scroll_to_element' };
    } catch (error) {
      // Falhou
    }

    return {
      success: false,
      reason: 'Não foi possível encontrar elemento com estratégias de recuperação',
    };
  }

  /**
   * Recupera erro de timeout.
   */
  async recoverTimeout(detectedError, action, page) {
    // Estratégia 1: Aguardar mais tempo
    const selector = action.selector || action.waitFor;
    if (selector) {
      try {
        await page.waitForSelector(selector, {
          timeout: (action.timeout || 30000) * 2,
        });
        return { success: true, strategy: 'increased_timeout' };
      } catch (error) {
        // Continua
      }
    }

    // Estratégia 2: Aguardar estado específico
    if (selector) {
      try {
        await page.waitForSelector(selector, {
          state: 'attached', // Menos restritivo que 'visible'
          timeout: (action.timeout || 30000) * 1.5,
        });
        return { success: true, strategy: 'relaxed_state' };
      } catch (error) {
        // Falhou
      }
    }

    return {
      success: false,
      reason: 'Timeout não recuperável',
    };
  }

  /**
   * Recupera erro de validação.
   */
  async recoverValidationError(detectedError, action, page) {
    // Para validação, geralmente não há recuperação automática
    // Mas podemos tentar re-executar a ação com dados corrigidos
    if (action.type === 'fill' && action.validate) {
      // Tenta limpar e preencher novamente
      try {
        await page.fill(action.selector, '');
        await page.fill(action.selector, action.value);
        return { success: true, strategy: 'refill' };
      } catch (error) {
        // Falhou
      }
    }

    return {
      success: false,
      reason: 'Erro de validação requer correção manual de dados',
    };
  }

  /**
   * Gera seletores alternativos.
   * 
   * @param {string} selector - Seletor original
   */
  generateAlternativeSelectors(selector) {
    const alternatives = [];

    // Se for ID, tenta por classe
    if (selector.startsWith('#')) {
      const id = selector.substring(1);
      alternatives.push(`[id="${id}"]`);
      alternatives.push(`[data-id="${id}"]`);
    }

    // Se for classe, tenta por atributo data-*
    if (selector.startsWith('.')) {
      const className = selector.substring(1);
      alternatives.push(`[class*="${className}"]`);
      alternatives.push(`[data-class="${className}"]`);
    }

    // Tenta por texto
    alternatives.push(`text=${selector}`);
    
    // Tenta por atributo name
    if (selector.includes('[')) {
      // Já tem atributo, não precisa
    } else {
      alternatives.push(`[name="${selector}"]`);
    }

    return alternatives.filter(alt => alt !== selector);
  }
}

module.exports = { ErrorRecovery };

