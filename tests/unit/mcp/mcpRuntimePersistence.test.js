'use strict';

/**
 * M3/M4/M6/M7 — o runtime carrega as conexões da FONTE PERSISTENTE, não da config.
 *
 * Antes: `startMcpClient.js` montava as conexões de `config.get('mcp.connections')`
 * e o estado vivia em memória. Agora o banco (control plane) é a autoridade e a
 * config legada serve apenas como bootstrap determinístico; o caminho realmente
 * usado é reportado em `source` para nunca haver dúvida sobre a origem.
 *
 * §M3/§M4: a carga NÃO depende de `deps.tenants`. A lista de tenants era um
 * insumo EXTERNO — um tenant habilitado no banco depois do boot (ou ausente da
 * lista) nunca era carregado e o runtime perdia capabilities em silêncio.
 * `listAllEnabledConnections()` é a única autoridade.
 *
 * A projeção linha→config vem do módulo REAL (`jest.requireActual`), porque é
 * exatamente o contrato que o hub consome; só a leitura do banco é substituída.
 */

const mockState = { enabled: [], imported: [], failList: false };

jest.mock('../../../api/services/mcp/mcpConnectionService', () => {
  const actual = jest.requireActual('../../../api/services/mcp/mcpConnectionService');
  return {
    ...actual,
    importFromConfigBootstrap: jest.fn(),
    listAllEnabledConnections: jest.fn(),
  };
});

const mockConfigState = { connections: [] };
jest.mock('../../../api/utils/config', () => ({
  get: (key) => (key === 'mcp.connections' ? mockConfigState.connections : null),
}));

const mockService = require('../../../api/services/mcp/mcpConnectionService');
const { loadConnectionsFromPersistence, loadMcpConnectionsFromConfig } = require('../../../api/runtime/startMcpClient');

/**
 * `resetMocks: true` no jest.config limpa as implementações dos mocks antes de
 * CADA teste — por isso elas são (re)instaladas aqui, e não no factory.
 */
function installMockImplementations() {
  mockService.importFromConfigBootstrap.mockImplementation(async ({ tenantId, connections }) => {
    mockState.imported.push({ tenantId, count: (connections || []).length });
    return { imported: (connections || []).map((c) => c.name), skipped: [], invalid: [] };
  });
  mockService.listAllEnabledConnections.mockImplementation(async () => {
    if (mockState.failList) throw new Error('db_down');
    return mockState.enabled;
  });
}

function reset() {
  mockState.enabled = [];
  mockState.imported = [];
  mockState.failList = false;
  mockConfigState.connections = [];
  installMockImplementations();
}

function persistedRow(overrides = {}) {
  return {
    id: 'mcpc-1',
    tenant_key: 'academia-a',
    name: 'provedor-a',
    endpoint: 'https://mcp.exemplo.com/rpc',
    transport: 'http',
    enabled: true,
    classification_ceiling: 'PRODUCTION',
    auth_type: 'bearer',
    credential_ref: 'REF_A',
    schema_fingerprint: 'abc',
    allowed_capabilities: ['crm.read'],
    allowed_tools: ['crm.lookupCustomer'],
    tool_capability_map: { 'crm.lookupCustomer': 'crm.read' },
    mapping_version: '3',
    tool_policies: { 'crm.lookupCustomer': { sideEffects: false, riskLevel: 'low' } },
    endpoint_policy: { allowPrivateNetwork: false },
    quota: { tenant: 100 },
    timeout_ms: 15000,
    retry_policy: { attempts: 2 },
    discovered_tools: [{ name: 'crm.lookupCustomer', capability: 'crm.read', schemaFingerprint: null }],
    ...overrides,
  };
}

