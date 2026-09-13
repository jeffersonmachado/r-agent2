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

const logger = require('../../utils/logger');
const connectionService = require('./mcpConnectionService');
const { createMcpClientHub } = require('../../../src/core/mcp/client-hub');
const core = require('./mcpDiscoveryCore');

/**
 * A descoberta REAL vive em `mcpDiscoveryCore` — rotina ÚNICA compartilhada com o
 * startup (TAREFA 69). Este módulo é o adaptador do caminho administrativo/HTTP:
 * resolve a conexão PERSISTIDA, monta o hub dedicado e expõe as operações de
 * diagnóstico (`probe`), revalidação explícita e leitura de saúde.
 *
 * As funções puras são RE-EXPORTADAS do núcleo, mantendo a MESMA referência de
 * função: não existe segunda implementação de validação/preflight para divergir
 * da que o startup usa.
 */
const {
  DISCOVERY_CODES,
  defaultDnsLookup,
  defaultCredentialResolver,
  discoveryError,
  endpointIsConfigured,
  preflight,
  mapDiscoveryError,
  validateToolInventory,
  negotiateCapabilities,
  resolveToolCapabilities,
  runDiscoveryCycle,
} = core;

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
 * Validação de inventário, negociação de capabilities e resolução de capability
 * canônica NÃO são reimplementadas aqui: são as funções do núcleo único
 * (`mcpDiscoveryCore`), re-exportadas no fim deste módulo para compatibilidade.
 */

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

  // Fail-closed ANTES de construir o hub: endpoint ausente ou proibido pela
  // política não chega a abrir transporte nenhum. A verificação é a MESMA do
  // núcleo (`preflight`), feita aqui para que o resultado seja o código de
  // descoberta (`MCP_ENDPOINT_NOT_CONFIGURED`) e não um erro de construção.
  const gate = preflight(config);
  if (!gate.ok) return recordFailure({ tenantId, id, code: gate.code, message: gate.message });

  // §TAREFA 69 — ROTINA ÚNICA. Antes este caminho REIMPLEMENTAVA a cadeia
  // (preflight → discoverTools → validate → resolve → negociate → persist), o
  // que criava duas implementações capazes de divergir do startup em silêncio
  // (foi assim que o startup passou a atualizar só memória enquanto o admin
  // persistia). Agora ambos chamam `runDiscoveryCycle`.
  const hub = createHubForConnection({ config, deps });
  return runDiscoveryCycle({
    connection: config,
    connectionId: id,
    hub,
    store: connectionService,
    mode,
    logger,
  });
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
