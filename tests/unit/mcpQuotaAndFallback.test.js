'use strict';

/**
 * MCP Quota (M49) + política de fallback de provider (M52).
 */

const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');

const {
  QUOTA_SCOPES,
  QUOTA_REASONS,
  normalizeQuotaConfig,
  scopeKey,
  createMcpQuota,
} = require('../../src/core/mcp/quota');
const { createMcpClientHub } = require('../../src/core/mcp/client-hub');
const { createMcpToolLifecycle } = require('../../src/core/mcp/tool-lifecycle');
const { createToolRegistry } = require('../../src/core/cognitive/tool-registry');
const {
  resolveProvider,
  selectProvider,
} = require('../../src/core/mcp/capability-resolution');

const silent = { info() {}, warn() {}, error() {}, debug() {} };

describe('MCP quota — janela deslizante por escopo', () => {
  test('normaliza número e objeto, ignorando limites inválidos', () => {
    const normalized = normalizeQuotaConfig({ windowMs: 1000, tenant: 5, tool: { limit: 2, windowMs: 500 }, connection: 0 });
    expect(normalized.limits.tenant).toEqual({ limit: 5, windowMs: 1000 });
    expect(normalized.limits.tool).toEqual({ limit: 2, windowMs: 500 });
    expect(normalized.limits.connection).toBeUndefined();
  });

  test('escopos têm chaves distintas e estáveis', () => {
    expect(scopeKey(QUOTA_SCOPES.TENANT, { tenantId: 't1' })).toBe('tenant:t1');
    expect(scopeKey(QUOTA_SCOPES.CONNECTION, { tenantId: 't1', connection: 'erp' })).toBe('connection:t1:erp');
    expect(scopeKey(QUOTA_SCOPES.TOOL, { tenantId: 't1', connection: 'erp', tool: 'x' })).toBe('tool:t1:erp:x');
  });

  test('limite de tool bloqueia na N+1 e libera após a janela', () => {
    let current = 1_000_000;
    const quota = createMcpQuota({ now: () => current });
    quota.configure({ tool: { limit: 2, windowMs: 60000 } });

    const ctx = { tenantId: 't1', connection: 'erp', tool: 'crm.read' };
    expect(quota.acquire(ctx).allowed).toBe(true);
    expect(quota.acquire(ctx).allowed).toBe(true);

    const denied = quota.acquire(ctx);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe(QUOTA_REASONS.EXCEEDED);
    expect(denied.violatedScope).toBe(QUOTA_SCOPES.TOOL);
    expect(denied.retryAfterMs).toBe(60000);

    // Outra tool da MESMA conexão não é afetada (escopo por tool).
    expect(quota.acquire({ ...ctx, tool: 'crm.write' }).allowed).toBe(true);

    current += 60001;
    expect(quota.acquire(ctx).allowed).toBe(true);
  });

  test('escopo de conexão limita tools diferentes da mesma conexão', () => {
    const quota = createMcpQuota({ now: () => 1_000_000 });
    quota.configure({ connection: 1 });
    expect(quota.acquire({ tenantId: 't1', connection: 'erp', tool: 'a' }).allowed).toBe(true);
    const denied = quota.acquire({ tenantId: 't1', connection: 'erp', tool: 'b' });
    expect(denied.allowed).toBe(false);
    expect(denied.violatedScope).toBe(QUOTA_SCOPES.CONNECTION);
  });

  test('escopo de tenant isola tenants', () => {
    const quota = createMcpQuota({ now: () => 1_000_000 });
    quota.configure({ tenant: 1 });
    expect(quota.acquire({ tenantId: 't1' }).allowed).toBe(true);
    expect(quota.acquire({ tenantId: 't1' }).allowed).toBe(false);
    expect(quota.acquire({ tenantId: 't2' }).allowed).toBe(true);
  });

  test('negação é tudo-ou-nada: nenhum escopo é consumido quando um estoura', () => {
    const quota = createMcpQuota({ now: () => 1_000_000 });
    quota.configure({ tenant: 10, tool: 1 });
    const ctx = { tenantId: 't1', connection: 'erp', tool: 'x' };
    expect(quota.acquire(ctx).allowed).toBe(true);
    expect(quota.acquire(ctx).allowed).toBe(false);

    // A tentativa NEGADA não consumiu o escopo de tenant (que tinha folga).
    const snapshot = quota.snapshot({ tenantId: 't1' });
    expect(snapshot.find((s) => s.key === 'tenant:t1').used).toBe(1);
    expect(snapshot.find((s) => s.key === 'tool:t1:erp:x').used).toBe(1);

    // `release` devolve a cota dos escopos configurados.
    quota.release(ctx);
    const afterRelease = quota.snapshot({ tenantId: 't1' });
    expect(afterRelease.find((s) => s.key === 'tenant:t1').used).toBe(0);
    expect(afterRelease.find((s) => s.key === 'tool:t1:erp:x').used).toBe(0);
  });

  test('release devolve a cota consumida', () => {
    const quota = createMcpQuota({ now: () => 1_000_000 });
    quota.configure({ connection: 1 });
    const ctx = { tenantId: 't1', connection: 'erp', tool: 'x' };
    expect(quota.acquire(ctx).allowed).toBe(true);
    expect(quota.acquire(ctx).allowed).toBe(false);
    quota.release(ctx);
    expect(quota.acquire(ctx).allowed).toBe(true);
  });

  test('sem tenant o uso é recusado explicitamente', () => {
    const quota = createMcpQuota({ now: () => 1_000_000 });
    quota.configure({ tenant: 1 });
    expect(() => quota.acquire({})).toThrow('mcp_quota_tenant_required');
  });

  test('sem quota configurada nada é bloqueado', () => {
    const quota = createMcpQuota({ now: () => 1_000_000 });
    for (let i = 0; i < 50; i += 1) {
      expect(quota.acquire({ tenantId: 't1', connection: 'erp', tool: 'x' }).allowed).toBe(true);
    }
  });
});

