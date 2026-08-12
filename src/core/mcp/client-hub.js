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

const CONNECTION_REQUIRED_FIELDS = ['tenant', 'name', 'endpoint'];

function validateConnection(connection) {
  for (const field of CONNECTION_REQUIRED_FIELDS) {
    if (!connection[field]) throw new Error(`mcp_connection_invalid: ${field} required (${connection.name || 'unnamed'})`);
  }
  const classification = String(connection.classification || 'PRODUCTION').toUpperCase();
  if (!['PRODUCTION', 'SUPPORT', 'DEVELOPMENT'].includes(classification)) {
    throw new Error(`mcp_connection_invalid: classification inválida (${connection.name})`);
  }
  return Object.freeze({
    tenant: String(connection.tenant),
    name: String(connection.name),
    endpoint: String(connection.endpoint),
    authRef: connection.authRef || null, // referência (ex.: env var name) — nunca o segredo
    enabled: connection.enabled !== false,
    classification,
    allowedCapabilities: Object.freeze([...(connection.allowedCapabilities || [])]),
    allowedTools: Object.freeze([...(connection.allowedTools || [])]),
    toolCapabilityMap: Object.freeze({ ...(connection.toolCapabilityMap || {}) }),
    timeoutMs: Number(connection.timeoutMs) || 30000,
    retryPolicy: Object.freeze({ attempts: 1, ...(connection.retryPolicy || {}) }),
  });
}

function createMcpClientHub({ connections = [], transportFactory, clientFactory, logger } = {}) {
  const log = logger || defaultLogger();
  // P1: Chave composta tenantId + connectionName — dois tenants podem ter 'erp'.
  const registry = new Map();

  function _key(tenantId, name) {
    return `${String(tenantId)}:${String(name)}`;
  }

  for (const connection of connections) {
    const validated = validateConnection(connection);
    const key = _key(validated.tenant, validated.name);
    if (registry.has(key)) throw new Error(`mcp_connection_duplicate: ${key}`);
    registry.set(key, validated);
  }

  function getConnection(name, { tenantId = null } = {}) {
    const tenant = String(tenantId || '');
    const key = tenant ? _key(tenant, String(name || '')) : null;
    if (key && registry.has(key)) return registry.get(key);
    // Fallback: busca por nome apenas (backward compat).
    if (!tenant) {
      for (const [k, v] of registry) {
        if (k.endsWith(`:${String(name || '')}`)) return v;
      }
    }
    return null;
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
        allowedCapabilities: [...c.allowedCapabilities],
        allowedTools: [...c.allowedTools],
        timeoutMs: c.timeoutMs,
        // authRef nunca é exposto em listagens/logs.
      }));
  }

  function defaultTransportFactory(connection, authToken) {
    const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const url = new URL(connection.endpoint);
    return new StreamableHTTPClientTransport(url, {
      requestInit: authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : undefined,
    });
  }

  function resolveAuthToken(connection) {
    if (!connection.authRef) return null;
    // authRef é uma REFERÊNCIA (nome de env var). O valor nunca é logado.
    const token = process.env[connection.authRef];
    if (!token) throw new Error(`mcp_auth_unavailable: credencial '${connection.authRef}' não resolvida (${connection.name})`);
    return token;
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

    const authToken = resolveAuthToken(connection);
    const makeTransport = transportFactory || defaultTransportFactory;
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');

    const client = clientFactory
      ? clientFactory(connection)
      : new Client({ name: 'rap-mcp-client', version: '1.0.0' }, { capabilities: {} });

    await client.connect(makeTransport(connection, authToken));

    log.info('[McpClientHub] Connected', { connection: connection.name, tenant: connection.tenant });
    return { client, connection };
  }

  /**
   * Executa uma tool em um MCP server externo, respeitando escopo declarado
   * (allowedTools / allowedCapabilities) da conexão registrada.
   */
  async function callTool(name, toolName, args = {}, { tenantId = null } = {}) {
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

    const attempts = Math.max(1, connection.retryPolicy.attempts || 1);
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let client;
      try {
        ({ client } = await connect(name, { tenantId }));
        const result = await client.callTool({ name: toolName, arguments: args }, undefined, {
          timeout: connection.timeoutMs,
        });
        return result;
      } catch (error) {
        lastError = error;
        log.warn('[McpClientHub] callTool failed', {
          connection: name, tool: toolName, attempt, error: error.message,
        });
      } finally {
        try { await client?.close?.(); } catch (_) { /* best-effort */ }
      }
    }
    throw new Error(`mcp_call_failed: ${name}/${toolName}: ${lastError?.message || 'unknown'}`);
  }

  return { getConnection, listConnections, connect, callTool, size: () => registry.size };
}

module.exports = { createMcpClientHub, validateConnection };
