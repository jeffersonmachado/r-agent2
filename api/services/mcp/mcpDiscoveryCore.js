'use strict';

/**
 * mcpDiscoveryCore — o NÚCLEO ÚNICO de descoberta do MCP Control Plane
 * (TAREFAS 68–73 e 90 da missão corretiva).
 *
 * Defeito que este módulo fecha: existiam DOIS caminhos de descoberta que
 * produziam resultados DIFERENTES para a mesma conexão:
 *
 *   - `POST /mcp/connections/:id/discover` (administração) falava com o servidor
 *     remoto e PERSISTIA inventário, fingerprint e saúde;
 *   - o startup (`startMcpClient` → `registerExternalMcpTools`) chamava
 *     `hub.discoverTools` e atualizava APENAS MEMÓRIA. Depois de um reinício, o
 *     banco continuava dizendo "descoberto" com o inventário velho — ou pior,
 *     dizia "nunca descoberto" enquanto o processo novo operava com um inventário
 *     que só existia na RAM daquele processo. Isso é "MCP funcionando só em
 *     memória", que é proibido.
 *
 * Aqui existe UMA rotina, com a mesma ordem nos dois caminhos:
 *
 *   conexão → preflight (SSRF/TLS/auth) → connect → tools/list → validação do
 *   inventário → resolução de capability → negociação → PERSIST discovery →
 *   PERSIST health
 *
 * O `store` é INJETADO e OBRIGATÓRIO: em produção é o `mcpConnectionService`
 * (Postgres); nos testes é um double que exercita a MESMA interface de
 * persistência. Não existe caminho "sem store": sem persistência o resultado é
 * um erro explícito (`MCP_DISCOVERY_STORE_REQUIRED`), nunca um sucesso em
 * memória.
 *
 * O que este módulo NÃO faz: registrar tools no Canonical Tool Registry. O
 * registry não existe no caminho administrativo (e não é autoridade de
 * descoberta); o registro é a etapa final do RUNTIME
 * (`api/services/mcp/mcpRuntimeDiscovery.js`), que consome EXATAMENTE o
 * resultado desta rotina. Uma descoberta, dois consumidores.
 */

const dns = require('dns');

const logger = require('../../utils/logger');
const { evaluateEndpoint } = require('../../../src/core/mcp/endpoint-policy');
const { evaluateAuthModeUse } = require('../../../src/core/mcp/auth-capabilities');
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
  /** O ciclo de descoberta NÃO tem caminho sem persistência (§TAREFA 69). */
  STORE_REQUIRED: 'MCP_DISCOVERY_STORE_REQUIRED',
  /** A descoberta aconteceu, mas gravar estado falhou: o resultado é FALHA. */
  PERSISTENCE_FAILED: 'MCP_PERSISTENCE_FAILED',
  /** Conexão sem relação persistida não pode ter descoberta persistida. */
  CONNECTION_NOT_PERSISTED: 'MCP_CONNECTION_NOT_PERSISTED',
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

/** Política de endpoint (SSRF/TLS) — pura, sem I/O e sem banco. */
function assertEndpointAllowed(endpoint, { classification = 'PRODUCTION', policy } = {}) {
  const decision = evaluateEndpoint({ endpoint, classification, policy });
  if (!decision || decision.allowed !== true) {
    throw discoveryError(
      'mcp_endpoint_blocked',
      `endpoint recusado pela política (${decision && decision.code ? decision.code : 'unknown'})`,
      { decision },
    );
  }
  return decision;
}

