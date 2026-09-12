'use strict';

/**
 * MCP Server HTTP Boundary — expõe o RAP como MCP Server (Streamable HTTP).
 *
 * Montagem: api/app/registerRoutes.js chama mountMcpRoutes(app) DEPOIS dos
 * routers de domínio e ANTES dos error handlers e do fallback terminal 404
 * (montar depois do fallback tornaria /mcp inalcançável; montar num
 * http.Server separado — sem `.post` — nunca registrava a rota de fato).
 *
 * Segurança (fail closed):
 *  - requireAuth real (api/middleware/auth): sem sessão válida → 401
 *    `mcp_authentication_required`.
 *  - Tenant SEMPRE da sessão autenticada (req.tenantId || agent.tenantId),
 *    sem fallback para 'system'. Ausente → 400 `tenant_required`.
 *  - Principal sem fallback ('unknown' proibido): ausente → 401.
 *  - Classificação via mapeamento canônico role→classificação
 *    (api/modules/agent-os/experience-segregation.js).
 *  - Permissões de tools derivadas do RBAC real
 *    (api/utils/actorToolPermissions.js) — nunca `agent.permissions` cru.
 *  - Delegação ao MCP Server Adapter inalterada: um MCP Server por principal;
 *    tools/list e tools/call passam pelo Canonical Tool Registry com o
 *    principal da sessão.
 */

const logger = require('../utils/logger');
const { requireAuth } = require('../middleware/auth');
const { getClassificationForAgent } = require('../modules/agent-os/experience-segregation');
const { resolveActorToolPermissions } = require('../utils/actorToolPermissions');

/**
 * Habilita a autenticação machine-to-machine do boundary MCP.
 *
 * Default: habilitada em produção; desabilitada em dev/test para que a
 * resolução de credencial só aconteça quando houver store disponível.
 * `MCP_SERVICE_PRINCIPAL_AUTH=1|0` força o estado, e a injeção de
 * `deps.resolveServicePrincipalToken` (testes/embedding) também habilita.
 */
