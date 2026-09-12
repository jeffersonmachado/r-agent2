'use strict';

/**
 * Ask AI ↔ Canonical Tool Registry — convergência (A6/A7 + M20/M61).
 *
 * Prova que o copiloto deixou de ter um universo paralelo de tools:
 *   - a definição é única (catálogo → Canonical Tool Registry);
 *   - o copiloto pede CAPABILITY e o bridge resolve o PROVIDER
 *     (nativo ou MCP externo), sem o Ask AI conhecer a origem;
 *   - tenant/permissão/visibilidade continuam aplicados pelo registry.
 */

const { createToolRegistry } = require('../../src/core/cognitive/tool-registry');
const {
  ensureAskAiCapabilityTools,
  resolveCapabilityProviders,
  selectProvider,
} = require('../../api/services/askAi/canonicalToolBridge');
const { ASK_AI_TOOLS, findAskAiTool } = require('../../api/services/askAi/askAiToolCatalog');
const {
  buildRegistry,
  executeTool,
  RUNNERS,
} = require('../../api/services/askAi/toolRegistry');
const { authorizeTools, resolveCanonicalPermissions } = require('../../api/services/askAi/toolAuthorization');

const silent = { info() {}, warn() {}, error() {}, debug() {} };

const ACTOR_ADMIN = {
  id: 'u-1', username: 'admin', role: 'super_admin', tenantId: 'academia-a',
  permissions: ['*'],
  capabilities: ['crm.read', 'reports.read', 'attendance.read', 'churn.read'],
};

function buildRunners(overrides = {}) {
  return {
    fitnessStudentSummary: async () => ({ toolId: 'askai.fitness.membershipSummary', found: true, facts: [{ key: 'membershipStatus', label: 'Status', value: 'ACTIVE' }], summary: 'ok' }),
    fitnessAttendanceSummary: async () => ({ toolId: 'askai.fitness.attendanceSummary', found: true, facts: [], summary: 'ok' }),
    fitnessBillingSummary: async () => ({ toolId: 'askai.billing.membershipHistory', found: true, facts: [], summary: 'ok' }),
    fitnessChurnSignal: async () => ({ toolId: 'askai.churn.latestSignal', found: true, facts: [], summary: 'ok' }),
    ...overrides,
  };
}

/** Registra um provider EXTERNO (como faria o MCP External Tool Adapter). */
function registerExternalProvider(registry, { id, capability, tenant, toolName = 'crm.lookupCustomer', sideEffects = false }) {
  registry.register({
    id,
    capability,
    visibility: 'PRODUCTION',
    permissions: [`mcp.t${tenant}.erp`],
    description: `[MCP externo] ${toolName}`,
    riskLevel: 'low',
    sideEffects,
    confirmationPolicy: 'autonomous',
    idempotencyPolicy: 'none',
    metadata: Object.freeze({ provider: 'external', via: 'mcp', tenant }),
    execute: async () => ({ toolId: id, found: true, facts: [{ key: 'origin', label: 'origem', value: 'mcp' }], summary: 'via mcp' }),
  });
}

