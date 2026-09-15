'use strict';

/**
 * T-M1/T-M2/T-M4 — Delegação REAL de capabilities de pesquisa via MCP externo.
 *
 * Diferente de `tests/unit/benchmarkResearchExecution.test.js` (que registra um
 * provider externo à mão com `permissions: ['research.search']` — atalho que
 * escondia o bug), esta suíte usa o caminho de PRODUÇÃO:
 *
 *   persisted connection config → createMcpClientHub (real)
 *     → registerExternalMcpTools (real) → Canonical Tool Registry (real)
 *     → buildResearchPrincipal() (real) → resolveProvider (real)
 *
 * O bug histórico: o adapter registra proxies com a permissão ESCOPADA da
 * conexão (`mcp.t<tenantToken>.<connection>`), que NENHUM principal de pesquisa
 * possui — então `resolveProvider('research.search')` nunca alcançava o provider
 * externo pelo caminho real. A correção é dirigida pela configuração PERSISTIDA
 * da conexão (`delegatedCapabilities`): nunca nome hardcoded, nunca `mcp.*`.
 *
 * O servidor MCP externo é fake apenas na fronteira de protocolo (SDK oficial
 * via InMemoryTransport) — adapter, hub, registry e principal são os reais.
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
  externalMcpTenantToken,
} = require('../../../src/core/mcp/external-tool-adapter');
const { resolveProvider } = require('../../../src/core/mcp/capability-resolution');
const { createToolRegistry } = require('../../../src/core/cognitive/tool-registry');
const {
  buildResearchPrincipal,
  RESEARCH_PRINCIPAL_PERMISSIONS,
} = require('../../../api/services/benchmark/benchmarkResearchSupervisor');
const {
  RESEARCH_CAPABILITY_IDS,
  executeResearchCapability,
} = require('../../../api/services/benchmark/researchCapabilities');

const silent = { info() {}, warn() {}, error() {}, debug() {} };

const RESEARCH_TOOLS = [
  { name: 'search', capability: 'research.search' },
  { name: 'fetch', capability: 'research.fetch' },
  { name: 'inspectDocumentation', capability: 'research.inspectDocumentation' },
  { name: 'inspectApiDocs', capability: 'research.inspectApiDocs' },
  { name: 'captureEvidence', capability: 'research.captureEvidence' },
];

function createFakeResearchServer({ onCall } = {}) {
  const server = new Server({ name: 'fake-research-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: RESEARCH_TOOLS.map((tool) => ({
      name: tool.name,
      description: `${tool.name} tool`,
      inputSchema: { type: 'object', additionalProperties: true },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (onCall) return onCall(request);
    return { content: [{ type: 'text', text: `ok:${request.params.name}` }] };
  });
  return server;
}

/**
 * Config PERSISTIDA da conexão de pesquisa (tenant SYSTEM). A delegação é
 * declarada nominalmente: exatamente as 5 capabilities de pesquisa, nada além.
 */
function researchConnection(overrides = {}) {
  return {
    tenant: 'system',
    name: 'market-research',
    endpoint: 'https://research.example.com/mcp',
    enabled: true,
    classification: 'DEVELOPMENT',
    allowedCapabilities: [...RESEARCH_CAPABILITY_IDS],
    toolCapabilityMap: Object.fromEntries(RESEARCH_TOOLS.map((tool) => [tool.name, tool.capability])),
    // Política declarada por tool: pesquisa é READ-ONLY (a captura de evidência
    // é gravação interna de artefato, não mutação de domínio).
    toolPolicies: Object.fromEntries(RESEARCH_TOOLS.map((tool) => [tool.name, {
      sideEffects: false, riskLevel: 'low', confirmationPolicy: 'autonomous', idempotencyPolicy: 'none',
    }])),
    delegatedCapabilities: [...RESEARCH_CAPABILITY_IDS],
    ...overrides,
  };
}

function buildHub({ connections, server, audit }) {
  return createMcpClientHub({
    logger: silent,
    audit,
    connections,
    transportFactory: () => {
      const pair = InMemoryTransport.createLinkedPair();
      server.connect(pair[1]);
      return pair[0];
    },
  });
}

async function buildRealStack({ connectionOverrides = {}, server } = {}) {
  const fakeServer = server || createFakeResearchServer();
  const hub = buildHub({ connections: [researchConnection(connectionOverrides)], server: fakeServer });
  const registry = createToolRegistry({ logger: silent });
  const registration = await registerExternalMcpTools({ toolRegistry: registry, hub, logger: silent });
  return { hub, registry, registration, server: fakeServer };
}