describe('MCP quota — enforcement no hub', () => {
  function buildHubWithQuota({ quotaConfig, networkCalls }) {
    const lifecycle = createMcpToolLifecycle({ logger: silent });
    // Cliente stub: o teste mede se a chamada CHEGA à rede — um stub registra
    // exatamente isso sem depender de um servidor remoto vivo.
    const clientFactory = () => ({
      connect: async () => {},
      listTools: async () => ({ tools: [] }),
      callTool: async () => {
        networkCalls.push(1);
        return { content: [{ type: 'text', text: 'ok' }] };
      },
      close: async () => {},
    });

    const hub = createMcpClientHub({
      logger: silent,
      connections: [{
        tenant: 'tenant-a', name: 'erp', endpoint: 'https://erp.example.com/mcp',
        enabled: true, classification: 'PRODUCTION', allowedCapabilities: ['crm.read'],
        quota: quotaConfig,
      }],
      lifecycle,
      clientFactory,
    });
    // Descoberta: a tool precisa existir e estar validada para ser executável.
    lifecycle.applyDiscovery('tenant-a:erp', {
      remoteTools: [{ name: 'crm.lookupCustomer', inputSchema: { type: 'object' } }],
    });
    lifecycle.validateTool('tenant-a:erp', 'crm.lookupCustomer');
    return hub;
  }

  test('chamada acima da quota local falha ANTES de ir à rede', async () => {
    const networkCalls = [];
    const hub = buildHubWithQuota({ quotaConfig: { tool: 1 }, networkCalls });

    const first = await hub.callTool('erp', 'crm.lookupCustomer', {}, { tenantId: 'tenant-a' });
    expect(first.content[0].text).toBe('ok');
    expect(networkCalls).toHaveLength(1);

    let quotaError = null;
    try {
      await hub.callTool('erp', 'crm.lookupCustomer', {}, { tenantId: 'tenant-a' });
    } catch (error) {
      quotaError = error;
    }
    expect(quotaError).toBeTruthy();
    expect(quotaError.message).toMatch(/mcp_quota_exceeded/);
    expect(quotaError.code).toBe(QUOTA_REASONS.EXCEEDED);
    expect(quotaError.violatedScope).toBe(QUOTA_SCOPES.TOOL);
    // A chamada negada NÃO chegou à rede.
    expect(networkCalls).toHaveLength(1);
  });

  test('quota exposta no hub para observabilidade', () => {
    const hub = buildHubWithQuota({ quotaConfig: { tenant: 3 }, networkCalls: [] });
    expect(hub.quota.acquire({ tenantId: 'tenant-a' }).allowed).toBe(true);
    expect(hub.quota.snapshot({ tenantId: 'tenant-a' })[0]).toEqual(expect.objectContaining({
      key: 'tenant:tenant-a', limit: 3, used: 1,
    }));
  });
});

