'use strict';

/**
 * MCP Tool Lifecycle — descoberta, fingerprint de schema, ciclo de vida,
 * saúde e circuit breaker de conexões MCP externas.
 */

const {
  TOOL_LIFECYCLE,
  CONNECTION_HEALTH,
  UNAVAILABLE_REASONS,
  computeSchemaFingerprint,
  evaluateDiscovery,
  canTransition,
  createMcpToolLifecycle,
} = require('../../src/core/mcp/tool-lifecycle');

const SCHEMA_A = { type: 'object', properties: { date: { type: 'string' } } };
const SCHEMA_B = { type: 'object', properties: { date: { type: 'string' }, limit: { type: 'integer' } } };

describe('MCP tool lifecycle — fingerprint de schema', () => {
  test('fingerprint é determinístico e insensível à ordem das chaves', () => {
    const a = computeSchemaFingerprint({ inputSchema: { type: 'object', properties: { x: { type: 'string' }, y: { type: 'number' } } } });
    const b = computeSchemaFingerprint({ inputSchema: { properties: { y: { type: 'number' }, x: { type: 'string' } }, type: 'object' } });
    expect(a).toBe(b);
  });

  test('mudança de input OU de output altera o fingerprint', () => {
    const base = computeSchemaFingerprint({ inputSchema: SCHEMA_A, outputSchema: { type: 'object' } });
    expect(computeSchemaFingerprint({ inputSchema: SCHEMA_B, outputSchema: { type: 'object' } })).not.toBe(base);
    expect(computeSchemaFingerprint({ inputSchema: SCHEMA_A, outputSchema: { type: 'array' } })).not.toBe(base);
  });
});

describe('MCP tool lifecycle — avaliação de descoberta', () => {
  test('tool nova entra como discovered e exige revalidação', () => {
    const result = evaluateDiscovery({ remoteTools: [{ name: 'calendar.listEvents', inputSchema: SCHEMA_A }] });
    expect(result.tools[0].lifecycle).toBe(TOOL_LIFECYCLE.DISCOVERED);
    expect(result.tools[0].changeStatus).toBe('new_tool');
    expect(result.requiresRevalidation).toBe(true);
  });

  test('schema inalterado mantém a tool validada', () => {
    const fingerprint = computeSchemaFingerprint({ inputSchema: SCHEMA_A });
    const result = evaluateDiscovery({
      remoteTools: [{ name: 'calendar.listEvents', inputSchema: SCHEMA_A }],
      knownTools: { 'calendar.listEvents': { schemaFingerprint: fingerprint, lifecycle: TOOL_LIFECYCLE.VALIDATED } },
    });
    expect(result.tools[0].lifecycle).toBe(TOOL_LIFECYCLE.VALIDATED);
    expect(result.tools[0].requiresRevalidation).toBe(false);
    expect(result.counts.schemaChanged).toBe(0);
  });

  test('schema alterado vira schema_changed e REQUER revalidação', () => {
    const fingerprint = computeSchemaFingerprint({ inputSchema: SCHEMA_A });
    const result = evaluateDiscovery({
      remoteTools: [{ name: 'payments.refund', inputSchema: SCHEMA_B }],
      knownTools: { 'payments.refund': { schemaFingerprint: fingerprint, lifecycle: TOOL_LIFECYCLE.ENABLED } },
    });
    expect(result.tools[0].lifecycle).toBe(TOOL_LIFECYCLE.SCHEMA_CHANGED);
    expect(result.tools[0].changeStatus).toBe('schema_changed');
    expect(result.tools[0].previousFingerprint).toBe(fingerprint);
    expect(result.requiresRevalidation).toBe(true);
  });

  test('tool removida remotamente não permanece válida por inércia', () => {
    const result = evaluateDiscovery({
      remoteTools: [],
      knownTools: { 'crm.getCustomer': { schemaFingerprint: 'abc', lifecycle: TOOL_LIFECYCLE.ENABLED } },
    });
    expect(result.tools[0].lifecycle).toBe(TOOL_LIFECYCLE.UNAVAILABLE);
    expect(result.tools[0].changeStatus).toBe('removed_remotely');
  });
});

describe('MCP tool lifecycle — máquina de estados', () => {
  test('transições inválidas são rejeitadas', () => {
    expect(canTransition(TOOL_LIFECYCLE.SCHEMA_CHANGED, TOOL_LIFECYCLE.DISABLED)).toBe(true);
    expect(canTransition(TOOL_LIFECYCLE.DISABLED, TOOL_LIFECYCLE.SCHEMA_CHANGED)).toBe(false);
  });
});

