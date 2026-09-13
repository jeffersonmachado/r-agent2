/**
 * routeMountConsistency.test.js — todo router DECLARADO precisa ser MONTADO.
 *
 * Defeito real (duas ocorrências no repositório, 2026-09-13):
 *   - `mcpRouter` instanciado e fora de `api/app/routeRegistry.js` → 9 rotas 404;
 *   - `productMetricsRouter` idem → GET /api/product-metrics/summary 404 e a
 *     seção de métricas de produto de /analytics quebrada no browser;
 *   - `pushRouter` idem → /api/push/public-key 404 (web push do frontend morto).
 *
 * Nada quebrava em tempo de boot: o router simplesmente não era montado.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const {
  extractDeclaredRouters,
  extractMountedRouters,
  compareRouteMounts,
} = require('../../../scripts/governance/lib/route-mount-consistency');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const REGISTER_ROUTES = fs.readFileSync(path.join(ROOT, 'api', 'app', 'registerRoutes.js'), 'utf8');
const ROUTE_REGISTRY = fs.readFileSync(path.join(ROOT, 'api', 'app', 'routeRegistry.js'), 'utf8');

describe('RouteMountConsistency — repositório real', () => {
  test('todo router instanciado em registerRoutes está montado no registry', () => {
    const result = compareRouteMounts({
      registerRoutesSource: REGISTER_ROUTES,
      routeRegistrySource: ROUTE_REGISTRY,
    });
    expect(result.missing).toEqual([]);
    expect(result.unknown).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.declared.length).toBeGreaterThan(50);
  });

  test('produtos do extrator: o registry monta os routers por referência', () => {
    const mounted = extractMountedRouters(ROUTE_REGISTRY);
    expect(mounted).toContain('productMetricsRouter');
    expect(mounted).toContain('pushRouter');
    expect(mounted).toContain('mcpRouter');
  });
});

describe('RouteMountConsistency — o validador consegue FALHAR', () => {
  test('router declarado e não montado é detectado (defeito real)', () => {
    const registerSource = `
      const routeRegistry = createRouteRegistry({
        fooRouter,
        barRouter,
      });
    `;
    const registrySource = `
      return [
        { router: routers.fooRouter },
      ];
    `;
    const result = compareRouteMounts({ registerRoutesSource: registerSource, routeRegistrySource: registrySource });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('ROUTER_NOT_MOUNTED');
    expect(result.missing).toEqual(['barRouter']);
  });

  test('router montado sem declaração também é inconsistência', () => {
    const registerSource = 'createRouteRegistry({ fooRouter, });';
    const registrySource = 'return [{ router: routers.fooRouter }, { router: routers.ghostRouter }];';
    const result = compareRouteMounts({ registerRoutesSource: registerSource, routeRegistrySource: registrySource });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('ROUTER_MOUNTED_WITHOUT_DECLARATION');
    expect(result.unknown).toEqual(['ghostRouter']);
  });

  test('bloco createRouteRegistry ausente falha explicitamente (nunca PASS vazio)', () => {
    const result = compareRouteMounts({ registerRoutesSource: 'const x = 1;', routeRegistrySource: 'module.exports = {};' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('ROUTE_REGISTRY_BLOCK_NOT_FOUND');
  });

  test('o extrator ignora código fora do bloco do registry', () => {
    const registerSource = `
      const otherRouter = 1;
      const routeRegistry = createRouteRegistry({
        includedRouter,
      });
      const afterRouter = 2;
    `;
    const { routers } = extractDeclaredRouters(registerSource);
    expect(routers).toEqual(['includedRouter']);
  });
});
