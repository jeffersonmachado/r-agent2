'use strict';

/**
 * MCP Server Adapter + Client Hub — authorization, visibility e fonte única.
 * Cobre os testes obrigatórios 19–23 e 25 da especificação.
 */

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { createMcpServerAdapter } = require('../../src/core/mcp/server-adapter');
const { createMcpClientHub } = require('../../src/core/mcp/client-hub');
const { stripTenantOverride, buildMcpExecutionContext } = require('../../src/core/mcp/auth');
const { createToolRegistry, registerDefaultTools } = require('../../src/core/cognitive/tool-registry');

const silent = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

const PROD_PRINCIPAL = {
  tenantId: 'tenant-a',
  principalId: 'user-1',
  principalType: 'user',
  classification: 'PRODUCTION',
  permissions: ['crm.read', 'crm.write', 'agenda.write'],
};

function buildAdapter(registry) {
  return createMcpServerAdapter({ toolRegistry: registry, logger: silent });
}

async function createLinkedClient(server) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

describe('MCP Server Adapter', () => {
  test('19. PRODUCTION lista apenas tools autorizadas (nunca SUPPORT/DEVELOPMENT)', async () => {
    const registry = registerDefaultTools(createToolRegistry({ logger: silent }));
    const adapter = buildAdapter(registry);

    const tools = adapter.listToolsForPrincipal(PROD_PRINCIPAL).map((t) => t.name);
    expect(tools).toContain('crm.searchCustomer');
    expect(tools).not.toContain('knowledge.searchSystem');
    expect(tools).not.toContain('audit.listReplays');
    expect(tools).not.toContain('qa.getWaveStatus');

    // Via protocolo MCP real (SDK oficial, transporte in-memory).
    const server = adapter.createServerForPrincipal(PROD_PRINCIPAL);
    const client = await createLinkedClient(server);
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name);
    expect(names).toContain('crm.searchCustomer');
    expect(names).not.toContain('qa.getWaveStatus');
    expect(names).not.toContain('audit.listReplays');
    await client.close();
    await server.close();
  });

  test('20. direct-call de tool proibida falha (authorization, não execução)', async () => {
    const registry = registerDefaultTools(createToolRegistry({ logger: silent }));
    const adapter = buildAdapter(registry);
    const server = adapter.createServerForPrincipal(PROD_PRINCIPAL);
    const client = await createLinkedClient(server);

    const result = await client.callTool({ name: 'qa.getWaveStatus', arguments: { executionId: 'x' } });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('cognitive_tool_visibility_denied');

    await client.close();
    await server.close();
  });

  test('21. MCP não aceita tenant override por input', async () => {
    const registry = registerDefaultTools(createToolRegistry({ logger: silent }));
    const adapter = buildAdapter(registry);
    const server = adapter.createServerForPrincipal(PROD_PRINCIPAL);
    const client = await createLinkedClient(server);

    const result = await client.callTool({
      name: 'crm.searchCustomer',
      arguments: { query: 'maria', tenantId: 'tenant-b' },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('mcp_tenant_override_forbidden');

    await client.close();
    await server.close();

    // stripTenantOverride direto
    expect(() => stripTenantOverride({ tenant_id: 'evil' })).toThrow('mcp_tenant_override_forbidden');
    expect(stripTenantOverride({ query: 'ok' })).toEqual({ query: 'ok' });
  });

  test('22. MCP tool chama exatamente o mesmo Tool Registry', async () => {
    const marketingService = {
      listLeads: jest.fn(async () => ({ total: 0, items: [] })),
      getLeadById: jest.fn(),
    };
    const registry = registerDefaultTools(createToolRegistry({ logger: silent }), { marketingService });
    const executeSpy = jest.spyOn(registry, 'execute');

    const adapter = buildAdapter(registry);
    const server = adapter.createServerForPrincipal(PROD_PRINCIPAL);
    const client = await createLinkedClient(server);

    const result = await client.callTool({ name: 'crm.searchCustomer', arguments: { query: 'maria' } });
    expect(result.isError).toBeFalsy();
    expect(executeSpy).toHaveBeenCalledWith(
      'crm.searchCustomer',
      { query: 'maria' },
      expect.objectContaining({ tenantId: 'tenant-a' }),
    );
    expect(marketingService.listLeads).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a' }));

    await client.close();
    await server.close();
  });

  test('23. MCP externo inexistente não produz fake success', async () => {
    const hub = createMcpClientHub({ connections: [], logger: silent });
    await expect(hub.connect('erp-legacy', { tenantId: 'tenant-a' })).rejects.toThrow('no_configured_mcp_connection');
    await expect(hub.callTool('erp-legacy', 'createOrder', {}, { tenantId: 'tenant-a' })).rejects.toThrow('no_configured_mcp_connection');
  });

  test('authorization: contexto incompleto falha fechado', () => {
    expect(() => buildMcpExecutionContext({})).toThrow('mcp_principal_invalid');
    expect(() => buildMcpExecutionContext({ tenantId: 't1', principalId: 'p1' })).toThrow('classification');
    const ctx = buildMcpExecutionContext(PROD_PRINCIPAL);
    expect(ctx.tenantId).toBe('tenant-a');
    expect(ctx.permissions).not.toContain('*');
  });

  test('client hub: conexão desabilitada e escopo de tools são enforced', async () => {
    const hub = createMcpClientHub({
      logger: silent,
      connections: [{
        tenant: 'tenant-a', name: 'erp', endpoint: 'https://erp.example.com/mcp',
        enabled: false, classification: 'PRODUCTION', allowedTools: ['createOrder'],
      }],
    });
    await expect(hub.connect('erp', { tenantId: 'tenant-a' })).rejects.toThrow('mcp_connection_disabled');

    const hub2 = createMcpClientHub({
      logger: silent,
      connections: [{
        tenant: 'tenant-a', name: 'erp', endpoint: 'https://erp.example.com/mcp',
        enabled: true, classification: 'PRODUCTION', allowedTools: ['createOrder'],
      }],
    });
    await expect(hub2.callTool('erp', 'deleteEverything', {}, { tenantId: 'tenant-a' }))
      .rejects.toThrow('mcp_tool_not_allowed');
    await expect(hub2.connect('erp', { tenantId: 'tenant-b' })).rejects.toThrow('mcp_connection_tenant_mismatch');
  });

  test('external adapter sem conexões: estado explícito, sem fake success', async () => {
    const { registerExternalMcpTools } = require('../../src/core/mcp/external-tool-adapter');
    const registry = createToolRegistry({ logger: silent });
    const hub = createMcpClientHub({ connections: [], logger: silent });
    const result = await registerExternalMcpTools({ toolRegistry: registry, hub, logger: silent });
    expect(result.registered).toEqual([]);
    expect(result.reason).toBe('no_configured_mcp_connection');
  });

  test('external adapter registra proxy governado que passa pelo Tool Registry', async () => {
    const { registerExternalMcpTools, externalMcpTenantToken } = require('../../src/core/mcp/external-tool-adapter');

    // MCP server externo fake PORÉM via SDK real (in-memory): simula um servidor
    // externo de verdade no protocolo, sem mocks de negócio.
    const remoteAdapter = createMcpServerAdapter({
      toolRegistry: (() => {
        const r = createToolRegistry({ logger: silent });
        r.register({
          id: 'legacy.createOrder',
          visibility: 'PRODUCTION',
          permissions: [],
          description: 'Cria pedido no ERP legado',
          execute: jest.fn(async (input) => ({ orderId: 'ord-1', sku: input.sku })),
        });
        return r;
      })(),
      logger: silent,
    });
    const remoteServer = remoteAdapter.createServerForPrincipal({
      tenantId: 'tenant-a', principalId: 'svc-erp', principalType: 'service',
      classification: 'PRODUCTION', permissions: [],
    });

    const hub = createMcpClientHub({
      logger: silent,
      connections: [{
        tenant: 'tenant-a', name: 'erp', endpoint: 'https://erp.example.com/mcp',
        enabled: true, classification: 'PRODUCTION',
        allowedCapabilities: ['order.manage'], allowedTools: ['legacy.createOrder'],
      }],
      transportFactory: () => {
        const pair = InMemoryTransport.createLinkedPair();
        remoteServer.connect(pair[1]);
        return pair[0];
      },
    });

    const registry = registerDefaultTools(createToolRegistry({ logger: silent }));
    const { registered } = await registerExternalMcpTools({ toolRegistry: registry, hub, logger: silent });
    // toolId escopado por tenant (hash opaco, determinístico) — sem vazar tenantId.
    const tenantToken = externalMcpTenantToken('tenant-a');
    const toolId = `mcp.t${tenantToken}.erp.legacy.createOrder`;
    expect(toolId).not.toContain('tenant-a');
    expect(registered).toContain(toolId);

    // Agente chama via Tool Registry (governado) — nunca direto.
    const result = await registry.execute(toolId, { sku: 'ABC' }, {
      tenantId: 'tenant-a',
      actor: { classification: 'PRODUCTION', permissions: [`mcp.t${tenantToken}.erp`] },
      idempotencyKey: 'k1',
      confirmed: true,
    });
    expect(result.success).toBe(true);
    expect(result.output.text).toContain('ord-1');

    // PRODUCTION sem a permissão da conexão é negado no registry.
    await expect(registry.execute(toolId, { sku: 'ABC' }, {
      tenantId: 'tenant-a',
      actor: { classification: 'PRODUCTION', permissions: [] },
      idempotencyKey: 'k2',
    })).rejects.toThrow('cognitive_tool_permission_denied');

    await remoteServer.close();
  });
});
