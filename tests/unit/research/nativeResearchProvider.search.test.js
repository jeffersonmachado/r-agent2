'use strict';

/**
 * Native Research Provider — research.search: DuckDuckGo HTML primeiro, Bing
 * como FALLBACK (`b_algo` + redirect `u=a1<base64url>`), tudo com transporte
 * injetado. Resultado vazio ou bloqueado é HONESTO (com o motivo dos backends
 * tentados); candidato nunca é fabricado.
 */

const {
  RESEARCH_PROVIDER_ERROR_CODES,
  createNativeResearchProvider,
} = require('../../../api/services/research/nativeResearchProvider');

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const PUBLIC_IP = '93.184.216.34';

const DDG_FIXTURE = `<html><body>
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.glofox.com%2F&amp;rut=abc123">Glofox &amp;mdash; Gym Management Software</a>
  <a class="result__a" href="https://www.mindbodyonline.com/business"> Mindbody   Business </a>
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.glofox.com%2F">Glofox (duplicado)</a>
  <a class="result__a" href="https://duckduckgo.com/settings">Link interno do DDG</a>
  <a class="result__a" href="javascript:void(0)">não-http</a>
</body></html>`;

// u=a1<base64url(destino)> — formato real observado no Bing (2026-09-15):
//   aHR0cHM6Ly93d3cuZ2xvZm94LmNvbS8  → https://www.glofox.com/
//   L2ltYWdlcy9zZWFyY2g_cT1nbG9mb3g  → /images/search?q=glofox (INTERNO)
const BING_FIXTURE = `<html><body><ol id="b_results">
  <li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;p=abc&amp;u=a1aHR0cHM6Ly93d3cuZ2xvZm94LmNvbS8&amp;ntb=1"><strong>Glofox</strong> — Gym Software</a></h2><p>snippet</p></li>
  <li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;u=a1L2ltYWdlcy9zZWFyY2g_cT1nbG9mb3g">Imagens (interno)</a></h2></li>
  <li class="b_algo"><h2><a href="https://www.mindbodyonline.com/business">Mindbody (link direto)</a></h2></li>
  <li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;u=a1!!!invalid">destino corrompido</a></h2></li>
  <li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;u=a1aHR0cHM6Ly93d3cuZ2xvZm94LmNvbS8=">Glofox (duplicado com padding)</a></h2></li>
  <li class="b_algo"><div><a href="https://nao-e-h2.example.com/">sem h2 não conta</a></div></li>
</ol></body></html>`;

function response(body, status = 200) {
  return { status, headers: { 'content-type': 'text/html' }, body: Buffer.from(body, 'utf8') };
}

/**
 * Transporte que distingue os dois backends. Cada spec é `{ status, body }`,
 * uma função que lança, ou null (endpoint que não deve ser chamado).
 */
function buildProvider({ ddg, bing, options } = {}) {
  const calls = [];
  const provider = createNativeResearchProvider({
    transport: async (request) => {
      calls.push(request.url);
      const spec = request.url.startsWith('https://html.duckduckgo.com/') ? ddg
        : request.url.startsWith('https://www.bing.com/') ? bing
          : null;
      if (!spec) throw new Error(`unexpected url: ${request.url}`);
      if (typeof spec === 'function') return spec();
      return response(spec.body, spec.status);
    },
    resolveAddresses: async () => [PUBLIC_IP],
    now: () => 1_700_000_000_000,
    sleep: async () => {},
    logger: silent,
    options,
  });
  return { provider, calls };
}

describe('nativeResearchProvider.search — DuckDuckGo (backend primário)', () => {
  test('decodifica uddg, limpa títulos, deduplica e ignora links internos/não-http', async () => {
    const { provider, calls } = buildProvider({ ddg: { status: 200, body: DDG_FIXTURE }, bing: null });
    const output = await provider.search({ query: 'gym management software' });

    expect(calls).toEqual(['https://html.duckduckgo.com/html/?q=gym%20management%20software']);
    expect(output.backend).toBe('duckduckgo');
    expect(output.candidates).toEqual([
      { title: expect.stringContaining('Glofox'), url: 'https://www.glofox.com/', source: 'duckduckgo' },
      { title: 'Mindbody Business', url: 'https://www.mindbodyonline.com/business', source: 'duckduckgo' },
    ]);
  });

  test('respeita o teto de resultados', async () => {
    const many = Array.from({ length: 15 }, (_, index) => (
      `<a class="result__a" href="https://site${index}.example.com/">Resultado ${index}</a>`
    )).join('\n');
    const { provider } = buildProvider({ ddg: { status: 200, body: many }, bing: null });
    const output = await provider.search({ query: 'fitness software' });
    expect(output.candidates).toHaveLength(10);
    expect(output.backend).toBe('duckduckgo');
  });

  test('query vazia é erro tipado, sem tocar a rede', async () => {
    const { provider, calls } = buildProvider({ ddg: { status: 200, body: '' }, bing: null });
    await expect(provider.search({ query: '   ' })).rejects.toMatchObject({
      code: RESEARCH_PROVIDER_ERROR_CODES.SEARCH_QUERY_REQUIRED,
    });
    expect(calls).toHaveLength(0);
  });
});

