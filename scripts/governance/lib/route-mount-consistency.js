'use strict';

/**
 * route-mount-consistency.js — checagem ESTÁTICA e PURA de coerência entre os
 * routers INSTANCIADOS em `api/app/registerRoutes.js` e os routers MONTADOS por
 * `api/app/routeRegistry.js`.
 *
 * MOTIVAÇÃO (defeito real, duas vezes no mesmo repositório)
 * `registerRoutes.js` instancia o router e o passa para `createRouteRegistry`,
 * mas o registry é uma LISTA EXPLÍCITA. Router fora da lista NÃO é montado — e
 * nada falha: as rotas simplesmente passam a responder 404 e, no frontend, o
 * dev server serve o index.html ("API retornou HTML ao invés de JSON").
 *
 *   - MCP: `mcpRouter` instanciado, ausente do registry → 9 rotas inalcançáveis.
 *   - Product Metrics: `productMetricsRouter` idem → GET
 *     /api/product-metrics/summary 404 e a seção de métricas de produto do
 *     /analytics quebrada (Page Surface Wave, 2026-09-13).
 *
 * Esta checagem roda ANTES do runtime: se um router declarado não está montado,
 * o validador FALHA (exit 1) com a lista exata.
 */

/** Extrai os identificadores `*Router` do bloco passado a `createRouteRegistry`. */
function extractDeclaredRouters(registerRoutesSource) {
  const start = registerRoutesSource.indexOf('createRouteRegistry({');
  if (start === -1) return { found: false, routers: [] };
  const open = registerRoutesSource.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < registerRoutesSource.length; i += 1) {
    const char = registerRoutesSource[i];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return { found: false, routers: [] };
  const block = registerRoutesSource.slice(open + 1, end);
  const routers = new Set();
  for (const match of block.matchAll(/([A-Za-z_$][\w$]*Router)\b/g)) routers.add(match[1]);
  return { found: true, routers: [...routers].sort() };
}

/** Extrai os routers efetivamente MONTADOS (`routers.<nome>` no registry). */
function extractMountedRouters(routeRegistrySource) {
  const routers = new Set();
  for (const match of routeRegistrySource.matchAll(/routers\.([A-Za-z_$][\w$]*)/g)) {
    routers.add(match[1]);
  }
  return [...routers].sort();
}

/**
 * Resultado da comparação.
 * `missing` = declarado mas não montado (o defeito real).
 * `unknown` = montado mas não declarado (indica registry com router renomeado).
 */
function compareRouteMounts({ registerRoutesSource, routeRegistrySource } = {}) {
  const declared = extractDeclaredRouters(String(registerRoutesSource || ''));
  const mounted = extractMountedRouters(String(routeRegistrySource || ''));
  if (!declared.found) {
    return {
      ok: false,
      code: 'ROUTE_REGISTRY_BLOCK_NOT_FOUND',
      declared: [],
      mounted,
      missing: [],
      unknown: [],
      detail: 'não foi possível localizar o bloco createRouteRegistry({...}) em api/app/registerRoutes.js',
    };
  }
  const mountedSet = new Set(mounted);
  const declaredSet = new Set(declared.routers);
  const missing = declared.routers.filter((name) => !mountedSet.has(name));
  const unknown = mounted.filter((name) => !declaredSet.has(name));
  return {
    ok: missing.length === 0 && unknown.length === 0,
    code: missing.length > 0 ? 'ROUTER_NOT_MOUNTED' : (unknown.length > 0 ? 'ROUTER_MOUNTED_WITHOUT_DECLARATION' : null),
    declared: declared.routers,
    mounted,
    missing,
    unknown,
    detail: missing.length > 0
      ? `routers instanciados e NÃO montados: ${missing.join(', ')}`
      : (unknown.length > 0 ? `routers montados sem declaração: ${unknown.join(', ')}` : null),
  };
}

module.exports = {
  extractDeclaredRouters,
  extractMountedRouters,
  compareRouteMounts,
};
