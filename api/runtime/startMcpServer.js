'use strict';

/**
 * MCP Server Runtime Bootstrap — integra o MCP Server Adapter no runtime real.
 *
 * Fluxo:
 *   1. Obtém o Cognitive Tool Registry (fonte da verdade)
 *   2. Cria o MCP Server Adapter com transport Streamable HTTP
 *   3. Expõe o endpoint /mcp no Express
 *   4. Health check + graceful shutdown
 *
 * Transport: Streamable HTTP (SDK oficial @modelcontextprotocol/sdk).
 * Autenticação: deriva principal da sessão Express (req.agent/req.user).
 */

const logger = require('../utils/logger');

let mcpServer = null;
let mcpTransport = null;

/**
 * Inicializa o MCP Server no runtime Express.
 *
 * @param {Object} app - Express app
 * @param {Object} [deps] - dependências
 */
async function startMcpServer(app, deps = {}) {
  try {
    const { createMcpServerAdapter } = require('../../src/core/mcp/server-adapter');
    const { getCognitiveOrchestrator } = require('../../src/core/cognitive/cognitive-orchestrator');

    const orchestrator = deps.orchestrator || getCognitiveOrchestrator();
    const toolRegistry = orchestrator.toolRegistry;

    if (!toolRegistry) {
      logger.warn('[McpRuntime] Tool Registry não disponível — MCP Server não iniciado');
      return null;
    }

    const adapter = createMcpServerAdapter({
      toolRegistry,
      logger,
      serverInfo: {
        name: 'rap-agent-runtime',
        version: process.env.npm_package_version || '1.0.0',
      },
    });

    // Endpoint MCP via Express — autenticação derivada da sessão.
    app.post('/mcp', async (req, res) => {
      try {
        // Deriva principal da sessão autenticada (fail closed).
        const agent = req.agent || req.user || null;
        if (!agent) {
          return res.status(401).json({ error: 'mcp_authentication_required' });
        }

        const tenantId = req.tenant_id || agent.tenant_id || 'system';
        const principalId = agent.id || agent.username || 'unknown';
        const classification = agent.classification
          || (agent.role === 'super_admin' ? 'DEVELOPMENT' : agent.role === 'auditor' ? 'SUPPORT' : 'PRODUCTION');

        const authContext = {
          tenantId,
          principalId,
          principalType: agent.type || 'user',
          classification,
          permissions: agent.permissions || [],
          capabilities: agent.capabilities || [],
          sessionId: req.id || null,
          correlationId: req.headers['x-correlation-id'] || null,
        };

        const server = adapter.createServerForPrincipal(authContext);

        // Streamable HTTP transport
        const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => req.id || `mcp-${Date.now()}`,
        });

        await server.connect(transport);
        await transport.handleRequest(req, res);
      } catch (error) {
        logger.error('[McpRuntime] MCP request error', { error: error.message });
        res.status(500).json({ error: 'mcp_internal_error', detail: error.message });
      }
    });

    // Health endpoint
    app.get('/mcp/health', (req, res) => {
      res.json({
        status: 'ok',
        name: 'rap-mcp-server',
        version: process.env.npm_package_version || '1.0.0',
        toolsCount: toolRegistry.size(),
      });
    });

    logger.info('[McpRuntime] MCP Server montado em /mcp');
    return { adapter, endpoint: '/mcp' };
  } catch (error) {
    logger.warn('[McpRuntime] MCP Server bootstrap falhou (não-bloqueante)', { error: error.message });
    return null;
  }
}

/**
 * Graceful shutdown do MCP Server.
 */
async function stopMcpServer() {
  try {
    if (mcpServer && typeof mcpServer.close === 'function') {
      await mcpServer.close();
    }
    logger.info('[McpRuntime] MCP Server stopped');
  } catch (error) {
    logger.warn('[McpRuntime] MCP Server shutdown error', { error: error.message });
  }
}

module.exports = { startMcpServer, stopMcpServer };
