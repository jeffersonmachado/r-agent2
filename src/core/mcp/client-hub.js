'use strict';

/**
 * MCP Client Hub — fundação para o RAP atuar como MCP Client.
 *
 * Agentes NUNCA conectam URLs arbitrárias: toda conexão é registrada e
 * configurada (tenant, endpoint, auth reference, classificação, escopo de
 * capabilities/tools, timeout, retry). Segredos são referências
 * (ex.: nome de variável de ambiente), nunca valores — e nunca vão para logs.
 *
 * Sem conexão configurada: erro explícito `no_configured_mcp_connection`.
 * Tools externas entram no Cognitive Tool Registry via External MCP Tool
 * Adapter (external-tool-adapter.js) — o agente nunca chama MCP diretamente.
 */

function defaultLogger() {
  return require('../../../api/utils/logger');
}

const {
  evaluateEndpoint,
  evaluateResolvedAddresses,
  resolveTlsOptions,
  normalizeEndpointPolicy,
} = require('./endpoint-policy');
const { createMcpToolLifecycle } = require('./tool-lifecycle');
const { createMcpQuota } = require('./quota');

const CONNECTION_REQUIRED_FIELDS = ['tenant', 'name', 'endpoint'];

/** Modos de autenticação suportados (M7). `no_auth` exige opt-in explícito. */
const { buildAuthHeaders, AUTH_CAPABILITIES } = require('./auth-capabilities');

const AUTH_MODES = Object.freeze(Object.keys(AUTH_CAPABILITIES));

function validateConnection(connection) {
  for (const field of CONNECTION_REQUIRED_FIELDS) {
    if (!connection[field]) throw new Error(`mcp_connection_invalid: ${field} required (${connection.name || 'unnamed'})`);
  }
  const classification = String(connection.classification || 'PRODUCTION').toUpperCase();
  if (!['PRODUCTION', 'SUPPORT', 'DEVELOPMENT'].includes(classification)) {
    throw new Error(`mcp_connection_invalid: classification inválida (${connection.name})`);
  }

  // Fail closed na CONFIGURAÇÃO: um endpoint loopback/metadata/privado proibido
  // nunca chega a existir como conexão registrada.
  const endpointPolicy = normalizeEndpointPolicy(connection.endpointPolicy || {});
  const endpointDecision = evaluateEndpoint({
    endpoint: String(connection.endpoint),
    classification,
    policy: connection.endpointPolicy || {},
  });
  if (!endpointDecision.allowed) {
    const error = new Error(`mcp_endpoint_rejected: ${endpointDecision.code} (${connection.name})`);
    error.code = endpointDecision.code;
    error.detail = endpointDecision.detail;
    throw error;
  }

  const authType = String(connection.authType || 'bearer').toLowerCase();
  if (!AUTH_MODES.includes(authType)) {
    throw new Error(`mcp_connection_invalid: authType inválido '${connection.authType}' (${connection.name})`);
  }
  // Sem autenticação só com autorização explícita — nunca por omissão, e
  // nunca em PRODUCTION (fail closed na configuração, não só na conexão).
  if (authType === 'no_auth' && connection.allowNoAuth !== true) {
    throw new Error(`mcp_connection_invalid: no_auth exige allowNoAuth:true explícito (${connection.name})`);
  }
  if (authType === 'no_auth' && classification === 'PRODUCTION') {
    throw new Error(`mcp_connection_invalid: no_auth não é permitido em PRODUCTION (${connection.name})`);
  }
  // Credencial em claro é proibida: só referência (env/secret name).
  for (const forbidden of ['password', 'token', 'apiKey', 'api_key', 'clientSecret', 'client_secret', 'oauthSecret']) {
    if (connection[forbidden] !== undefined) {
      throw new Error(`mcp_connection_invalid: segredo em claro proibido ('${forbidden}'); use authRef/credentialRef (${connection.name})`);
    }
  }

  return Object.freeze({
    tenant: String(connection.tenant),
    name: String(connection.name),
    endpoint: String(connection.endpoint),
    authRef: connection.authRef || null, // referência (ex.: env var name) — nunca o segredo
    authType,
    credentialRef: connection.credentialRef || null,
    enabled: connection.enabled !== false,
    classification,
    allowedCapabilities: Object.freeze([...(connection.allowedCapabilities || [])]),
    allowedTools: Object.freeze([...(connection.allowedTools || [])]),
    toolCapabilityMap: Object.freeze({ ...(connection.toolCapabilityMap || {}) }),
    toolPolicies: Object.freeze({ ...(connection.toolPolicies || {}) }),
    endpointPolicy,
    allowNoAuth: connection.allowNoAuth === true,
    // Quota local (M49): declarada por conexão, aplicada por tenant/conexão/tool.
    quota: connection.quota || null,
    timeoutMs: Number(connection.timeoutMs) || 30000,
    retryPolicy: Object.freeze({ attempts: 1, ...(connection.retryPolicy || {}) }),
  });
}

