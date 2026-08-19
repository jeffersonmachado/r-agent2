'use strict';

/**
 * MCP Hardening (W1-B) — boundary HTTP /mcp autenticado, tenant fail-closed,
 * Client Hub sem fallback por nome e toolId externo escopado por tenant.
 */

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../api/services/authService', () => ({
  validateToken: jest.fn(),
}));

const express = require('express');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const { validateToken } = require('../../api/services/authService');
const { mountMcpRoutes, buildMcpAuthContext } = require('../../api/runtime/startMcpServer');
const { createMcpClientHub } = require('../../src/core/mcp/client-hub');
const { createMcpServerAdapter } = require('../../src/core/mcp/server-adapter');
const {
  registerExternalMcpTools,
  externalMcpTenantToken,
} = require('../../src/core/mcp/external-tool-adapter');
const { createToolRegistry, registerDefaultTools } = require('../../src/core/cognitive/tool-registry');

const silent = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function buildApp(toolRegistry) {
  const app = express();
  app.use(express.json());
  mountMcpRoutes(app, { orchestrator: { toolRegistry } });
  return app;
}

async function startHttp(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function postMcp(baseUrl, headers = {}) {
  return fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
}

describe('MCP Hardening — boundary HTTP /mcp', () => {
  let server;
  let baseUrl;

  afterEach(async () => {
    validateToken.mockReset();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }
  });

  test('(a) POST /mcp sem auth → 401 mcp_authentication_required', async () => {
    const registry = registerDefaultTools(createToolRegistry({ logger: silent }), {
      marketingService: { listLeads: jest.fn(async () => ({ items: [] })), getLeadById: jest.fn() },
    });
    ({ server, baseUrl } = await startHttp(buildApp(registry)));

    // Sem header Authorization.
    const noAuth = await postMcp(baseUrl);
    expect(noAuth.status).toBe(401);
    expect((await noAuth.json()).error).toBe('mcp_authentication_required');

    // Token inválido (validateToken rejeita).
    validateToken.mockReturnValue({ valid: false, error: 'Sessão não encontrada' });
    const badToken = await postMcp(baseUrl, { authorization: 'Bearer token-invalido' });
    expect(badToken.status).toBe(401);
    expect((await badToken.json()).error).toBe('mcp_authentication_required');
  });

  test('autenticado mas sem tenant na sessão → 400 tenant_required (sem fallback p/ system)', async () => {
    const registry = registerDefaultTools(createToolRegistry({ logger: silent }), {
      marketingService: { listLeads: jest.fn(async () => ({ items: [] })), getLeadById: jest.fn() },
    });
    ({ server, baseUrl } = await startHttp(buildApp(registry)));

    validateToken.mockReturnValue({
      valid: true,
      agent: { id: 'u1', username: 'op1', role: 'operator' }, // sem tenantId
      session: { id: 'sess-1' },
    });

    const res = await postMcp(baseUrl, { authorization: 'Bearer token-sem-tenant' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('tenant_required');
  });

  test('(b) com auth do tenant A, tools/call executa com tenantId A (nunca system)', async () => {
    const marketingService = {
      listLeads: jest.fn(async () => ({ items: [] })),
      getLeadById: jest.fn(),
    };
    const registry = registerDefaultTools(createToolRegistry({ logger: silent }), { marketingService });
    ({ server, baseUrl } = await startHttp(buildApp(registry)));

    validateToken.mockReturnValue({
      valid: true,
      agent: { id: 'u1', username: 'op1', role: 'operator', tenantId: 'tenant-a' },
      session: { id: 'sess-a' },
    });

    // Cliente MCP real (SDK oficial) contra o boundary HTTP autenticado.
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { authorization: 'Bearer token-a' } },
    });
    const client = new Client({ name: 'mcp-hardening-test', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);

    // Classificação do ator (operator → PRODUCTION) filtra a descoberta.
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name);
    expect(names).toContain('crm.searchCustomer');
    expect(names).not.toContain('qa.getWaveStatus');
    expect(names).not.toContain('audit.listReplays');

    // Execução chega ao serviço de domínio com o tenant da sessão.
    const result = await client.callTool({ name: 'crm.searchCustomer', arguments: { query: 'maria' } });
    expect(result.isError).toBeFalsy();
    expect(marketingService.listLeads).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a' }),
    );
    expect(marketingService.listLeads.mock.calls[0][0].tenantId).not.toBe('system');

    await client.close();
  });

  test('buildMcpAuthContext: fail-closed, principal sem fallback, classificação canônica', () => {
    // Sem agente → 401.
    expect(() => buildMcpAuthContext({ headers: {} }))
      .toThrow(expect.objectContaining({ message: 'mcp_authentication_required', statusCode: 401 }));

    // Sem tenant (nem no request nem no agente) → 400 tenant_required.
    expect(() => buildMcpAuthContext({ agent: { id: 'u1', role: 'operator' }, headers: {} }))
      .toThrow(expect.objectContaining({ message: 'tenant_required', statusCode: 400 }));

    // Sem principal (nem username nem id) → 401, nunca 'unknown'.
    expect(() => buildMcpAuthContext({ agent: { role: 'operator', tenantId: 'tenant-a' }, headers: {} }))
      .toThrow(expect.objectContaining({ message: 'mcp_authentication_required', statusCode: 401 }));

    // Happy path: tenant do request, principal = username, RBAC → permissions.
    const ctx = buildMcpAuthContext({
      agent: { id: 'u1', username: 'op1', role: 'operator', tenantId: 'tenant-a' },
      tenantId: 'tenant-a',
      session: { id: 'sess-a' },
      headers: {},
    });
    expect(ctx.tenantId).toBe('tenant-a');
    expect(ctx.principalId).toBe('op1');
    expect(ctx.classification).toBe('PRODUCTION');
    expect(ctx.permissions).toContain('crm.read');
    expect(ctx.permissions).not.toContain('*');

    // Mapeamento canônico role→classificação (experience-segregation).
    expect(buildMcpAuthContext({
      agent: { id: 'a1', role: 'auditor', tenantId: 'tenant-a' }, headers: {},
    }).classification).toBe('SUPPORT');
    const sa = buildMcpAuthContext({
      agent: { id: 'sa1', role: 'super_admin', tenantId: 'tenant-b' }, tenantId: 'tenant-b', headers: {},
    });
    expect(sa.classification).toBe('DEVELOPMENT');
    expect(sa.permissions).toEqual(['*']);
  });
});