describe('T-M1 — caminho REAL: adapter + registry + principal de pesquisa', () => {
  test('resolveProvider alcança o provider MCP externo pelo principal REAL de pesquisa', async () => {
    const { registry, registration } = await buildRealStack();
    expect(registration.registered).toHaveLength(RESEARCH_TOOLS.length);
    expect(registration.skipped).toEqual([]);

    // O principal REAL, construído pelo supervisor — sem nenhuma permissão
    // registrada à mão no teste.
    const principal = buildResearchPrincipal();
    const resolution = resolveProvider({ registry, capability: 'research.search', actor: principal });

    expect(resolution.provider).toBeTruthy();
    expect(resolution.provider.id).toBe(
      `mcp.t${externalMcpTenantToken('system')}.market-research.search`,
    );
    // Decisão auditável: fallback read-only explícito, nunca opaco.
    expect(resolution.reason).toBe('external_read_only_provider_selected');
    expect(resolution.semanticSafety).toBe('safe_read_only_fallback');
  });

  test('o bug antigo permanece reproduzível: principal SEM as capabilities research.* não alcança o provider', async () => {
    const { registry } = await buildRealStack();
    // A forma do bug histórico: o supervisor declarava apenas
    // `benchmark.research.execute` e nenhuma delegação research.* existia.
    const legacyPrincipal = {
      classification: 'DEVELOPMENT',
      tenant: 'system',
      permissions: ['benchmark.research.execute'],
    };
    const resolution = resolveProvider({ registry, capability: 'research.search', actor: legacyPrincipal });
    expect(resolution.provider).toBeNull();
    expect(resolution.reason).toBe('no_provider_available');
  });

  test('a delegação é POLICY-DRIVEN: sem delegatedCapabilities persistido, o provider NÃO resolve', async () => {
    // Mesma conexão, mesmo mapeamento tool→capability — mas sem a delegação
    // declarada na config. Se a resolução funcionasse aqui, a correção seria
    // implícita (não política persistida).
    const { registry, registration } = await buildRealStack({ connectionOverrides: { delegatedCapabilities: [] } });
    expect(registration.registered).toHaveLength(RESEARCH_TOOLS.length);

    const principal = buildResearchPrincipal();
    const resolution = resolveProvider({ registry, capability: 'research.search', actor: principal });
    expect(resolution.provider).toBeNull();
    expect(resolution.reason).toBe('no_provider_available');
  });

  test('execução ponta a ponta pelo proxy governado (registry → adapter → hub → MCP)', async () => {
    const calls = [];
    const server = createFakeResearchServer({
      onCall: (request) => {
        calls.push(request.params);
        return { content: [{ type: 'text', text: JSON.stringify({ candidates: [{ url: 'https://vendor.example/docs', title: 'docs' }] }) }] };
      },
    });
    const { registry } = await buildRealStack({ server });

    const principal = buildResearchPrincipal();
    const result = await executeResearchCapability({
      registry,
      capability: 'research.search',
      tenantId: 'system',
      actor: principal,
      input: { query: 'benchmark fitness funcionalidades' },
    });

    expect(result.provider).toBe('external');
    expect(result.toolId).toBe(`mcp.t${externalMcpTenantToken('system')}.market-research.search`);
    expect(result.reason).toBe('external_read_only_provider_selected');
    expect(result.output.remote).toBe('market-research');
    expect(JSON.parse(result.output.text).candidates).toHaveLength(1);
    // A chamada realmente cruzou a fronteira de protocolo.
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('search');
  });

  test('todas as 5 capabilities research.* resolvem pelo MESMO mecanismo de delegação', async () => {
    const { registry } = await buildRealStack();
    const principal = buildResearchPrincipal();
    for (const capability of RESEARCH_CAPABILITY_IDS) {
      const resolution = resolveProvider({ registry, capability, actor: principal });
      expect(resolution.provider).toBeTruthy();
      expect(resolution.provider.capability).toBe(capability);
    }
  });

  test('o supervisor REAL reporta externalAccess=true sobre o stack real (o bug histórico de delegação)', async () => {
    const { createBenchmarkResearchMemoryStore } = require('../../helpers/benchmarkResearchMemoryStore');
    const { createBenchmarkResearchSupervisor } = require('../../../api/services/benchmark/benchmarkResearchSupervisor');
    const { registry } = await buildRealStack();

    // Supervisor com o principal DEFAULT (buildResearchPrincipal interno) — sem
    // nenhum ator injetado pelo teste. Era exatamente este caminho que
    // declarava research.* e nunca alcançava provider algum.
    const supervisor = createBenchmarkResearchSupervisor({
      store: createBenchmarkResearchMemoryStore(),
      registry,
      logger: silent,
      now: () => '2026-09-15T00:00:00.000Z',
    });

    const availability = supervisor.providerAvailability();
    expect(availability.externalAccess).toBe(true);
    expect(availability.missing).toEqual([]);
    expect(availability.reason).toBe('research_provider_available');
  });
});

