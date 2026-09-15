'use strict';

/**
 * Native Research Provider — fetch real sob política de endpoint (transporte
 * INJETADO: zero rede no Jest). Prova SSRF guard, DNS rebinding, timeout,
 * teto de bytes, redirects salto a salto, hash do conteúdo e polidez por host.
 */

const crypto = require('crypto');

const {
  RESEARCH_PROVIDER_ERROR_CODES,
  createNativeResearchProvider,
} = require('../../../api/services/research/nativeResearchProvider');

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const PUBLIC_IP = '93.184.216.34';

function htmlResponse(body, { status = 200, headers = {} } = {}) {
  return {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
    body: Buffer.from(body, 'utf8'),
  };
}

function buildProvider({ transport, resolveAddresses, options, now, sleep } = {}) {
  const calls = [];
  const wrappedTransport = async (request) => {
    calls.push(request);
    return transport(request);
  };
  let currentTime = 1_700_000_000_000;
  const sleeps = [];
  const provider = createNativeResearchProvider({
    transport: wrappedTransport,
    resolveAddresses: resolveAddresses || (async () => [PUBLIC_IP]),
    now: now || (() => currentTime),
    sleep: sleep || (async (ms) => { sleeps.push(ms); }),
    logger: silent,
    options,
  });
  return {
    provider,
    calls,
    sleeps,
    advance: (ms) => { currentTime += ms; },
  };
}

describe('nativeResearchProvider.fetch — contrato e hash', () => {
  test('sucesso: status, contentType, retrievedAt do relógio e contentHash do conteúdo exato', async () => {
    const { provider, calls } = buildProvider({
      transport: async () => htmlResponse('hello'),
      now: () => 1_700_000_000_000,
    });
    const output = await provider.fetch({ url: 'https://example.com/page' });

    expect(output.httpStatus).toBe(200);
    expect(output.content).toBe('hello');
    expect(output.contentType).toBe('text/html; charset=utf-8');
    expect(output.retrievedAt).toBe(new Date(1_700_000_000_000).toISOString());
    const expected = crypto.createHash('sha256').update('hello', 'utf8').digest('hex');
    expect(expected).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(output.contentHash).toBe(`sha256:${expected}`);
    expect(calls).toHaveLength(1);
    expect(calls[0].headers['user-agent']).toContain('RAP-Research');
    expect(calls[0].url).toBe('https://example.com/page');
  });

  test('url ausente é erro tipado, sem tocar o transporte', async () => {
    const { provider, calls } = buildProvider({ transport: async () => htmlResponse('x') });
    await expect(provider.fetch({})).rejects.toMatchObject({ code: RESEARCH_PROVIDER_ERROR_CODES.INVALID_URL });
    expect(calls).toHaveLength(0);
  });
});

describe('nativeResearchProvider.fetch — SSRF guard (política de endpoint do MCP)', () => {
  const blockedUrls = [
    'https://localhost/internal',
    'https://127.0.0.1/admin',
    'https://10.1.2.3/rede-interna',
    'https://192.168.0.10/roteador',
    'https://169.254.169.254/latest/meta-data',
    'https://metadata.google.internal/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'ftp://example.com/arquivo',
    'https://user:senha@example.com/',
  ];

  test.each(blockedUrls)('%s é bloqueado com research_fetch_blocked e NUNCA toca o transporte', async (url) => {
    const { provider, calls } = buildProvider({ transport: async () => htmlResponse('x') });
    await expect(provider.fetch({ url })).rejects.toMatchObject({ code: RESEARCH_PROVIDER_ERROR_CODES.BLOCKED });
    expect(calls).toHaveLength(0);
  });

  test('http plaintext é negado (https-only por padrão)', async () => {
    const { provider, calls } = buildProvider({ transport: async () => htmlResponse('x') });
    await expect(provider.fetch({ url: 'http://example.com/' })).rejects.toMatchObject({
      code: RESEARCH_PROVIDER_ERROR_CODES.BLOCKED,
    });
    expect(calls).toHaveLength(0);
  });

  test('DNS rebinding: hostname público que resolve para IP privado é bloqueado', async () => {
    const { provider, calls } = buildProvider({
      transport: async () => htmlResponse('x'),
      resolveAddresses: async () => ['10.0.0.9'],
    });
    await expect(provider.fetch({ url: 'https://publico.example.com/' })).rejects.toMatchObject({
      code: RESEARCH_PROVIDER_ERROR_CODES.BLOCKED,
    });
    expect(calls).toHaveLength(0);
  });

  test('falha de DNS é research_fetch_failed (nunca silenciosa)', async () => {
    const { provider } = buildProvider({
      transport: async () => htmlResponse('x'),
      resolveAddresses: async () => {
        const error = new Error('getaddrinfo ENOTFOUND exemplo.invalid');
        error.code = 'ENOTFOUND';
        throw error;
      },
    });
    await expect(provider.fetch({ url: 'https://exemplo.invalid/' })).rejects.toMatchObject({
      code: RESEARCH_PROVIDER_ERROR_CODES.FAILED,
    });
  });
});

