'use strict';

/**
 * MCP Server Adapter — expõe o RAP como MCP Server usando o SDK oficial
 * (@modelcontextprotocol/sdk).
 *
 * Princípios:
 *  - A lista de tools é DERIVADA do Canonical Tool Registry (fonte da verdade).
 *    Não existe mcp-tools.json nem lista manual paralela.
 *  - A descoberta (tools/list) respeita o principal autenticado: PRODUCTION
 *    nunca recebe descrição de tools SUPPORT/DEVELOPMENT.
 *  - A segurança ocorre também na EXECUÇÃO (tools/call passa pelas mesmas
 *    validações de tenant/visibility/permissão/schema do Tool Registry) —
 *    ocultação na listagem não é o único controle.
 *  - Tenant vem do contexto autenticado da sessão; input não troca tenant.
 *  - MCP não acessa banco nem serviços diretamente: tudo passa pelo
 *    Tool Registry, que delega aos Domain Services.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const { buildMcpExecutionContext, stripTenantOverride } = require('./auth');

function defaultLogger() {
  return require('../../../api/utils/logger');
}

const FALLBACK_INPUT_SCHEMA = Object.freeze({ type: 'object', additionalProperties: true });

function createMcpServerAdapter({ toolRegistry, logger, serverInfo } = {}) {
  if (!toolRegistry) throw new Error('mcp_server_tool_registry_required');
  const log = logger || defaultLogger();

  /**
   * Lista tools autorizadas para o principal (descoberta filtrada).
   * @returns {Array<{name, description, inputSchema}>}
   */
  function listToolsForPrincipal(authContext) {
    const principal = buildMcpExecutionContext(authContext);
    return toolRegistry.list({
      classification: principal.classification,
      permissions: principal.permissions,
    }).map((tool) => ({
      name: tool.id,
      description: `[${tool.capability || tool.id}] ${tool.description}`,
      inputSchema: tool.inputSchema || FALLBACK_INPUT_SCHEMA,
    }));
  }

  /**
   * Executa uma tool via Canonical Tool Registry com o principal da sessão.
   * Tenant override via input é rejeitado ANTES da execução.
   */
  async function callToolForPrincipal(authContext, toolName, args = {}) {
    const principal = buildMcpExecutionContext(authContext);
    const cleanArgs = stripTenantOverride(args);

    const meta = args?._meta || {};
    const correlationId = meta.correlationId || principal.correlationId || null;
    const executionId = meta.executionId || null;

    const result = await toolRegistry.execute(toolName, cleanArgs, {
      tenantId: principal.tenantId,
      actor: {
        userId: principal.principalType === 'user' ? principal.principalId : null,
        agentId: principal.agentId,
        principalId: principal.principalId,
        principalType: principal.principalType,
        classification: principal.classification,
        permissions: principal.permissions,
        capabilities: principal.capabilities,
      },
      sessionId: principal.sessionId,
      correlationId,
      executionId,
      idempotencyKey: meta.idempotencyKey
        || [principal.tenantId, toolName, correlationId || executionId || principal.sessionId || 'mcp'].join(':'),
      channel: 'mcp',
    });

    log.info('[McpServerAdapter] Tool executed', {
      tenantId: principal.tenantId,
      principalId: principal.principalId,
      toolId: result.toolId,
      durationMs: result.durationMs,
    });

    return result;
  }

  /**
   * Cria um MCP Server (SDK oficial) com escopo de um principal autenticado.
   * Um servidor por sessão: a listagem e a execução já nascem filtradas.
   *
   * @param {object} authContext contexto autenticado da sessão MCP
   * @returns {Server} pronto para conectar a qualquer transport do SDK
   */
  function createServerForPrincipal(authContext) {
    // Valida ANTES de subir o servidor — fail closed.
    const principal = buildMcpExecutionContext(authContext);

    const server = new Server(
      {
        name: serverInfo?.name || 'rap-agent-runtime',
        version: serverInfo?.version || '1.0.0',
      },
      { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: listToolsForPrincipal(principal),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params || {};
      try {
        const result = await callToolForPrincipal(principal, name, args || {});
        return {
          content: [{ type: 'text', text: JSON.stringify(result.output ?? null) }],
          isError: false,
        };
      } catch (error) {
        // Erro estruturado e auditável — nunca fake success.
        log.warn('[McpServerAdapter] Tool call denied/failed', {
          tenantId: principal.tenantId,
          principalId: principal.principalId,
          tool: name,
          error: error.message,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: error.message, code: error.code || 'tool_call_failed' }) }],
          isError: true,
        };
      }
    });

    return server;
  }

  return {
    listToolsForPrincipal,
    callToolForPrincipal,
    createServerForPrincipal,
  };
}

module.exports = { createMcpServerAdapter };
