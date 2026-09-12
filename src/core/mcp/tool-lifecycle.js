'use strict';

/**
 * MCP Tool Lifecycle — descoberta, fingerprint de schema, ciclo de vida e
 * saúde de conexão.
 *
 * Problema que este módulo resolve:
 *  1. Uma tool externa só era "conhecida" no boot. Se o servidor remoto não
 *     respondia, a tool simplesmente não existia — e nenhum agente sabia que
 *     a capability estava indisponível (indistinguível de "não configurada").
 *  2. Mudança de schema remoto era aceita em silêncio: o servidor podia
 *     alterar o contrato de uma tool de mutação e o RAP passava a chamá-la com
 *     input inválido (ou com semântica diferente).
 *  3. Falha repetida gerava tempestade de reconexões.
 *
 * Estados de tool (§13):
 *   discovered → validated → enabled ⇄ disabled
 *                     ↘ degraded / schema_changed / unavailable
 *
 * Regra: "existe conexão no startup" ≠ "tool disponível". Disponibilidade é
 * derivada de (lifecycle permitido) E (saúde da conexão) E (fingerprint
 * inalterado), avaliada a cada uso.
 */

const crypto = require('crypto');
const { createCircuitBreaker } = require('../../../engine/aiControlPlaneResilience');

const TOOL_LIFECYCLE = Object.freeze({
  DISCOVERED: 'discovered',
  VALIDATED: 'validated',
  ENABLED: 'enabled',
  DISABLED: 'disabled',
  DEGRADED: 'degraded',
  SCHEMA_CHANGED: 'schema_changed',
  UNAVAILABLE: 'unavailable',
});

const CONNECTION_HEALTH = Object.freeze({
  UNKNOWN: 'unknown',
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNAVAILABLE: 'unavailable',
});

/** Estados em que a tool pode ser EXECUTADA. */
const EXECUTABLE_LIFECYCLE_STATES = Object.freeze([TOOL_LIFECYCLE.ENABLED, TOOL_LIFECYCLE.VALIDATED]);

/** Motivos auditáveis de indisponibilidade. */
const UNAVAILABLE_REASONS = Object.freeze({
  NOT_DISCOVERED: 'mcp_tool_not_discovered',
  NOT_VALIDATED: 'mcp_tool_not_validated',
  LIFECYCLE_BLOCKED: 'mcp_tool_lifecycle_blocked',
  SCHEMA_REVALIDATION_REQUIRED: 'mcp_tool_schema_revalidation_required',
  CONNECTION_UNAVAILABLE: 'mcp_connection_unavailable',
  CONNECTION_DEGRADED: 'mcp_connection_degraded',
  CIRCUIT_OPEN: 'mcp_connection_circuit_open',
});

/**
 * Serialização determinística (chaves ordenadas) — sem isso, dois schemas
 * semanticamente idênticos com ordem de chave diferente gerariam fingerprints
 * distintos e um falso `schema_changed`.
 */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/**
 * Fingerprint SHA-256 de um schema de tool. Considera input E output schema:
 * uma mudança só no output também altera o contrato consumido pelo agente.
 */
