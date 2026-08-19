'use strict';

/**
 * External MCP Tool Adapter — registra tools de MCP servers externos no
 * Canonical Tool Registry como proxies governados.
 *
 * Fluxo obrigatório:
 *   Agent → Plan → Execution Engine → Tool Registry → ESTE adapter → MCP Client
 *
 * Isso preserva permissions, audit, tenant, idempotência, risco, validação e
 * learning: o agente nunca chama MCP externo diretamente.
 *
 * Cada tool externa vira uma tool canônica
 * `mcp.t<tenantToken>.<connection>.<tool>` cuja visibility/permissions vêm da
 * conexão REGISTRADA (Client Hub) — nunca de configuração fornecida pelo
 * agente em runtime.
 *
 * `tenantToken` é um hash SHA-256 truncado (12 hex) do tenantId: determinístico,
 * evita colisão silenciosa de toolId entre tenants com conexão de mesmo nome
 * (o segundo registro virava `skipped` via cognitive_tool_duplicate) e não
 * expõe o tenantId em ids listados para outros tenants. A permissão exigida
 * (`mcp.t<tenantToken>.<connection>`) é igualmente escopada, então um ator de
 * outro tenant não lista nem executa a tool no registry — e a execução ainda
 * valida que o tenant do contexto governado é o tenant da conexão.
 */

const crypto = require('crypto');

function defaultLogger() {
  return require('../../../api/utils/logger');
}

function sanitizeToolIdPart(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

/**
 * Token opaco e determinístico do tenant para ids/permissões de tools
 * externas (não reversível, não vaza tenantId).
 */
function externalMcpTenantToken(tenantId) {
  return crypto.createHash('sha256').update(String(tenantId)).digest('hex').slice(0, 12);
}

/**
 * Registra proxies das tools externas permitidas de cada conexão habilitada.
 *
 * @param {object} args
 * @param {object} args.toolRegistry  Canonical Tool Registry
 * @param {object} args.hub           MCP Client Hub
 * @param {object} [args.logger]
 * @returns {Promise<{registered: string[], skipped: object[], reason?: string}>}
 */
async function registerExternalMcpTools({ toolRegistry, hub, logger } = {}) {
  if (!toolRegistry) throw new Error('external_mcp_adapter_registry_required');
  if (!hub) throw new Error('external_mcp_adapter_hub_required');
  const log = logger || defaultLogger();

  const connections = hub.listConnections().filter((c) => c.enabled);
  if (connections.length === 0) {
    // Nenhum MCP externo configurado: estado explícito, não fake success.
    return { registered: [], skipped: [], reason: 'no_configured_mcp_connection' };
  }

  const registered = [];
  const skipped = [];

  for (const connection of connections) {
    let remoteTools;
    try {
      const { client } = await hub.connect(connection.name, { tenantId: connection.tenant });
      try {
        const result = await client.listTools();
        remoteTools = result.tools || [];
      } finally {
        try { await client.close?.(); } catch (_) { /* best-effort */ }
      }
    } catch (error) {
      skipped.push({ connection: connection.name, reason: 'connection_failed', error: error.message });
      log.warn('[ExternalMcpToolAdapter] Connection failed; skipping', {
        connection: connection.name, error: error.message,
      });
      continue;
    }

    for (const remoteTool of remoteTools) {
      if (connection.allowedTools.length > 0 && !connection.allowedTools.includes(remoteTool.name)) {
        skipped.push({ connection: connection.name, tool: remoteTool.name, reason: 'tool_not_in_allowed_scope' });
        continue;
      }

      // P1: Mapeamento explícito tool → capability (nunca allowedCapabilities[0] cego).
      const toolCapabilityMap = connection.toolCapabilityMap || {};
      const capability = toolCapabilityMap[remoteTool.name]
        || (connection.allowedCapabilities.length === 1 ? connection.allowedCapabilities[0] : null);

      if (!capability) {
        skipped.push({
          connection: connection.name,
          tool: remoteTool.name,
          reason: 'external_tool_capability_unmapped',
          detail: 'Defina toolCapabilityMap na conexão ou tenha exatamente 1 allowedCapability.',
        });
        continue;
      }

      const tenantToken = externalMcpTenantToken(connection.tenant);
      const toolId = `mcp.t${tenantToken}.${sanitizeToolIdPart(connection.name)}.${sanitizeToolIdPart(remoteTool.name)}`;
      try {
        toolRegistry.register({
          id: toolId,
          capability,
          visibility: connection.classification,
          permissions: [`mcp.t${tenantToken}.${sanitizeToolIdPart(connection.name)}`],
          description: `[MCP externo: ${connection.name}] ${remoteTool.description || remoteTool.name}`,
          inputSchema: remoteTool.inputSchema && typeof remoteTool.inputSchema === 'object'
            ? remoteTool.inputSchema
            : { type: 'object', additionalProperties: true },
          riskLevel: 'medium',
          sideEffects: true,
          confirmationPolicy: 'policy_based',
          idempotencyPolicy: 'recommended',
          executionMode: 'atomic',
          version: '1.0.0',
          execute: async (input, context) => {
            // Tenant e correlação vêm do contexto governado, nunca do input.
            // A tool pertence à conexão registrada DESTE tenant: se o tenant
            // do contexto não é o da conexão, fail closed (mesmo com '*'),
            // sem revelar qual tenant é o dono.
            if (String(context?.tenantId || '') !== connection.tenant) {
              throw new Error(`mcp_connection_tenant_mismatch: ${connection.name} não pertence ao tenant do contexto`);
            }
            const result = await hub.callTool(connection.name, remoteTool.name, input, {
              tenantId: context.tenantId,
            });
            const text = (result.content || [])
              .filter((c) => c.type === 'text')
              .map((c) => c.text)
              .join('\n');
            if (result.isError) {
              throw new Error(`mcp_remote_tool_failed: ${connection.name}/${remoteTool.name}: ${text}`);
            }
            return { remote: connection.name, tool: remoteTool.name, content: result.content || [], text };
          },
        });
        registered.push(toolId);
      } catch (error) {
        skipped.push({ connection: connection.name, tool: remoteTool.name, reason: 'register_failed', error: error.message });
      }
    }
  }

  log.info('[ExternalMcpToolAdapter] External MCP tools registered', {
    registered: registered.length, skipped: skipped.length,
  });
  return { registered, skipped };
}

module.exports = { registerExternalMcpTools, externalMcpTenantToken };