function isServicePrincipalAuthEnabled(deps = {}) {
  if (typeof deps.resolveServicePrincipalToken === 'function') return true;
  const raw = String(process.env.MCP_SERVICE_PRINCIPAL_AUTH || '').trim().toLowerCase();
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

/**
 * Middleware Express de autenticação do boundary MCP.
 * requireAuth popula req.agent/req.session/req.tenantId (fail closed).
 *
 * Aceita dois tipos de principal:
 *  1. sessão HUMANA (`requireAuth`);
 *  2. SERVICE PRINCIPAL (credencial de integração, M31/M32) — resolvido
 *     apenas quando habilitado, e sempre com escopo de capability + teto de
 *     classificação próprios.
 *
 * Falha de autenticação devolve SEMPRE `mcp_authentication_required` — não há
 * oráculo distinguindo "sessão inválida" de "credencial de integração
 * inválida". O motivo real vai para auditoria.
 */
function createMcpAuthMiddleware(deps = {}) {
  const serviceAuthEnabled = isServicePrincipalAuthEnabled(deps);

  return function mcpRequireAuth(req, res, next) {
    const authResult = requireAuth(req);
    if (authResult.valid) {
      next();
      return;
    }

    const authorization = req.headers?.authorization;
    if (!serviceAuthEnabled || !authorization) {
      res.status(401).json({ error: 'mcp_authentication_required' });
      return;
    }

    const { resolveServicePrincipal } = require('./mcpServicePrincipalAuth');
    Promise.resolve(resolveServicePrincipal({
      authorizationHeader: authorization,
      resolveToken: deps.resolveServicePrincipalToken,
      correlationId: req.headers?.['x-correlation-id'] || null,
    }))
      .then((result) => {
        if (!result.ok) {
          logger.warn('[McpRuntime] Credencial de integração recusada', {
            error: result.error,
            detail: result.detail || null,
          });
          res.status(401).json({ error: 'mcp_authentication_required' });
          return;
        }
        req.mcpServicePrincipal = result.principal;
        req.mcpAuthContext = result.authContext;
        next();
      })
      .catch((error) => {
        logger.warn('[McpRuntime] Falha ao resolver credencial de integração', { error: error.message });
        if (!res.headersSent) res.status(401).json({ error: 'mcp_authentication_required' });
      });
  };
}

/**
 * Deriva o contexto autenticado MCP do request Express — SEM fallbacks.
 * Erros carregam `statusCode` + mensagem = código de erro explícito.
 *
 * @param {Object} req - request já autenticado (req.agent/req.tenantId)
 * @returns {Object} authContext para o MCP Server Adapter
 */
function buildMcpAuthContext(req) {
  // Service principal (M2M): identidade de integração com escopos e teto de
  // classificação próprios — nunca permissões de um humano.
  if (req.mcpAuthContext) return req.mcpAuthContext;

  const agent = req.agent || null;
  if (!agent) {
    const err = new Error('mcp_authentication_required');
    err.statusCode = 401;
    throw err;
  }

  const tenantId = String(req.tenantId || agent.tenantId || '').trim();
  if (!tenantId) {
    const err = new Error('tenant_required');
    err.statusCode = 400;
    throw err;
  }

  const principalId = String(agent.username || agent.id || '').trim();
  if (!principalId) {
    const err = new Error('mcp_authentication_required');
    err.statusCode = 401;
    throw err;
  }

  return {
    tenantId,
    principalId,
    principalType: agent.type || 'user',
    classification: getClassificationForAgent(agent),
    permissions: resolveActorToolPermissions(agent),
    capabilities: Array.isArray(agent.capabilities) ? [...agent.capabilities] : [],
    sessionId: req.session?.id || req.id || null,
    correlationId: req.headers?.['x-correlation-id'] || null,
  };
}

/**
 * Monta as rotas MCP no Express app real. Síncrono: o adapter/tool registry
 * são resolvidos lazy na primeira requisição (o orchestrator pode ainda não
 * estar pronto no momento da montagem).
 *
 * @param {Object} app - Express app
 * @param {Object} [deps]
 * @param {Object} [deps.orchestrator] - Cognitive Orchestrator (testes)
 */
function mountMcpRoutes(app, deps = {}) {
  if (!app || typeof app.post !== 'function') {
    throw new Error('mcp_server_mount_requires_express_app');
  }

  let adapterCache = null;
  let adapterResolved = false;

  function resolveAdapter() {
    if (adapterResolved) return adapterCache;
    adapterResolved = true;
    try {
      const { createMcpServerAdapter } = require('../../src/core/mcp/server-adapter');
      const { getCognitiveOrchestrator } = require('../../src/core/cognitive/cognitive-orchestrator');

      const orchestrator = deps.orchestrator || getCognitiveOrchestrator();
      const toolRegistry = orchestrator.toolRegistry;

      if (!toolRegistry) {
        logger.warn('[McpRuntime] Tool Registry não disponível — MCP Server indisponível');
        return null;
      }

      adapterCache = createMcpServerAdapter({
        toolRegistry,
        logger,
        serverInfo: {
          name: 'rap-agent-runtime',
          version: process.env.npm_package_version || '1.0.0',
        },
      });
    } catch (error) {
      logger.error('[McpRuntime] MCP Server adapter falhou', { error: error.message });
      adapterCache = null;
    }
    return adapterCache;
  }

  // Endpoint MCP — autenticação obrigatória. O principal é derivado da sessão
  // humana OU de uma credencial de integração (service principal, M2M); nunca
  // de payload.
  app.post('/mcp', createMcpAuthMiddleware(deps), async (req, res) => {
    try {
      const authContext = buildMcpAuthContext(req);

      const adapter = resolveAdapter();
      if (!adapter) {
        res.status(503).json({ error: 'mcp_unavailable' });
        return;
      }

      const server = adapter.createServerForPrincipal(authContext);

      // Streamable HTTP transport (SDK oficial) em modo STATELESS:
      // servidor+transport são criados por request com o principal da sessão —
      // um transport stateful novo por request rejeitaria qualquer request
      // não-initialize ("Server not initialized"/"Session not found").
      const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);

      // Stateless: encerra transport+servidor ao fim da resposta (ciclo de
      // vida é o da request; o principal nunca vaza entre requests).
      res.on('close', () => {
        transport.close?.().catch(() => {});
        server.close?.().catch(() => {});
      });

      // express.json() já consumiu o stream: o body parseado precisa ser
      // passado ao transport, senão ele relê o stream vazio (parse error).
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (error.statusCode) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      logger.error('[McpRuntime] MCP request error', { error: error.message });
      if (!res.headersSent) {
        res.status(500).json({ error: 'mcp_internal_error', detail: error.message });
      }
    }
  });

  // Health endpoint (público, sem dados de tenant)
  app.get('/mcp/health', (req, res) => {
    const adapter = resolveAdapter();
    res.json({
      status: adapter ? 'ok' : 'unavailable',
      name: 'rap-mcp-server',
      version: process.env.npm_package_version || '1.0.0',
    });
  });

  logger.info('[McpRuntime] MCP Server montado em /mcp (auth obrigatória)');
  return { endpoint: '/mcp' };
}

/**
 * Compat: entrada assíncrona histórica. A montagem é síncrona via
 * mountMcpRoutes (chamada por registerRoutes); esta função existe apenas
 * para callers legados que aguardavam uma Promise.
 */
async function startMcpServer(app, deps = {}) {
  try {
    return mountMcpRoutes(app, deps);
  } catch (error) {
    logger.warn('[McpRuntime] MCP Server bootstrap falhou (não-bloqueante)', { error: error.message });
    return null;
  }
}

/**
 * Graceful shutdown do MCP Server (servidores são por request/sessão;
 * o encerramento do processo drena os transports via shutdown do HTTP).
 */
async function stopMcpServer() {
  logger.info('[McpRuntime] MCP Server stopped');
}

module.exports = {
  mountMcpRoutes,
  startMcpServer,
  stopMcpServer,
  buildMcpAuthContext,
  createMcpAuthMiddleware,
  isServicePrincipalAuthEnabled,
};
