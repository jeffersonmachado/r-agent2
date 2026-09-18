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
 * Isola conexões PERSISTIDAS inválidas antes de construir o hub.
 *
 * Defeito real (2026-09-18): 17 fixtures de teste vazadas no banco real — uma
 * execução de Jest interrompida nunca rodou o `afterAll` que as purgava. Uma
 * delas era endpoint loopback (`https://127.0.0.1:9/rpc`). O HUB é estrito por
 * contrato (config inválida lança, e DEVE continuar lançando: é o que os testes
 * adversariais de wildcard/delegação exigem), então essa única linha órfã
 * abortava a criação do hub, a composição caía no catch do startup e ZERAVA
 * todas as external MCP tools — inclusive a conexão válida. O MCP simplesmente
 * nunca funcionava no runtime, com um único WARN "não-bloqueante".
 *
 * A resiliência mora na FRONTEIRA (carregador), não no componente: aqui o
 * estado persistido — sujo por definição — é validado conexão a conexão, cada
 * recusa é REPORTADA (tenant/nome/motivo) e o hub recebe apenas as válidas.
 *
 * @returns {{valid: object[], rejected: {tenant: string|null, name: string|null, reason: string}[]}}
 */
function partitionConnectionsByPolicy(connections = [], { log = logger } = {}) {
  let validateConnection;
  try {
    ({ validateConnection } = require('../../src/core/mcp/client-hub'));
  } catch (error) {
    // Sem validador não há filtro seguro: entrega tudo ao hub (que lança).
    // Degradar para "tudo válido" silenciosamente seria o pior dos mundos.
    log.warn('[McpClientComposition] validador de conexões indisponível', { error: error.message });
    return { valid: connections, rejected: [] };
  }

  const valid = [];
  const rejected = [];
  for (const connection of connections) {
    try {
      validateConnection(connection);
      valid.push(connection);
    } catch (error) {
      rejected.push({
        tenant: connection ? connection.tenant : null,
        name: connection ? connection.name : null,
        reason: error.message,
      });
    }
  }
  return { valid, rejected };
}

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
function loadMcpConnectionsFromConfig() {
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

/** Mantido para compatibilidade de assinatura (§M6). */
function loadMcpConnections() {
  return loadMcpConnectionsFromConfig();
}

/**
 * §M3/§M4/§M6/§M7 — o BANCO é a autoridade das conexões externas.
 *
 * Ordem:
 *   1. importa a config legada como BOOTSTRAP determinístico e idempotente
 *      (chave `(tenant_key, name)` impede duplicação entre startups);
 *   2. carrega do banco TODAS as conexões HABILITADAS, de TODOS os tenants.
 *
 * A lista de tenants NÃO é insumo: ela vinha por `deps.tenants` e transformava a
 * descoberta numa função do que alguém lembrou de passar. Um tenant habilitado no
 * banco depois do boot (ou simplesmente ausente da lista) nunca era carregado — e
 * o runtime silenciosamente perdia aquelas capabilities. O que está habilitado no
 * banco é o que o runtime carrega.
 *
 * Se o banco não estiver disponível, a config legada continua servindo (degradação
 * EXPLÍCITA, reportada em `source`), sem jamais inventar conexão.
 */
async function loadConnectionsFromPersistence({ actor = 'runtime-startup' } = {}) {
  let service;
  try {
    service = require('../services/mcp/mcpConnectionService');
  } catch (error) {
    return { connections: [], source: 'persistence-unavailable', error: error.message, imported: null };
  }

  const legacy = loadMcpConnectionsFromConfig();
  const legacyByTenant = new Map();
  for (const connection of legacy) {
    const tenant = String(connection.tenant || '').trim();
    if (!tenant) continue;
    if (!legacyByTenant.has(tenant)) legacyByTenant.set(tenant, []);
    legacyByTenant.get(tenant).push(connection);
  }

  const imported = [];
  for (const [tenantId, connections] of legacyByTenant.entries()) {
    try {
      imported.push({ tenantId, result: await service.importFromConfigBootstrap({ tenantId, connections, actor }) });
    } catch (error) {
      imported.push({ tenantId, error: error.message });
    }
  }

  let rows = [];
  let persistenceError = null;
  try {
    rows = await service.listAllEnabledConnections();
  } catch (error) {
    persistenceError = error.message;
    logger.warn('[McpClientComposition] Falha ao carregar conexões persistidas', { error: error.message });
  }

  const connections = rows
    .map((row) => service.toConnectionConfig(row))
    .filter((connection) => connection.tenant && connection.name && connection.endpoint);

  if (connections.length > 0) {
    return { connections, source: 'control-plane', imported, persistenceError };
  }
  // Banco vazio/sem conexões habilitadas: a config legada ainda serve, mas o
  // caminho usado é EXPLÍCITO no resultado.
  if (legacy.length > 0) return { connections: legacy, source: 'config-bootstrap-fallback', imported, persistenceError };
  return { connections: [], source: 'none', imported, persistenceError };
}

/** Lookup DNS com TODOS os endereços (valida rebinding, não só o 1º). */
async function defaultDnsLookup(hostname) {
  const result = await dns.promises.lookup(hostname, { all: true });
  return result.map((entry) => entry.address);
}

/**
 * Resolução de credencial por REFERÊNCIA quando nenhum resolver é injetado:
 * a referência é o NOME de uma variável de ambiente. Mesma semântica de
 * `mcpDiscoveryCore.defaultCredentialResolver` — sem ela, uma conexão
 * persistida pelo control plane (credentialRef) nunca resolvia no runtime.
 */
function defaultEnvCredentialResolver(ref) {
  return process.env[String(ref)] || null;
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

    // Auto-registro do container mcp-research (idempotente): quando
    // MCP_RESEARCH_ENDPOINT está configurado, a conexão é persistida ANTES da
    // carga — o runtime a encontra no banco como qualquer outra conexão.
    // Não-bloqueante: falha é reportada e o runtime segue sem ela (ausência
    // explícita, nunca fake success).
    if (!deps.connections) {
      try {
        const { registerMcpResearchConnection } = require('../services/mcp/registerMcpResearchConnection');
        const registration = await registerMcpResearchConnection({ actor: 'runtime-startup' });
        if (registration.registered && registration.action !== 'already_registered') {
          logger.info('[McpClientComposition] conexão mcp-research auto-registrada', {
            action: registration.action, id: registration.id,
          });
        }
      } catch (error) {
        logger.warn('[McpClientComposition] auto-registro mcp-research falhou (não-bloqueante)', {
          error: error.message,
        });
      }
    }

    const loaded = deps.connections
      ? { connections: deps.connections, source: 'injected', imported: null }
      : await loadConnectionsFromPersistence({ actor: 'runtime-startup' });
    const loadedConnections = loaded.connections;
    const { valid: connections, rejected } = partitionConnectionsByPolicy(loadedConnections, { log: logger });
    if (rejected.length > 0) {
      logger.warn('[McpClientComposition] conexões persistidas recusadas na política (isoladas: as válidas seguem)', {
        rejected: rejected.length,
        valid: connections.length,
        details: rejected.map((entry) => `${entry.tenant || '?'}/${entry.name || '?'}: ${entry.reason}`),
      });
    }

    if (connections.length === 0) {
      logger.info('[McpClientComposition] Nenhuma conexão MCP configurada — pulando', { source: loaded.source });
      return null;
    }

    metrics = deps.metrics || createMcpMetrics();

    hub = createMcpClientHub({
      connections,
      logger,
      credentialResolver: deps.credentialResolver || defaultEnvCredentialResolver,
      // DNS real por padrão: resolve TODOS os endereços e revalida a política
      // antes de abrir a conexão (DNS rebinding).
      dnsLookup: deps.dnsLookup || defaultDnsLookup,
      audit: createMcpAuditSink({ metrics, onAudit: deps.onAudit }),
    });
    metrics.recordConnectionRegistered(hub.size());

    logger.info('[McpClientComposition] MCP Client Hub criado', {
      connections: connections.length,
      rejected: rejected.length,
      source: loaded.source,
      tenants: [...new Set(connections.map((c) => c.tenant))],
    });

    // Registra tools externas no Tool Registry como proxies governados.
    const result = await registerExternalMcpTools({
      toolRegistry,
      hub,
      logger,
    });

    // Expõe o par VIVO (hub + registry) para a superfície de administração:
    // enable/disable passam a valer em runtime, não só após restart.
    const { setMcpRuntimeHandles } = require('./mcpRuntimeHandles');
    setMcpRuntimeHandles({ hub, toolRegistry });

    metrics.recordDiscovery({
      toolsDiscovered: result.registered.length,
      schemaChanged: 0,
      ok: true,
    });

    logger.info('[McpClientComposition] External MCP tools registered', {
      registered: result.registered.length,
      skipped: result.skipped.length,
    });

    // ── TAREFA 70/73 — STARTUP PERSISTE (mesma rotina do admin) ──────────
    //
    // GAP CONFIRMADO: o startup criava o hub, registrava tools no Canonical
    // Tool Registry e NÃO gravava nada — discovery, health, schemaFingerprint e
    // timestamps ficavam só em memória e desapareciam no restart. O caminho
    // administrativo (`/discover`) persistia, o startup não: duas semânticas
    // para a mesma operação, exatamente o que a TAREFA 69 proíbe.
    //
    // Agora ambos executam `runDiscoveryCycle` — a rotina ÚNICA — com o store
    // de conexões como persistência. Conexão sem relação persistida não pode
    // ser gravada e é reportada como tal (nunca "persistida" por engano).
    const discoveryResults = await persistStartupDiscovery({ connections, hub });
    const schemaChangedCount = discoveryResults.filter((entry) => entry.schemaChanged === true).length;
    metrics.recordDiscovery({
      toolsDiscovered: result.registered.length,
      schemaChanged: schemaChangedCount,
      ok: discoveryResults.every((entry) => entry.ok !== false),
    });
    logger.info('[McpClientComposition] Descoberta do startup persistida', {
      connections: discoveryResults.length,
      persisted: discoveryResults.filter((entry) => entry.persisted === true).length,
      schemaChanged: schemaChangedCount,
      failed: discoveryResults.filter((entry) => entry.ok === false).length,
    });

    return {
      hub,
      metrics,
      registeredTools: result.registered,
      skipped: result.skipped,
      source: loaded.source,
      discovery: discoveryResults,
    };
  } catch (error) {
    // Configuração MCP inválida NÃO derruba o runtime: é reportada e o RAP
    // segue sem aquelas capabilities (estado explícito, nunca fake success).
    logger.warn('[McpClientComposition] MCP Client composition falhou (não-bloqueante)', {
      error: error.message,
    });
    return hub ? { hub, metrics, registeredTools: [], error: error.message } : null;
  }
}

