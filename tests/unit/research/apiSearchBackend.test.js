'use strict';

/**
 * Backend de busca por API — a resposta ao scraping inoperante.
 *
 * Medido em 2026-09-19: os dois endpoints de scraping estavam mortos (DuckDuckGo
 * falhava no transporte; o Bing respondia HTTP 200 com página alheia à query) e um
 * levantamento de nove buscadores gratuitos não achou nenhum viável. A saída é uma
 * API com contrato e chave.
 *
 * Estados que estes testes fixam:
 *   - sem chave, o comportamento é EXATAMENTE o anterior (nenhum backend extra);
 *   - com chave, o backend por API entra na frente do scraping;
 *   - a chave nunca vai na URL (URL vaza em log de proxy e em mensagem de erro);
 *   - resposta inválida não derruba o provider: vira lista vazia e o próximo
 *     backend é tentado.
 */

const {
  API_PROVIDERS,
  API_PROVIDER_ORDER,
  API_SEARCH_RESULT_LIMIT,
  listConfiguredApiBackends,
  buildApiSearchRequest,
  parseApiSearchResponse,
} = require('../../../api/services/research/apiSearchBackend');

const BRAVE_OK = JSON.stringify({
  web: {
    results: [
      { title: 'CakeBoss | Bakery POS Software', url: 'https://cakeboss.com/', description: 'POS para padarias' },
      { title: 'Bakery Software', url: 'https://ex.com/bakery', description: null },
    ],
  },
});

describe('listConfiguredApiBackends — ativação por chave', () => {
  it('sem nenhuma chave, não habilita nenhum backend por API', () => {
    expect(listConfiguredApiBackends({})).toEqual([]);
    expect(listConfiguredApiBackends()).toEqual([]);
  });

  it('habilita o Brave quando a chave existe', () => {
    const backends = listConfiguredApiBackends({ BRAVE_SEARCH_API_KEY: 'sk-1' });
    expect(backends.map((b) => b.id)).toEqual(['brave']);
  });

  it('NÃO habilita o Google com chave mas sem o CX (precisa das duas)', () => {
    expect(listConfiguredApiBackends({ GOOGLE_CSE_API_KEY: 'k' })).toEqual([]);
    expect(listConfiguredApiBackends({ GOOGLE_CSE_ID: 'c' })).toEqual([]);
    const completos = listConfiguredApiBackends({ GOOGLE_CSE_API_KEY: 'k', GOOGLE_CSE_ID: 'c' });
    expect(completos.map((b) => b.id)).toEqual(['google']);
  });

  it('chave em branco não conta como configurada', () => {
    expect(listConfiguredApiBackends({ BRAVE_SEARCH_API_KEY: '   ' })).toEqual([]);
    expect(listConfiguredApiBackends({ BRAVE_SEARCH_API_KEY: null })).toEqual([]);
  });

  it('ordem é determinística e explícita, para o motivo da falha ser reprodutível', () => {
    const backends = listConfiguredApiBackends({ BRAVE_SEARCH_API_KEY: 'k', GOOGLE_CSE_API_KEY: 'k', GOOGLE_CSE_ID: 'c' });
    expect(backends.map((b) => b.id)).toEqual(API_PROVIDER_ORDER);
  });
});

describe('buildApiSearchRequest', () => {
  it('NUNCA põe a chave na URL — ela vai no header', () => {
    const request = buildApiSearchRequest({
      providerId: 'brave',
      env: { BRAVE_SEARCH_API_KEY: 'sk-secreta' },
      query: 'bakery management software',
    });
    expect(request.url).not.toContain('sk-secreta');
    expect(request.headers['x-subscription-token']).toBe('sk-secreta');
  });

  it('codifica a query e respeita o teto de resultados', () => {
    const request = buildApiSearchRequest({
      providerId: 'brave',
      env: { BRAVE_SEARCH_API_KEY: 'k' },
      query: 'software para padaria gestão de produção',
    });
    expect(request.url).toContain(encodeURIComponent('software para padaria gestão de produção'));
    expect(request.url).toContain(`count=${API_SEARCH_RESULT_LIMIT}`);
  });

  it('pedir mais que o teto é limitado ao teto (o cap é do provider)', () => {
    const request = buildApiSearchRequest({
      providerId: 'brave',
      env: { BRAVE_SEARCH_API_KEY: 'k' },
      query: 'x',
      count: 500,
    });
    expect(request.url).toContain(`count=${API_SEARCH_RESULT_LIMIT}`);
  });

  it('o Google usa o CX e o teto numérico da própria API', () => {
    const request = buildApiSearchRequest({
      providerId: 'google',
      env: { GOOGLE_CSE_API_KEY: 'gk', GOOGLE_CSE_ID: 'cx-1' },
      query: 'bakery',
    });
    expect(request.url).toContain('cx=cx-1');
    expect(request.url).toContain('num=');
  });

  it('provider desconhecido e query vazia são erros nomeados', () => {
    expect(() => buildApiSearchRequest({ providerId: 'nao-existe', query: 'x' })).toThrow(/api_search_provider_unknown/);
    expect(() => buildApiSearchRequest({ providerId: 'brave', env: {}, query: '   ' })).toThrow(/api_search_query_required/);
  });
});

describe('parseApiSearchResponse', () => {
  it('extrai título, url e snippet do formato do Brave', () => {
    const candidates = parseApiSearchResponse({ providerId: 'brave', body: BRAVE_OK });
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toEqual({
      title: 'CakeBoss | Bakery POS Software',
      url: 'https://cakeboss.com/',
      snippet: 'POS para padarias',
      source: 'brave',
    });
  });

  it('extrai do formato do Google (items/link)', () => {
    const body = JSON.stringify({ items: [{ title: 'Bakery POS', link: 'https://ex.com/', snippet: 's' }] });
    const candidates = parseApiSearchResponse({ providerId: 'google', body });
    expect(candidates).toEqual([{ title: 'Bakery POS', url: 'https://ex.com/', snippet: 's', source: 'google' }]);
  });

  it('resposta inválida vira lista vazia em vez de derrubar o provider', () => {
    expect(parseApiSearchResponse({ providerId: 'brave', body: '<html>bloqueado</html>' })).toEqual([]);
    expect(parseApiSearchResponse({ providerId: 'brave', body: '' })).toEqual([]);
    expect(parseApiSearchResponse({ providerId: 'brave', body: 'null' })).toEqual([]);
    expect(parseApiSearchResponse({ providerId: 'brave', body: JSON.stringify({ web: { results: 'nao-e-lista' } }) })).toEqual([]);
    expect(parseApiSearchResponse({ providerId: 'brave', body: JSON.stringify({ erro: 'chave invalida' }) })).toEqual([]);
  });

  it('descarta item sem URL utilizável e não inventa candidato', () => {
    const body = JSON.stringify({ web: { results: [{ title: 'Sem url' }, { title: 'Vazia', url: '   ' }, { title: 'Boa', url: 'https://ok.com/' }] } });
    const candidates = parseApiSearchResponse({ providerId: 'brave', body });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].url).toBe('https://ok.com/');
  });

  it('provider desconhecido não lança', () => {
    expect(parseApiSearchResponse({ providerId: 'nao-existe', body: '{}' })).toEqual([]);
  });

  it('o registro expõe os providers declarados', () => {
    expect(Object.keys(API_PROVIDERS).sort()).toEqual(['brave', 'google']);
    expect(API_PROVIDERS.brave.requiredEnv).toEqual(['BRAVE_SEARCH_API_KEY']);
  });
});