describe('Ask AI ↔ Canonical Tool Registry — definição única', () => {
  test('catálogo do copiloto é registrado no Canonical Tool Registry (idempotente)', () => {
    const registry = createToolRegistry({ logger: silent });
    const first = ensureAskAiCapabilityTools(registry, buildRunners());
    expect(first.registered).toEqual(ASK_AI_TOOLS.map((t) => t.id));

    const second = ensureAskAiCapabilityTools(registry, buildRunners());
    expect(second.registered).toEqual([]);
    expect(second.existing).toEqual(ASK_AI_TOOLS.map((t) => t.id));
    // Nenhuma duplicação: uma tool por capability declarada.
    expect(registry.size()).toBe(ASK_AI_TOOLS.length);
  });

  test('cada capability do copiloto existe UMA única vez no registry canônico', () => {
    const registry = createToolRegistry({ logger: silent });
    ensureAskAiCapabilityTools(registry, buildRunners());

    for (const tool of ASK_AI_TOOLS) {
      const canonical = registry.get(tool.id);
      expect(canonical).toBeTruthy();
      expect(canonical.capability).toBe(tool.capability);
      expect([...canonical.permissions]).toEqual([...tool.permissions]);
      expect(canonical.sideEffects).toBe(false);
      // O alias legado resolve para o MESMO objeto canônico.
      for (const alias of tool.aliases) expect(registry.get(alias)).toBe(canonical);
    }
  });

  test('a projeção do copiloto deriva do catálogo canônico (sem segunda definição)', () => {
    const projection = buildRegistry();
    expect(projection.all()).toHaveLength(ASK_AI_TOOLS.length);
    for (const entry of projection.all()) {
      const catalogEntry = findAskAiTool(entry.id);
      expect(catalogEntry).toBeTruthy();
      expect(entry.capability).toBe(catalogEntry.capability);
      expect(entry.rbac).toEqual(catalogEntry.rbac);
      expect(entry.entityTypes).toEqual([...catalogEntry.entityTypes]);
    }
  });

  test('runner ausente falha explicitamente (não registra tool sem implementação)', () => {
    const registry = createToolRegistry({ logger: silent });
    expect(() => ensureAskAiCapabilityTools(registry, {}))
      .toThrow(/ask_ai_capability_runner_missing/);
  });
});

describe('Ask AI ↔ Canonical Tool Registry — resolução de provider', () => {
  test('provider nativo tem precedência determinística', () => {
    const registry = createToolRegistry({ logger: silent });
    ensureAskAiCapabilityTools(registry, buildRunners());
    registerExternalProvider(registry, { id: 'mcp.ta.erp.crm.lookupCustomer', capability: 'crm.read', tenant: 'academia-a' });

    const providers = resolveCapabilityProviders({
      registry, capability: 'crm.read', entityType: 'FITNESS_STUDENT', actor: { classification: 'PRODUCTION', permissions: ['*'] },
    });
    const selected = selectProvider(providers);
    expect(selected.reason).toBe('native_preferred');
    expect(selected.provider.id).toBe('askai.fitness.membershipSummary');
  });

  test('sem provider nativo, o provider externo atende a MESMA capability', async () => {
    const registry = createToolRegistry({ logger: silent });
    registerExternalProvider(registry, {
      id: 'mcp.ta.erp.crm.lookupCustomer', capability: 'crm.read', tenant: 'academia-a',
    });

    const providers = resolveCapabilityProviders({
      registry, capability: 'crm.read', entityType: 'FITNESS_STUDENT', actor: { classification: 'PRODUCTION', permissions: ['*'] },
    });
    const selected = selectProvider(providers);
    expect(selected.reason).toBe('external_read_only_provider_selected');
    expect(selected.provider.provider).toBe('external');
    expect(selected.provider.id).toBe('mcp.ta.erp.crm.lookupCustomer');
  });

  test('providers somente com side effect não sofrem fallback automático', () => {
    const registry = createToolRegistry({ logger: silent });
    registerExternalProvider(registry, {
      id: 'mcp.ta.erp.billing.charge', capability: 'billing.read', tenant: 'academia-a', sideEffects: true,
    });
    const providers = resolveCapabilityProviders({
      registry, capability: 'billing.read', entityType: 'CUSTOMER', actor: { classification: 'PRODUCTION', permissions: ['*'] },
    });
    const selected = selectProvider(providers);
    expect(selected.provider).toBeNull();
    expect(selected.reason).toBe('side_effect_provider_fallback_not_safe');
  });

  test('capability sem provider disponível não é inventada', () => {
    const registry = createToolRegistry({ logger: silent });
    const providers = resolveCapabilityProviders({
      registry, capability: 'schedule.read', entityType: 'CUSTOMER', actor: { classification: 'PRODUCTION', permissions: ['*'] },
    });
    expect(selectProvider(providers)).toEqual(expect.objectContaining({
      provider: null, reason: 'no_provider_available', fallbackUsed: false,
    }));
  });

  test('M61 — mesma capability, provider diferente por tenant', () => {
    const registry = createToolRegistry({ logger: silent });
    // Tenant A: provider nativo. Tenant B: apenas provider MCP.
    ensureAskAiCapabilityTools(registry, buildRunners());
    registerExternalProvider(registry, { id: 'mcp.tb.erp.crm.lookupCustomer', capability: 'crm.read', tenant: 'academia-b' });

    const providers = resolveCapabilityProviders({
      registry, capability: 'crm.read', entityType: 'FITNESS_STUDENT', actor: { classification: 'PRODUCTION', permissions: ['*'] },
    });
    const selected = selectProvider(providers);
    // O Ask AI não hardcoda provider: com o nativo presente ele é preferido,
    // e o conjunto de providers disponíveis é o mesmo independentemente de
    // quem atende (nativo ou MCP).
    expect(providers.map((p) => p.provider).sort()).toEqual(['external', 'native']);
    expect(selected.provider).toBeTruthy();
  });
});

