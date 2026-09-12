'use strict';

/**
 * M6/M7 — o runtime carrega as conexões da FONTE PERSISTENTE, não da config.
 *
 * Antes: `startMcpClient.js` montava as conexões de `config.get('mcp.connections')`
 * e o estado vivia em memória. Agora o banco (control plane) é a autoridade e a
 * config legada serve apenas como bootstrap determinístico; o caminho realmente
 * usado é reportado em `source` para nunca haver dúvida sobre a origem.
 */

const mockState = { enabled: [], imported: [], failList: false };

jest.mock('../../../api/services/mcp/mcpConnectionService', () => ({
  importFromConfigBootstrap: jest.fn(),
  listEnabledConnections: jest.fn(),
}));

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
  mockService.listEnabledConnections.mockImplementation(async ({ tenantId }) => {
    if (mockState.failList) throw new Error('db_down');
    return mockState.enabled.filter((row) => row.tenant_key === tenantId);
  });
}

function reset() {
  mockState.enabled = [];
  mockState.imported = [];
  mockState.failList = false;
  mockConfigState.connections = [];
  installMockImplementations();
}

describe('M6/M7 — runtime MCP carrega do control plane persistente', () => {
  beforeEach(() => reset());

  it('usa as conexões HABILITADAS do banco e reporta source=control-plane', async () => {
    mockState.enabled = [{
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
    }];

    const result = await loadConnectionsFromPersistence({ tenants: ['academia-a'] });

    expect(result.source).toBe('control-plane');
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]).toMatchObject({
      tenant: 'academia-a',
      name: 'provedor-a',
      authType: 'bearer',
      credentialRef: 'REF_A',
      connectionId: 'mcpc-1',
    });
  });

  it('faz bootstrap da config legada sem duplicar (idempotente por tenant)', async () => {
    mockConfigState.connections = [
      { tenant: 'academia-a', name: 'legado-1', endpoint: 'https://mcp.legado.com/rpc' },
    ];

    await loadConnectionsFromPersistence({ tenants: ['academia-a'] });
    await loadConnectionsFromPersistence({ tenants: ['academia-a'] });

    // O bootstrap é delegado ao serviço, que é idempotente por (tenant,name).
    expect(mockState.imported).toHaveLength(2);
    expect(mockState.imported.every((i) => i.tenantId === 'academia-a')).toBe(true);
  });

  it('sem conexão persistida e com config legada, o caminho usado é EXPLÍCITO', async () => {
    mockConfigState.connections = [
      { tenant: 'academia-a', name: 'legado-1', endpoint: 'https://mcp.legado.com/rpc' },
    ];
    const result = await loadConnectionsFromPersistence({ tenants: ['academia-a'] });
    expect(result.source).toBe('config-bootstrap-fallback');
    expect(result.connections).toHaveLength(1);
  });

  it('sem banco e sem config, não inventa conexão', async () => {
    mockState.failList = true;
    const result = await loadConnectionsFromPersistence({ tenants: ['academia-a'] });
    expect(result.connections).toEqual([]);
    expect(result.source).toBe('none');
  });

  it('falha de leitura do banco não derruba o runtime (estado explícito)', async () => {
    mockState.failList = true;
    mockConfigState.connections = [{ tenant: 'academia-a', name: 'legado', endpoint: 'https://x.com/rpc' }];
    const result = await loadConnectionsFromPersistence({ tenants: ['academia-a'] });
    // Degrada para a config legada, sem silenciar o problema.
    expect(result.source).toBe('config-bootstrap-fallback');
  });

  it('a config legada continua legível pela função de compatibilidade', () => {
    mockConfigState.connections = [{ tenant: 't', name: 'n' }];
    expect(loadMcpConnectionsFromConfig()).toHaveLength(1);
    mockConfigState.connections = [];
    expect(loadMcpConnectionsFromConfig()).toEqual([]);
  });
});
