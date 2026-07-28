/**
 * Regressão: páginas /kitchen, /dispatch e /orders chamam a API `/orders` e
 * `/storefront/orders` via URL relativa (frontend/src/api/orders.js e
 * frontend/src/api/storefront.js). Sem entradas no proxy do Vite, o dev
 * server respondia index.html (200 text/html) e a página quebrava com
 * "API retornou HTML ao invés de JSON" — falha observada no cenário
 * CORE-BIZ-KITCHEN-DISPATCH da Business QA Wave (2026-07-27).
 *
 * Este teste ancora a configuração mínima do proxy; a prova E2E é o cenário
 * CORE-BIZ-KITCHEN-DISPATCH.
 */
import { describe, it, expect } from 'vitest';
import defineViteConfig from '../../vite.config.mjs';

const viteConfig = typeof defineViteConfig === 'function'
  ? defineViteConfig({ mode: 'development', command: 'serve' })
  : defineViteConfig;

describe('vite proxy — rotas de orders (regressão)', () => {
  const proxy = (viteConfig.server && viteConfig.server.proxy) || {};
  const keys = Object.keys(proxy);

  it('proxia /orders para a API (páginas kitchen/dispatch/orders)', () => {
    expect(keys).toContain('^/orders');
  });

  it('proxia /storefront/orders para a API pública (sem capturar as páginas /storefront/order*)', () => {
    expect(keys).toContain('^/storefront/orders');
    expect(keys).not.toContain('^/storefront');
  });

  it('bypass de navegação em /orders preserva a página SPA (Accept text/html), inclusive com query string', () => {
    const entry = proxy['^/orders'];
    expect(entry).toBeTruthy();
    expect(typeof entry.bypass).toBe('function');
    const navReq = { method: 'GET', url: '/orders', headers: { accept: 'text/html' } };
    expect(entry.bypass(navReq, {}, {})).toBe(false);
    const navReqQuery = { method: 'GET', url: '/orders?tab=open', headers: { accept: 'text/html' } };
    expect(entry.bypass(navReqQuery, {}, {})).toBe(false);
    const apiReq = { method: 'GET', url: '/orders?status=confirmed&limit=50', headers: { accept: 'application/json' } };
    expect(entry.bypass(apiReq, {}, {})).toBeUndefined();
  });
});
