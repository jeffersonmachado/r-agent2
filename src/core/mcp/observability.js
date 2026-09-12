'use strict';

/**
 * MCP Observability — métricas e audit sink do Control Plane.
 *
 * Métricas exigidas pelo Control Plane (SUPPORT/DEVELOPMENT):
 *   mcp_connections, mcp_connection_failures, mcp_tool_discoveries,
 *   mcp_tool_calls, mcp_tool_failures, mcp_tool_denials, mcp_schema_changes,
 *   mcp_circuit_open, mcp_latency.
 *
 * Registro em memória do runtime (mesmo modelo do control plane de IA já
 * existente): contadores monotônicos + amostras de latência limitadas. Nunca
 * carrega segredo, payload de tool ou identificador de tenant em métrica —
 * apenas contadores e rótulos de conexão/ferramenta.
 */

const METRIC_NAMES = Object.freeze([
  'mcp_connections',
  'mcp_connection_failures',
  'mcp_tool_discoveries',
  'mcp_tool_failures',
  'mcp_tool_calls',
  'mcp_tool_denials',
  'mcp_schema_changes',
  'mcp_circuit_open',
  'mcp_latency',
]);

const MAX_LATENCY_SAMPLES = 200;

function createMcpMetrics({ now } = {}) {
  const clock = typeof now === 'function' ? now : () => Date.now();
  const counters = new Map(METRIC_NAMES.map((name) => [name, 0]));
  const latencies = [];
  const startedAt = clock();

  function increment(metric, amount = 1) {
    if (!counters.has(metric)) return;
    counters.set(metric, counters.get(metric) + amount);
  }

  /** Registra uma invocação de tool: chamada + resultado + latência. */
  function recordToolCall({ latencyMs = null, ok = true, denied = false } = {}) {
    if (denied) {
      increment('mcp_tool_denials');
      return;
    }
    increment('mcp_tool_calls');
    if (!ok) increment('mcp_tool_failures');
    if (Number.isFinite(latencyMs)) {
      latencies.push(latencyMs);
      if (latencies.length > MAX_LATENCY_SAMPLES) latencies.shift();
    }
  }

  /** Registra resultado de descoberta (inclui mudanças de schema). */
  function recordDiscovery({ toolsDiscovered = 0, schemaChanged = 0, ok = true } = {}) {
    if (ok) increment('mcp_tool_discoveries', toolsDiscovered);
    else increment('mcp_connection_failures');
    if (schemaChanged > 0) increment('mcp_schema_changes', schemaChanged);
  }

  function recordCircuitOpen() {
    increment('mcp_circuit_open');
  }

  function recordConnectionRegistered(count = 1) {
    increment('mcp_connections', count);
  }

  function latencySummary() {
    if (latencies.length === 0) return { count: 0, avgMs: null, maxMs: null, p95Ms: null };
    const sorted = [...latencies].sort((a, b) => a - b);
    const total = sorted.reduce((acc, value) => acc + value, 0);
    const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
    return {
      count: sorted.length,
      avgMs: Math.round((total / sorted.length) * 100) / 100,
      maxMs: sorted[sorted.length - 1],
      p95Ms: sorted[p95Index],
    };
  }

  function snapshot() {
    return {
      startedAt: new Date(startedAt).toISOString(),
      counters: Object.fromEntries(counters),
      latency: latencySummary(),
    };
  }

  function reset() {
    for (const name of METRIC_NAMES) counters.set(name, 0);
    latencies.length = 0;
  }

  return {
    increment,
    recordToolCall,
    recordDiscovery,
    recordCircuitOpen,
    recordConnectionRegistered,
    latencySummary,
    snapshot,
    reset,
    metricNames: METRIC_NAMES,
  };
}

/**
 * Audit sink: converte eventos do hub (`mcp_tool_invocation`) em métricas e
 * encaminha o registro bruto para um logger de auditoria. Nunca lança — uma
 * falha de métrica não pode derrubar uma chamada de tool.
 */
function createMcpAuditSink({ metrics, onAudit } = {}) {
  return function audit(event) {
    try {
      if (metrics && event?.event === 'mcp_tool_invocation') {
        const denied = event.outcome === 'denied' || event.outcome === 'unavailable';
        metrics.recordToolCall({
          latencyMs: event.latencyMs ?? null,
          ok: event.outcome === 'success',
          denied,
        });
        if (event.reason === 'mcp_connection_circuit_open') metrics.recordCircuitOpen();
      }
      if (typeof onAudit === 'function') onAudit(event);
    } catch (_) {
      // Auditoria/métrica nunca derruba a operação.
    }
  };
}

module.exports = { METRIC_NAMES, MAX_LATENCY_SAMPLES, createMcpMetrics, createMcpAuditSink };
