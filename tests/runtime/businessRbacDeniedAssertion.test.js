'use strict';

/**
 * businessRbacDeniedAssertion.test.js — prova, com browser REAL, os dois sentidos
 * da assertiva RBAC negativa das páginas business (`pageDef.expectDenied`).
 *
 * Motivo (medido 2026-10-05): o mesh reprovou `business-core-biz-tenants` com
 * `CRITICAL_DOMAIN_FAILED:core` — "Pagina /tenants deveria negar acesso ao papel
 * da sessão (RBAC), mas renderizou" — enquanto o MESMO cenário passava isolado e
 * o RBAC estava intacto. A causa não era RBAC: o runtime esperava "texto
 * não-vazio" (que "Carregando..." satisfaz: 12 de 12 amostras sob carga) e lia o
 * veredito UMA vez, 300 ms depois; sob 6 processos concorrentes, 4 de 12 leituras
 * caiam antes do guard pintar "Acesso Negado" (tDenied até 1,4 s).
 *
 * Este teste fixa o contrato em três casos:
 *   A) página que RENDERIZA + expectDenied  -> REPROVA (fail-closed preservado);
 *   B) página que NEGA + expectDenied       -> PASSA (a medição correta);
 *   C) página que NEGA sem expectDenied     -> REPROVA (sentido simétrico).
 *
 * Requer frontend (5173) e API (3001) vivos; sem browser ou sem ambiente o teste
 * se declara pulado em vez de dar falso negativo.
 */

jest.setTimeout(180000);

const { chromium } = require('playwright');

// Teto curto da espera pelo veredito: mantém a prova fail-closed barata
// (a constante é lida no load do módulo).
process.env.PAGE_DENIED_TIMEOUT_MS = process.env.PAGE_DENIED_TIMEOUT_MS || '5000';

const FRONTEND_URL = String(process.env.TEST_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

async function frontendIsUp() {
  try {
    const res = await fetch(`${FRONTEND_URL}/login`, { signal: AbortSignal.timeout(5000) });
    return res.status > 0;
  } catch (_) {
    return false;
  }
}

let runtime = null;
let playwrightAvailable = true;
let envAvailable = true;
let ui = null;

beforeAll(async () => {
  try {
    const probe = await chromium.launch({ headless: true });
    await probe.close();
  } catch (_) {
    playwrightAvailable = false;
    return;
  }
  envAvailable = await frontendIsUp();
  if (!envAvailable) return;
  runtime = require('../rpa/business/runtime');
  ui = await runtime.createUiSession();
});

afterAll(async () => {
  if (ui && ui.browser) await ui.browser.close().catch(() => {});
});

function skipIfUnavailable() {
  if (!playwrightAvailable) {
    console.warn('browser Playwright indisponível — teste pulado');
    return true;
  }
  if (!envAvailable) {
    console.warn(`frontend ${FRONTEND_URL} indisponível — teste pulado`);
    return true;
  }
  return false;
}

describe('assertBusinessPage — assertiva RBAC negativa (expectDenied)', () => {
  test('página que RENDERIZA continua reprovando com expectDenied (fail-closed)', async () => {
    if (skipIfUnavailable()) return;
    expect.assertions(1);
    await expect(
      runtime.assertBusinessPage(ui.page, { path: '/dashboard', expectDenied: true }),
    ).rejects.toThrow(/deveria negar acesso ao papel da sessão/);
  });

  test('página que NEGA passa — mesmo sob a janela "Carregando..." da SPA', async () => {
    if (skipIfUnavailable()) return;
    const result = await runtime.assertBusinessPage(ui.page, { path: '/tenants', expectDenied: true });
    expect(result).toMatchObject({ path: '/tenants', denied: true });
  });

  test('sentido simétrico: página que NEGA sem expectDenied reprova', async () => {
    if (skipIfUnavailable()) return;
    expect.assertions(1);
    await expect(
      runtime.assertBusinessPage(ui.page, { path: '/tenants' }),
    ).rejects.toThrow(/apresentou 'Acesso Negado'/);
  });
});