describe('MCP Hardening — Client Hub sem fallback por nome', () => {
  const connections = [
    { tenant: 'tenant-a', name: 'erp', endpoint: 'https://erp.a.example.com', enabled: true, classification: 'PRODUCTION' },
    { tenant: 'tenant-b', name: 'erp', endpoint: 'https://erp.b.example.com', enabled: true, classification: 'PRODUCTION' },
  ];

  test('(c) getConnection/connect/callTool sem tenant → mcp_connection_tenant_required', async () => {
    const hub = createMcpClientHub({ connections, logger: silent });

    expect(() => hub.getConnection('erp')).toThrow('mcp_connection_tenant_required');
    await expect(hub.connect('erp')).rejects.toThrow('mcp_connection_tenant_required');
    await expect(hub.callTool('erp', 'createOrder', {})).rejects.toThrow('mcp_connection_tenant_required');

    // Com tenant correto a resolução continua funcionando.
    expect(hub.getConnection('erp', { tenantId: 'tenant-a' }).endpoint).toBe('https://erp.a.example.com');
    expect(hub.getConnection('erp', { tenantId: 'tenant-b' }).endpoint).toBe('https://erp.b.example.com');
    // Tenant errado para o nome → null (connect/callTool viram tenant_mismatch).
    expect(hub.getConnection('erp', { tenantId: 'tenant-c' })).toBeNull();
  });
});