describe('MCP provider fallback — política explícita (M52)', () => {
  const readTool = (id, provider) => ({
    id, capability: 'crm.read', visibility: 'PRODUCTION', permissions: [], description: id,
    metadata: Object.freeze({ provider }), execute: async () => ({}),
  });
  const mutatingTool = (id, provider) => ({
    id, capability: 'billing.write', visibility: 'PRODUCTION', permissions: [], description: id,
    sideEffects: true, metadata: Object.freeze({ provider }), execute: async () => ({}),
  });

  function registryWith(tools) {
    const registry = createToolRegistry({ logger: silent });
    for (const tool of tools) registry.register(tool);
    return registry;
  }

  test('nativo presente → sem fallback', () => {
    const registry = registryWith([readTool('askai.crm.read', 'native'), readTool('mcp.tx.erp.crm', 'external')]);
    const selection = resolveProvider({ registry, capability: 'crm.read', actor: { classification: 'PRODUCTION', permissions: ['*'] } });
    expect(selection.provider.id).toBe('askai.crm.read');
    expect(selection.fallbackUsed).toBe(false);
    expect(selection.semanticSafety).toBe('primary_provider');
  });

  test('leitura sem nativo → fallback externo SEGURO e explícito', () => {
    const registry = registryWith([readTool('mcp.tx.erp.crm', 'external')]);
    const selection = resolveProvider({ registry, capability: 'crm.read', actor: { classification: 'PRODUCTION', permissions: ['*'] } });
    expect(selection.fallbackUsed).toBe(true);
    expect(selection.semanticSafety).toBe('safe_read_only_fallback');
  });

  test('mutação sem nativo → fallback PROIBIDO (pode duplicar operação)', () => {
    const registry = registryWith([mutatingTool('mcp.tx.erp.charge', 'external')]);
    const selection = resolveProvider({ registry, capability: 'billing.write', actor: { classification: 'PRODUCTION', permissions: ['*'] } });
    expect(selection.provider).toBeNull();
    expect(selection.reason).toBe('side_effect_provider_fallback_not_safe');
    expect(selection.fallbackUsed).toBe(false);
    expect(selection.semanticSafety).toBe('unsafe_requires_explicit_policy');
  });

  test('mutação com opt-in explícito de política é permitida e declarada', () => {
    const registry = registryWith([mutatingTool('mcp.tx.erp.charge', 'external')]);
    const selection = resolveProvider({
      registry, capability: 'billing.write', actor: { classification: 'PRODUCTION', permissions: ['*'] },
      options: { allowSideEffectFallback: true },
    });
    expect(selection.provider.id).toBe('mcp.tx.erp.charge');
    expect(selection.reason).toBe('side_effect_fallback_allowed_by_policy');
    expect(selection.semanticSafety).toBe('unsafe_allowed_by_explicit_policy');
  });

  test('sem candidato a razão é explícita', () => {
    expect(selectProvider([])).toEqual({
      provider: null, reason: 'no_provider_available', fallbackUsed: false, semanticSafety: 'no_candidate',
    });
  });
});
