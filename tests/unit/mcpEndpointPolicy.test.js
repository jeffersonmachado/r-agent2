'use strict';

/**
 * MCP Endpoint Policy — proteção de SSRF/TLS/DNS rebinding na fronteira de
 * rede do MCP Client.
 */

const {
  ENDPOINT_DENIAL_CODES,
  classifyAddress,
  evaluateEndpoint,
  evaluateResolvedAddresses,
  evaluateRedirectChain,
  resolveTlsOptions,
} = require('../../src/core/mcp/endpoint-policy');

describe('MCP endpoint policy — endpoint declarado', () => {
  test('https público é permitido em PRODUCTION', () => {
    const result = evaluateEndpoint({ endpoint: 'https://mcp.example.com/rpc', classification: 'PRODUCTION' });
    expect(result.allowed).toBe(true);
    expect(result.code).toBeNull();
  });

  test('http é negado em PRODUCTION mesmo com allowPlaintextHttp', () => {
    const result = evaluateEndpoint({
      endpoint: 'http://mcp.example.com/rpc',
      classification: 'PRODUCTION',
      policy: { allowPlaintextHttp: true },
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe(ENDPOINT_DENIAL_CODES.PLAINTEXT_HTTP_PRODUCTION);
  });

  test('http em DEVELOPMENT exige allowPlaintextHttp explícito', () => {
    const denied = evaluateEndpoint({ endpoint: 'http://mcp.example.com', classification: 'DEVELOPMENT' });
    expect(denied.allowed).toBe(false);
    expect(denied.code).toBe(ENDPOINT_DENIAL_CODES.UNSUPPORTED_PROTOCOL);

    const allowed = evaluateEndpoint({
      endpoint: 'http://mcp.example.com',
      classification: 'DEVELOPMENT',
      policy: { allowPlaintextHttp: true },
    });
    expect(allowed.allowed).toBe(true);
  });

  test.each([
    ['ftp://mcp.example.com', ENDPOINT_DENIAL_CODES.UNSUPPORTED_PROTOCOL],
    ['file:///etc/passwd', ENDPOINT_DENIAL_CODES.UNSUPPORTED_PROTOCOL],
    ['gopher://mcp.example.com', ENDPOINT_DENIAL_CODES.UNSUPPORTED_PROTOCOL],
    ['', ENDPOINT_DENIAL_CODES.INVALID_ENDPOINT],
    ['not-a-url', ENDPOINT_DENIAL_CODES.INVALID_ENDPOINT],
  ])('protocolo/URL inválido é negado: %s', (endpoint, code) => {
    const result = evaluateEndpoint({ endpoint, classification: 'DEVELOPMENT', policy: { allowPlaintextHttp: true } });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe(code);
  });

  test('credenciais embutidas na URL são negadas', () => {
    const result = evaluateEndpoint({ endpoint: 'https://user:pass@mcp.example.com', classification: 'PRODUCTION' });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe(ENDPOINT_DENIAL_CODES.CREDENTIALS_IN_URL);
  });

  test.each([
    'https://localhost/mcp',
    'https://localhost.localdomain/mcp',
    'https://metadata.google.internal/computeMetadata/v1/',
    'https://mcp.internal/mcp',
    'https://host.local/mcp',
  ])('hostname proibido é negado: %s', (endpoint) => {
    const result = evaluateEndpoint({ endpoint, classification: 'PRODUCTION' });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe(ENDPOINT_DENIAL_CODES.BLOCKED_HOSTNAME);
  });

  test.each([
    ['https://127.0.0.1/mcp', ENDPOINT_DENIAL_CODES.LOOPBACK],
    ['https://[::1]/mcp', ENDPOINT_DENIAL_CODES.LOOPBACK],
    ['https://169.254.169.254/latest/meta-data/', ENDPOINT_DENIAL_CODES.CLOUD_METADATA],
    ['https://10.0.0.5/mcp', ENDPOINT_DENIAL_CODES.PRIVATE_NETWORK],
    ['https://172.20.1.1/mcp', ENDPOINT_DENIAL_CODES.PRIVATE_NETWORK],
    ['https://192.168.1.10/mcp', ENDPOINT_DENIAL_CODES.PRIVATE_NETWORK],
    ['https://100.64.0.1/mcp', ENDPOINT_DENIAL_CODES.PRIVATE_NETWORK],
    ['https://0.0.0.0/mcp', ENDPOINT_DENIAL_CODES.RESERVED_RANGE],
  ])('IP literal restrito é negado: %s', (endpoint, code) => {
    const result = evaluateEndpoint({ endpoint, classification: 'PRODUCTION' });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe(code);
  });

  test('allowPrivateNetwork libera rede privada só em classificação não-PRODUCTION', () => {
    const dev = evaluateEndpoint({
      endpoint: 'https://10.0.0.5/mcp',
      classification: 'DEVELOPMENT',
      policy: { allowPrivateNetwork: true },
    });
    expect(dev.allowed).toBe(true);

    const prod = evaluateEndpoint({
      endpoint: 'https://10.0.0.5/mcp',
      classification: 'PRODUCTION',
      policy: { allowPrivateNetwork: true },
    });
    expect(prod.allowed).toBe(false);
    expect(prod.code).toBe(ENDPOINT_DENIAL_CODES.PRIVATE_NETWORK);
  });

  test('metadata de cloud NUNCA é liberado, nem em DEVELOPMENT', () => {
    for (const classification of ['PRODUCTION', 'SUPPORT', 'DEVELOPMENT']) {
      const result = evaluateEndpoint({
        endpoint: 'https://169.254.169.254/latest/meta-data/',
        classification,
        policy: { allowPrivateNetwork: true, allowPlaintextHttp: true },
      });
      expect(result.allowed).toBe(false);
      expect(result.code).toBe(ENDPOINT_DENIAL_CODES.CLOUD_METADATA);
    }
  });
});

describe('MCP endpoint policy — rebinding e redirects', () => {
  test('hostname público que resolve para loopback é bloqueado (DNS rebinding)', () => {
    const result = evaluateResolvedAddresses({
      hostname: 'mcp.example.com',
      addresses: ['93.184.216.34', '127.0.0.1'],
      classification: 'PRODUCTION',
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe(ENDPOINT_DENIAL_CODES.DNS_REBINDING);
    expect(result.detail.reason).toBe('resolved_to_restricted_range');
  });

  test('hostname público que resolve para metadata é bloqueado como metadata', () => {
    const result = evaluateResolvedAddresses({
      hostname: 'evil.example.com',
      addresses: ['169.254.169.254'],
      classification: 'PRODUCTION',
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe(ENDPOINT_DENIAL_CODES.CLOUD_METADATA);
  });

  test('endereços públicos são aceitos', () => {
    const result = evaluateResolvedAddresses({
      hostname: 'mcp.example.com',
      addresses: ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'],
      classification: 'PRODUCTION',
    });
    expect(result.allowed).toBe(true);
  });

  test('sem endereço resolvido é fail-closed', () => {
    const result = evaluateResolvedAddresses({ hostname: 'mcp.example.com', addresses: [] });
    expect(result.allowed).toBe(false);
    expect(result.detail.reason).toBe('no_resolved_address');
  });

  test('redirect para destino proibido é bloqueado', () => {
    const result = evaluateRedirectChain(
      ['https://mcp.example.com/step', 'http://127.0.0.1:8080/admin'],
      { classification: 'PRODUCTION' },
    );
    expect(result.allowed).toBe(false);
    expect(result.code).toBe(ENDPOINT_DENIAL_CODES.REDIRECT_BLOCKED);
  });

  test('cadeia de redirects acima do limite é bloqueada', () => {
    const hops = ['https://a.example.com', 'https://b.example.com', 'https://c.example.com', 'https://d.example.com'];
    const result = evaluateRedirectChain(hops, { classification: 'PRODUCTION', policy: { maxRedirects: 2 } });
    expect(result.allowed).toBe(false);
    expect(result.detail.reason).toBe('too_many_redirects');
  });
});

describe('MCP endpoint policy — TLS', () => {
  test('TLS é verificado por padrão em todas as classificações', () => {
    expect(resolveTlsOptions({ classification: 'PRODUCTION' }).rejectUnauthorized).toBe(true);
    expect(resolveTlsOptions({ classification: 'DEVELOPMENT' }).rejectUnauthorized).toBe(true);
  });

  test('rejectUnauthorized=false só em não-PRODUCTION com justificativa', () => {
    const noJustification = resolveTlsOptions({
      classification: 'DEVELOPMENT',
      policy: { allowInsecureTls: true },
    });
    expect(noJustification.rejectUnauthorized).toBe(true);

    const justified = resolveTlsOptions({
      classification: 'DEVELOPMENT',
      policy: { allowInsecureTls: true, insecureTlsJustification: 'servidor de teste interno' },
    });
    expect(justified.rejectUnauthorized).toBe(false);
    expect(justified.insecure).toBe(true);
  });

  test('PRODUCTION nunca desativa verificação TLS', () => {
    const options = resolveTlsOptions({
      classification: 'PRODUCTION',
      policy: { allowInsecureTls: true, insecureTlsJustification: 'tentativa indevida' },
    });
    expect(options.rejectUnauthorized).toBe(true);
    expect(options.insecure).toBe(false);
  });

  test('allowInsecureTls em PRODUCTION é negado na avaliação do endpoint', () => {
    const result = evaluateEndpoint({
      endpoint: 'https://mcp.example.com',
      classification: 'PRODUCTION',
      policy: { allowInsecureTls: true },
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe(ENDPOINT_DENIAL_CODES.INSECURE_TLS);
  });
});

describe('MCP endpoint policy — classificação de endereços', () => {
  test.each([
    ['127.0.0.1', 'loopback'],
    ['169.254.169.254', 'cloud_metadata'],
    ['10.1.2.3', 'private'],
    ['192.168.0.1', 'private'],
    ['::1', 'loopback'],
    ['fe80::1', 'link_local'],
    ['fd12:3456::1', 'private'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['8.8.8.8', null],
  ])('classifyAddress(%s) → %s', (address, category) => {
    expect(classifyAddress(address).category).toBe(category);
  });
});
