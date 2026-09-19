'use strict';

/**
 * Backends de busca por API — a alternativa ao scraping de HTML.
 *
 * POR QUE EXISTE (medido em 2026-09-19): a busca da plataforma dependia
 * inteiramente de scraping de dois endpoints HTML e ambos estavam inoperantes
 * nesta rede. `DuckDuckGo` falhava no transporte, e o `Bing` — pior — respondia
 * HTTP 200 com página alheia à query ("bakery management software" retornou
 * eletricistas de Summerville/SC numa chamada e "When I Work" em outra; um fetch
 * cru do mesmo URL trouxe uma tela de login do Google). Um levantamento de nove
 * buscadores gratuitos não encontrou nenhum backend de scraping viável (403, 429,
 * 500 ou zero resultados).
 *
 * Scraping é frágil por natureza: o HTML de terceiros muda sem aviso, bloqueia
 * IP de datacenter e não tem contrato. Uma API tem contrato, status honesto e
 * chave — e algumas têm camada gratuita.
 *
 * Este módulo é PURO: monta a requisição e extrai os resultados, sem I/O. O
 * transporte continua sendo o `guardedGet` do provider (política de endpoint,
 * timeout, teto de bytes), e o veredito de relevância continua sendo do
 * `assessSearchResultRelevance` — um backend por API que responda página alheia
 * é recusado exatamente como o de scraping era.
 *
 * ATIVAÇÃO: um provider só entra na lista quando TODAS as suas variáveis de
 * ambiente estão preenchidas. Sem chave, o comportamento é o de antes (scraping),
 * sem quebrar nada.
 */

/** Mesmo teto dos backends de scraping — o cap de resultados é do provider. */
const API_SEARCH_RESULT_LIMIT = 10;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeJson(body) {
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    // Corpo não-JSON (página de erro, HTML de bloqueio): não é resultado, e não
    // pode derrubar o provider — quem chama trata lista vazia como "sem
    // resultados" e segue para o próximo backend.
    return null;
  }
}

function toCandidate({ title, url, snippet, source }) {
  if (!isNonEmptyString(url)) return null;
  return {
    title: isNonEmptyString(title) ? title.trim() : null,
    url: url.trim(),
    snippet: isNonEmptyString(snippet) ? snippet.trim() : null,
    source,
  };
}

/**
 * Registro de providers. `requiredEnv` é a lista de variáveis que precisam
 * existir; `buildRequest` devolve `{url, headers}`; `parseResults` nunca lança.
 */
const API_PROVIDERS = Object.freeze({
  brave: Object.freeze({
    id: 'brave',
    label: 'Brave Search API',
    requiredEnv: Object.freeze(['BRAVE_SEARCH_API_KEY']),
    buildRequest({ apiKey, query, count }) {
      return {
        url:
          'https://api.search.brave.com/res/v1/web/search' +
          `?q=${encodeURIComponent(query)}&count=${count}`,
        // A chave vai no header, nunca na URL — URL vaza em log de proxy.
        headers: { accept: 'application/json', 'x-subscription-token': apiKey },
      };
    },
    parseResults(body) {
      const parsed = safeJson(body);
      const results = parsed && parsed.web && Array.isArray(parsed.web.results)
        ? parsed.web.results
        : [];
      return results
        .map((item) =>
          toCandidate({
            title: item && item.title,
            url: item && item.url,
            snippet: item && (item.description || item.snippet),
            source: 'brave',
          })
        )
        .filter(Boolean);
    },
  }),

  google: Object.freeze({
    id: 'google',
    label: 'Google Custom Search JSON API',
    requiredEnv: Object.freeze(['GOOGLE_CSE_API_KEY', 'GOOGLE_CSE_ID']),
    buildRequest({ apiKey, extraEnv, query, count }) {
      return {
        url:
          'https://www.googleapis.com/customsearch/v1' +
          `?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(extraEnv.GOOGLE_CSE_ID)}` +
          `&q=${encodeURIComponent(query)}&num=${count}`,
        headers: { accept: 'application/json' },
      };
    },
    parseResults(body) {
      const parsed = safeJson(body);
      const items = parsed && Array.isArray(parsed.items) ? parsed.items : [];
      return items
        .map((item) =>
          toCandidate({
            title: item && item.title,
            url: item && item.link,
            snippet: item && item.snippet,
            source: 'google',
          })
        )
        .filter(Boolean);
    },
  }),
});

/** Ordem determinística: explícita, para o motivo da falha ser reprodutível. */
const API_PROVIDER_ORDER = Object.freeze(['brave', 'google']);

/**
 * Quais providers por API estão utilizáveis no ambiente dado.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {Array<{id: string, label: string, apiKey: string, extraEnv: object}>}
 */
function listConfiguredApiBackends(env = {}) {
  const configured = [];
  for (const id of API_PROVIDER_ORDER) {
    const provider = API_PROVIDERS[id];
    if (!provider) continue;
    const missing = provider.requiredEnv.filter((key) => !isNonEmptyString(env[key]));
    if (missing.length > 0) continue;
    configured.push({
      id: provider.id,
      label: provider.label,
      apiKey: String(env[provider.requiredEnv[0]]).trim(),
      extraEnv: Object.fromEntries(provider.requiredEnv.slice(1).map((k) => [k, String(env[k]).trim()])),
    });
  }
  return configured;
}

/**
 * Monta a requisição de um backend por API.
 * @returns {{url: string, headers: object}}
 */
function buildApiSearchRequest({ providerId, env = {}, query, count = API_SEARCH_RESULT_LIMIT }) {
  const provider = API_PROVIDERS[providerId];
  if (!provider) throw new Error(`api_search_provider_unknown: ${providerId}`);
  if (!isNonEmptyString(query)) throw new Error('api_search_query_required');

  const apiKey = provider.requiredEnv[0];
  return provider.buildRequest({
    apiKey: String(env[apiKey] || '').trim(),
    extraEnv: env,
    query: String(query),
    count: Math.max(1, Math.min(Number(count) || API_SEARCH_RESULT_LIMIT, API_SEARCH_RESULT_LIMIT)),
  });
}

/**
 * Extrai candidatos da resposta. Nunca lança: corpo inválido vira lista vazia.
 * @returns {Array<{title, url, snippet, source}>}
 */
function parseApiSearchResponse({ providerId, body }) {
  const provider = API_PROVIDERS[providerId];
  if (!provider) return [];
  try {
    return provider.parseResults(typeof body === 'string' ? body : String(body ?? ''));
  } catch (_) {
    return [];
  }
}

module.exports = {
  API_SEARCH_RESULT_LIMIT,
  API_PROVIDERS,
  API_PROVIDER_ORDER,
  listConfiguredApiBackends,
  buildApiSearchRequest,
  parseApiSearchResponse,
};
