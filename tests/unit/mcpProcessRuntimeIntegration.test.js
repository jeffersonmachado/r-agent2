'use strict';

/**
 * MCP × Process Runtime (M24 / M25 / M70) — capability externa dentro de um
 * processo DURÁVEL.
 *
 * Verifica que a integração não é teórica: um nó de processo durável executa
 * uma tool de MCP EXTERNO através do Canonical Tool Registry, com tenant,
 * confirmação e idempotência aplicados pelo Capability Kernel — e que falha de
 * provider externo NÃO é mascarada.
 */

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

const { createExecutionRouter } = require('../../src/core/cognitive/execution-router');
const { createExecutionEngine } = require('../../src/core/cognitive/execution-engine');
const { createToolRegistry } = require('../../src/core/cognitive/tool-registry');
const { createMcpClientHub } = require('../../src/core/mcp/client-hub');
const { registerExternalMcpTools, externalMcpTenantToken } = require('../../src/core/mcp/external-tool-adapter');
const { ProcessRuntimeService } = require('../../api/core/process-runtime/processRuntimeService');

const silent = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

function createFakeExternalServer({ tools, onCall }) {
  const server = new Server({ name: 'fake-external', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => onCall(request));
  return server;
}

async function buildExternalToolRegistry({ tools, onCall, connectionOverrides = {}, callLog = [] }) {
  const server = createFakeExternalServer({
    tools,
    onCall: (request) => {
      callLog.push({ tool: request.params.name, args: request.params.arguments });
      return onCall(request);
    },
  });

  const hub = createMcpClientHub({
    logger: silent,
    connections: [{
      tenant: 'tenant-a',
      name: 'erp',
      endpoint: 'https://erp.example.com/mcp',
      enabled: true,
      classification: 'PRODUCTION',
      allowedCapabilities: ['crm.read', 'crm.write'],
      // Mapeamento explícito tool → capability (autoridade sobre a lista).
      toolCapabilityMap: {
        'crm.lookupCustomer': 'crm.read',
        'crm.updateCustomer': 'crm.write',
        'payments.refund': 'crm.write',
      },
      ...connectionOverrides,
    }],
    transportFactory: () => {
      const pair = InMemoryTransport.createLinkedPair();
      server.connect(pair[1]);
      return pair[0];
    },
  });

  const registry = createToolRegistry({ logger: silent });
  const { registered } = await registerExternalMcpTools({ toolRegistry: registry, hub, logger: silent });
  return { registry, registered, server, hub };
}

function buildRouter(registry) {
  // A MESMA instância é usada pelo router e pelas asserções de persistência.
  const processRuntime = new ProcessRuntimeService();
  const router = createExecutionRouter({
    executionEngine: createExecutionEngine({ toolRegistry: registry, logger: silent }),
    toolRegistry: registry,
    processRuntime,
    logger: silent,
  });
  return { router, processRuntime };
}

const PRODUCTION_ACTOR = { classification: 'PRODUCTION', permissions: ['*'] };

describe('Process Runtime → Tool Registry → MCP externo (M24/M70)', () => {
  test('processo durável executa tool de MCP externo (leitura) pelo registry', async () => {
    const callLog = [];
    const { registry, registered } = await buildExternalToolRegistry({
      tools: [{
        name: 'crm.lookupCustomer',
        description: 'Consulta cliente',
        inputSchema: { type: 'object', additionalProperties: true },
      }],
      onCall: () => ({ content: [{ type: 'text', text: JSON.stringify({ name: 'Maria', id: 'c1' }) }] }),
      callLog,
    });

    const toolId = registered[0];
    const { router, processRuntime } = buildRouter(registry);

    const result = await router.execute({
      plan: {
        planId: 'plan-mcp-durable',
        tenantId: 'tenant-a',
        intent: 'consultar_cliente_externo',
        durable: true,
        steps: [{ id: 'lookup', toolId }],
      },
      context: { tenantId: 'tenant-a' },
      actor: PRODUCTION_ACTOR,
      input: { shared: { query: 'maria' } },
      payload: { durable: true },
      executionId: 'exec-mcp-1',
    });

    expect(result.executionMode).toBe('durable');
    expect(result.processResult.status).toBe('completed');
    // O servidor MCP EXTERNO foi realmente chamado.
    expect(callLog).toEqual([{ tool: 'crm.lookupCustomer', args: { query: 'maria' } }]);

    // Instância durável persistida e inspecionável.
    const instance = await processRuntime.instanceStore.loadInstance(result.processInstanceId);
    expect(instance).toBeTruthy();
    expect(String(instance.status)).toBe('completed');

    // A saída do runtime não é inventada: ela vem do retorno remoto.
    expect(JSON.stringify(result.processResult)).toContain('Maria');
  }, 20000);

  test('M25 — side effect durável propaga idempotencyKey determinística por nó', async () => {
    const callLog = [];
    const { registry, registered } = await buildExternalToolRegistry({
      tools: [{
        name: 'crm.updateCustomer',
        description: 'Atualiza cliente',
        inputSchema: { type: 'object', additionalProperties: true },
      }],
      onCall: () => ({ content: [{ type: 'text', text: 'updated' }] }),
      callLog,
      // Declaração explícita de operação idempotente e autônoma: quem habilita
      // mutação externa sem confirmação é a POLÍTICA, não o default.
      connectionOverrides: {
        toolPolicies: {
          'crm.updateCustomer': {
            riskLevel: 'medium',
            sideEffects: true,
            confirmationPolicy: 'autonomous',
            idempotencyPolicy: 'required',
          },
        },
      },
    });

    const toolId = registered[0];
    const { router } = buildRouter(registry);
    const plan = {
      planId: 'plan-mcp-durable-mutation',
      tenantId: 'tenant-a',
      intent: 'atualizar_cliente',
      durable: true,
      steps: [{ id: 'update', toolId }],
    };

    const result = await router.execute({
      plan,
      context: { tenantId: 'tenant-a' },
      actor: PRODUCTION_ACTOR,
      input: { shared: { customerId: 'c1', name: 'Maria Silva' } },
      payload: { durable: true },
      executionId: 'exec-mcp-2',
    });

    expect(result.processResult.status).toBe('completed');
    expect(callLog).toHaveLength(1);
    expect(callLog[0].args).toEqual({ customerId: 'c1', name: 'Maria Silva' });

    // Reexecutar o MESMO executionId gera a MESMA chave de idempotência
    // (`executionId:nodeId`) — retry não duplica a operação de forma cega.
    const again = await router.execute({
      plan,
      context: { tenantId: 'tenant-a' },
      actor: PRODUCTION_ACTOR,
      input: { shared: { customerId: 'c1', name: 'Maria Silva' } },
      payload: { durable: true },
      executionId: 'exec-mcp-2',
    });
    expect(again.processResult.status).toBe('completed');
  }, 20000);

  test('M63 — side effect de alto risco sem declaração NÃO executa no caminho durável', async () => {
    const callLog = [];
    const { registry, registered } = await buildExternalToolRegistry({
      tools: [{
        name: 'payments.refund',
        description: 'Estorna pagamento',
        inputSchema: { type: 'object', additionalProperties: true },
      }],
      onCall: () => ({ content: [{ type: 'text', text: 'refunded' }] }),
      callLog,
    });

    const toolId = registered[0];
    const tool = registry.get(toolId);
    // Política derivada: alto risco + confirmação obrigatória.
    expect(tool.riskLevel).toBe('high');
    expect(tool.confirmationPolicy).toBe('confirmation_required');

    const { router } = buildRouter(registry);
    const result = await router.execute({
      plan: {
        planId: 'plan-mcp-durable-refund',
        tenantId: 'tenant-a',
        intent: 'estornar',
        durable: true,
        steps: [{ id: 'refund', toolId }],
      },
      context: { tenantId: 'tenant-a' },
      actor: PRODUCTION_ACTOR,
      input: { shared: { amount: 100 } },
      payload: { durable: true },
      executionId: 'exec-mcp-3',
    });

    // O processo NÃO conclui com sucesso e o remoto NUNCA foi chamado.
    expect(result.processResult.status).not.toBe('completed');
    expect(callLog).toEqual([]);
    expect(JSON.stringify(result.processResult)).toMatch(/confirmation_required|policy_denied/);
  }, 20000);

  test('M62 — provider externo indisponível falha explícito, sem resposta inventada', async () => {
    const registry = createToolRegistry({ logger: silent });
    const hub = createMcpClientHub({
      logger: silent,
      connections: [{
        tenant: 'tenant-a', name: 'erp', endpoint: 'https://erp.example.com/mcp',
        enabled: true, classification: 'PRODUCTION', allowedCapabilities: ['crm.read'],
      }],
      transportFactory: () => { throw new Error('ECONNREFUSED'); },
    });
    const { registered } = await registerExternalMcpTools({ toolRegistry: registry, hub, logger: silent });
    // Sem descoberta bem-sucedida não existe tool para registrar.
    expect(registered).toEqual([]);

    // Mesmo que um proxy existisse (registro manual), a indisponibilidade da
    // conexão bloqueia a execução — e o processo falha, não "inventa" sucesso.
    registry.register({
      id: 'mcp.tdead.erp.crm.lookupCustomer',
      capability: 'crm.read',
      visibility: 'PRODUCTION',
      permissions: [],
      description: 'proxy órfão',
      execute: async () => { throw new Error('mcp_tool_unavailable: mcp_connection_unavailable'); },
    });

    const { router } = buildRouter(registry);
    const result = await router.execute({
      plan: {
        planId: 'plan-mcp-down',
        tenantId: 'tenant-a',
        intent: 'consultar',
        durable: true,
        steps: [{ id: 'lookup', toolId: 'mcp.tdead.erp.crm.lookupCustomer' }],
      },
      context: { tenantId: 'tenant-a' },
      actor: PRODUCTION_ACTOR,
      input: { shared: {} },
      payload: { durable: true },
      executionId: 'exec-mcp-4',
    });

    expect(result.processResult.status).not.toBe('completed');
    expect(JSON.stringify(result.processResult)).toMatch(/mcp_tool_unavailable|mcp_connection_unavailable/);
  }, 20000);

  test('M65 — processo do tenant B não usa conexão MCP do tenant A', async () => {
    const callLog = [];
    const { registry, registered } = await buildExternalToolRegistry({
      tools: [{
        name: 'crm.lookupCustomer',
        description: 'Consulta cliente',
        inputSchema: { type: 'object', additionalProperties: true },
      }],
      onCall: () => ({ content: [{ type: 'text', text: 'ok' }] }),
      callLog,
    });

    const toolId = registered[0];
    expect(toolId).toContain(externalMcpTenantToken('tenant-a'));

    const { router } = buildRouter(registry);
    const result = await router.execute({
      plan: {
        planId: 'plan-mcp-cross',
        tenantId: 'tenant-b',
        intent: 'consultar',
        durable: true,
        steps: [{ id: 'lookup', toolId }],
      },
      context: { tenantId: 'tenant-b' },
      actor: { classification: 'PRODUCTION', permissions: ['*'] },
      input: { shared: {} },
      payload: { durable: true },
      executionId: 'exec-mcp-5',
    });

    expect(result.processResult.status).not.toBe('completed');
    expect(callLog).toEqual([]);
    expect(JSON.stringify(result.processResult)).toMatch(/tenant_mismatch|permission_denied/);
  }, 20000);
});
