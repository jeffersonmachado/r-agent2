'use strict';

/**
 * MCP Client Composition — integra o MCP Client Hub no runtime real.
 *
 * Registra conexões MCP externas configuradas e popula o Tool Registry
 * com proxies governados via External MCP Tool Adapter.
 */

const logger = require('../utils/logger');
const config = require('../utils/config');

/**
 * Carrega conexões MCP da configuração.
 * Formato esperado em config mcp.connections:
 * [{ tenant, name, endpoint, authRef, enabled, classification, allowedCapabilities, allowedTools, toolCapabilityMap }]
 */
function loadMcpConnections() {
  try {
    const raw = config.get('mcp.connections');
    if (!raw) return [];
    if (typeof raw === 'string') {
      return JSON.parse(raw);
    }
    if (Array.isArray(raw)) return raw;
    return [];
  } catch (error) {
    logger.warn('[McpClientComposition] Failed to load MCP connections', { error: error.message });
    return [];
  }
}

/**
 * Inicializa o MCP Client Hub e registra tools externas no Tool Registry.
 *
 * @param {Object} [deps] - dependências
 * @param {Object} [deps.toolRegistry] - Cognitive Tool Registry
 * @param {Object} [deps.orchestrator] - Cognitive Orchestrator
 */
async function startMcpClientComposition(deps = {}) {
  try {
    const { createMcpClientHub } = require('../../src/core/mcp/client-hub');
    const { registerExternalMcpTools } = require('../../src/core/mcp/external-tool-adapter');
    const { getCognitiveOrchestrator } = require('../../src/core/cognitive/cognitive-orchestrator');

    const orchestrator = deps.orchestrator || getCognitiveOrchestrator();
    const toolRegistry = deps.toolRegistry || orchestrator.toolRegistry;

    if (!toolRegistry) {
      logger.warn('[McpClientComposition] Tool Registry não disponível — MCP Client não iniciado');
      return null;
    }

    const connections = loadMcpConnections();

    if (connections.length === 0) {
      logger.info('[McpClientComposition] Nenhuma conexão MCP configurada — pulando');
      return null;
    }

    const hub = createMcpClientHub({
      connections,
      logger,
    });

    logger.info('[McpClientComposition] MCP Client Hub criado', {
      connections: connections.length,
      tenants: [...new Set(connections.map((c) => c.tenant))],
    });

    // Registra tools externas no Tool Registry como proxies governados.
    const result = await registerExternalMcpTools({
      toolRegistry,
      hub,
      logger,
    });

    logger.info('[McpClientComposition] External MCP tools registered', {
      registered: result.registered.length,
      skipped: result.skipped.length,
    });

    return { hub, registeredTools: result.registered };
  } catch (error) {
    logger.warn('[McpClientComposition] MCP Client composition falhou (não-bloqueante)', {
      error: error.message,
    });
    return null;
  }
}

module.exports = { startMcpClientComposition, loadMcpConnections };
