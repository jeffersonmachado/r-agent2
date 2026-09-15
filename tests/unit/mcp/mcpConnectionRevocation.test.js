'use strict';

/**
 * T-M3 — Revogação de conexão MCP externa SEM restart.
 *
 * Estado anterior: desabilitar a conexão persistia o estado
 * (mcpConnectionService.setEnabled), mas o hub em memória seguia habilitado e
 * o Canonical Tool Registry não tinha deregister — os proxies `mcp.t*` ficavam
 * listados e EXECUTÁVEIS até o restart. Revogação que depende de restart não é
 * revogação.
 *
 * Agora:
 *  (a) `hub.setConnectionEnabled(false)` faz `connect`/`callTool` recusarem na
 *      hora (`mcp_connection_disabled`);
 *  (b) `revokeExternalMcpConnection` remove os proxies do registry —
 *      `resolveProvider` deixa de selecioná-los e `execute` falha com
 *      `cognitive_tool_not_found`;
 *  (c) a delegação de escopo deixa de ser concedida (resolver ignora conexão
 *      desabilitada);
 *  (d) no "restart" (registry + hub recriados da config persistida), conexão
 *      desabilitada NUNCA re-registra; habilitada reconstrói a delegação.
 */

jest.mock('../../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

const { createMcpClientHub } = require('../../../src/core/mcp/client-hub');
const {
  registerExternalMcpTools,
  revokeExternalMcpConnection,
  externalMcpTenantToken,
} = require('../../../src/core/mcp/external-tool-adapter');
const { resolveProvider } = require('../../../src/core/mcp/capability-resolution');
const { createToolRegistry } = require('../../../src/core/cognitive/tool-registry');
const { buildResearchPrincipal } = require('../../../api/services/benchmark/benchmarkResearchSupervisor');
const { RESEARCH_CAPABILITY_IDS } = require('../../../api/services/benchmark/researchCapabilities');

const silent = { info() {}, warn() {}, error() {}, debug() {} };

const REMOTE_TOOLS = [
  { name: 'search', capability: 'research.search' },
  { name: 'fetch', capability: 'research.fetch' },
];

function createFakeServer() {
  const server = new Server({ name: 'fake-research-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: REMOTE_TOOLS.map((tool) => ({
      name: tool.name,
      description: `${tool.name} tool`,
      inputSchema: { type: 'object', additionalProperties: true },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => ({
    content: [{ type: 'text', text: `ok:${request.params.name}` }],
  }));
  return server;
}

/** A "config persistida" do teste: enabled é o campo que o disable grava. */
function persistedConfig(overrides = {}) {
  return {
    tenant: 'system',
    name: 'market-research',
    endpoint: 'https://research.example.com/mcp',
    enabled: true,
    classification: 'DEVELOPMENT',
    allowedCapabilities: [...RESEARCH_CAPABILITY_IDS],
    toolCapabilityMap: Object.fromEntries(REMOTE_TOOLS.map((tool) => [tool.name, tool.capability])),
    toolPolicies: Object.fromEntries(REMOTE_TOOLS.map((tool) => [tool.name, {
      sideEffects: false, riskLevel: 'low', confirmationPolicy: 'autonomous', idempotencyPolicy: 'none',
    }])),
    delegatedCapabilities: REMOTE_TOOLS.map((tool) => tool.capability),
    ...overrides,
  };
}

/** Simula o startup: recria hub + registry a partir da config persistida. */
async function bootFromPersistedConfig(connections) {
  const server = createFakeServer();
  const hub = createMcpClientHub({
    logger: silent,
    connections,
    transportFactory: () => {
      const pair = InMemoryTransport.createLinkedPair();
      server.connect(pair[1]);
      return pair[0];
    },
  });
  const registry = createToolRegistry({ logger: silent });
  const registration = await registerExternalMcpTools({ toolRegistry: registry, hub, logger: silent });
  return { hub, registry, registration };
}

describe('T-M3 — revogação em runtime', () => {
  test('(a) execução pelo proxy é recusada imediatamente após o disable', async () => {
    const { hub, registry, registration } = await bootFromPersistedConfig([persistedConfig()]);
    const principal = buildResearchPrincipal();
    const context = { tenantId: 'system', actor: principal };

    // Antes do disable: executa.
    const before = await registry.execute(registration.registered[0], {}, context);
    expect(before.success).toBe(true);

    hub.setConnectionEnabled('market-research', { tenantId: 'system', enabled: false });

    // Camada 1 — o hub recusa a chamada na hora (enforcement já existente).
    await expect(hub.callTool('market-research', 'search', {}, { tenantId: 'system' }))
      .rejects.toThrow(/mcp_connection_disabled/);

    // Camada 2 — a delegação de escopo deixa de ser concedida (resolver ignora
    // conexão desabilitada), então a execução pelo proxy falha FECHADA já na
    // verificação de permissão do registry, antes de tocar a rede.
    await expect(registry.execute(registration.registered[0], {}, context))
      .rejects.toThrow(/cognitive_tool_permission_denied|mcp_connection_disabled/);

    // E o LIST do principal deixa de ver o proxy pela permissão delegada.
    const stillVisible = registry.list({
      classification: principal.classification,
      permissions: [...principal.permissions],
    }).filter((tool) => tool.id.startsWith('mcp.'));
    expect(stillVisible.map((tool) => tool.id)).not.toContain(registration.registered[0]);
  });

  test('(b) revokeExternalMcpConnection remove os proxies: resolveProvider não seleciona mais', async () => {
    const { hub, registry, registration } = await bootFromPersistedConfig([persistedConfig()]);
    const principal = buildResearchPrincipal();

    const before = resolveProvider({ registry, capability: 'research.search', actor: principal });
    expect(before.provider).toBeTruthy();

    const revoked = revokeExternalMcpConnection({
      toolRegistry: registry, hub, tenantId: 'system', name: 'market-research', logger: silent,
    });
    expect(revoked.deregistered.sort()).toEqual([...registration.registered].sort());

    // Resolução: o provider revogado não é mais candidato.
    const after = resolveProvider({ registry, capability: 'research.search', actor: principal });
    expect(after.provider).toBeNull();
    expect(after.reason).toBe('no_provider_available');

    // Execução direta pelo id antigo: tool não existe mais.
    await expect(registry.execute(registration.registered[0], {}, {
      tenantId: 'system', actor: principal,
    })).rejects.toThrow('cognitive_tool_not_found');

    expect(registry.get(registration.registered[0])).toBeNull();
    expect(registry.size()).toBe(0);
  });

  test('revoke de conexão desconhecida falha explicitamente (nunca no-op silencioso)', async () => {
    const { hub, registry } = await bootFromPersistedConfig([persistedConfig()]);
    expect(() => revokeExternalMcpConnection({
      toolRegistry: registry, hub, tenantId: 'system', name: 'inexistente', logger: silent,
    })).toThrow(/no_configured_mcp_connection/);
    expect(() => revokeExternalMcpConnection({
      toolRegistry: registry, hub, tenantId: 'outro-tenant', name: 'market-research', logger: silent,
    })).toThrow(/mcp_connection_tenant_required|no_configured_mcp_connection/);
  });

  test('registry.deregister é idempotente e remove aliases e schema cache', async () => {
    const registry = createToolRegistry({ logger: silent });
    registry.register({
      id: 'probe.tool',
      aliases: ['legacyProbe'],
      capability: 'probe.read',
      visibility: 'DEVELOPMENT',
      permissions: ['probe.read'],
      description: 'probe',
      inputSchema: { type: 'object' },
      execute: async () => ({}),
    });
    // Compila o schema (entrada de cache) antes de remover.
    await registry.execute('probe.tool', {}, {
      tenantId: 'system', actor: { classification: 'DEVELOPMENT', permissions: ['probe.read'] },
    });

    expect(registry.deregister('probe.tool')).toBe(true);
    expect(registry.deregister('probe.tool')).toBe(false);
    expect(registry.get('probe.tool')).toBeNull();
    // Alias removido junto: não resolve mais para o canônico.
    expect(registry.get('legacyProbe')).toBeNull();
    expect(registry.isAlias('legacyProbe')).toBe(false);
    // Re-registro com o MESMO id funciona (sem resíduo de duplicata).
    registry.register({
      id: 'probe.tool', capability: 'probe.read', visibility: 'DEVELOPMENT',
      permissions: ['probe.read'], description: 'probe v2', execute: async () => ({ v: 2 }),
    });
    const rerun = await registry.execute('probe.tool', {}, {
      tenantId: 'system', actor: { classification: 'DEVELOPMENT', permissions: ['probe.read'] },
    });
    expect(rerun.output).toEqual({ v: 2 });
  });

  test('(d) restart: conexão desabilitada NUNCA re-registra; habilitada reconstrói a delegação', async () => {
    // "Banco" após o disable: a config persistida tem enabled=false.
    const persistedAfterDisable = persistedConfig({ enabled: false });
    const boot = await bootFromPersistedConfig([persistedAfterDisable]);

    expect(boot.registration.registered).toEqual([]);
    expect(boot.registration.reason).toBe('no_configured_mcp_connection');
    expect(boot.registry.size()).toBe(0);

    const principal = buildResearchPrincipal();
    const resolution = resolveProvider({ registry: boot.registry, capability: 'research.search', actor: principal });
    expect(resolution.provider).toBeNull();

    // Restart com a conexão HABILITADA: a delegação é reconstruída da config.
    const reboot = await bootFromPersistedConfig([persistedConfig()]);
    const restored = resolveProvider({ registry: reboot.registry, capability: 'research.search', actor: principal });
    expect(restored.provider).toBeTruthy();
    expect(restored.provider.id).toBe(`mcp.t${externalMcpTenantToken('system')}.market-research.search`);
  });

  test('restart com mix: só a conexão habilitada registra proxies', async () => {
    const disabled = persistedConfig({ enabled: false });
    const enabled = persistedConfig({ name: 'partner-research' });
    const boot = await bootFromPersistedConfig([disabled, enabled]);

    expect(boot.registration.registered).toHaveLength(REMOTE_TOOLS.length);
    expect(boot.registration.registered.every((id) => id.includes('.partner-research.'))).toBe(true);
    expect(boot.registry.list({ classification: 'DEVELOPMENT' }).some((t) => t.id.includes('.market-research.'))).toBe(false);
  });
});
