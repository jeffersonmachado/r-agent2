'use strict';

/**
 * §P0 — RAP_CORE_RESEARCH_EGRESS / RESEARCH_CANONICAL_PROVIDER_ONLY.
 *
 * DEFEITO REPRODUZIDO (2026-09-18): os módulos de rotas de benchmark e de
 * descoberta de mercado injetavam o provider NATIVO como DEFAULT
 * (`defaultResearchProviders` → `createNativeResearchProvider()`), ou seja:
 *
 *   Benchmark / Market Discovery → provider nativo → Internet
 *
 * O egress acontecia de dentro do RAP Core, fora do Canonical Tool Registry,
 * fora do MCP Control Plane e fora de qualquer revogação por configuração.
 *
 * Invariantes provados aqui:
 *   1. o egress nativo NÃO é default (`RESEARCH_NATIVE_PROVIDER_ENABLED`);
 *   2. com providers EXTERNOS registrados pelo adapter REAL, os runners são
 *      resolvidos pelo registry — capability-neutral, sem nome de conexão nem
 *      de provider no caminho do agente;
 *   3. sem provider governado e sem opt-in, o conjunto é VAZIO e a lista de
 *      ausentes é NOMINAL (fail closed, nunca fallback silencioso);
 *   4. a permissão concedida é ESCOPADA por conexão — nunca `mcp.*`.
 */

jest.mock('../../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

const { createMcpClientHub } = require('../../../src/core/mcp/client-hub');
const { registerExternalMcpTools } = require('../../../src/core/mcp/external-tool-adapter');
const { createToolRegistry } = require('../../../src/core/cognitive/tool-registry');
const { buildResearchPrincipal } = require('../../../api/services/benchmark/benchmarkResearchSupervisor');
const {
  RESEARCH_CAPABILITIES,
  RESEARCH_CAPABILITY_IDS,
} = require('../../../api/services/benchmark/researchCapabilities');
const {
  resolveGovernedResearchRunners,
  isNativeResearchProviderEnabled,
  NATIVE_OPT_IN_ENV,
} = require('../../../api/services/research/governedResearchProviders');
const { parseResearchToolOutput } = require('../../../api/services/benchmark/researchCapabilities');

const silent = { info() {}, warn() {}, error() {}, debug() {} };

const RESEARCH_TOOLS = RESEARCH_CAPABILITIES.map((definition) => ({
  name: definition.runner,
  capability: definition.capability,
}));

function createFakeResearchServer({ payloadForTool = null } = {}) {
  const server = new Server({ name: 'fake-research-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: RESEARCH_TOOLS.map((tool) => ({
      name: tool.name,
      description: `${tool.name} tool`,
      inputSchema: { type: 'object', additionalProperties: true },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // O serviço de pesquisa REAL devolve o payload como TEXTO JSON em
    // `content[].text` (não usa `structuredContent`). O fixture espelha isso:
    // devolver texto arbitrário aqui tornava o teste cego para a projeção de
    // output — foi assim que a falha silenciosa de 2026-09-19 passou.
    const custom = typeof payloadForTool === 'function' ? payloadForTool(request.params) : null;
    const payload = custom !== null && custom !== undefined
      ? custom
      : { tool: request.params.name, candidates: [{ title: 'Fonte oficial', url: 'https://oficial.example.com/' }] };
    return {
      content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }],
    };
  });
  return server;
}

function researchConnection(overrides = {}) {
  return {
    tenant: 'system',
    name: 'market-research',
    endpoint: 'https://research.example.com/mcp',
    enabled: true,
    classification: 'DEVELOPMENT',
    allowedCapabilities: [...RESEARCH_CAPABILITY_IDS],
    toolCapabilityMap: Object.fromEntries(RESEARCH_TOOLS.map((tool) => [tool.name, tool.capability])),
    toolPolicies: Object.fromEntries(RESEARCH_TOOLS.map((tool) => [tool.name, {
      sideEffects: false, riskLevel: 'low', confirmationPolicy: 'autonomous', idempotencyPolicy: 'none',
    }])),
    delegatedCapabilities: [...RESEARCH_CAPABILITY_IDS],
    ...overrides,
  };
}