function computeSchemaFingerprint({ inputSchema, outputSchema } = {}) {
  const payload = stableStringify({ input: inputSchema ?? null, output: outputSchema ?? null });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Avalia a descoberta de tools de UMA conexão contra o estado conhecido.
 *
 * @param {object} args
 * @param {Array<object>} args.remoteTools       tools retornadas por tools/list
 * @param {object} [args.knownTools]             mapa name → {schemaFingerprint, lifecycle}
 * @param {string} [args.now]                    ISO timestamp (injetável)
 * @returns {{tools: Array<object>, counts: object, requiresRevalidation: boolean}}
 */
function evaluateDiscovery({ remoteTools = [], knownTools = {}, now = null } = {}) {
  const observedAt = now || new Date().toISOString();
  const known = knownTools && typeof knownTools === 'object' ? knownTools : {};
  const tools = [];
  const counts = {
    discovered: 0, validated: 0, schemaChanged: 0, missing: 0,
  };

  const seenNames = new Set();

  for (const remote of remoteTools) {
    const name = String(remote?.name || '').trim();
    if (!name) continue;
    seenNames.add(name);

    const fingerprint = computeSchemaFingerprint({
      inputSchema: remote.inputSchema,
      outputSchema: remote.outputSchema,
    });
    const previous = known[name] || null;

    if (!previous) {
      counts.discovered += 1;
      tools.push({
        name,
        schemaFingerprint: fingerprint,
        previousFingerprint: null,
        lifecycle: TOOL_LIFECYCLE.DISCOVERED,
        discoveredAt: observedAt,
        changeStatus: 'new_tool',
        requiresRevalidation: true,
        inputSchema: remote.inputSchema || null,
        outputSchema: remote.outputSchema || null,
        annotations: remote.annotations || null,
        description: remote.description || null,
      });
      continue;
    }

    if (previous.schemaFingerprint !== fingerprint) {
      counts.schemaChanged += 1;
      tools.push({
        name,
        schemaFingerprint: fingerprint,
        previousFingerprint: previous.schemaFingerprint,
        lifecycle: TOOL_LIFECYCLE.SCHEMA_CHANGED,
        discoveredAt: observedAt,
        changeStatus: 'schema_changed',
        requiresRevalidation: true,
        // O schema NOVO não substitui o anterior até revalidação explícita:
        // continua com o schema anterior em vigor.
        inputSchema: remote.inputSchema || null,
        outputSchema: remote.outputSchema || null,
        annotations: remote.annotations || null,
        description: remote.description || null,
      });
      continue;
    }

    counts.validated += 1;
    tools.push({
      name,
      schemaFingerprint: fingerprint,
      previousFingerprint: previous.schemaFingerprint,
      lifecycle: previous.lifecycle === TOOL_LIFECYCLE.DISABLED
        ? TOOL_LIFECYCLE.DISABLED
        : TOOL_LIFECYCLE.VALIDATED,
      discoveredAt: observedAt,
      changeStatus: 'unchanged',
      requiresRevalidation: false,
      inputSchema: remote.inputSchema || null,
      outputSchema: remote.outputSchema || null,
      annotations: remote.annotations || null,
      description: remote.description || null,
    });
  }

  // Tools conhecidas que NÃO apareceram na descoberta: a capability pode ter
  // sido removida remotamente. Nunca permanecem "enabled" por inércia.
  for (const [name, previous] of Object.entries(known)) {
    if (seenNames.has(name)) continue;
    counts.missing += 1;
    tools.push({
      name,
      schemaFingerprint: previous.schemaFingerprint || null,
      previousFingerprint: previous.schemaFingerprint || null,
      lifecycle: TOOL_LIFECYCLE.UNAVAILABLE,
      discoveredAt: observedAt,
      changeStatus: 'removed_remotely',
      requiresRevalidation: false,
      inputSchema: null,
      outputSchema: null,
      annotations: null,
    });
  }

  return {
    tools,
    counts,
    requiresRevalidation: tools.some((t) => t.requiresRevalidation === true),
    observedAt,
  };
}

/**
 * Máquina de vida de uma tool. Transições permitidas são explícitas; qualquer
 * transição não listada é rejeitada (evita "enabled" a partir de
 * schema_changed por engano de chamador).
 */
const ALLOWED_TRANSITIONS = Object.freeze({
  [TOOL_LIFECYCLE.DISCOVERED]: [TOOL_LIFECYCLE.VALIDATED, TOOL_LIFECYCLE.DISABLED, TOOL_LIFECYCLE.UNAVAILABLE, TOOL_LIFECYCLE.SCHEMA_CHANGED],
  [TOOL_LIFECYCLE.VALIDATED]: [TOOL_LIFECYCLE.ENABLED, TOOL_LIFECYCLE.DISABLED, TOOL_LIFECYCLE.DEGRADED, TOOL_LIFECYCLE.SCHEMA_CHANGED, TOOL_LIFECYCLE.UNAVAILABLE],
  [TOOL_LIFECYCLE.ENABLED]: [TOOL_LIFECYCLE.DISABLED, TOOL_LIFECYCLE.DEGRADED, TOOL_LIFECYCLE.SCHEMA_CHANGED, TOOL_LIFECYCLE.UNAVAILABLE],
  [TOOL_LIFECYCLE.DISABLED]: [TOOL_LIFECYCLE.ENABLED, TOOL_LIFECYCLE.VALIDATED, TOOL_LIFECYCLE.UNAVAILABLE],
  [TOOL_LIFECYCLE.DEGRADED]: [TOOL_LIFECYCLE.ENABLED, TOOL_LIFECYCLE.DISABLED, TOOL_LIFECYCLE.UNAVAILABLE, TOOL_LIFECYCLE.VALIDATED],
  [TOOL_LIFECYCLE.SCHEMA_CHANGED]: [TOOL_LIFECYCLE.VALIDATED, TOOL_LIFECYCLE.ENABLED, TOOL_LIFECYCLE.DISABLED, TOOL_LIFECYCLE.UNAVAILABLE],
  [TOOL_LIFECYCLE.UNAVAILABLE]: [TOOL_LIFECYCLE.DISCOVERED, TOOL_LIFECYCLE.VALIDATED, TOOL_LIFECYCLE.DISABLED],
});

function canTransition(from, to) {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`mcp_tool_lifecycle_transition_invalid: ${from} → ${to}`);
  }
  return to;
}