/**
 * TAREFA 70/73 — o startup usa a MESMA rotina persistente do admin.
 *
 * Para cada conexão PERSISTIDA (com `connectionId`) executa `runDiscoveryCycle`
 * e grava discovery + health + schemaFingerprint. Conexão sem relação
 * persistida é reportada explicitamente (`connection_not_persisted`) — nunca
 * gravada como se fosse.
 *
 * Uma falha de conexão NÃO derruba o runtime: o resultado é explícito e a
 * conexão fica com health degradado no banco.
 */
async function persistStartupDiscovery({ connections = [], hub } = {}) {
  if (!hub || connections.length === 0) return [];
  let core;
  let store;
  try {
    core = require('../services/mcp/mcpDiscoveryCore');
    store = require('../services/mcp/mcpConnectionService');
  } catch (error) {
    logger.warn('[McpClientComposition] Persistência de descoberta indisponível', { error: error.message });
    return connections.map((connection) => ({
      name: connection.name || null,
      ok: false,
      persisted: false,
      code: 'MCP_DISCOVERY_STORE_UNAVAILABLE',
      message: error.message,
    }));
  }

  const results = [];
  for (const connection of connections) {
    const connectionId = connection.connectionId || null;
    if (!connectionId) {
      results.push({
        name: connection.name || null,
        ok: false,
        persisted: false,
        code: core.DISCOVERY_CODES.CONNECTION_NOT_PERSISTED,
        message: 'conexão sem relação persistida: a descoberta não pode ser gravada',
      });
      continue;
    }
    try {
      const outcome = await core.runDiscoveryCycle({
        connection,
        connectionId,
        hub,
        store,
        mode: 'discover',
        logger,
      });
      results.push({
        name: connection.name || null,
        connectionId,
        ok: outcome.ok === true,
        persisted: outcome.persisted === true,
        code: outcome.code || null,
        toolCount: outcome.toolCount || 0,
        schemaChanged: outcome.schemaChanged === true,
        revalidationRequired: outcome.revalidationRequired === true,
      });
    } catch (error) {
      results.push({
        name: connection.name || null,
        connectionId,
        ok: false,
        persisted: false,
        code: error.code || 'MCP_DISCOVERY_UNEXPECTED_FAILURE',
        message: error.message,
      });
    }
  }
  return results;
}

module.exports = {
  startMcpClientComposition,
  persistStartupDiscovery,
  loadMcpConnections,
  loadMcpConnectionsFromConfig,
  loadConnectionsFromPersistence,
  partitionConnectionsByPolicy,
  defaultDnsLookup,
  defaultEnvCredentialResolver,
};