describe('M3/M4/M6/M7 — runtime MCP carrega do control plane persistente', () => {
  beforeEach(() => reset());

  it('usa as conexões HABILITADAS do banco e reporta source=control-plane', async () => {
    mockState.enabled = [persistedRow()];

    const result = await loadConnectionsFromPersistence();

    expect(result.source).toBe('control-plane');
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]).toMatchObject({
      tenant: 'academia-a',
      name: 'provedor-a',
      authType: 'bearer',
      credentialRef: 'REF_A',
      connectionId: 'mcpc-1',
    });
    // §M6 — a config OPERACIONAL também chega ao hub (antes era dropada).
    expect(result.connections[0].toolPolicies['crm.lookupCustomer']).toMatchObject({ riskLevel: 'low' });
    expect(result.connections[0].toolCapabilityMap).toEqual({ 'crm.lookupCustomer': 'crm.read' });
    expect(result.connections[0].mappingVersion).toBe('3');
  });

  it('M3/M4 — a lista de tenants NÃO é insumo: tenant ausente da lista É carregado', async () => {
    mockState.enabled = [persistedRow({ tenant_key: 'tenant-nao-listado', name: 'sobrevive' })];

    // `tenants` era o insumo do defeito; a carga não pode depender dele.
    const result = await loadConnectionsFromPersistence({ tenants: ['outro-tenant'] });

    expect(result.source).toBe('control-plane');
    expect(result.connections.map((c) => c.tenant)).toEqual(['tenant-nao-listado']);
    // O serviço é chamado SEM argumento: nenhuma lista é repassada adiante.
    expect(mockService.listAllEnabledConnections).toHaveBeenCalledWith();
  });

  it('M3/M4 — TODOS os tenants habilitados são carregados (multi-tenant)', async () => {
    mockState.enabled = [
      persistedRow({ id: 'mcpc-a', tenant_key: 'academia-a', name: 'a' }),
      persistedRow({ id: 'mcpc-b', tenant_key: 'academia-b', name: 'b' }),
    ];

    const result = await loadConnectionsFromPersistence();

    expect(result.connections.map((c) => c.connectionId).sort()).toEqual(['mcpc-a', 'mcpc-b']);
    expect(result.connections.map((c) => c.tenant).sort()).toEqual(['academia-a', 'academia-b']);
  });

  it('faz bootstrap da config legada sem duplicar (idempotente por tenant)', async () => {
    mockConfigState.connections = [
      { tenant: 'academia-a', name: 'legado-1', endpoint: 'https://mcp.legado.com/rpc' },
    ];

    await loadConnectionsFromPersistence();
    await loadConnectionsFromPersistence();

    // O bootstrap é delegado ao serviço, que é idempotente por (tenant,name).
    expect(mockState.imported).toHaveLength(2);
    expect(mockState.imported.every((i) => i.tenantId === 'academia-a')).toBe(true);
  });

  it('o bootstrap legado é EXPLÍCITO sobre a ORIGEM (source no resultado)', async () => {
    mockState.enabled = [persistedRow()];
    mockConfigState.connections = [{ tenant: 'academia-a', name: 'legado-1', endpoint: 'https://mcp.legado.com/rpc' }];

    const result = await loadConnectionsFromPersistence();

    // O banco venceu, mas o bootstrap rodou e é reportado — nunca implícito.
    expect(result.source).toBe('control-plane');
    expect(result.imported).toEqual([
      { tenantId: 'academia-a', result: { imported: ['legado-1'], skipped: [], invalid: [] } },
    ]);
    // A conexão que o runtime USA veio do banco, não da config.
    expect(result.connections[0].name).toBe('provedor-a');
  });

  it('sem conexão persistida e com config legada, o caminho usado é EXPLÍCITO', async () => {
    mockConfigState.connections = [
      { tenant: 'academia-a', name: 'legado-1', endpoint: 'https://mcp.legado.com/rpc' },
    ];
    const result = await loadConnectionsFromPersistence();
    expect(result.source).toBe('config-bootstrap-fallback');
    expect(result.connections).toHaveLength(1);
  });

  it('sem banco e sem config, não inventa conexão', async () => {
    mockState.failList = true;
    const result = await loadConnectionsFromPersistence();
    expect(result.connections).toEqual([]);
    expect(result.source).toBe('none');
    // A falha de leitura é REPORTADA, não silenciada.
    expect(result.persistenceError).toBe('db_down');
  });

  it('falha de leitura do banco não derruba o runtime (estado explícito)', async () => {
    mockState.failList = true;
    mockConfigState.connections = [{ tenant: 'academia-a', name: 'legado', endpoint: 'https://x.com/rpc' }];
    const result = await loadConnectionsFromPersistence();
    // Degrada para a config legada, sem silenciar o problema.
    expect(result.source).toBe('config-bootstrap-fallback');
    expect(result.persistenceError).toBe('db_down');
  });

  it('linha sem endpoint NÃO vira conexão do hub (config inválida é descartada, não inventada)', async () => {
    mockState.enabled = [persistedRow({ endpoint: '' })];
    const result = await loadConnectionsFromPersistence();
    expect(result.connections).toEqual([]);
    expect(result.source).toBe('none');
  });

  it('a config legada continua legível pela função de compatibilidade', () => {
    mockConfigState.connections = [{ tenant: 't', name: 'n' }];
    expect(loadMcpConnectionsFromConfig()).toHaveLength(1);
    mockConfigState.connections = [];
    expect(loadMcpConnectionsFromConfig()).toEqual([]);
  });
});
