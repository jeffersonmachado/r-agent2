'use strict';

/**
 * MCP Client Composition — integra o MCP Client Hub no runtime real.
 *
 * Registra conexões MCP externas configuradas e popula o Canonical Tool
 * Registry com proxies governados via External MCP Tool Adapter.
 *
 * O Control Plane aplica política de endpoint (SSRF/TLS), descoberta com
 * fingerprint de schema, ciclo de vida, política por tool, circuit breaker,
 * redaction e auditoria/métricas. Nenhum desses controles é opcional: sem
 * credencial resolvível, sem endpoint permitido ou sem capability mapeada a
 * tool NÃO é registrada — e a ausência é explícita (`skipped`), nunca um
 * "sucesso" silencioso.
 */

const dns = require('dns');
const logger = require('../utils/logger');
const config = require('../utils/config');

/**
 * Carrega conexões MCP da configuração.
 *
 * Formato esperado em config `mcp.connections` (array ou JSON string):
 * [{
 *   tenant, name, endpoint, enabled, classification,
 *   authType, authRef|credentialRef, allowNoAuth,
 *   allowedCapabilities, allowedTools, toolCapabilityMap, toolPolicies,
 *   endpointPolicy: { allowPrivateNetwork, allowPlaintextHttp, allowInsecureTls,
 *                     insecureTlsJustification, maxRedirects },
 *   timeoutMs, retryPolicy: { attempts },
 * }]
 */
function loadMcpConnections() {
  try {
    const raw = config.get('mcp.connections');
    if (!raw) return [];
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
    if (Array.isArray(raw)) return raw;
    return [];
  } catch (error) {
    logger.warn('[McpClientComposition] Failed to load MCP connections', { error: error.message });
    return [];
  }
}

/** Lookup DNS com TODOS os endereços (valida rebinding, não só o 1º). */
async function defaultDnsLookup(hostname) {
  const result = await dns.promises.lookup(hostname, { all: true });
  return result.map((entry) => entry.address);
}

/**
 * Inicializa o MCP Client Hub e registra tools externas no Tool Registry.
 *
 * @param {Object} [deps] - dependências
 * @param {Object} [deps.toolRegistry] - Canonical Tool Registry
 * @param {Object} [deps.orchestrator] - Cognitive Orchestrator
 * @param {Function} [deps.credentialResolver] - resolve `credentialRef` → segredo
 * @param {Function} [deps.dnsLookup] - injeção para teste
 * @param {Object} [deps.metrics] - métricas do Control Plane
 */
async function startMcpClientComposition(deps = {}) {
  let hub = null;
  let metrics = null;
  try {
    const { createMcpClientHub } = require('../../src/core/mcp/client-hub');
    const { registerExternalMcpTools } = require('../../src/core/mcp/external-tool-adapter');
    const { createMcpMetrics, createMcpAuditSink } = require('../../src/core/mcp/observability');

    // O orchestrator só é carregado quando nenhum registry é injetado — evita
    // puxar o pipeline cognitivo inteiro em composições parciais/testes.
    let toolRegistry = deps.toolRegistry || null;
    if (!toolRegistry) {
      const { getCognitiveOrchestrator } = require('../../src/core/cognitive/cognitive-orchestrator');
      const orchestrator = deps.orchestrator || getCognitiveOrchestrator();
      toolRegistry = orchestrator ? orchestrator.toolRegistry : null;
    }

    if (!toolRegistry) {
      logger.warn('[McpClientComposition] Tool Registry não disponível — MCP Client não iniciado');
      return null;
    }

    const connections = loadMcpConnections();

    if (connections.length === 0) {
      logger.info('[McpClientComposition] Nenhuma conexão MCP configurada — pulando');
      return null;
    }

    metrics = deps.metrics || createMcpMetrics();

    hub = createMcpClientHub({
      connections,
      logger,
      credentialResolver: deps.credentialResolver,
      // DNS real por padrão: resolve TODOS os endereços e revalida a política
      // antes de abrir a conexão (DNS rebinding).
      dnsLookup: deps.dnsLookup || defaultDnsLookup,
      audit: createMcpAuditSink({ metrics, onAudit: deps.onAudit }),
    });
    metrics.recordConnectionRegistered(hub.size());

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

    metrics.recordDiscovery({
      toolsDiscovered: result.registered.length,
      schemaChanged: 0,
      ok: true,
    });

    logger.info('[McpClientComposition] External MCP tools registered', {
      registered: result.registered.length,
      skipped: result.skipped.length,
    });

    return { hub, metrics, registeredTools: result.registered, skipped: result.skipped };
  } catch (error) {
    // Configuração MCP inválida NÃO derruba o runtime: é reportada e o RAP
    // segue sem aquelas capabilities (estado explícito, nunca fake success).
    logger.warn('[McpClientComposition] MCP Client composition falhou (não-bloqueante)', {
      error: error.message,
    });
    return hub ? { hub, metrics, registeredTools: [], error: error.message } : null;
  }
}

module.exports = { startMcpClientComposition, loadMcpConnections, defaultDnsLookup };