describe('MCP tool lifecycle — disponibilidade real', () => {
  function setup({ circuitBreakerOptions } = {}) {
    return createMcpToolLifecycle({ logger: { info() {}, warn() {}, error() {} }, circuitBreakerOptions });
  }

  test('tool descoberta mas não validada NÃO está disponível', () => {
    const lifecycle = setup();
    lifecycle.applyDiscovery('t1:erp', { remoteTools: [{ name: 'calendar.listEvents', inputSchema: SCHEMA_A }] });
    const availability = lifecycle.getToolAvailability('t1:erp', 'calendar.listEvents');
    expect(availability.available).toBe(false);
    expect(availability.reason).toBe(UNAVAILABLE_REASONS.NOT_VALIDATED);
  });

  test('validar + habilitar torna a tool disponível', () => {
    const lifecycle = setup();
    lifecycle.applyDiscovery('t1:erp', { remoteTools: [{ name: 'calendar.listEvents', inputSchema: SCHEMA_A }] });
    lifecycle.validateTool('t1:erp', 'calendar.listEvents');
    const availability = lifecycle.getToolAvailability('t1:erp', 'calendar.listEvents');
    expect(availability.available).toBe(true);
    expect(availability.lifecycle).toBe(TOOL_LIFECYCLE.ENABLED);
  });

  test('mudança de schema bloqueia a execução até revalidação explícita', () => {
    const lifecycle = setup();
    lifecycle.applyDiscovery('t1:erp', { remoteTools: [{ name: 'payments.refund', inputSchema: SCHEMA_A }] });
    lifecycle.validateTool('t1:erp', 'payments.refund');
    expect(lifecycle.getToolAvailability('t1:erp', 'payments.refund').available).toBe(true);

    lifecycle.applyDiscovery('t1:erp', { remoteTools: [{ name: 'payments.refund', inputSchema: SCHEMA_B }] });
    const blocked = lifecycle.getToolAvailability('t1:erp', 'payments.refund');
    expect(blocked.available).toBe(false);
    expect(blocked.reason).toBe(UNAVAILABLE_REASONS.SCHEMA_REVALIDATION_REQUIRED);

    lifecycle.validateTool('t1:erp', 'payments.refund');
    expect(lifecycle.getToolAvailability('t1:erp', 'payments.refund').available).toBe(true);
  });

  test('falha de conexão no startup deixa as tools unavailable sem derrubar o runtime', () => {
    const lifecycle = setup();
    lifecycle.applyDiscovery('t1:erp', { remoteTools: [{ name: 'calendar.listEvents', inputSchema: SCHEMA_A }] });
    lifecycle.validateTool('t1:erp', 'calendar.listEvents');

    lifecycle.recordDiscoveryFailure('t1:erp', new Error('ECONNREFUSED'));

    const state = lifecycle.getConnectionState('t1:erp');
    expect(state.health).toBe(CONNECTION_HEALTH.UNAVAILABLE);
    expect(state.lastError).toContain('ECONNREFUSED');

    const availability = lifecycle.getToolAvailability('t1:erp', 'calendar.listEvents');
    expect(availability.available).toBe(false);
    expect(availability.reason).toBe(UNAVAILABLE_REASONS.CONNECTION_UNAVAILABLE);
    // Outra conexão permanece intacta — falha é isolada.
    expect(lifecycle.getConnectionState('t2:other')).toBeNull();
  });

  test('circuito abre após falhas consecutivas e bloqueia sem ir à rede', () => {
    const lifecycle = setup({ circuitBreakerOptions: { failureThreshold: 2, resetMs: 60000 } });
    lifecycle.applyDiscovery('t1:erp', { remoteTools: [{ name: 'calendar.listEvents', inputSchema: SCHEMA_A }] });
    lifecycle.validateTool('t1:erp', 'calendar.listEvents');

    lifecycle.recordCallFailure('t1:erp', new Error('timeout'));
    expect(lifecycle.acquireCallPermit('t1:erp').allowed).toBe(true);
    lifecycle.recordCallFailure('t1:erp', new Error('timeout'));

    const permit = lifecycle.acquireCallPermit('t1:erp');
    expect(permit.allowed).toBe(false);
    expect(permit.reason).toBe(UNAVAILABLE_REASONS.CIRCUIT_OPEN);

    const availability = lifecycle.getToolAvailability('t1:erp', 'calendar.listEvents');
    expect(availability.available).toBe(false);
    expect(availability.reason).toBe(UNAVAILABLE_REASONS.CIRCUIT_OPEN);
  });

  test('sucesso de chamada restaura a saúde da conexão', () => {
    const lifecycle = setup();
    lifecycle.applyDiscovery('t1:erp', { remoteTools: [{ name: 'calendar.listEvents', inputSchema: SCHEMA_A }] });
    lifecycle.validateTool('t1:erp', 'calendar.listEvents');
    lifecycle.recordCallFailure('t1:erp', new Error('boom'), { latencyMs: 120 });
    lifecycle.recordCallSuccess('t1:erp', { latencyMs: 42 });

    const state = lifecycle.getConnectionState('t1:erp');
    expect(state.health).toBe(CONNECTION_HEALTH.HEALTHY);
    expect(state.lastLatencyMs).toBe(42);
    expect(state.lastError).toBeNull();
  });

  test('desabilitar tool explicitamente a torna indisponível', () => {
    const lifecycle = setup();
    lifecycle.applyDiscovery('t1:erp', { remoteTools: [{ name: 'calendar.listEvents', inputSchema: SCHEMA_A }] });
    lifecycle.validateTool('t1:erp', 'calendar.listEvents');
    lifecycle.setToolEnabled('t1:erp', 'calendar.listEvents', false);

    const availability = lifecycle.getToolAvailability('t1:erp', 'calendar.listEvents');
    expect(availability.available).toBe(false);
    expect(availability.lifecycle).toBe(TOOL_LIFECYCLE.DISABLED);
  });

  test('tool desconhecida não é considerada disponível', () => {
    const lifecycle = setup();
    const availability = lifecycle.getToolAvailability('t1:erp', 'nope');
    expect(availability.available).toBe(false);
    expect(availability.reason).toBe(UNAVAILABLE_REASONS.NOT_DISCOVERED);
  });
});