async function buildRealStack({ connectionOverrides = {}, payloadForTool = null } = {}) {
  const server = createFakeResearchServer({ payloadForTool });
  const hub = createMcpClientHub({
    logger: silent,
    connections: [researchConnection(connectionOverrides)],
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

describe('egress nativo de pesquisa não é o caminho padrão', () => {
  test('o opt-in é DESLIGADO por default', () => {
    expect(isNativeResearchProviderEnabled({})).toBe(false);
    expect(isNativeResearchProviderEnabled({ [NATIVE_OPT_IN_ENV]: '' })).toBe(false);
    expect(isNativeResearchProviderEnabled({ [NATIVE_OPT_IN_ENV]: '0' })).toBe(false);
    expect(isNativeResearchProviderEnabled({ [NATIVE_OPT_IN_ENV]: 'yes' })).toBe(false);
  });

  test('o opt-in só liga com declaração explícita', () => {
    expect(isNativeResearchProviderEnabled({ [NATIVE_OPT_IN_ENV]: '1' })).toBe(true);
    expect(isNativeResearchProviderEnabled({ [NATIVE_OPT_IN_ENV]: 'true' })).toBe(true);
  });
});

describe('resolução de runners pelo registry (adapter REAL)', () => {
  test('as 5 capabilities de pesquisa são atendidas por tools EXTERNAS registradas', async () => {
    const { registry } = await buildRealStack();
    const principal = buildResearchPrincipal();

    const governed = resolveGovernedResearchRunners({
      registry,
      actor: principal,
      tenantId: 'system',
    });

    expect(governed.missing).toEqual([]);
    expect(governed.available).toEqual([...RESEARCH_CAPABILITY_IDS]);
    expect(Object.keys(governed.runners).sort()).toEqual(
      RESEARCH_CAPABILITIES.map((definition) => definition.runner).sort(),
    );
    // O runner é ligado a um proxy de MCP externo — nunca ao provider nativo.
    for (const capability of RESEARCH_CAPABILITY_IDS) {
      expect(governed.toolIds[capability]).toMatch(/^mcp\.t[0-9a-f]{12}\./);
    }
  });

  test('todas as capabilities têm runner executável e a execução passa pelo registry', async () => {
    const { registry } = await buildRealStack();
    const principal = buildResearchPrincipal();
    const governed = resolveGovernedResearchRunners({ registry, actor: principal, tenantId: 'system' });

    for (const definition of RESEARCH_CAPABILITIES) {
      // eslint-disable-next-line no-await-in-loop
      const output = await governed.runners[definition.runner]({ query: 'x', url: 'https://x.test' });
      expect(output).toBeTruthy();
    }
  });

  test('o runner devolve o PAYLOAD DECLARADO da capability, não o objeto cru do adapter', async () => {
    const { registry } = await buildRealStack();
    const governed = resolveGovernedResearchRunners({
      registry,
      actor: buildResearchPrincipal(),
      tenantId: 'system',
    });

    const output = await governed.runners.search({ query: 'x' });
    // O adapter devolve { remote, tool, content, text }; a capability promete
    // { candidates }, conforme documentado em researchCapabilities.js.
    // Sem a projeção, `candidates` era undefined e todo consumidor registrava
    // ZERO resultados com o run "COMPLETED" (2026-09-19).
    expect(output.candidates).toEqual([
      { title: 'Fonte oficial', url: 'https://oficial.example.com/' },
    ]);
    expect(output.remote).toBeUndefined();
    expect(output.content).toBeUndefined();
  });

  test('payload não estruturado FALHA de forma tipada — nunca vira vazio silencioso', async () => {
    const { registry } = await buildRealStack({ payloadForTool: () => 'texto solto sem json' });
    const governed = resolveGovernedResearchRunners({
      registry,
      actor: buildResearchPrincipal(),
      tenantId: 'system',
    });

    await expect(governed.runners.search({ query: 'x' }))
      .rejects.toMatchObject({ code: 'research_tool_output_unparsed' });
  });

  test('structuredContent tem precedência quando o provider o declara', () => {
    expect(parseResearchToolOutput(
      { text: '{"ignorado":true}', structuredContent: { candidates: ['a'] } },
      'research.search',
    )).toEqual({ candidates: ['a'] });
  });

  test('sem provider governado o conjunto é VAZIO e a ausência é NOMINAL', () => {
    const governed = resolveGovernedResearchRunners({
      registry: null,
      actor: buildResearchPrincipal(),
      tenantId: 'system',
    });
    expect(Object.keys(governed.runners)).toHaveLength(0);
    expect(governed.available).toEqual([]);
    expect(governed.missing).toEqual([...RESEARCH_CAPABILITY_IDS]);
  });

  test('conexão DESABILITADA não produz runner (revogação perde o provider)', async () => {
    const { registry } = await buildRealStack({ connectionOverrides: { enabled: false } });
    const governed = resolveGovernedResearchRunners({
      registry,
      actor: buildResearchPrincipal(),
      tenantId: 'system',
    });
    expect(governed.available).toEqual([]);
    expect(governed.missing).toEqual([...RESEARCH_CAPABILITY_IDS]);
  });

  test('delegação com wildcard é recusada na configuração da conexão', async () => {
    await expect(buildRealStack({ connectionOverrides: { delegatedCapabilities: ['mcp.*'] } }))
      .rejects.toThrow(/wildcard/i);
  });
});

describe('a permissão concedida é escopada por conexão, nunca mcp.*', () => {
  test('o principal de pesquisa não contém wildcard nem permissão nua de mcp', () => {
    const principal = buildResearchPrincipal();
    expect(principal.permissions).not.toContain('*');
    expect(principal.permissions).not.toContain('mcp.*');
    expect(principal.permissions).not.toContain('mcp');
    // Permissões nominais de pesquisa — nada de provider/cliente no caminho.
    for (const capability of RESEARCH_CAPABILITY_IDS) {
      expect(principal.permissions).toContain(capability);
    }
  });

  test('o acesso ao provider externo vem da DELEGAÇÃO, não da permissão do agente', async () => {
    const { registry } = await buildRealStack();
    const principal = buildResearchPrincipal();

    // O agente NÃO possui a permissão escopada da conexão...
    expect(principal.permissions.some((permission) => permission.startsWith('mcp.t'))).toBe(false);

    // ...e ainda assim alcança o provider, porque a conexão delega o escopo
    // para quem já possui a capability.
    const governed = resolveGovernedResearchRunners({ registry, actor: principal, tenantId: 'system' });
    expect(governed.available).toHaveLength(RESEARCH_CAPABILITY_IDS.length);
  });
});
