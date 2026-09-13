'use strict';

/**
 * mcpDiscoveryService — operações REAIS de conexão/descoberta/revalidação do MCP
 * Control Plane (§M9–§M12).
 *
 * Defeito que este módulo corrige: a API de administração aceitava que o CLIENTE
 * dissesse quais tools existiam (`POST discover` com `body.tools`) e respondia ao
 * teste de conexão com um 502 fixo ("nenhum servidor configurado"). Nos dois casos
 * o resultado era uma mentira estrutural:
 *
 *   - inventário declarado pelo cliente não é descoberta. A capability existia no
 *     banco porque alguém digitou, não porque o servidor remoto a oferece;
 *   - 502 fixo não distingue "endpoint morto" de "auth inválida" de "TLS" — e um
 *     control plane que não diagnostica não serve para operar.
 *
 * Aqui a descoberta segue o caminho OBRIGATÓRIO:
 *
 *   conexão persistida → política de endpoint (SSRF/TLS) → credencial por
 *   referência → `connect` → `tools/list` REAL → validação do inventário →
 *   fingerprint de schema → persistência (+ feedback de saúde)
 *
 * Sem endpoint real configurado o resultado é um CÓDIGO explícito
 * (`MCP_ENDPOINT_NOT_CONFIGURED`), nunca sucesso inventado. O `deps.transportFactory`
 * existe para o harness de teste (servidor MCP real no protocolo, via
 * `InMemoryTransport`); em produção o transporte é o de rede real.
 */

const dns = require('dns');

const logger = require('../../utils/logger');
const connectionService = require('./mcpConnectionService');
const { createMcpClientHub } = require('../../../src/core/mcp/client-hub');
const { resolveCapability } = require('../../../src/core/mcp/external-tool-adapter');
const { ENDPOINT_DENIAL_CODES } = require('../../../src/core/mcp/endpoint-policy');

/** Códigos honestos de falha (nunca "sucesso" com aviso). */
const DISCOVERY_CODES = Object.freeze({
  ENDPOINT_NOT_CONFIGURED: 'MCP_ENDPOINT_NOT_CONFIGURED',
  ENDPOINT_BLOCKED: 'MCP_ENDPOINT_BLOCKED',
  AUTH_FORBIDDEN: 'MCP_AUTH_FORBIDDEN',
  AUTH_UNAVAILABLE: 'MCP_AUTH_UNAVAILABLE',
  CONNECTION_NOT_FOUND: 'MCP_CONNECTION_NOT_FOUND',
  CONNECTION_DISABLED: 'MCP_CONNECTION_DISABLED',
  CONNECTION_TENANT_MISMATCH: 'MCP_CONNECTION_TENANT_MISMATCH',
  TOOL_INVENTORY_INVALID: 'MCP_TOOL_INVENTORY_INVALID',
  DISCOVERY_FAILED: 'MCP_DISCOVERY_FAILED',
  REVALIDATION_NOT_REQUIRED: 'MCP_REVALIDATION_NOT_REQUIRED',
});

const DENIAL_CODE_SET = new Set(Object.values(ENDPOINT_DENIAL_CODES));

/** Lookup DNS com TODOS os endereços (valida rebinding, não só o 1º). */
async function defaultDnsLookup(hostname) {
  const result = await dns.promises.lookup(hostname, { all: true });
  return result.map((entry) => entry.address);
}

/**
 * Resolução de credencial por REFERÊNCIA. O valor nunca é logado nem devolvido.
 * `deps.credentialResolver` (store oficial) tem precedência; sem ele a referência
 * é resolvida como nome de variável de ambiente. Não resolver é FALHA explícita —
 * nunca conexão anônima silenciosa.
 */
function defaultCredentialResolver(ref) {
  return process.env[String(ref)] || null;
}

