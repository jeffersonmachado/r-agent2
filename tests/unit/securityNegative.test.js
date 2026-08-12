'use strict';

/**
 * Security Negative Tests — tentativas de quebrar a arquitetura.
 *
 * Cada teste tenta uma violação e espera DENY explícito.
 * Nenhum bypass deve ser possível por nenhum caminho:
 * Planner, MCP Server, MCP Client, Process Runtime, API direta.
 */

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { createToolRegistry, registerDefaultTools } = require('../../src/core/cognitive/tool-registry');
const { createAgentSupervisor } = require('../../src/core/cognitive/agent-supervisor');
const { createCapabilityRegistry } = require('../../src/core/cognitive/capability-registry');
const { buildMcpExecutionContext, stripTenantOverride } = require('../../src/core/mcp/auth');
const { createMcpServerAdapter } = require('../../src/core/mcp/server-adapter');
const { createMcpClientHub } = require('../../src/core/mcp/client-hub');
const { canAccess } = require('../../src/core/cognitive/visibility');
const { getOutcomeContract, validateBusinessOutcome } = require('../../src/core/cognitive/outcome');

const silent = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

describe('Security — Classification Isolation', () => {
  test('PRODUCTION cannot access DEVELOPMENT tools', () => {
    const registry = createToolRegistry({ logger: silent });
    registry.register({
      id: 'qa.runWave',
      visibility: 'DEVELOPMENT',
      permissions: [],
      description: 'QA wave execution',
      execute: async () => ({}),
    });

    const prodList = registry.list({ classification: 'PRODUCTION' });
    expect(prodList.find((t) => t.id === 'qa.runWave')).toBeUndefined();

    const devList = registry.list({ classification: 'DEVELOPMENT' });
    expect(devList.find((t) => t.id === 'qa.runWave')).toBeDefined();
  });

  test('PRODUCTION cannot execute SUPPORT tools', async () => {
    const registry = createToolRegistry({ logger: silent });
    registry.register({
      id: 'support.diagnose',
      visibility: 'SUPPORT',
      permissions: [],
      description: 'diagnostic tool',
      execute: async () => ({}),
    });

    await expect(registry.execute('support.diagnose', {}, {
      tenantId: 't1',
      actor: { classification: 'PRODUCTION', permissions: ['*'] },
    })).rejects.toThrow('cognitive_tool_visibility_denied');
  });

  test('SUPPORT cannot access DEVELOPMENT tools', () => {
    const registry = createToolRegistry({ logger: silent });
    registry.register({
      id: 'qa.waves.regression',
      visibility: 'DEVELOPMENT',
      permissions: [],
      description: 'regression test',
      execute: async () => ({}),
    });

    const supportList = registry.list({ classification: 'SUPPORT' });
    expect(supportList.find((t) => t.id === 'qa.waves.regression')).toBeUndefined();
  });

  test('DEVELOPMENT can access all visibility levels', () => {
    const registry = createToolRegistry({ logger: silent });
    for (const vis of ['PRODUCTION', 'SUPPORT', 'DEVELOPMENT']) {
      registry.register({
        id: `tool.${vis.toLowerCase()}`,
        visibility: vis,
        permissions: [],
        description: `tool for ${vis}`,
        execute: async () => ({}),
      });
    }
    const devList = registry.list({ classification: 'DEVELOPMENT' });
    expect(devList.length).toBe(3);
  });
});

describe('Security — Tenant Isolation', () => {
  test('Tool Registry enforces tenant in execution', async () => {
    const registry = createToolRegistry({ logger: silent });
    registry.register({
      id: 'crm.read',
      visibility: 'PRODUCTION',
      permissions: [],
      description: 'read CRM',
      execute: async (input, ctx) => ({ tenantId: ctx.tenantId }),
    });

    // Sem tenant → erro.
    await expect(registry.execute('crm.read', {}, {
      actor: { classification: 'PRODUCTION', permissions: ['*'] },
    })).rejects.toThrow('cognitive_tool_tenant_required');
  });

  test('Agent Supervisor filters by tenant', async () => {
    const supervisor = createAgentSupervisor({
      logger: silent,
      capabilityRegistry: createCapabilityRegistry(),
      agentDirectory: {
        listActiveAgents: jest.fn(async ({ tenantId }) => [
          // Retorna agente de outro tenant maliciosamente
          { id: 'bad', slug: 'crm-agent', tenant_id: 'tenant-b', lifecycle: 'active', classification: 'PRODUCTION', capabilities: ['crm.read'] },
        ]),
      },
    });

    const decision = await supervisor.route({
      intent: 'criar_lead',
      tenantId: 'tenant-a',
      actor: { classification: 'PRODUCTION', permissions: ['*'] },
    });

    // P0: Agente de outro tenant NUNCA pode ser roteado.
    expect(decision.status).toBe('no_specialist');
  });
});