function createMcpClientHub({
  connections = [],
  transportFactory,
  clientFactory,
  logger,
  lifecycle,
  quota,
  audit,
  dnsLookup,
  credentialResolver,
  now,
} = {}) {
  const log = logger || defaultLogger();
  // P1: Chave composta tenantId + connectionName — dois tenants podem ter 'erp'.
  const registry = new Map();
  const toolLifecycle = lifecycle || createMcpToolLifecycle({ logger: log, now });
  const quotaGuard = quota || createMcpQuota({ now });
  const clock = typeof now === 'function' ? now : () => Date.now();

  function _key(tenantId, name) {
    return `${String(tenantId)}:${String(name)}`;
  }

  for (const connection of connections) {
    const validated = validateConnection(connection);
    const key = _key(validated.tenant, validated.name);
    if (registry.has(key)) throw new Error(`mcp_connection_duplicate: ${key}`);
    registry.set(key, validated);
    // Quota declarada na conexão é registrada no guard LOCAL (M49).
    if (validated.quota) quotaGuard.configure(validated.quota);
  }

  function getConnection(name, { tenantId = null } = {}) {
    const tenant = String(tenantId || '').trim();
    // Fail closed: conexão é sempre endereçada por (tenant, name). Nunca
    // resolver por sufixo de nome — isso cruzaria tenants com conexões de
    // mesmo nome (ex.: 'erp' do tenant A vs. tenant B).
    if (!tenant) throw new Error(`mcp_connection_tenant_required: ${name}`);
    return registry.get(_key(tenant, String(name || ''))) || null;
  }

  function listConnections({ tenantId = null, classification = null } = {}) {
    const rank = { PRODUCTION: 0, SUPPORT: 1, DEVELOPMENT: 2 };
    return Array.from(registry.values())
      .filter((c) => !tenantId || c.tenant === tenantId)
      .filter((c) => !classification || rank[c.classification] <= (rank[String(classification).toUpperCase()] ?? 0))
      .map((c) => ({
        name: c.name,
        tenant: c.tenant,
        endpoint: c.endpoint,
        enabled: c.enabled,
        classification: c.classification,
        authType: c.authType,
        allowedCapabilities: [...c.allowedCapabilities],
        allowedTools: [...c.allowedTools],
        toolCapabilityMap: { ...c.toolCapabilityMap },
        // Política DECLARADA por tool: sem isto o adapter cairia sempre na
        // heurística e uma mutação declarada autônoma/idempotente seria
        // tratada como confirmação obrigatória (ou vice-versa).
        toolPolicies: { ...c.toolPolicies },
        endpointPolicy: { ...c.endpointPolicy },
        quota: c.quota ? { ...c.quota } : null,
        timeoutMs: c.timeoutMs,
        health: toolLifecycle.getConnectionState(_key(c.tenant, c.name))?.health || 'unknown',
        // authRef/credentialRef nunca são expostos em listagens/logs.
      }));
  }

  /**
   * Monta os headers de autenticação a partir do MODO declarado e da
   * REFERÊNCIA de credencial. O valor do segredo nunca é logado nem
   * devolvido ao chamador.
   *
   * `transportInjected` indica um transport fornecido pelo chamador (harness de
   * teste/embedding): nesse caso a autenticação, quando não declarada, é
   * responsabilidade do transport. No caminho de REDE REAL a ausência de
   * referência de credencial é erro explícito (fail closed) — nunca conexão
   * anônima silenciosa em PRODUCTION.
   */
  function resolveAuthHeaders(connection, { transportInjected = false } = {}) {
    if (connection.authType === 'no_auth') {
      if (connection.classification === 'PRODUCTION') {
        throw new Error(`mcp_auth_unavailable: no_auth não é permitido em PRODUCTION (${connection.name})`);
      }
      return {};
    }

    const hasReference = Boolean(connection.credentialRef || connection.authRef);
    if (!hasReference) {
      if (transportInjected) return {};
      throw new Error(
        `mcp_auth_unavailable: conexão '${connection.name}' sem authRef/credentialRef (authType=${connection.authType})`,
      );
    }

    let secret = null;
    if (connection.credentialRef && typeof credentialResolver === 'function') {
      secret = credentialResolver(connection.credentialRef, connection);
    }
    if (!secret && connection.authRef) {
      // authRef é uma REFERÊNCIA (nome de env var). O valor nunca é logado.
      secret = process.env[connection.authRef] || null;
    }
    if (!secret) {
      throw new Error(
        `mcp_auth_unavailable: credencial '${connection.credentialRef || connection.authRef}' não resolvida (${connection.name})`,
      );
    }

    // §M13–M16: verdade de autenticação vem da fonte única. O modo `mtls` é
    // UNSUPPORTED e é recusado aqui em vez de fingir autenticação com header de
    // referência de certificado (que não é handshake TLS).
    return buildAuthHeaders(connection.authType, secret, {
      classification: connection.classification,
      allowNoAuth: connection.allowNoAuth === true,
    });
  }

  function defaultTransportFactory(connection, authHeaders) {
    const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const url = new URL(connection.endpoint);
    const tls = resolveTlsOptions({ classification: connection.classification, policy: connection.endpointPolicy });
    return new StreamableHTTPClientTransport(url, {
      requestInit: Object.keys(authHeaders).length > 0 ? { headers: authHeaders } : undefined,
      // `rejectUnauthorized` só é false com política explícita não-PRODUCTION
      // justificada (resolveTlsOptions garante isso).
      ...(tls.insecure ? { rejectUnauthorized: false } : {}),
    });
  }

  /**
   * Revalida o destino ANTES de abrir a conexão (DNS rebinding).
   * Só é executado no caminho de rede REAL (transportFactory default):
   * transports injetados em teste não têm DNS.
   */
  async function assertResolvedEndpointSafe(connection) {
    if (typeof dnsLookup !== 'function') return { skipped: true, reason: 'no_dns_lookup_configured' };
    const hostname = new URL(connection.endpoint).hostname;
    let addresses;
    try {
      addresses = await dnsLookup(hostname);
    } catch (error) {
      throw new Error(`mcp_endpoint_unresolvable: ${hostname} (${error.message})`);
    }
    const decision = evaluateResolvedAddresses({
      hostname,
      addresses: Array.isArray(addresses) ? addresses : [addresses],
      classification: connection.classification,
      policy: connection.endpointPolicy,
    });
    if (!decision.allowed) {
      const error = new Error(`mcp_endpoint_rejected: ${decision.code} (${connection.name} → ${hostname})`);
      error.code = decision.code;
      error.detail = decision.detail;
      throw error;
    }
    return { skipped: false, addresses };
  }

  /**
   * Conecta a um MCP server externo REGISTRADO. Erros explícitos:
   *  - no_configured_mcp_connection (nome desconhecido)
   *  - mcp_connection_disabled
   *  - mcp_connection_tenant_mismatch
   */
  async function connect(name, { tenantId = null } = {}) {
    const connection = getConnection(name, { tenantId });
    if (!connection) {
      // Verifica se existe com outro tenant para dar erro mais específico.
      if (tenantId) {
        const allForName = Array.from(registry.values()).filter((c) => c.name === String(name || ''));
        if (allForName.length > 0) {
          throw new Error(`mcp_connection_tenant_mismatch: ${name} pertence ao(s) tenant(s) '${allForName.map((c) => c.tenant).join(', ')}'`);
        }
      }
      throw new Error(`no_configured_mcp_connection: ${name} (tenant=${tenantId})`);
    }
    if (!connection.enabled) throw new Error(`mcp_connection_disabled: ${name}`);

    const connectionKey = _key(connection.tenant, connection.name);

    // Defesa em profundidade: revalida o endpoint declarado a cada conexão.
    const endpointDecision = evaluateEndpoint({
      endpoint: connection.endpoint,
      classification: connection.classification,
      policy: connection.endpointPolicy,
    });
    if (!endpointDecision.allowed) {
      const error = new Error(`mcp_endpoint_rejected: ${endpointDecision.code} (${connection.name})`);
      error.code = endpointDecision.code;
      throw error;
    }

    // Transport/cliente injetado ⇒ a autenticação é responsabilidade do
    // chamador (harness de teste/embedding). Apenas em um deles injetado o
    // caminho é o de REDE REAL, onde credencial ausente é erro explícito.
    const authHeaders = resolveAuthHeaders(connection, {
      transportInjected: Boolean(transportFactory || clientFactory),
    });

    // Caminho de rede REAL: revalida o IP resolvido (DNS rebinding).
    if (!transportFactory) {
      await assertResolvedEndpointSafe(connection);
    }

    const makeTransport = transportFactory || defaultTransportFactory;
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');

    const client = clientFactory
      ? clientFactory(connection)
      : new Client({ name: 'rap-mcp-client', version: '1.0.0' }, { capabilities: {} });

    try {
      await client.connect(makeTransport(connection, authHeaders));
    } catch (error) {
      toolLifecycle.recordDiscoveryFailure(connectionKey, error);
      throw error;
    }
    toolLifecycle.recordCallSuccess(connectionKey, { latencyMs: null });

    log.info('[McpClientHub] Connected', { connection: connection.name, tenant: connection.tenant });
    return { client, connection };
  }

  /**
   * Conecta, executa `tools/list` e aplica o resultado ao ciclo de vida.
   *
   * Falha de descoberta NÃO derruba o processo: marca a conexão como
   * indisponível e as tools como `unavailable` (o agente precisa saber que a
   * capability está degradada — não que ela não existe).
   */
  async function discoverTools(name, { tenantId = null } = {}) {
    const connection = getConnection(name, { tenantId });
    if (!connection) {
      if (tenantId) {
        const allForName = Array.from(registry.values()).filter((c) => c.name === String(name || ''));
        if (allForName.length > 0) {
          throw new Error(`mcp_connection_tenant_mismatch: ${name} pertence ao(s) tenant(s) '${allForName.map((c) => c.tenant).join(', ')}'`);
        }
      }
      throw new Error(`no_configured_mcp_connection: ${name} (tenant=${tenantId})`);
    }
    if (!connection.enabled) throw new Error(`mcp_connection_disabled: ${name}`);

    const connectionKey = _key(connection.tenant, connection.name);
    let client;
    try {
      ({ client } = await connect(name, { tenantId }));
      const result = await client.listTools();
      const discovery = toolLifecycle.applyDiscovery(connectionKey, { remoteTools: result.tools || [] });
      return { connection, discovery };
    } catch (error) {
      toolLifecycle.recordDiscoveryFailure(connectionKey, error);
      throw error;
    } finally {
      try { await client?.close?.(); } catch (_) { /* best-effort */ }
    }
  }

  /**
   * Executa uma tool em um MCP server externo, respeitando escopo declarado
   * (allowedTools / allowedCapabilities) da conexão registrada, o CICLO DE VIDA
   * real da tool (descoberta/validação/schema) e o circuit breaker.
   *
   * Uma tool indisponível NUNCA é executada "porque a conexão existia no
   * startup": a disponibilidade é derivada de descoberta + saúde + fingerprint.
   */
  async function callTool(name, toolName, args = {}, { tenantId = null, toolPolicy = null, principalId = null } = {}) {
    const connection = getConnection(name, { tenantId });
    if (!connection) {
      if (tenantId) {
        const allForName = Array.from(registry.values()).filter((c) => c.name === String(name || ''));
        if (allForName.length > 0) {
          throw new Error(`mcp_connection_tenant_mismatch: ${name} pertence ao(s) tenant(s) '${allForName.map((c) => c.tenant).join(', ')}'`);
        }
      }
      throw new Error(`no_configured_mcp_connection: ${name} (tenant=${tenantId})`);
    }

    if (connection.allowedTools.length > 0 && !connection.allowedTools.includes(toolName)) {
      throw new Error(`mcp_tool_not_allowed: ${toolName} não está no escopo da conexão '${name}'`);
    }

    const connectionKey = _key(connection.tenant, connection.name);

    // Disponibilidade REAL (lifecycle + schema + saúde) — fail closed.
    const availability = toolLifecycle.getToolAvailability(connectionKey, toolName);
    if (!availability.available) {
      const error = new Error(`mcp_tool_unavailable: ${name}/${toolName} (${availability.reason})`);
      error.code = availability.reason;
      error.availability = availability;
      emitAudit({ connection, toolName, principalId, outcome: 'unavailable', reason: availability.reason });
      throw error;
    }

    // Quota local (M49): antes de qualquer ida à rede. Um loop de agente ou
    // um tenant abusivo não pode consumir cota remota antes do limite local.
    const quotaDecision = quotaGuard.acquire({
      tenantId: connection.tenant,
      connection: connection.name,
      tool: toolName,
    });
    if (!quotaDecision.allowed) {
      const error = new Error(`mcp_quota_exceeded: ${name}/${toolName} (${quotaDecision.violatedScope})`);
      error.code = quotaDecision.reason;
      error.retryAfterMs = quotaDecision.retryAfterMs;
      error.violatedScope = quotaDecision.violatedScope;
      emitAudit({
        connection, toolName, principalId,
        outcome: 'denied', reason: `${quotaDecision.reason}:${quotaDecision.violatedScope}`,
      });
      throw error;
    }

    // Permissão de chamada (circuit breaker) — não vai à rede com circuito aberto.
    const permit = toolLifecycle.acquireCallPermit(connectionKey);
    if (!permit.allowed) {
      // Circuito aberto: a cota consumida é devolvida (não houve operação).
      quotaGuard.release({ tenantId: connection.tenant, connection: connection.name, tool: toolName });
      const error = new Error(`mcp_tool_unavailable: ${name}/${toolName} (${permit.reason})`);
      error.code = permit.reason;
      emitAudit({ connection, toolName, principalId, outcome: 'denied', reason: permit.reason });
      throw error;
    }

    // Retry: policy da tool manda. Side effect sem idempotência garantida NUNCA
    // é reexecutado às cegas (operação ambígua) — 1 tentativa.
    //
    // Ambiguidade: se a tentativa falha por timeout/falha de transporte, a
    // operação PODE ter sido aplicada no provedor remoto sem resposta. Repetir
    // um efeito não idempotente duplicaria a consequência (cobrança, envio,
    // cancelamento). A política efetiva vem do parâmetro da chamada e, na
    // ausência dele, da política declarada por tool na conexão.
    const effectivePolicy = toolPolicy || connection.toolPolicies?.[toolName] || null;
    const declaresSideEffects = effectivePolicy?.sideEffects === true;
    const declaresIdempotency = effectivePolicy?.idempotent === true
      || effectivePolicy?.idempotencyGuaranteed === true;
    const ambiguousSideEffect = declaresSideEffects && !declaresIdempotency;

    const policyAttempts = Number(effectivePolicy?.retryPolicy?.attempts) || null;
    const requestedAttempts = Math.max(1, policyAttempts || connection.retryPolicy.attempts || 1);
    const attempts = ambiguousSideEffect ? 1 : requestedAttempts;
    const timeout = Number(effectivePolicy?.timeoutMs) || connection.timeoutMs;

    if (ambiguousSideEffect && requestedAttempts > 1) {
      // Não é silêncio: a supressão do retry é auditada com o motivo.
      emitAudit({
        connection,
        toolName,
        principalId,
        outcome: 'retry_withheld',
        reason: 'ambiguous_side_effect_without_idempotency',
        requestedAttempts,
      });
    }

    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let client;
      const startedAt = clock();
      try {
        ({ client } = await connect(name, { tenantId }));
        const result = await client.callTool({ name: toolName, arguments: args }, undefined, {
          timeout,
        });
        const latencyMs = clock() - startedAt;
        toolLifecycle.recordCallSuccess(connectionKey, { latencyMs });
        emitAudit({ connection, toolName, principalId, outcome: result?.isError ? 'remote_error' : 'success', latencyMs });
        return result;
      } catch (error) {
        lastError = error;
        toolLifecycle.recordCallFailure(connectionKey, error, { latencyMs: clock() - startedAt });
        emitAudit({ connection, toolName, principalId, outcome: 'failure', reason: error.message });
        log.warn('[McpClientHub] callTool failed', {
          connection: name, tool: toolName, attempt, error: error.message,
        });
        // Backoff exponencial entre tentativas (evita loop apertado de
        // reconexão quando o endpoint MCP falha rápido/imediato).
        if (attempt < attempts) {
          const delay = Math.min(2000, 250 * (2 ** (attempt - 1)));
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      } finally {
        try { await client?.close?.(); } catch (_) { /* best-effort */ }
      }
    }
    throw new Error(`mcp_call_failed: ${name}/${toolName}: ${lastError?.message || 'unknown'}`);
  }

  function emitAudit({ connection, toolName, principalId, outcome, latencyMs = null, reason = null, requestedAttempts = null }) {
    if (typeof audit !== 'function') return;
    try {
      audit({
        event: 'mcp_tool_invocation',
        tenantId: connection.tenant,
        connection: connection.name,
        tool: toolName,
        principalId,
        classification: connection.classification,
        outcome,
        latencyMs,
        reason,
        requestedAttempts,
        at: new Date(clock()).toISOString(),
      });
    } catch (error) {
      // Auditoria nunca derruba a operação, mas a falha não é silenciosa.
      log.warn('[McpClientHub] Falha ao emitir auditoria MCP', { error: error.message });
    }
  }

  return {
    getConnection,
    listConnections,
    connect,
    callTool,
    discoverTools,
    // Ciclo de vida/descoberta expostos para o adapter e para observabilidade.
    lifecycle: toolLifecycle,
    quota: quotaGuard,
    applyDiscovery: (tenantId, name, discovery) => toolLifecycle.applyDiscovery(_key(tenantId, name), discovery),
    getConnectionState: (tenantId, name) => toolLifecycle.getConnectionState(_key(tenantId, name)),
    size: () => registry.size,
  };
}

module.exports = { createMcpClientHub, validateConnection, AUTH_MODES };
