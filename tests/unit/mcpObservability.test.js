'use strict';

/**
 * MCP Observability + composição de runtime.
 *
 * Cobre as métricas do Control Plane (mcp_connections, mcp_tool_calls,
 * mcp_tool_failures, mcp_tool_denials, mcp_circuit_open, mcp_latency) e a
 * composição real `startMcpClientComposition` sobre config → hub → registry.
 */

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../api/utils/config', () => ({ get: jest.fn(), set: jest.fn() }));

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

const config = require('../../api/utils/config');
const { createMcpMetrics, createMcpAuditSink, METRIC_NAMES } = require('../../src/core/mcp/observability');
const { startMcpClientComposition, loadMcpConnections } = require('../../api/runtime/startMcpClient');
const { createToolRegistry } = require('../../src/core/cognitive/tool-registry');

const silent = { info() {}, warn() {}, error() {}, debug() {} };

describe('MCP observability — métricas', () => {
  test('emite as métricas exigidas sem carregar payload sensível', () => {
    const metrics = createMcpMetrics();
    metrics.recordConnectionRegistered(2);
    metrics.recordDiscovery({ toolsDiscovered: 3, schemaChanged: 1, ok: true });
    metrics.recordToolCall({ latencyMs: 40, ok: true });
    metrics.recordToolCall({ latencyMs: 90, ok: false });
    metrics.recordToolCall({ denied: true });
    metrics.recordCircuitOpen();

    const snapshot = metrics.snapshot();
    expect(Object.keys(snapshot.counters).sort()).toEqual([...METRIC_NAMES].sort());
    expect(snapshot.counters.mcp_connections).toBe(2);
    expect(snapshot.counters.mcp_tool_discoveries).toBe(3);
    expect(snapshot.counters.mcp_schema_changes).toBe(1);
    expect(snapshot.counters.mcp_tool_calls).toBe(2);
    expect(snapshot.counters.mcp_tool_failures).toBe(1);
    expect(snapshot.counters.mcp_tool_denials).toBe(1);
    expect(snapshot.counters.mcp_circuit_open).toBe(1);
    expect(snapshot.latency.count).toBe(2);
    expect(snapshot.latency.maxMs).toBe(90);
    expect(JSON.stringify(snapshot)).not.toMatch(/password|secret|token/i);
  });

  test('audit sink converte invocações em métricas e nunca lança', () => {
    const metrics = createMcpMetrics();
    const sink = createMcpAuditSink({ metrics });

    sink({ event: 'mcp_tool_invocation', outcome: 'success', latencyMs: 12 });
    sink({ event: 'mcp_tool_invocation', outcome: 'failure', latencyMs: 30 });
    sink({ event: 'mcp_tool_invocation', outcome: 'denied', reason: 'mcp_connection_circuit_open' });
    sink({ event: 'other_event' });
    // Evento inválido não derruba.
    expect(() => sink(null)).not.toThrow();

    const counters = metrics.snapshot().counters;
    expect(counters.mcp_tool_calls).toBe(2);
    expect(counters.mcp_tool_failures).toBe(1);
    expect(counters.mcp_tool_denials).toBe(1);
    expect(counters.mcp_circuit_open).toBe(1);
  });
});

describe('MCP client composition — runtime', () => {
  afterEach(() => {
    config.get.mockReset();
  });

  test('sem conexões configuradas: pula explicitamente (sem fake success)', async () => {
    config.get.mockReturnValue(undefined);
    const registry = createToolRegistry({ logger: silent });
    const result = await startMcpClientComposition({ toolRegistry: registry });
    expect(result).toBeNull();
  });

  test('loadMcpConnections aceita array e JSON string', () => {
    config.get.mockReturnValue('[{"tenant":"t1","name":"erp","endpoint":"https://e.example.com/mcp"}]');
    expect(loadMcpConnections()).toHaveLength(1);

    config.get.mockReturnValue([{ tenant: 't1', name: 'erp', endpoint: 'https://e.example.com/mcp' }]);
    expect(loadMcpConnections()).toHaveLength(1);

    config.get.mockReturnValue('não-json');
    expect(loadMcpConnections()).toEqual([]);
  });

  test('configuração inválida não derruba o runtime e não registra tool fantasma', async () => {
    config.get.mockReturnValue([{
      tenant: 'tenant-a', name: 'erp', endpoint: 'http://127.0.0.1:9999/mcp', enabled: true,
    }]);
    const registry = createToolRegistry({ logger: silent });

    const result = await startMcpClientComposition({ toolRegistry: registry, dnsLookup: async () => ['127.0.0.1'] });
    // Bloqueado na validação da configuração (SSRF): nenhuma tool registrada.
    expect(registry.size()).toBe(0);
    expect(result === null || result.registeredTools.length === 0).toBe(true);
  });

  test('conexão válida é descoberta e registrada no Canonical Tool Registry', async () => {
    const remote = new Server({ name: 'fake', version: '1.0.0' }, { capabilities: { tools: {} } });
    remote.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: 'calendar.listEvents', description: 'Lista eventos', inputSchema: { type: 'object' } }],
    }));
    remote.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'ok' }] }));

    config.get.mockReturnValue([{
      tenant: 'tenant-a',
      name: 'erp',
      endpoint: 'https://erp.example.com/mcp',
      enabled: true,
      classification: 'PRODUCTION',
      allowedCapabilities: ['schedule.read'],
    }]);

    const registry = createToolRegistry({ logger: silent });
    // Composição real, porém com transporte in-memory: o runtime wiring é o
    // mesmo (config → hub → adapter → registry).
    const { createMcpClientHub } = require('../../src/core/mcp/client-hub');
    const { registerExternalMcpTools } = require('../../src/core/mcp/external-tool-adapter');
    const hub = createMcpClientHub({
      connections: loadMcpConnections(),
      logger: silent,
      dnsLookup: async () => ['93.184.216.34'],
      transportFactory: () => {
        const pair = InMemoryTransport.createLinkedPair();
        remote.connect(pair[1]);
        return pair[0];
      },
    });
    const { registered } = await registerExternalMcpTools({ toolRegistry: registry, hub, logger: silent });

    expect(registered).toHaveLength(1);
    expect(registry.list({ classification: 'PRODUCTION', permissions: ['*'] }).map((t) => t.id)).toContain(registered[0]);
    const tool = registry.get(registered[0]);
    expect(tool.capability).toBe('schedule.read');

    await remote.close();
  });
});