/** Erro de domínio do discovery (o chamador HTTP usa `code`). */
function discoveryError(code, message, extra = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function endpointIsConfigured(endpoint) {
  const raw = String(endpoint || '').trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch (_) {
    return false;
  }
}

/**
 * Pré-checagens determinísticas ANTES de abrir qualquer conexão.
 * @returns {{ok: true} | {ok: false, code: string, message: string}}
 */
function preflight(config) {
  if (!endpointIsConfigured(config.endpoint)) {
    return {
      ok: false,
      code: DISCOVERY_CODES.ENDPOINT_NOT_CONFIGURED,
      message: 'conexão sem endpoint HTTP(S) real configurado — descoberta exige servidor MCP externo',
    };
  }
  try {
    connectionService.assertEndpointAllowed(config.endpoint, {
      classification: config.classification,
      policy: config.endpointPolicy,
    });
  } catch (error) {
    return { ok: false, code: DISCOVERY_CODES.ENDPOINT_BLOCKED, message: error.message };
  }
  try {
    connectionService.assertAuthAllowed(config.authType, config.classification);
  } catch (error) {
    return { ok: false, code: DISCOVERY_CODES.AUTH_FORBIDDEN, message: error.message };
  }
  if (config.authType !== 'no_auth' && !config.credentialRef) {
    return {
      ok: false,
      code: DISCOVERY_CODES.AUTH_UNAVAILABLE,
      message: `conexão '${config.name}' sem credentialRef (authType=${config.authType})`,
    };
  }
  return { ok: true };
}

/** Traduz erro de runtime (hub/SDK) em código de falha auditável. */
function mapDiscoveryError(error) {
  const message = String(error?.message || 'unknown');
  if (error?.code && DENIAL_CODE_SET.has(error.code)) return DISCOVERY_CODES.ENDPOINT_BLOCKED;
  if (/^no_configured_mcp_connection/.test(message)) return DISCOVERY_CODES.CONNECTION_NOT_FOUND;
  if (/^mcp_connection_disabled/.test(message)) return DISCOVERY_CODES.CONNECTION_DISABLED;
  if (/^mcp_connection_tenant_mismatch/.test(message)) return DISCOVERY_CODES.CONNECTION_TENANT_MISMATCH;
  if (/^(mcp_endpoint_rejected|mcp_endpoint_unresolvable)/.test(message)) return DISCOVERY_CODES.ENDPOINT_BLOCKED;
  if (/^mcp_auth_unavailable/.test(message)) return DISCOVERY_CODES.AUTH_UNAVAILABLE;
  if (/^mcp_auth_forbidden/.test(message)) return DISCOVERY_CODES.AUTH_FORBIDDEN;
  return DISCOVERY_CODES.DISCOVERY_FAILED;
}

/**
 * Monta um hub dedicado a UMA conexão persistida. Não há registry global: o hub
 * aqui serve apenas para falar com o servidor remoto; quem registra tools no
 * Canonical Tool Registry é o adapter, no runtime.
 */
function createHubForConnection({ config, deps = {} }) {
  const hub = createMcpClientHub({
    connections: [{ ...config, enabled: true }],
    logger,
    audit: typeof deps.audit === 'function' ? deps.audit : undefined,
    transportFactory: deps.transportFactory,
    clientFactory: deps.clientFactory,
    dnsLookup: deps.dnsLookup || defaultDnsLookup,
    credentialResolver: deps.credentialResolver || defaultCredentialResolver,
    now: deps.now,
  });
  return hub;
}

/**
 * Valida o inventário REAL devolvido por `tools/list`.
 * Protocolo violado (nome vazio, duplicado, não-string, tamanho absurdo) é
 * recusado: persistir um inventário inválido faria o runtime registrar tools
 * impossíveis de endereçar.
 */
function validateToolInventory(rawTools) {
  const tools = Array.isArray(rawTools) ? rawTools : [];
  const seen = new Set();
  for (const tool of tools) {
    const name = String(tool?.name || '').trim();
    if (!name) {
      return { valid: false, message: 'tool remota sem nome no inventário', toolCount: tools.length };
    }
    if (name.length > 128 || /[\u0000-\u001f]/.test(name)) {
      return { valid: false, message: `nome de tool inválido: '${name.slice(0, 40)}'`, toolCount: tools.length };
    }
    if (seen.has(name)) {
      return { valid: false, message: `tool duplicada no inventário: '${name}'`, toolCount: tools.length };
    }
    seen.add(name);
    const input = tool?.inputSchema;
    if (input !== undefined && input !== null && (typeof input !== 'object' || Array.isArray(input))) {
      return { valid: false, message: `inputSchema inválido em '${name}'`, toolCount: tools.length };
    }
  }
  return { valid: true, message: null, toolCount: tools.length };
}

/**
 * Negociação de capabilities: compara o que a conexão DECLARA com o que o
 * servidor remoto REALMENTE oferece. Divergência não é erro fatal (um servidor
 * pode expor subconjunto), mas precisa ser reportada — nunca silenciada.
 */
function negotiateCapabilities({ declared = [], toolCapabilityMap = {}, tools = [] }) {
  const observed = [...new Set(
    tools
      .map((tool) => tool.capability || toolCapabilityMap[String(tool?.name || '')] || null)
      .filter(Boolean),
  )].sort();
  const declaredSorted = [...declared].sort();
  return {
    declared: declaredSorted,
    observed,
    unmappedTools: tools.filter((tool) => !(tool.capability || toolCapabilityMap[String(tool?.name || '')]))
      .map((tool) => String(tool.name)),
    missingCapabilities: declaredSorted.filter((capability) => !observed.includes(capability)),
    unexpectedCapabilities: observed.filter((capability) => !declaredSorted.includes(capability)),
  };
}

/**
 * Anexa a capability CANÔNICA de cada tool remota usando o mapeamento persistido
 * (§M8). Capability não mapeada fica `null` — e a tool é reportada em
 * `unmappedTools`, nunca registrada com semântica inventada.
 */
function resolveToolCapabilities({ tools = [], config }) {
  return tools.map((tool) => ({
    ...tool,
    capability: resolveCapability(
      {
        toolCapabilityMap: config.toolCapabilityMap,
        allowedCapabilities: config.allowedCapabilities,
      },
      { name: tool.name },
    ),
  }));
}

/** Erro de pré-checagem/descoberta persistido como falha de saúde (§M11). */
async function recordFailure({ tenantId, id, code, message }) {
  let connection = null;
  try {
    connection = await connectionService.recordHealth({
      tenantId,
      id,
      ok: false,
      error: `${code}: ${message}`,
      degradedAfter: 1,
    });
  } catch (error) {
    logger.warn('[McpDiscovery] Falha ao registrar saúde negativa', { id, error: error.message });
  }
  return { ok: false, code, message, connection };
}

/**
 * §M9/§M12 — descoberta REAL de tools.
 *
 * @param {object} args
 * @param {string} args.tenantId
 * @param {string} args.id
 * @param {object} [args.deps]            `transportFactory`/`credentialResolver`/`dnsLookup`/`audit`
 * @param {'discover'|'revalidate'} [args.mode]
 * @returns {Promise<object>} sempre explícito: `{ok:true,...}` ou `{ok:false,code,...}`
 */
async function discoverConnectionTools({ tenantId, id, deps = {}, mode = 'discover' } = {}) {
  const row = await connectionService.getConnection({ tenantId, id });
  const config = connectionService.toConnectionConfig(row);

  const gate = preflight(config);
  if (!gate.ok) return recordFailure({ tenantId, id, code: gate.code, message: gate.message });

  const hub = createHubForConnection({ config, deps });
  let discovery;
  try {
    const result = await hub.discoverTools(config.name, { tenantId });
    discovery = result.discovery;
  } catch (error) {
    const code = mapDiscoveryError(error);
    return recordFailure({ tenantId, id, code, message: error.message });
  }

  const validation = validateToolInventory(discovery.tools);
  if (!validation.valid) {
    return recordFailure({
      tenantId,
      id,
      code: DISCOVERY_CODES.TOOL_INVENTORY_INVALID,
      message: validation.message,
    });
  }

  const tools = resolveToolCapabilities({ tools: discovery.tools, config });
  const negotiation = negotiateCapabilities({
    declared: config.allowedCapabilities,
    toolCapabilityMap: config.toolCapabilityMap,
    tools,
  });

  const persisted = mode === 'revalidate'
    ? await connectionService.recordRevalidation({ tenantId, id, tools })
    : await connectionService.recordDiscovery({ tenantId, id, tools });

  return {
    ok: true,
    code: null,
    mode,
    connection: persisted,
    tools,
    toolCount: tools.length,
    // `schemaFingerprint` é o contrato em VIGOR (aceito). Quando a descoberta
    // encontrou um contrato diferente, ele aparece em `observedSchemaFingerprint`
    // e a promoção exige `revalidate` — nunca acontece sozinha (§M12).
    schemaFingerprint: persisted.schema_fingerprint || persisted.schemaFingerprint || null,
    observedSchemaFingerprint: persisted.observedSchemaFingerprint || null,
    schemaChanged: persisted.schemaChanged === true,
    revalidationRequired: persisted.revalidationRequired === true,
    negotiation,
    inventorySource: 'remote_tools_list',
  };
}

/**
 * §M10 — teste de conexão REAL: resolve endpoint, aplica SSRF/TLS, autentica,
 * abre MCP e roda uma negociação de saúde/capabilities. Nunca declara sucesso sem
 * ter falado com o servidor.
 */
async function probeConnection({ tenantId, id, deps = {}, allowDisabledProbe = false } = {}) {
  const row = await connectionService.getConnection({ tenantId, id });
  const config = connectionService.toConnectionConfig(row);

  if (config.enabled === false && !allowDisabledProbe) {
    return recordFailure({
      tenantId,
      id,
      code: DISCOVERY_CODES.CONNECTION_DISABLED,
      message: `conexão '${config.name}' está desabilitada`,
    });
  }

  const gate = preflight(config);
  if (!gate.ok) return recordFailure({ tenantId, id, code: gate.code, message: gate.message });

  await connectionService.markValidating({ tenantId, id });

  const hub = createHubForConnection({ config, deps });
  const startedAt = Date.now();
  let client = null;
  try {
    ({ client } = await hub.connect(config.name, { tenantId }));
    const serverCapabilities = typeof client.getServerCapabilities === 'function'
      ? client.getServerCapabilities() || null
      : null;
    const serverVersion = typeof client.getServerVersion === 'function'
      ? client.getServerVersion() || null
      : null;
    const listed = await client.listTools();
    const tools = resolveToolCapabilities({ tools: listed.tools || [], config });
    const negotiation = negotiateCapabilities({
      declared: config.allowedCapabilities,
      toolCapabilityMap: config.toolCapabilityMap,
      tools,
    });
    const connection = await connectionService.recordHealth({ tenantId, id, ok: true });
    return {
      ok: true,
      code: null,
      connection,
      latencyMs: Date.now() - startedAt,
      toolCount: tools.length,
      serverCapabilities,
      serverVersion,
      negotiation,
      connectionEnabled: config.enabled !== false,
    };
  } catch (error) {
    const code = mapDiscoveryError(error);
    return recordFailure({ tenantId, id, code, message: error.message });
  } finally {
    try { await client?.close?.(); } catch (_) { /* best-effort */ }
  }
}

/**
 * §M12 — revalidação EXPLÍCITA do schema. Só existe quando há mudança pendente;
 * caso contrário responde `MCP_REVALIDATION_NOT_REQUIRED` (não é no-op silencioso
 * nem promoção automática).
 */
async function revalidateConnection({ tenantId, id, deps = {} } = {}) {
  const row = await connectionService.getConnection({ tenantId, id });
  const required = row.status === connectionService.LIFECYCLE_STATES.SCHEMA_CHANGED
    || row.metadata?.revalidationRequired === true;
  if (!required) {
    return {
      ok: false,
      code: DISCOVERY_CODES.REVALIDATION_NOT_REQUIRED,
      message: `revalidação não é exigida no estado atual (${row.status})`,
      connection: row,
    };
  }
  return discoverConnectionTools({ tenantId, id, deps, mode: 'revalidate' });
}

/**
 * §M11 — visão de saúde PERSISTIDA (somente leitura, sem ida à rede). O
 * diagnóstico "ao vivo" é `probeConnection`.
 */
async function getConnectionHealth({ tenantId, id }) {
  const row = await connectionService.getConnection({ tenantId, id });
  return {
    connectionId: row.id,
    name: row.name,
    tenant: row.tenant_key,
    enabled: row.enabled,
    status: row.status,
    lastHealthAt: row.last_health_at || null,
    lastSuccessAt: row.last_success_at || null,
    lastFailureAt: row.last_failure_at || null,
    lastDiscoveryAt: row.last_discovery_at || null,
    schemaRevalidatedAt: row.schema_revalidated_at || null,
    consecutiveFailures: Number(row.consecutive_failures) || 0,
    lastError: row.last_error || null,
    schemaFingerprint: row.schema_fingerprint || null,
    revalidationRequired: row.metadata?.revalidationRequired === true,
    discoveredToolCount: Array.isArray(row.discovered_tools) ? row.discovered_tools.length : 0,
    live: false,
  };
}

module.exports = {
  DISCOVERY_CODES,
  defaultDnsLookup,
  defaultCredentialResolver,
  discoveryError,
  endpointIsConfigured,
  preflight,
  mapDiscoveryError,
  createHubForConnection,
  validateToolInventory,
  negotiateCapabilities,
  resolveToolCapabilities,
  discoverConnectionTools,
  probeConnection,
  revalidateConnection,
  getConnectionHealth,
};