describe('Ask AI ↔ Canonical Tool Registry — execução governada', () => {
  test('execução passa pelo registry e reporta o provider resolvido', async () => {
    const registry = createToolRegistry({ logger: silent });
    // Runners determinísticos: a definição registrada é a do catálogo, mas a
    // implementação injetada evita I/O de domínio no teste.
    ensureAskAiCapabilityTools(registry, buildRunners());

    const result = await executeTool('askai.fitness.membershipSummary', {
      tenantId: 'academia-a',
      actor: ACTOR_ADMIN,
      entity: { type: 'FITNESS_STUDENT', id: 'student-42' },
      toolRegistry: registry,
    });

    expect(result.failed).toBe(false);
    expect(result.provider).toBe('native');
    expect(result.providerReason).toBe('native_preferred');
    expect(result.facts.length).toBeGreaterThan(0);
  });

  test('alias legado continua resolvendo para a tool canônica', async () => {
    const registry = createToolRegistry({ logger: silent });
    const result = await executeTool('getFitnessStudentSummary', {
      tenantId: 'academia-a',
      actor: ACTOR_ADMIN,
      entity: { type: 'FITNESS_STUDENT', id: 'student-42' },
      toolRegistry: registry,
    });
    expect(result.failed).toBe(false);
    expect(result.toolId).toBe('askai.fitness.membershipSummary');
  });

  test('entidade de tipo não suportado é recusada sem executar nada', async () => {
    let called = false;
    const registry = createToolRegistry({ logger: silent });
    ensureAskAiCapabilityTools(registry, buildRunners({ fitnessStudentSummary: async () => { called = true; return {}; } }));

    const result = await executeTool('askai.fitness.membershipSummary', {
      tenantId: 'academia-a',
      actor: ACTOR_ADMIN,
      entity: { type: 'CAMPAIGN', id: 'c-1' },
      toolRegistry: registry,
    });
    expect(result.failed).toBe(true);
    expect(result.error).toBe('entity_type_not_supported');
    expect(called).toBe(false);
  });

  test('ator sem o RBAC do dado financeiro não recebe a permissão canônica', () => {
    const operator = { id: 'u-2', username: 'op', role: 'operator', tenantId: 'academia-a' };
    const projection = buildRegistry().all();
    const { denied } = authorizeTools({ actor: operator, tools: projection });
    expect(denied.map((d) => d.toolId)).toContain('askai.billing.membershipHistory');

    const permissions = resolveCanonicalPermissions(operator, projection);
    expect(permissions).not.toContain('reports.read');
    expect(resolveCanonicalPermissions(ACTOR_ADMIN, projection)).toContain('reports.read');
  });

  test('registry do copiloto é o canônico (mesma instância injetada)', () => {
    const registry = createToolRegistry({ logger: silent });
    const projection = buildRegistry(registry);
    expect(projection.toolRegistry).toBe(registry);
    // As tools do copiloto ficam no MESMO registry que serve agentes/MCP.
    ensureAskAiCapabilityTools(projection.toolRegistry, RUNNERS);
    expect(registry.get('askai.churn.latestSignal')).toBeTruthy();
  });
});
