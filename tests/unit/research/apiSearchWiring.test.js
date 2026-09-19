'use strict';

/**
 * Integração: o backend por API entra na frente do scraping quando há chave.
 *
 * Sem chave nada muda (as suítes de scraping cobrem isso — o `buildProvider`
 * delas lança em URL inesperada, então qualquer chamada indevida à API
 * apareceria como falha). Com chave, a ordem passa a ser API → scraping, e a
 * chave viaja no header.
 */

const { createNativeResearchProvider } = require('../../../api/services/research/nativeResearchProvider');

const PUBLIC_IP = '93.184.216.34';
const silent = { debug() {}, info() {}, warn() {}, error() {} };

/** Transporte injetado: registra URL + headers e devolve a resposta do mapa. */
function buildProvider({ responses, env }) {
  const calls = [];
  const provider = createNativeResearchProvider({
    env,
    transport: async (request) => {
      calls.push({ url: request.url, headers: request.headers });
      for (const [prefix, spec] of Object.entries(responses)) {
        if (request.url.startsWith(prefix)) {
          return { status: spec.status, headers: {}, body: Buffer.from(spec.body) };
        }
      }
      throw new Error(`unexpected url: ${request.url}`);
    },
    resolveAddresses: async () => [PUBLIC_IP],
    now: () => 1_700_000_000_000,
    sleep: async () => {},
    logger: silent,
  });
  return { provider, calls };
}

const BRAVE_BODY = JSON.stringify({
  web: { results: [{ title: 'CakeBoss | Bakery POS Software', url: 'https://cakeboss.com/', description: 'POS' }] },
});

describe('search — backend por API tem prioridade sobre scraping', () => {
  test('sem chave: nenhuma chamada à API (comportamento inalterado)', async () => {
    const { provider, calls } = buildProvider({
      env: {},
      responses: {
        'https://html.duckduckgo.com/': { status: 200, body: '<a class="result__a" href="https://cakeboss.com/">Bakery POS</a>' },
      },
    });
    const output = await provider.search({ query: 'bakery management software' });
    expect(output.backend).toBe('duckduckgo');
    expect(calls.every((c) => !c.url.includes('api.search.brave.com'))).toBe(true);
  });

  test('com chave: usa a API primeiro e envia a chave no header, não na URL', async () => {
    const { provider, calls } = buildProvider({
      env: { BRAVE_SEARCH_API_KEY: 'sk-secreta' },
      responses: { 'https://api.search.brave.com/': { status: 200, body: BRAVE_BODY } },
    });
    const output = await provider.search({ query: 'bakery management software' });

    expect(output.backend).toBe('brave');
    expect(output.candidates).toHaveLength(1);
    expect(output.candidates[0].url).toBe('https://cakeboss.com/');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).not.toContain('sk-secreta');
    expect(calls[0].headers['x-subscription-token']).toBe('sk-secreta');
    expect(output.queryRelevance.matched).toBe(1);
  });

  test('a API responde página alheia à query: recusada como qualquer backend', async () => {
    const alheio = JSON.stringify({
      web: { results: [{ title: '24 Hour Emergency Electrician in Summerville', url: 'https://electriciansquad.com/x' }] },
    });
    const { provider } = buildProvider({
      env: { BRAVE_SEARCH_API_KEY: 'k' },
      responses: {
        'https://api.search.brave.com/': { status: 200, body: alheio },
        'https://html.duckduckgo.com/': { status: 200, body: '<a class="result__a" href="https://cakeboss.com/">Bakery POS</a>' },
      },
    });
    const output = await provider.search({ query: 'bakery management software' });
    // A API foi recusada por irrelevância e o scraping assumiu — o veredito de
    // relevância vale para todo backend, não só para HTML.
    expect(output.backend).toBe('duckduckgo');
  });

  test('chave inválida (401) cai para o scraping com motivo nominal', async () => {
    const { provider } = buildProvider({
      env: { BRAVE_SEARCH_API_KEY: 'invalida' },
      responses: {
        'https://api.search.brave.com/': { status: 401, body: '{"error":"invalid token"}' },
        'https://html.duckduckgo.com/': { status: 200, body: '<a class="result__a" href="https://cakeboss.com/">Bakery POS</a>' },
      },
    });
    const output = await provider.search({ query: 'bakery management software' });
    expect(output.backend).toBe('duckduckgo');
  });

  test('API e scraping falhando: vazio honesto com o motivo de CADA backend', async () => {
    const { provider } = buildProvider({
      env: { BRAVE_SEARCH_API_KEY: 'k' },
      responses: {
        'https://api.search.brave.com/': { status: 401, body: '{}' },
        'https://html.duckduckgo.com/': { status: 200, body: '<html>sem resultado</html>' },
        'https://www.bing.com/': { status: 200, body: '<html>Gmail - Email from Google</html>' },
      },
    });
    const output = await provider.search({ query: 'bakery management software' });
    expect(output.candidates).toEqual([]);
    expect(output.reason).toContain('brave');
    expect(output.reason).toContain('duckduckgo');
    expect(output.reason).toContain('bing');
  });
});