/**
 * Registro de ciclo de vida + saúde por conexão. Estado em memória do runtime
 * (deriva de descoberta real; nunca configuração otimista).
 */
function createMcpToolLifecycle({ logger, now, circuitBreakerOptions = {} } = {}) {
  const connections = new Map();
  const clock = typeof now === 'function' ? now : () => Date.now();

  function ensureConnection(connectionKey) {
    if (!connections.has(connectionKey)) {
      connections.set(connectionKey, {
        key: connectionKey,
        health: CONNECTION_HEALTH.UNKNOWN,
        lifecycle: TOOL_LIFECYCLE.DISCOVERED,
        tools: new Map(),
        lastDiscoveryAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastError: null,
        lastLatencyMs: null,
        consecutiveFailures: 0,
        breaker: createCircuitBreaker({ now: clock, ...circuitBreakerOptions }),
      });
    }
    return connections.get(connectionKey);
  }

  /**
   * Aplica o resultado de uma descoberta bem-sucedida.
   * Revalidação NÃO é automática: uma tool com schema alterado entra em
   * `schema_changed` e fica NÃO executável até `validateTool` explícito.
   */
  function applyDiscovery(connectionKey, { remoteTools = [], now: observedAt = null } = {}) {
    const entry = ensureConnection(connectionKey);
    const known = Object.fromEntries([...entry.tools.entries()].map(([name, t]) => [name, t]));
    const result = evaluateDiscovery({ remoteTools, knownTools: known, now: observedAt });

    let newlyEnabled = 0;
    for (const tool of result.tools) {
      const previous = entry.tools.get(tool.name);
      const lifecycle = tool.lifecycle;
      // Tool nova entra como `discovered` (não executável); as já validadas
      // permanecem válidas quando o schema não mudou.
      if (previous && previous.lifecycle === TOOL_LIFECYCLE.ENABLED && lifecycle === TOOL_LIFECYCLE.VALIDATED) {
        tool.lifecycle = TOOL_LIFECYCLE.ENABLED;
        newlyEnabled += 1;
      }
      entry.tools.set(tool.name, {
        ...previous,
        ...tool,
        enabledAt: tool.lifecycle === TOOL_LIFECYCLE.ENABLED
          ? (previous?.enabledAt || observedAt || new Date().toISOString())
          : previous?.enabledAt || null,
      });
    }

    entry.lastDiscoveryAt = result.observedAt;
    entry.health = result.counts.discovered > 0 || result.counts.schemaChanged > 0
      ? CONNECTION_HEALTH.DEGRADED
      : CONNECTION_HEALTH.HEALTHY;
    entry.lastSuccessAt = result.observedAt;
    entry.lastError = null;
    entry.consecutiveFailures = 0;
    entry.breaker.recordSuccess();

    return { ...result, newlyEnabled };
  }

  /** Marca a conexão como indisponível sem derrubar o processo (não-fatal). */
  function recordDiscoveryFailure(connectionKey, error, { now: failedAt = null } = {}) {
    const entry = ensureConnection(connectionKey);
    entry.health = CONNECTION_HEALTH.UNAVAILABLE;
    entry.lastFailureAt = failedAt || new Date().toISOString();
    entry.lastError = error?.message || String(error);
    entry.consecutiveFailures += 1;
    entry.breaker.recordFailure();
    for (const tool of entry.tools.values()) {
      if (tool.lifecycle === TOOL_LIFECYCLE.ENABLED || tool.lifecycle === TOOL_LIFECYCLE.VALIDATED) {
        tool.lifecycle = TOOL_LIFECYCLE.UNAVAILABLE;
        tool.unavailableReason = UNAVAILABLE_REASONS.CONNECTION_UNAVAILABLE;
      }
    }
    return entry;
  }

  function recordCallSuccess(connectionKey, { latencyMs = null, now: at = null } = {}) {
    const entry = ensureConnection(connectionKey);
    entry.health = CONNECTION_HEALTH.HEALTHY;
    entry.lastSuccessAt = at || new Date().toISOString();
    entry.lastLatencyMs = Number.isFinite(latencyMs) ? latencyMs : null;
    entry.lastError = null;
    entry.consecutiveFailures = 0;
    entry.breaker.recordSuccess();
    return entry;
  }

  function recordCallFailure(connectionKey, error, { latencyMs = null, now: at = null } = {}) {
    const entry = ensureConnection(connectionKey);
    entry.lastFailureAt = at || new Date().toISOString();
    entry.lastError = error?.message || String(error);
    entry.lastLatencyMs = Number.isFinite(latencyMs) ? latencyMs : null;
    entry.consecutiveFailures += 1;
    entry.breaker.recordFailure();
    entry.health = entry.breaker.isOpen() ? CONNECTION_HEALTH.UNAVAILABLE : CONNECTION_HEALTH.DEGRADED;
    return entry;
  }

  /** Habilita uma tool após revalidação explícita. */
  function validateTool(connectionKey, toolName, { enable = true } = {}) {
    const entry = ensureConnection(connectionKey);
    const tool = entry.tools.get(String(toolName));
    if (!tool) throw new Error(`mcp_tool_unknown: ${toolName} (${connectionKey})`);
    if (tool.lifecycle !== TOOL_LIFECYCLE.VALIDATED) {
      assertTransition(tool.lifecycle, TOOL_LIFECYCLE.VALIDATED);
      tool.lifecycle = TOOL_LIFECYCLE.VALIDATED;
    }
    tool.validatedAt = new Date().toISOString();
    tool.requiresRevalidation = false;
    if (enable) {
      if (tool.lifecycle !== TOOL_LIFECYCLE.ENABLED) {
        assertTransition(tool.lifecycle, TOOL_LIFECYCLE.ENABLED);
        tool.lifecycle = TOOL_LIFECYCLE.ENABLED;
      }
      tool.enabledAt = new Date().toISOString();
    }
    return tool;
  }

  function setToolEnabled(connectionKey, toolName, enabled) {
    const entry = ensureConnection(connectionKey);
    const tool = entry.tools.get(String(toolName));
    if (!tool) throw new Error(`mcp_tool_unknown: ${toolName} (${connectionKey})`);
    const target = enabled ? TOOL_LIFECYCLE.ENABLED : TOOL_LIFECYCLE.DISABLED;
    assertTransition(tool.lifecycle, target);
    tool.lifecycle = target;
    return tool;
  }

  /**
   * Disponibilidade REAL de uma tool, avaliada a cada uso.
   * @returns {{available: boolean, reason: string|null, lifecycle: string, health: string}}
   */
  function getToolAvailability(connectionKey, toolName) {
    const entry = connections.get(connectionKey);
    if (!entry) {
      return { available: false, reason: UNAVAILABLE_REASONS.NOT_DISCOVERED, lifecycle: null, health: CONNECTION_HEALTH.UNKNOWN };
    }
    const tool = entry.tools.get(String(toolName));
    if (!tool) {
      return { available: false, reason: UNAVAILABLE_REASONS.NOT_DISCOVERED, lifecycle: null, health: entry.health };
    }
    if (tool.lifecycle === TOOL_LIFECYCLE.DISCOVERED) {
      // Tool nova: nunca foi validada localmente. Não é "mudança de schema".
      return { available: false, reason: UNAVAILABLE_REASONS.NOT_VALIDATED, lifecycle: tool.lifecycle, health: entry.health };
    }
    if (tool.requiresRevalidation === true) {
      return { available: false, reason: UNAVAILABLE_REASONS.SCHEMA_REVALIDATION_REQUIRED, lifecycle: tool.lifecycle, health: entry.health };
    }
    if (!EXECUTABLE_LIFECYCLE_STATES.includes(tool.lifecycle)) {
      // Motivo específico quando conhecido (ex.: conexão caiu depois da
      // descoberta) — nunca um genérico que esconda a causa real.
      return {
        available: false,
        reason: tool.unavailableReason || UNAVAILABLE_REASONS.LIFECYCLE_BLOCKED,
        lifecycle: tool.lifecycle,
        health: entry.health,
      };
    }
    if (entry.breaker.isOpen()) {
      return { available: false, reason: UNAVAILABLE_REASONS.CIRCUIT_OPEN, lifecycle: tool.lifecycle, health: entry.health };
    }
    if (entry.health === CONNECTION_HEALTH.UNAVAILABLE) {
      return { available: false, reason: UNAVAILABLE_REASONS.CONNECTION_UNAVAILABLE, lifecycle: tool.lifecycle, health: entry.health };
    }
    return { available: true, reason: null, lifecycle: tool.lifecycle, health: entry.health };
  }

  /** Aquisição de direito de chamada (circuit breaker) antes de ir à rede. */
  function acquireCallPermit(connectionKey) {
    const entry = ensureConnection(connectionKey);
    if (!entry.breaker.acquire()) {
      return { allowed: false, reason: UNAVAILABLE_REASONS.CIRCUIT_OPEN };
    }
    return { allowed: true, reason: null };
  }

  function listTools(connectionKey) {
    const entry = connections.get(connectionKey);
    if (!entry) return [];
    return [...entry.tools.values()].map((tool) => ({ ...tool, availability: getToolAvailability(connectionKey, tool.name) }));
  }

  function getConnectionState(connectionKey) {
    const entry = connections.get(connectionKey);
    if (!entry) return null;
    return {
      key: entry.key,
      health: entry.health,
      lifecycle: entry.lifecycle,
      lastDiscoveryAt: entry.lastDiscoveryAt,
      lastSuccessAt: entry.lastSuccessAt,
      lastFailureAt: entry.lastFailureAt,
      lastError: entry.lastError,
      lastLatencyMs: entry.lastLatencyMs,
      consecutiveFailures: entry.consecutiveFailures,
      circuit: entry.breaker.getState(),
      toolCount: entry.tools.size,
    };
  }

  function snapshot() {
    return [...connections.keys()].map((key) => getConnectionState(key));
  }

  return {
    applyDiscovery,
    recordDiscoveryFailure,
    recordCallSuccess,
    recordCallFailure,
    validateTool,
    setToolEnabled,
    getToolAvailability,
    acquireCallPermit,
    listTools,
    getConnectionState,
    snapshot,
    size: () => connections.size,
  };
}

module.exports = {
  TOOL_LIFECYCLE,
  CONNECTION_HEALTH,
  EXECUTABLE_LIFECYCLE_STATES,
  UNAVAILABLE_REASONS,
  ALLOWED_TRANSITIONS,
  stableStringify,
  computeSchemaFingerprint,
  evaluateDiscovery,
  canTransition,
  assertTransition,
  createMcpToolLifecycle,
};
