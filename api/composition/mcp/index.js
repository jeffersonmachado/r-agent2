'use strict';

/**
 * Composição das rotas de administração do MCP Control Plane (§M8).
 *
 * LAZY DE PROPÓSITO (2026-09-12): a primeira versão fazia
 * `require('../../middleware/auth')` no TOPO do módulo. Isso arrastava
 * `authService` → `tenantService` → `webScrapingService` na simples IMPORTAÇÃO da
 * composição, e qualquer teste unitário das rotas deixava o runner do jest PRESO
 * (não era open handle de socket: `--forceExit`, `agent: false` e timeout não
 * resolviam — o travamento acontecia na inicialização do grafo de módulos).
 *
 * Agora as dependências que arrastam a cadeia de autenticação são resolvidas
 * dentro de `buildMcpRouteDeps()`, chamada por requisição. Importar a composição
 * não inicializa auth; em produção o custo é idêntico (`require` é cacheado).
 */

const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const { createMcpRoutes } = require('../../modules/mcp/routes');

function buildMcpRouteDeps() {
  // Resolvido AQUI, não no topo do arquivo (ver nota acima).
  const { requireAuth } = require('../../middleware/auth');
  const { tenantFromRequest } = require('../../../lib/rpaSecurity');
  return {
    requireAuth,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    /** Tenant SEMPRE do contexto autenticado, nunca do payload. */
    tenantFromRequest: (req, auth) => tenantFromRequest(req, auth),
  };
}

function createMcpExpressRouter() {
  return createMcpRoutes({ buildDeps: () => buildMcpRouteDeps() });
}

module.exports = { createMcpExpressRouter, buildMcpRouteDeps };
