'use strict';

/**
 * Isolamento de conexões MCP inválidas na FRONTEIRA do runtime.
 *
 * Defeito real reproduzido no runtime (2026-09-18, release #2): 17 fixtures de
 * teste vazadas no banco real (uma execução de Jest interrompida nunca rodou o
 * `afterAll` que as purgava). Uma delas — tenant `mcp-ssrf-*`, endpoint
 * `https://127.0.0.1:9/rpc` — era loopback. O HUB é estrito por contrato
 * (config inválida lança), então essa única linha órfã abortava a composição
 * inteira e ZERAVA todas as external MCP tools, inclusive as válidas. Efeito:
 * o MCP nunca funcionava no runtime, com apenas um WARN "não-bloqueante".
 *
 * Correção: a resiliência vai para o CARREGADOR (`partitionConnectionsByPolicy`),
 * que isola e reporta por conexão. O hub continua ESTRITO — nada foi afrouxado.
 *
 * Controles negativos incluídos: (a) o validador puro segue recusando loopback/
 * metadata/faixa privada; (b) o hub segue LANÇANDO com config inválida.
 */

const { createMcpClientHub, validateConnection } = require('../../../src/core/mcp/client-hub');
const { partitionConnectionsByPolicy } = require('../../../api/runtime/startMcpClient');

const silent = { info() {}, warn() {}, error() {}, debug() {} };

const VALID = Object.freeze({
  tenant: 'tenant-a',
  name: 'valida',
  endpoint: 'https://mcp.externo.exemplo.com/rpc',
  classification: 'PRODUCTION',
  authType: 'bearer',
  credentialRef: 'MCP_VALIDA_TOKEN',
});

const LOOPBACK = Object.freeze({
  ...VALID,
  name: 'loopback-orfa',
  tenant: 'mcp-ssrf-1789316064079-d4ynu1',
  endpoint: 'https://127.0.0.1:9/rpc',
});

const METADATA = Object.freeze({
  ...VALID,
  name: 'metadata-orfa',
  endpoint: 'https://169.254.169.254/latest/meta-data/',
});

describe('partitionConnectionsByPolicy — fronteira do runtime', () => {
  test('isola a conexão inválida e preserva a válida', () => {
    const { valid, rejected } = partitionConnectionsByPolicy([VALID, LOOPBACK], { log: silent });

    expect(valid).toEqual([VALID]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].name).toBe('loopback-orfa');
    expect(rejected[0].tenant).toBe('mcp-ssrf-1789316064079-d4ynu1');
    expect(rejected[0].reason).toMatch(/mcp_endpoint_rejected/);
  });

  test('a recusa é EXPLÍCITA por conexão (tenant, nome e motivo)', () => {
    const { rejected } = partitionConnectionsByPolicy([LOOPBACK, METADATA], { log: silent });

    expect(rejected).toHaveLength(2);
    expect(rejected.map((entry) => entry.name).sort()).toEqual(['loopback-orfa', 'metadata-orfa']);
    for (const entry of rejected) expect(entry.reason).toMatch(/mcp_endpoint_rejected/);
  });

  test('todas inválidas → nenhuma conexão vai para o hub (falha isolada, não fatal)', () => {
    const { valid, rejected } = partitionConnectionsByPolicy([LOOPBACK, METADATA], { log: silent });
    expect(valid).toEqual([]);
    expect(rejected).toHaveLength(2);
  });

  test('sem conexões inválidas não há ruído', () => {
    const { valid, rejected } = partitionConnectionsByPolicy([VALID], { log: silent });
    expect(valid).toEqual([VALID]);
    expect(rejected).toEqual([]);
  });

  test('o hub construído com o resultado filtrado funciona normalmente', () => {
    const { valid, rejected } = partitionConnectionsByPolicy([VALID, LOOPBACK], { log: silent });
    const hub = createMcpClientHub({ connections: valid, logger: silent });

    expect(rejected).toHaveLength(1);
    expect(hub.size()).toBe(1);
    expect(hub.getConnection('valida', { tenantId: 'tenant-a' })).toBeTruthy();
  });
});

describe('controles negativos — nada foi afrouxado', () => {
  test('o hub segue ESTRITO: config inválida lança (contrato dos testes adversariais)', () => {
    expect(() => createMcpClientHub({ connections: [LOOPBACK], logger: silent }))
      .toThrow(/mcp_endpoint_rejected/);
    expect(() => createMcpClientHub({ connections: [METADATA], logger: silent }))
      .toThrow(/mcp_endpoint_rejected/);
  });

  test('o validador puro recusa loopback/metadata/faixa privada e aceita endpoint público', () => {
    expect(() => validateConnection(LOOPBACK)).toThrow(/mcp_endpoint_rejected/);
    expect(() => validateConnection(METADATA)).toThrow(/mcp_endpoint_rejected/);
    expect(() => validateConnection({ ...VALID, endpoint: 'http://10.0.0.7/rpc' })).toThrow(/mcp_endpoint_rejected/);
    expect(() => validateConnection(VALID)).not.toThrow();
  });
});
