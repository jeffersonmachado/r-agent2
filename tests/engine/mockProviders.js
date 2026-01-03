/**
 * Providers mockados para simulação determinística.
 * 
 * Estes providers não fazem chamadas reais a APIs externas
 * e retornam respostas determinísticas baseadas em templates.
 */

/**
 * Provider de IA mock.
 * Retorna respostas determinísticas baseadas em templates.
 */
class MockAiProvider {
  constructor() {
    this.callCount = 0;
  }
  
  /**
   * Gera resposta determinística baseada no prompt.
   * 
   * @param {string} prompt - Prompt do usuário
   * @returns {Promise<string>} Resposta determinística
   */
  async generateResponse(prompt) {
    this.callCount++;
    
    // Respostas determinísticas baseadas em palavras-chave
    const lowerPrompt = prompt.toLowerCase();
    
    if (lowerPrompt.includes('olá') || lowerPrompt.includes('oi') || lowerPrompt.includes('bom dia')) {
      return 'Olá! Como posso ajudar?';
    }
    
    if (lowerPrompt.includes('ajuda') || lowerPrompt.includes('help')) {
      return 'Claro! Estou aqui para ajudar. Em que posso auxiliar?';
    }
    
    if (lowerPrompt.includes('obrigado') || lowerPrompt.includes('obrigada')) {
      return 'De nada! Fico feliz em ajudar.';
    }
    
    if (lowerPrompt.includes('tchau') || lowerPrompt.includes('até logo')) {
      return 'Até logo! Tenha um ótimo dia!';
    }
    
    // Resposta padrão determinística
    return 'Entendi. Como posso ajudar com isso?';
  }
  
  /**
   * Reseta o contador de chamadas (útil para testes).
   */
  reset() {
    this.callCount = 0;
  }
  
  /**
   * Retorna número de chamadas realizadas.
   */
  getCallCount() {
    return this.callCount;
  }
}

/**
 * Provider de API mock.
 * Simula chamadas HTTP determinísticas.
 */
class MockApiProvider {
  constructor() {
    this.callCount = 0;
    this.responses = new Map();
  }
  
  /**
   * Registra uma resposta para uma URL específica.
   * 
   * @param {string} url - URL da requisição
   * @param {any} response - Resposta a retornar
   */
  registerResponse(url, response) {
    this.responses.set(url, response);
  }
  
  /**
   * Faz uma requisição mockada.
   * 
   * @param {string} url - URL da requisição
   * @param {object} options - Opções da requisição
   * @returns {Promise<any>} Resposta determinística
   */
  async fetch(url, options = {}) {
    this.callCount++;
    
    // Se há resposta registrada, retorna ela
    if (this.responses.has(url)) {
      return {
        ok: true,
        status: 200,
        json: async () => this.responses.get(url),
        text: async () => JSON.stringify(this.responses.get(url))
      };
    }
    
    // Resposta padrão
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
      text: async () => JSON.stringify({ success: true })
    };
  }
  
  /**
   * Reseta o provider.
   */
  reset() {
    this.callCount = 0;
    this.responses.clear();
  }
  
  /**
   * Retorna número de chamadas realizadas.
   */
  getCallCount() {
    return this.callCount;
  }
}

module.exports = {
  MockAiProvider,
  MockApiProvider
};









