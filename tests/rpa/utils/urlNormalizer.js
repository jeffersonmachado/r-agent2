/**
 * Utilitário para normalização de URLs em testes RPA.
 * 
 * Responsabilidades:
 * - Normaliza URLs inválidas (rpa.local, etc) para URLs válidas
 * - Converte URLs relativas para absolutas
 * - Aplica base URL do frontend
 */

/**
 * Normaliza URLs nos steps e asserts do teste RPA.
 * Substitui URLs inválidas ou relativas pela URL base do frontend.
 * 
 * @param {Object} test - Objeto de teste RPA (pode ser recording, seed, etc)
 */
function normalizeRpaTestUrls(test) {
  // Obtém URL base do frontend
  const frontendUrl = process.env.TEST_FRONTEND_URL || 
                      process.env.FRONTEND_URL || 
                      'http://localhost:5173';
  
  // Remove barra final se houver
  const baseUrl = frontendUrl.replace(/\/$/, '');
  
  /**
   * Normaliza uma URL:
   * - Se for inválida (rpa.local, etc) ou relativa, converte para absoluta
   * - Se já for absoluta e válida, mantém
   */
  function normalizeUrl(url) {
    if (!url || typeof url !== 'string') {
      return url;
    }
    
    // Se já é uma URL absoluta válida (http:// ou https://), verifica se é inválida
    if (url.match(/^https?:\/\//)) {
      // Verifica se é um domínio inválido conhecido
      const invalidDomains = ['rpa.local', 'localhost.local', '.local'];
      const isInvalid = invalidDomains.some(domain => url.includes(domain));
      
      if (isInvalid) {
        // Extrai o caminho e query string
        try {
          const urlObj = new URL(url);
          const path = urlObj.pathname + urlObj.search;
          return baseUrl + path;
        } catch (e) {
          // Se falhar ao parsear, tenta extrair caminho manualmente
          const match = url.match(/https?:\/\/[^\/]+(\/.*)?$/);
          if (match && match[1]) {
            return baseUrl + match[1];
          }
          return baseUrl;
        }
      }
      
      // URL absoluta válida, mantém
      return url;
    }
    
    // URL relativa, adiciona base
    if (url.startsWith('/')) {
      return baseUrl + url;
    }
    
    // URL relativa sem barra inicial
    return baseUrl + '/' + url;
  }
  
  // Normaliza URLs nos steps
  if (test.steps && Array.isArray(test.steps)) {
    test.steps.forEach(step => {
      if (step.type === 'navigate') {
        // Normaliza URL em action.url ou action.value
        if (step.url) {
          step.url = normalizeUrl(step.url);
        }
        if (step.value) {
          step.value = normalizeUrl(step.value);
        }
      }
    });
  }
  
  // Normaliza URLs nos asserts
  if (test.asserts && Array.isArray(test.asserts)) {
    test.asserts.forEach(assert => {
      if (assert.type === 'url' && assert.expected) {
        assert.expected = normalizeUrl(assert.expected);
      }
    });
  }
}

module.exports = {
  normalizeRpaTestUrls,
};

