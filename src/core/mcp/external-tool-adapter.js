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
const { resolveToolPolicy, sanitizeRemoteDescription, redactToolOutput } = require('./tool-policy');

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
 * Resolve a capability canônica de uma tool remota.
 *
 * REGRA: nunca `allowedCapabilities[0]` cego quando há mais de uma. O
 * mapeamento explícito (`toolCapabilityMap`) é a autoridade; sem ele, só é
 * aceito quando a conexão declara EXATAMENTE uma capability (caso
 * unívoco). Caso contrário a tool não é registrada — não se inventa semântica.
 */
function resolveCapability(connection, remoteTool) {
  const map = connection.toolCapabilityMap || {};
  if (map[remoteTool.name]) return String(map[remoteTool.name]);
  if (connection.allowedCapabilities.length === 1) return connection.allowedCapabilities[0];
  return null;
}

/**
 * Registra proxies das tools externas permitidas de cada conexão habilitada.
 *
 * Cada proxy carrega a POLÍTICA EFETIVA da tool (risco, side effect,
 * confirmação, idempotência, timeout, redaction) resolvida por
 * `resolveToolPolicy` — não a política genérica que tratava leitura e mutação
 * financeira como o mesmo caso.
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
    let discovery;
    try {
      const result = await hub.discoverTools(connection.name, { tenantId: connection.tenant });
      discovery = result.discovery;
    } catch (error) {
      skipped.push({ connection: connection.name, reason: 'connection_failed', error: error.message });
      log.warn('[ExternalMcpToolAdapter] Connection failed; skipping', {
        connection: connection.name, error: error.message,
      });
      continue;
    }

    for (const remoteTool of discovery.tools) {
      if (connection.allowedTools.length > 0 && !connection.allowedTools.includes(remoteTool.name)) {
        skipped.push({ connection: connection.name, tool: remoteTool.name, reason: 'tool_not_in_allowed_scope' });
        continue;
      }

      const capability = resolveCapability(connection, remoteTool);
      if (!capability) {
        skipped.push({
          connection: connection.name,
          tool: remoteTool.name,
          reason: 'external_tool_capability_unmapped',
          detail: 'Defina toolCapabilityMap na conexão ou tenha exatamente 1 allowedCapability.',
        });
        continue;
      }

      // A descrição remota é METADATA não confiável: sanitizada e marcada
      // `trusted: false`. Nunca vira instrução de sistema.
      const safeDescription = sanitizeRemoteDescription(remoteTool.description);
      if (safeDescription.removedInstructional.length > 0) {
        log.warn('[ExternalMcpToolAdapter] Descrição remota continha conteúdo instrucional (tratado como dado)', {
          connection: connection.name,
          tool: remoteTool.name,
          matches: safeDescription.removedInstructional,
        });
      }

      const toolPolicy = resolveToolPolicy({
        toolName: remoteTool.name,
        declaration: connection.toolPolicies?.[remoteTool.name] || null,
        remoteAnnotations: remoteTool.annotations || null,
        classification: connection.classification,
      });

      const tenantToken = externalMcpTenantToken(connection.tenant);
      const toolId = `mcp.t${tenantToken}.${sanitizeToolIdPart(connection.name)}.${sanitizeToolIdPart(remoteTool.name)}`;
      try {
        toolRegistry.register({
          id: toolId,
          capability,
          visibility: connection.classification,
          permissions: [`mcp.t${tenantToken}.${sanitizeToolIdPart(connection.name)}`],
          description: `[MCP externo: ${connection.name}] ${safeDescription.text}`,
          inputSchema: remoteTool.inputSchema && typeof remoteTool.inputSchema === 'object'
            ? remoteTool.inputSchema
            : { type: 'object', additionalProperties: true },
          riskLevel: toolPolicy.riskLevel,
          sideEffects: toolPolicy.sideEffects,
          confirmationPolicy: toolPolicy.confirmationPolicy,
          idempotencyPolicy: toolPolicy.idempotencyPolicy,
          executionMode: toolPolicy.executionMode,
          version: '1.0.0',
          metadata: Object.freeze({
            source: 'external_mcp',
            descriptionTrusted: false,
            sensitivity: toolPolicy.sensitivity,
            policyProvenance: toolPolicy.provenance,
          }),
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
              principalId: context.actor?.principalId || context.actor?.userId || null,
              toolPolicy,
            });
            const text = (result.content || [])
              .filter((c) => c.type === 'text')
              .map((c) => c.text)
              .join('\n');
            if (result.isError) {
              throw new Error(`mcp_remote_tool_failed: ${connection.name}/${remoteTool.name}: ${text}`);
            }
            // Redaction ANTES de devolver ao agente/modelo.
            const safeContent = redactToolOutput(result.content || [], { policy: toolPolicy });
            const safeText = redactToolOutput(text, { policy: toolPolicy });
            return { remote: connection.name, tool: remoteTool.name, content: safeContent, text: safeText };
          },
        });

        // Ativação explícita: a declaração da conexão (allowedTools +
        // toolCapabilityMap) É a validação local da tool. Mudanças POSTERIORES
        // de schema remoto continuam exigindo revalidação.
        hub.lifecycle.validateTool(`${connection.tenant}:${connection.name}`, remoteTool.name);
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

module.exports = { registerExternalMcpTools, externalMcpTenantToken, resolveCapability };
