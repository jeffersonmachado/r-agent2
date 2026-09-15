'use strict';

/**
 * Auto-registro da conexão mcp-research (bootstrap idempotente).
 *
 * O store do control plane é mockado na fronteira (mcpConnectionService), mas
 * a política REAL é exercida: o módulo passa por createConnection com a
 * normalização/validação canônica apenas quando o mock delega — aqui o foco é
 * o CONTRATO do bootstrap: sem env → ausência explícita; criação com escopo
 * fechado + delegação das 5 research.*; idempotência; reconciliação de drift;
 * disable administrativo NUNCA revertido.
 */

jest.mock('../../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const {
  CONNECTION_NAME,
  CREDENTIAL_REF,
  RESEARCH_TOOLS,
  buildConnectionInput,
  registerMcpResearchConnection,
} = require('../../../api/services/mcp/registerMcpResearchConnection');
const { RESEARCH_CAPABILITY_IDS } = require('../../../api/services/benchmark/researchCapabilities');

const ENDPOINT = 'http://mcp-research:8080/mcp';

function createFakeService() {
  const rows = new Map();
  return {
    rows,
    async listConnections() {
      return [...rows.values()];
    },
    async createConnection({ tenantId, input }) {
      const id = `mcpc-test-${rows.size + 1}`;
      const row = {
        id,
        tenant_key: tenantId,
        name: input.name,
        endpoint: input.endpoint,
        enabled: input.enabled,
        classification_ceiling: input.classificationCeiling,
        credential_ref: input.credentialRef,
        allowed_capabilities: input.allowedCapabilities,
        allowed_tools: input.allowedTools,
        tool_capability_map: input.toolCapabilityMap,
        tool_policies: input.toolPolicies,
        delegated_capabilities: input.delegatedCapabilities,
        endpoint_policy: input.endpointPolicy,
        metadata: { createdBy: 'test' },
      };
      rows.set(id, row);
      return row;
    },
    async updateConnection({ id, patch }) {
      const row = rows.get(id);
      if (patch.endpoint !== undefined) row.endpoint = patch.endpoint;
      if (patch.allowedCapabilities !== undefined) row.allowed_capabilities = patch.allowedCapabilities;
      if (patch.allowedTools !== undefined) row.allowed_tools = patch.allowedTools;
      if (patch.toolCapabilityMap !== undefined) row.tool_capability_map = patch.toolCapabilityMap;
      if (patch.toolPolicies !== undefined) row.tool_policies = patch.toolPolicies;
      if (patch.delegatedCapabilities !== undefined) row.delegated_capabilities = patch.delegatedCapabilities;
      if (patch.endpointPolicy !== undefined) row.endpoint_policy = patch.endpointPolicy;
      if (patch.credentialRef !== undefined) row.credential_ref = patch.credentialRef;
      if (patch.metadata !== undefined) row.metadata = { ...row.metadata, ...patch.metadata };
      return row;
    },
    async setEnabled({ id, enabled }) {
      rows.get(id).enabled = enabled === true;
      return rows.get(id);
    },
  };
}

describe('registerMcpResearchConnection — bootstrap idempotente', () => {
  const ENV_KEY = 'MCP_RESEARCH_ENDPOINT';

  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  test('sem MCP_RESEARCH_ENDPOINT → ausência EXPLÍCITA (nunca conexão inventada)', async () => {
    delete process.env[ENV_KEY];
    const result = await registerMcpResearchConnection({ service: createFakeService() });
    expect(result).toEqual({ registered: false, action: 'skipped', reason: 'mcp_research_endpoint_not_configured' });
  });

  test('com endpoint configurado: persiste conexão DEVELOPMENT com escopo fechado e delegação', async () => {
    const service = createFakeService();
    const result = await registerMcpResearchConnection({ endpoint: ENDPOINT, service });
    expect(result.registered).toBe(true);
    expect(result.action).toBe('created');

    const row = [...service.rows.values()][0];
    expect(row.tenant_key).toBe('system');
    expect(row.name).toBe(CONNECTION_NAME);
    expect(row.endpoint).toBe(ENDPOINT);
    expect(row.classification_ceiling).toBe('DEVELOPMENT');
    expect(row.enabled).toBe(true);
    expect(row.credential_ref).toBe(CREDENTIAL_REF); // referência, nunca o valor
    expect(row.allowed_capabilities).toEqual(RESEARCH_CAPABILITY_IDS);
    expect(row.delegated_capabilities).toEqual(RESEARCH_CAPABILITY_IDS);
    expect(row.allowed_tools).toEqual(RESEARCH_TOOLS.map((t) => t.name));
    expect(row.tool_capability_map).toEqual(
      Object.fromEntries(RESEARCH_TOOLS.map((t) => [t.name, t.capability])),
    );
    for (const tool of RESEARCH_TOOLS) {
      expect(row.tool_policies[tool.name].sideEffects).toBe(false);
    }
    expect(row.endpoint_policy).toEqual({ allowPlaintextHttp: true, allowPrivateNetwork: true, maxRedirects: 0 });
    expect(row.metadata.allowedHosts).toEqual(['mcp-research']);
  });

  test('idempotente: segundo bootstrap é already_registered, sem duplicar', async () => {
    const service = createFakeService();
    const first = await registerMcpResearchConnection({ endpoint: ENDPOINT, service });
    const second = await registerMcpResearchConnection({ endpoint: ENDPOINT, service });
    expect(second.action).toBe('already_registered');
    expect(second.id).toBe(first.id);
    expect(service.rows.size).toBe(1);
  });

  test('drift de config é reconciliado (update), nunca duplicado', async () => {
    const service = createFakeService();
    const first = await registerMcpResearchConnection({ endpoint: ENDPOINT, service });
    // Drift: operador alterou o mapa de capabilities.
    service.rows.get(first.id).tool_capability_map = { research_search: 'research.search' };
    const reconciled = await registerMcpResearchConnection({ endpoint: ENDPOINT, service });
    expect(reconciled.action).toBe('updated');
    expect(reconciled.drift).toBe('toolCapabilityMap');
    expect(service.rows.size).toBe(1);
    expect(service.rows.get(first.id).tool_capability_map).toEqual(
      Object.fromEntries(RESEARCH_TOOLS.map((t) => [t.name, t.capability])),
    );
  });

  test('disable administrativo NUNCA é revertido pelo bootstrap', async () => {
    const service = createFakeService();
    const first = await registerMcpResearchConnection({ endpoint: ENDPOINT, service });
    await service.setEnabled({ tenantId: 'system', id: first.id, enabled: false });
    const again = await registerMcpResearchConnection({ endpoint: ENDPOINT, service });
    expect(again.action).toBe('already_registered');
    expect(service.rows.get(first.id).enabled).toBe(false);
  });

  test('endpoint inválido é recusado', async () => {
    await expect(registerMcpResearchConnection({ endpoint: 'not-a-url', service: createFakeService() }))
      .rejects.toThrow(/mcp_research_endpoint_invalid/);
  });

  test('buildConnectionInput nunca carrega segredo nem wildcard', () => {
    const input = buildConnectionInput(ENDPOINT);
    const raw = JSON.stringify(input);
    expect(raw).not.toMatch(/"token"\s*:/i);
    expect(input.delegatedCapabilities.every((c) => !c.includes('*'))).toBe(true);
    expect(input.delegatedCapabilities).toEqual(RESEARCH_CAPABILITY_IDS);
    expect(input.credentialRef).toBe(CREDENTIAL_REF);
  });
});