describe('nativeResearchProvider.fetch — timeout, tamanho e redirects', () => {
  test('timeout do transporte vira research_fetch_timeout', async () => {
    const { provider } = buildProvider({
      transport: () => new Promise(() => {}),
      options: { timeoutMs: 30 },
    });
    await expect(provider.fetch({ url: 'https://lento.example.com/' })).rejects.toMatchObject({
      code: RESEARCH_PROVIDER_ERROR_CODES.TIMEOUT,
    });
  });

  test('content-length acima do teto é research_fetch_too_large', async () => {
    const { provider } = buildProvider({
      transport: async () => htmlResponse('ok', { headers: { 'content-length': String(3 * 1024 * 1024) } }),
    });
    await expect(provider.fetch({ url: 'https://grande.example.com/' })).rejects.toMatchObject({
      code: RESEARCH_PROVIDER_ERROR_CODES.TOO_LARGE,
    });
  });

  test('corpo acima do teto (sem content-length) é research_fetch_too_large', async () => {
    const { provider } = buildProvider({
      transport: async () => htmlResponse('x'.repeat(64)),
      options: { maxBytes: 16 },
    });
    await expect(provider.fetch({ url: 'https://grande.example.com/' })).rejects.toMatchObject({
      code: RESEARCH_PROVIDER_ERROR_CODES.TOO_LARGE,
    });
  });

  test('redirect para host proibido é bloqueado no destino (não na origem)', async () => {
    const { provider, calls } = buildProvider({
      transport: async ({ url }) => (url === 'https://exemplo.com/inicio'
        ? { status: 302, headers: { location: 'https://127.0.0.1/captura' }, body: Buffer.alloc(0) }
        : htmlResponse('nunca')),
    });
    await expect(provider.fetch({ url: 'https://exemplo.com/inicio' })).rejects.toMatchObject({
      code: RESEARCH_PROVIDER_ERROR_CODES.BLOCKED,
    });
    // O transporte só foi chamado para a ORIGEM — o destino proibido não conecta.
    expect(calls.map((call) => call.url)).toEqual(['https://exemplo.com/inicio']);
  });

  test('redirect legítimo é seguido salto a salto e o conteúdo final é o devolvido', async () => {
    const { provider, calls } = buildProvider({
      transport: async ({ url }) => (url === 'https://exemplo.com/antigo'
        ? { status: 301, headers: { location: '/novo' }, body: Buffer.alloc(0) }
        : htmlResponse('conteudo final')),
    });
    const output = await provider.fetch({ url: 'https://exemplo.com/antigo' });
    expect(output.httpStatus).toBe(200);
    expect(output.content).toBe('conteudo final');
    expect(calls.map((call) => call.url)).toEqual(['https://exemplo.com/antigo', 'https://exemplo.com/novo']);
  });

  test('cadeia de redirects além do limite é research_fetch_redirect_blocked', async () => {
    const { provider } = buildProvider({
      transport: async ({ url }) => ({
        status: 302,
        headers: { location: `${url}-x` },
        body: Buffer.alloc(0),
      }),
      options: { maxRedirects: 2 },
    });
    await expect(provider.fetch({ url: 'https://loop.example.com/a' })).rejects.toMatchObject({
      code: RESEARCH_PROVIDER_ERROR_CODES.REDIRECT_BLOCKED,
    });
  });

  test('falha de transporte (rede) é research_fetch_failed', async () => {
    const { provider } = buildProvider({
      transport: async () => { throw new Error('socket hang up'); },
    });
    await expect(provider.fetch({ url: 'https://caiu.example.com/' })).rejects.toMatchObject({
      code: RESEARCH_PROVIDER_ERROR_CODES.FAILED,
    });
  });
});

describe('nativeResearchProvider — polidez por host (relógio e sono injetados)', () => {
  test('segunda requisição ao mesmo host dentro do intervalo aguarda o restante', async () => {
    const { provider, sleeps, advance } = buildProvider({
      transport: async () => htmlResponse('ok'),
      options: { minIntervalMsPerHost: 1000 },
    });

    await provider.fetch({ url: 'https://exemplo.com/a' });
    expect(sleeps).toEqual([]);

    await provider.fetch({ url: 'https://exemplo.com/b' });
    expect(sleeps).toEqual([1000]);

    // Host diferente não espera; relógio avançado além do intervalo também não.
    advance(2000);
    await provider.fetch({ url: 'https://outro.example.com/' });
    advance(2000);
    await provider.fetch({ url: 'https://exemplo.com/c' });
    expect(sleeps).toEqual([1000]);
  });
});