describe('T-M2 — nenhum wildcard, nenhum escopo de conexão em blanket', () => {
  test('o principal de pesquisa carrega SOMENTE as 5 capabilities + benchmark.research.execute', () => {
    const principal = buildResearchPrincipal();
    expect(principal.permissions).toEqual([...RESEARCH_PRINCIPAL_PERMISSIONS]);
    expect(principal.permissions).not.toContain('*');
    expect(principal.permissions.some((perm) => perm.includes('*'))).toBe(false);
    expect(principal.permissions.some((perm) => perm.startsWith('mcp.'))).toBe(false);
    expect(principal.permissions.sort()).toEqual(
      ['benchmark.research.execute', ...RESEARCH_CAPABILITY_IDS].sort(),
    );
  });

  test('adversarial: principal com SOMENTE mcp.* NÃO executa nem resolve research.search', async () => {
    const { registry, registration } = await buildRealStack();
    const wildcardish = {
      classification: 'DEVELOPMENT',
      tenant: 'system',
      permissions: ['mcp.*'],
    };

    const resolution = resolveProvider({ registry, capability: 'research.search', actor: wildcardish });
    expect(resolution.provider).toBeNull();

    // Mesmo endereçando o proxy pelo id, a execução falha fechada:
    // `mcp.*` não é wildcard no Capability Kernel (só `*` é).
    await expect(registry.execute(registration.registered[0], {}, {
      tenantId: 'system',
      actor: wildcardish,
    })).rejects.toThrow('cognitive_tool_permission_denied');
  });

  test('adversarial: delegatedCapabilities com wildcard é recusado na configuração', async () => {
    expect(() => researchConnection() && buildHub({
      connections: [researchConnection({ delegatedCapabilities: ['mcp.*'] })],
      server: createFakeResearchServer(),
    })).toThrow(/mcp_connection_invalid/);
    expect(() => buildHub({
      connections: [researchConnection({ delegatedCapabilities: ['*'] })],
      server: createFakeResearchServer(),
    })).toThrow(/mcp_connection_invalid/);
  });

  test('adversarial: delegação de capability NÃO declarada pela conexão é recusada', () => {
    expect(() => buildHub({
      connections: [researchConnection({ delegatedCapabilities: ['billing.write'] })],
      server: createFakeResearchServer(),
    })).toThrow(/mcp_connection_invalid/);
  });
});

describe('T-M4 — cross-tenant: conexão de outro tenant nunca é do principal SYSTEM', () => {
  function tenantBConnection() {
    return researchConnection({
      tenant: 'tenant-b',
      name: 'partner-research',
      classification: 'DEVELOPMENT',
    });
  }

  test('resolution-time: provider do tenant B NÃO é selecionado para o principal SYSTEM', async () => {
    const server = createFakeResearchServer();
    const hub = buildHub({ connections: [tenantBConnection()], server });
    const registry = createToolRegistry({ logger: silent });
    const registration = await registerExternalMcpTools({ toolRegistry: registry, hub, logger: silent });
    expect(registration.registered).toHaveLength(RESEARCH_TOOLS.length);

    const principal = buildResearchPrincipal(); // tenant: 'system'
    const resolution = resolveProvider({ registry, capability: 'research.search', actor: principal });
    expect(resolution.provider).toBeNull();
    expect(resolution.reason).toBe('no_provider_available');
  });

  test('resolution-time: ator do PRÓPRIO tenant resolve (controle positivo do filtro)', async () => {
    const server = createFakeResearchServer();
    const hub = buildHub({ connections: [tenantBConnection()], server });
    const registry = createToolRegistry({ logger: silent });
    await registerExternalMcpTools({ toolRegistry: registry, hub, logger: silent });

    const tenantBActor = {
      classification: 'DEVELOPMENT',
      tenant: 'tenant-b',
      permissions: [...RESEARCH_CAPABILITY_IDS],
    };
    const resolution = resolveProvider({ registry, capability: 'research.search', actor: tenantBActor });
    expect(resolution.provider).toBeTruthy();
    expect(resolution.provider.id).toContain('.partner-research.');
  });

  test('execution-time: contexto SYSTEM na tool do tenant B é recusado mesmo com escopo explícito', async () => {
    const server = createFakeResearchServer();
    const hub = buildHub({ connections: [tenantBConnection()], server });
    const registry = createToolRegistry({ logger: silent });
    const { registered } = await registerExternalMcpTools({ toolRegistry: registry, hub, logger: silent });

    const scopeB = `mcp.t${externalMcpTenantToken('tenant-b')}.partner-research`;
    await expect(registry.execute(registered[0], {}, {
      tenantId: 'system',
      actor: { ...buildResearchPrincipal(), permissions: [...RESEARCH_PRINCIPAL_PERMISSIONS, scopeB] },
    })).rejects.toThrow('mcp_connection_tenant_mismatch');
  });
});