/** Modo de autenticação permitido para a classificação (no_auth nunca em PRODUCTION). */
function assertAuthAllowed(authType, classification) {
  const use = evaluateAuthModeUse(authType, { classification });
  if (!use.ok) {
    throw discoveryError('mcp_auth_forbidden', use.reason || 'auth mode recusado', { authState: use.state });
  }
  return use;
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
    assertEndpointAllowed(config.endpoint, {
      classification: config.classification,
      policy: config.endpointPolicy,
    });
  } catch (error) {
    return { ok: false, code: DISCOVERY_CODES.ENDPOINT_BLOCKED, message: error.message };
  }
  try {
    assertAuthAllowed(config.authType, config.classification);
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

/**
 * Store OFICIAL de persistência da descoberta (Postgres via control plane).
 * Requerido de forma LAZY para que o núcleo continue carregável sem banco.
 */
function createConnectionServiceStore() {
  const connectionService = require('./mcpConnectionService');
  return {
    recordDiscovery: (args) => connectionService.recordDiscovery(args),
    recordRevalidation: (args) => connectionService.recordRevalidation(args),
    recordHealth: (args) => connectionService.recordHealth(args),
  };
}

/**
 * Persiste a FALHA como saúde negativa — diagnóstico nunca é silêncio.
 * Um erro de escrita aqui é reportado no resultado (`healthError`) e no log,
 * jamais engolido.
 */
async function persistFailure({ store, tenantId, id, code, message }) {
  const result = {
    ok: false,
    code,
    message,
    connection: null,
    healthPersisted: false,
    healthError: null,
  };
  if (!id) {
    result.healthError = 'conexão sem id persistido: nada a gravar';
    return result;
  }
  try {
    result.connection = await store.recordHealth({
      tenantId,
      id,
      ok: false,
      error: `${code}: ${message}`,
      degradedAfter: 1,
    });
    result.healthPersisted = true;
  } catch (error) {
    result.healthError = error.message;
    logger.warn('[McpDiscoveryCore] Falha ao registrar saúde negativa', { id, error: error.message });
  }
  return result;
}

/**
 * A ROTINA ÚNICA (TAREFA 69).
 *
 * @param {object} args
 * @param {object} args.connection   config da conexão (hub-validada ou projetada)
 * @param {string|null} [args.connectionId]  id PERSISTIDO (obrigatório p/ gravar)
 * @param {object} args.hub          MCP Client Hub (transporte injetável em teste)
 * @param {object} args.store        store de persistência (OBRIGATÓRIO)
 * @param {'discover'|'revalidate'} [args.mode]
 * @returns {Promise<object>} `{ok:true,...}` ou `{ok:false,code,...}` — nunca ambíguo
 */
async function runDiscoveryCycle({ connection, connectionId = null, hub, store, mode = 'discover', logger: log = null } = {}) {
  const log2 = log || logger;
  if (!store || typeof store.recordDiscovery !== 'function' || typeof store.recordHealth !== 'function') {
    throw discoveryError(
      DISCOVERY_CODES.STORE_REQUIRED,
      'o ciclo de descoberta exige um store de persistência (nunca há caminho só-memória)',
    );
  }

  const config = connection || {};
  const tenantId = String(config.tenant || '');
  const id = connectionId || config.connectionId || null;

  const gate = preflight(config);
  if (!gate.ok) return persistFailure({ store, tenantId, id, code: gate.code, message: gate.message });

  if (!id) {
    return persistFailure({
      store,
      tenantId,
      id: null,
      code: DISCOVERY_CODES.CONNECTION_NOT_PERSISTED,
      message: `conexão '${config.name}' não tem relação persistida: a descoberta não pode ser gravada`,
    });
  }

  let discovery;
  try {
    const result = await hub.discoverTools(config.name, { tenantId });
    discovery = result.discovery;
  } catch (error) {
    return persistFailure({
      store,
      tenantId,
      id,
      code: mapDiscoveryError(error),
      message: error.message,
    });
  }

  const validation = validateToolInventory(discovery.tools);
  if (!validation.valid) {
    return persistFailure({
      store,
      tenantId,
      id,
      code: DISCOVERY_CODES.TOOL_INVENTORY_INVALID,
      message: validation.message,
    });
  }

  const tools = resolveToolCapabilities({ tools: discovery.tools, config });
  const negotiation = negotiateCapabilities({
    declared: config.allowedCapabilities || [],
    toolCapabilityMap: config.toolCapabilityMap || {},
    tools,
  });

  // ── PERSIST discovery (TAREFA 70/71) ────────────────────────────────────
  let persisted;
  try {
    persisted = mode === 'revalidate'
      ? await store.recordRevalidation({ tenantId, id, tools })
      : await store.recordDiscovery({ tenantId, id, tools });
  } catch (error) {
    return {
      ok: false,
      code: DISCOVERY_CODES.PERSISTENCE_FAILED,
      message: `descoberta NÃO persistida (${error.message})`,
      connection: null,
      persisted: false,
      discoveryPersisted: false,
      healthPersisted: false,
      tools,
      toolCount: tools.length,
      negotiation,
      inventorySource: 'remote_tools_list',
    };
  }

  // ── PERSIST health (TAREFA 71) ──────────────────────────────────────────
  let health = null;
  try {
    health = await store.recordHealth({ tenantId, id, ok: true, degradedAfter: 1 });
  } catch (error) {
    return {
      ok: false,
      code: DISCOVERY_CODES.PERSISTENCE_FAILED,
      message: `saúde NÃO persistida (${error.message})`,
      connection: persisted,
      persisted: false,
      discoveryPersisted: true,
      healthPersisted: false,
      tools,
      toolCount: tools.length,
      negotiation,
      inventorySource: 'remote_tools_list',
    };
  }

  const revalidationRequired = persisted.revalidationRequired === true;
  log2.info?.('[McpDiscoveryCore] Descoberta persistida', {
    connection: config.name,
    mode,
    toolCount: tools.length,
    schemaChanged: persisted.schemaChanged === true,
    revalidationRequired,
  });

  return {
    ok: true,
    code: null,
    mode,
    connection: persisted,
    health,
    tools,
    toolCount: tools.length,
    // `schemaFingerprint` é o contrato em VIGOR (aceito). Quando a descoberta
    // encontrou um contrato diferente, ele aparece em `observedSchemaFingerprint`
    // e a promoção exige `revalidate` — nunca acontece sozinha (§M12).
    schemaFingerprint: persisted.schema_fingerprint || persisted.schemaFingerprint || null,
    observedSchemaFingerprint: persisted.observedSchemaFingerprint || null,
    schemaChanged: persisted.schemaChanged === true,
    revalidationRequired,
    negotiation,
    inventorySource: 'remote_tools_list',
    persisted: true,
    discoveryPersisted: true,
    healthPersisted: true,
    lifecycleCounts: discovery.counts || null,
  };
}

module.exports = {
  DISCOVERY_CODES,
  defaultDnsLookup,
  defaultCredentialResolver,
  discoveryError,
  endpointIsConfigured,
  assertEndpointAllowed,
  assertAuthAllowed,
  preflight,
  mapDiscoveryError,
  validateToolInventory,
  negotiateCapabilities,
  resolveToolCapabilities,
  createConnectionServiceStore,
  runDiscoveryCycle,
};
