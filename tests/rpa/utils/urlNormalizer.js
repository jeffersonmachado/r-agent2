/**
 * Utilitário para normalização de URLs em testes RPA.
 * 
 * Responsabilidades:
 * - Normaliza URLs inválidas (rpa.local, etc) para URLs válidas
 * - Converte URLs relativas para absolutas
 * - Aplica base URL do frontend
 */

const config = require('../../../api/utils/config');
const logger = require('../../../api/utils/logger');

/**
 * Normaliza URLs nos steps e asserts do teste RPA.
 * Substitui URLs inválidas ou relativas pela URL base do frontend.
 * 
 * @param {Object} test - Objeto de teste RPA (pode ser recording, seed, etc)
 */
function normalizeRpaTestUrls(test) {
  // Obtém URL base do frontend
  // Prioridade: TEST_FRONTEND_URL > FRONTEND_URL > rpa.config.json > config.json > fallback
  const frontendUrl = process.env.TEST_FRONTEND_URL || 
                      process.env.FRONTEND_URL || 
                      config.get('tests.rpa.frontendUrl') ||
                      config.get('frontend.url') ||
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
      try {
        const urlObj = new URL(url);

        // Reescreve URLs locais (ex.: localhost:3000) para a base atual do frontend.
        // Isso permite replay de seeds gravados em portas diferentes (3000 vs 5173, etc).
        const localHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0']);
        if (localHosts.has(urlObj.hostname)) {
          return baseUrl + urlObj.pathname + urlObj.search + urlObj.hash;
        }

        // Verifica se é um domínio inválido conhecido
        const invalidDomains = ['rpa.local', 'localhost.local', '.local'];
        const isInvalid = invalidDomains.some(domain => urlObj.hostname.includes(domain));

        if (isInvalid) {
          return baseUrl + urlObj.pathname + urlObj.search + urlObj.hash;
        }

        // URL absoluta válida e não-local, mantém
        return url;
      } catch (e) {
        // Se falhar ao parsear, tenta extrair caminho manualmente
        const match = url.match(/https?:\/\/[^\/]+(\/.*)?$/);
        if (match && match[1]) {
          return baseUrl + match[1];
        }
        return baseUrl;
      }
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
    const hasFlowIdInSteps = test.steps.some((step) => {
      const candidate = step?.url || step?.value || step?.selector || '';
      return typeof candidate === 'string' && candidate.includes('flowId=');
    });
    const hasChatGreetingAssert = test.steps.some((step) => {
      const expected = step?.assert?.expected || step?.expected || '';
      return typeof expected === 'string' && expected.includes('Como posso ajudar');
    });
    const derivedFlowId = typeof test.id === 'string'
      ? (test.id.match(/^test-flow-([^-]+)/) ? `flow-${test.id.match(/^test-flow-([^-]+)/)[1]}` : null)
      : null;

    test.steps.forEach((step, index) => {
      if (step.type === 'navigate') {
        // Garante que há uma URL válida (url ou value)
        if (!step.url && !step.value) {
          // Se não houver URL, adiciona URL padrão (base do frontend)
          // Isso corrige casos onde a IA gera ações navigate sem URL
          step.url = baseUrl;
          logger.warn('[urlNormalizer] Ação navigate sem URL, usando URL padrão', {
            stepIndex: index + 1,
            defaultUrl: baseUrl,
            stepType: step.type
          });
        }
        
        // Normaliza URL em action.url ou action.value
        if (step.url) {
          step.url = normalizeUrl(step.url);
        }
        if (step.value) {
          step.value = normalizeUrl(step.value);
        }

        if (!hasFlowIdInSteps && hasChatGreetingAssert && derivedFlowId) {
          const maybeBase = step.url || step.value;
          if (typeof maybeBase === 'string') {
            const normalized = normalizeUrl(maybeBase);
            const isBaseOnly = normalized === baseUrl || normalized === `${baseUrl}/`;
            if (isBaseOnly) {
              const chatUrl = `${baseUrl}/chat?flowId=${encodeURIComponent(derivedFlowId)}`;
              if (step.url) step.url = chatUrl;
              if (step.value) step.value = chatUrl;
            }
          }
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