describe('Security — MCP Authorization', () => {
  test('MCP context requires tenant, principal, classification', () => {
    expect(() => buildMcpExecutionContext({})).toThrow('tenant_required');
    expect(() => buildMcpExecutionContext({ tenantId: 't1' })).toThrow('principal_required');
    expect(() => buildMcpExecutionContext({ tenantId: 't1', principalId: 'p1' })).toThrow('classification_required');
  });

  test('MCP rejects tenant override via input payload', () => {
    // P0: Tentar trocar tenant via input.
    expect(() => stripTenantOverride({ tenantId: 'evil-tenant', data: 'x' })).toThrow('mcp_tenant_override_forbidden');
    expect(() => stripTenantOverride({ tenant_key: 'evil', data: 'x' })).toThrow('mcp_tenant_override_forbidden');
    expect(() => stripTenantOverride({ _meta: { tenantId: 'evil' }, data: 'x' })).toThrow('mcp_tenant_override_forbidden');

    // Input limpo deve passar.
    const clean = stripTenantOverride({ data: 'x', _meta: { correlationId: 'c1' } });
    expect(clean.data).toBe('x');
    expect(clean._meta.correlationId).toBe('c1');
  });

  test('MCP server lists only tools visible to principal', () => {
    const registry = createToolRegistry({ logger: silent });
    registry.register({
      id: 'prod.tool', visibility: 'PRODUCTION', permissions: [], description: 'prod',
      execute: async () => ({}),
    });
    registry.register({
      id: 'dev.tool', visibility: 'DEVELOPMENT', permissions: [], description: 'dev',
      execute: async () => ({}),
    });

    const adapter = createMcpServerAdapter({ toolRegistry: registry, logger: silent });
    const prodTools = adapter.listToolsForPrincipal({
      tenantId: 't1', principalId: 'u1', classification: 'PRODUCTION',
    });
    expect(prodTools.find((t) => t.name === 'dev.tool')).toBeUndefined();
    expect(prodTools.find((t) => t.name === 'prod.tool')).toBeDefined();
  });

  test('MCP direct execution blocked for unauthorized tool', async () => {
    const registry = createToolRegistry({ logger: silent });
    registry.register({
      id: 'secret.tool', visibility: 'DEVELOPMENT', permissions: ['secret.permission'],
      description: 'secret', execute: async () => ({ leaked: true }),
    });

    await expect(registry.execute('secret.tool', {}, {
      tenantId: 't1',
      actor: { classification: 'PRODUCTION', permissions: ['*'] },
    })).rejects.toThrow('cognitive_tool_visibility_denied');
  });
});

describe('Security — Confirmation Policy (cannot bypass)', () => {
  test('Tool with confirmation_required cannot be executed without confirmation', async () => {
    const registry = createToolRegistry({ logger: silent });
    registry.register({
      id: 'billing.charge',
      visibility: 'PRODUCTION',
      permissions: [],
      description: 'charge',
      riskLevel: 'high',
      sideEffects: true,
      confirmationPolicy: 'confirmation_required',
      execute: async () => ({ charged: true }),
    });

    // Sem confirmed → rejeitado.
    await expect(registry.execute('billing.charge', { amount: 100 }, {
      tenantId: 't1',
      actor: { classification: 'PRODUCTION', permissions: ['*'] },
    })).rejects.toThrow('cognitive_tool_confirmation_required');

    // Com confirmed → executado.
    const result = await registry.execute('billing.charge', { amount: 100 }, {
      tenantId: 't1',
      actor: { classification: 'PRODUCTION', permissions: ['*'] },
      confirmed: true,
    });
    expect(result.success).toBe(true);
  });
});