describe('nativeResearchProvider.search — Bing (parsing do fallback)', () => {
  test('extrai b_algo, decodifica u=a1<base64url> e rejeita internos/corrompidos', async () => {
    const { provider, calls } = buildProvider({
      ddg: { status: 202, body: '<html>anomaly</html>' },
      bing: { status: 200, body: BING_FIXTURE },
    });
    const output = await provider.search({ query: 'glofox' });

    expect(output.backend).toBe('bing');
    expect(output.candidates).toEqual([
      { title: 'Glofox — Gym Software', url: 'https://www.glofox.com/', source: 'bing' },
      { title: 'Mindbody (link direto)', url: 'https://www.mindbodyonline.com/business', source: 'bing' },
    ]);
    // DDG tentado primeiro, Bing depois — nesta ordem.
    expect(calls[0]).toContain('html.duckduckgo.com');
    expect(calls[1]).toContain('bing.com/search?q=glofox');
  });
});

describe('nativeResearchProvider.search — ordem de fallback e honestidade', () => {
  test('DDG 202 (bot-check) → Bing é usado', async () => {
    const { provider } = buildProvider({
      ddg: { status: 202, body: '<html>challenge</html>' },
      bing: { status: 200, body: BING_FIXTURE },
    });
    const output = await provider.search({ query: 'glofox' });
    expect(output.backend).toBe('bing');
    expect(output.candidates.length).toBeGreaterThan(0);
  });

  test('DDG 200 sem resultado parseável → Bing é usado', async () => {
    const { provider } = buildProvider({
      ddg: { status: 200, body: '<html><body>nada</body></html>' },
      bing: { status: 200, body: BING_FIXTURE },
    });
    const output = await provider.search({ query: 'glofox' });
    expect(output.backend).toBe('bing');
    expect(output.candidates.length).toBeGreaterThan(0);
  });

  test('DDG com resultados NÃO chama o Bing', async () => {
    const { provider, calls } = buildProvider({
      ddg: { status: 200, body: DDG_FIXTURE },
      bing: null,
    });
    const output = await provider.search({ query: 'gym software' });
    expect(output.backend).toBe('duckduckgo');
    expect(calls.some((url) => url.includes('bing.com'))).toBe(false);
  });

  test('os DOIS backends fora → vazio honesto com o motivo nominal de cada um', async () => {
    const { provider } = buildProvider({
      ddg: { status: 202, body: '<html>challenge</html>' },
      bing: { status: 503, body: '<html>down</html>' },
    });
    const output = await provider.search({ query: 'gym software' });
    expect(output.candidates).toEqual([]);
    expect(output.reason).toBe('duckduckgo: search_endpoint_http_202; bing: search_endpoint_http_503');
  });

  test('falha de transporte nos DOIS backends → vazio honesto com as causas tipadas', async () => {
    const { provider } = buildProvider({
      ddg: () => { throw new Error('connection reset'); },
      bing: () => { throw new Error('socket hang up'); },
    });
    const output = await provider.search({ query: 'gym software' });
    expect(output.candidates).toEqual([]);
    expect(output.reason).toBe('duckduckgo: research_fetch_failed; bing: research_fetch_failed');
  });

  test('Bing 200 sem b_algo parseável → vazio honesto (nunca fabrica candidato)', async () => {
    const { provider } = buildProvider({
      ddg: { status: 202, body: 'challenge' },
      bing: { status: 200, body: '<html><body>sem resultados</body></html>' },
    });
    const output = await provider.search({ query: 'xyz inexistente' });
    expect(output.candidates).toEqual([]);
    expect(output.reason).toBe('duckduckgo: search_endpoint_http_202; bing: search_no_results_parsed');
  });
});
