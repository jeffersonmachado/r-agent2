/**
 * Utilitário para normalização de URLs em testes RPA usados pela API.
 *
 * Esta versão vive em `api/utils` para estar disponível no container de produção,
 * independente da presença dos arquivos de teste em `tests/`.
 *
 * Responsabilidades:
 * - Normaliza URLs inválidas (rpa.local, etc) para URLs válidas
 * - Converte URLs relativas para absolutas
 * - Aplica base URL do frontend
 */

const config = require('./config');
const logger = require('./logger');

/**
 * Normaliza URLs nos steps e asserts do teste RPA.
 * Substitui URLs inválidas ou relativas pela URL base do frontend.
 *
 * @param {Object} test - Objeto de teste RPA (pode ser recording, seed, etc)
 */
function normalizeRpaTestUrls(test) {
  if (!test || typeof test !== 'object') {
    return;
  }

  // Obtém URL base do frontend
  // Prioridade: TEST_FRONTEND_URL > FRONTEND_URL > rpa.config.json > config.json > fallback
  const frontendUrl =
    process.env.TEST_FRONTEND_URL ||
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
      // Reescreve URLs antigas do frontend (localhost:5173) para a base ativa do ambiente.
      try {
        const urlObj = new URL(url);
        const port = urlObj.port || (urlObj.protocol === 'https:' ? '443' : '80');
        if ((urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1') && port === '5173') {
          const baseObj = new URL(baseUrl);
          urlObj.protocol = baseObj.protocol;
          urlObj.hostname = baseObj.hostname;
          urlObj.port = baseObj.port;
          return urlObj.toString();
        }
      } catch (_) {
        // Se não parsear, segue o fluxo legado abaixo.
      }

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
            stepType: step.type,
          });
        }

        // Normaliza URL em action.url ou action.value
        if (step.url) {
          step.url = normalizeUrl(step.url);
        }
        if (step.value) {
          step.value = normalizeUrl(step.value);
        }
      }

      if (step.type === 'assert' && step.assert && step.assert.type === 'url' && step.assert.expected) {
        step.assert.expected = normalizeUrl(step.assert.expected);
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