describe('MCP Hardening — External Tool Adapter sem colisão cross-tenant', () => {
  function makeRemoteServer(tenantId, marker) {
    const registry = createToolRegistry({ logger: silent });
    registry.register({
      id: 'legacy.createOrder',
      visibility: 'PRODUCTION',
      permissions: [],
      description: 'Cria pedido no ERP legado',
      execute: jest.fn(async (input) => ({ orderId: marker, sku: input.sku })),
    });
    const adapter = createMcpServerAdapter({ toolRegistry: registry, logger: silent });
    return adapter.createServerForPrincipal({
      tenantId, principalId: 'svc-erp', principalType: 'service',
      classification: 'PRODUCTION', permissions: [],
    });
  }

  test('(e) dois tenants com conexão de mesmo nome registram tools sem colisão silenciosa', async () => {
    const remoteServers = {
      'tenant-a': makeRemoteServer('tenant-a', 'ord-A'),
      'tenant-b': makeRemoteServer('tenant-b', 'ord-B'),
    };

    const hub = createMcpClientHub({
      logger: silent,
      connections: [
        {
          tenant: 'tenant-a', name: 'erp', endpoint: 'https://erp.a.example.com',
          enabled: true, classification: 'PRODUCTION',
          allowedCapabilities: ['order.manage'], allowedTools: ['legacy.createOrder'],
        },
        {
          tenant: 'tenant-b', name: 'erp', endpoint: 'https://erp.b.example.com',
          enabled: true, classification: 'PRODUCTION',
          allowedCapabilities: ['order.manage'], allowedTools: ['legacy.createOrder'],
        },
      ],
      transportFactory: (connection) => {
        const pair = InMemoryTransport.createLinkedPair();
        remoteServers[connection.tenant].connect(pair[1]);
        return pair[0];
      },
    });

    const registry = createToolRegistry({ logger: silent });
    const { registered, skipped } = await registerExternalMcpTools({ toolRegistry: registry, hub, logger: silent });

    // Nenhuma tool descartada por duplicidade: ambas registradas.
    expect(skipped.filter((s) => s.reason === 'register_failed')).toEqual([]);
    expect(registered).toHaveLength(2);

    const tokenA = externalMcpTenantToken('tenant-a');
    const tokenB = externalMcpTenantToken('tenant-b');
    expect(tokenA).not.toBe(tokenB);
    const toolA = `mcp.t${tokenA}.erp.legacy.createOrder`;
    const toolB = `mcp.t${tokenB}.erp.legacy.createOrder`;
    expect(registered).toEqual(expect.arrayContaining([toolA, toolB]));
    // Ids expostos não vazam o tenantId.
    expect(toolA).not.toContain('tenant-a');
    expect(toolB).not.toContain('tenant-b');

    // Execução no tenant correto atinge o remoto correto.
    const resultA = await registry.execute(toolA, { sku: 'X' }, {
      tenantId: 'tenant-a',
      actor: { classification: 'PRODUCTION', permissions: [`mcp.t${tokenA}.erp`] },
      idempotencyKey: 'k1',
      confirmed: true,
    });
    expect(resultA.success).toBe(true);
    expect(resultA.output.text).toContain('ord-A');

    // Cross-tenant sem a permissão escopada → negado no registry.
    await expect(registry.execute(toolB, { sku: 'X' }, {
      tenantId: 'tenant-a',
      actor: { classification: 'PRODUCTION', permissions: [`mcp.t${tokenA}.erp`] },
      idempotencyKey: 'k2',
    })).rejects.toThrow('cognitive_tool_permission_denied');

    // Mesmo com '*', a tool de B recusa contexto do tenant A (fail closed).
    await expect(registry.execute(toolB, { sku: 'X' }, {
      tenantId: 'tenant-a',
      actor: { classification: 'PRODUCTION', permissions: ['*'] },
      idempotencyKey: 'k3',
      confirmed: true,
    })).rejects.toThrow('mcp_connection_tenant_mismatch');

    await remoteServers['tenant-a'].close();
    await remoteServers['tenant-b'].close();
  });
});