describe('Security — Outcome Contracts', () => {
  test('schedule.create requires appointment.id evidence', () => {
    const contract = getOutcomeContract('agendar');
    expect(contract).toBeDefined();
    expect(contract.requiredAction).toBe('createAppointment');
    expect(contract.requiredEvidence).toContain('appointment.id');
  });

  test('Execution without required action fails outcome validation', () => {
    const result = validateBusinessOutcome({
      intent: 'agendar',
      execution: {
        status: 'completed',
        steps: [{ id: 'find_customer', output: { customerId: 'c1' } }],
        toolsExecuted: ['searchCustomer'],
      },
    });
    expect(result.valid).toBe(false);
    expect(result.failures).toContain('required_action_not_executed: createAppointment');
    expect(result.outcome).toBe('outcome_not_achieved');
  });

  test('Execution with required action and evidence passes outcome validation', () => {
    const result = validateBusinessOutcome({
      intent: 'agendar',
      execution: {
        status: 'completed',
        steps: [
          { id: 'find_customer', output: { customerId: 'c1' } },
          { id: 'create_appointment', status: 'executed', output: { appointment: { id: 'apt-123' } } },
        ],
        toolsExecuted: ['searchCustomer', 'createAppointment'],
      },
    });
    expect(result.valid).toBe(true);
    expect(result.outcome).toBe('appointment_created');
    expect(result.evidence['appointment.id']).toBe('apt-123');
  });
});

describe('Security — Idempotency Enforcement', () => {
  test('Side effect tool with required idempotency rejects missing key', async () => {
    const registry = createToolRegistry({ logger: silent });
    registry.register({
      id: 'payment.process',
      visibility: 'PRODUCTION',
      permissions: [],
      description: 'process payment',
      sideEffects: true,
      idempotencyPolicy: 'required',
      execute: async () => ({ processed: true }),
    });

    await expect(registry.execute('payment.process', { amount: 100 }, {
      tenantId: 't1',
      actor: { classification: 'PRODUCTION', permissions: ['*'] },
      confirmed: true,
      // Sem idempotencyKey.
    })).rejects.toThrow('cognitive_tool_idempotency_key_required');

    // Com idempotencyKey → executado.
    const result = await registry.execute('payment.process', { amount: 100 }, {
      tenantId: 't1',
      actor: { classification: 'PRODUCTION', permissions: ['*'] },
      confirmed: true,
      idempotencyKey: 'idem-123',
    });
    expect(result.success).toBe(true);
  });
});

describe('Security — MCP Client Hub Multi-tenant', () => {
  test('Dois tenants podem registrar conexão com mesmo nome', () => {
    const hub = createMcpClientHub({
      logger: silent,
      connections: [
        { tenant: 'tenant-a', name: 'erp', endpoint: 'https://erp.a.example.com', enabled: true, classification: 'PRODUCTION' },
        { tenant: 'tenant-b', name: 'erp', endpoint: 'https://erp.b.example.com', enabled: true, classification: 'PRODUCTION' },
      ],
    });
    // Ambas coexistem — chave composta tenantId:name.
    expect(hub.size()).toBe(2);
    const connA = hub.getConnection('erp', { tenantId: 'tenant-a' });
    const connB = hub.getConnection('erp', { tenantId: 'tenant-b' });
    expect(connA).toBeDefined();
    expect(connB).toBeDefined();
    expect(connA.endpoint).not.toBe(connB.endpoint);
  });

  test('Tenant A cannot use Tenant B connection', async () => {
    const hub = createMcpClientHub({
      logger: silent,
      connections: [
        { tenant: 'tenant-b', name: 'erp', endpoint: 'https://erp.b.example.com', enabled: true, classification: 'PRODUCTION' },
      ],
    });
    await expect(hub.connect('erp', { tenantId: 'tenant-a' }))
      .rejects.toThrow('mcp_connection_tenant_mismatch');
  });
});
