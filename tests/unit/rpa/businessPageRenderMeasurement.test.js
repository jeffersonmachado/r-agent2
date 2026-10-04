'use strict';

/**
 * Contrato de medição do validador de páginas business (`assertBusinessPage`).
 *
 * Defeito fechado (medido 2026-10-04): `business-core-biz-agents` falhou com
 * "Pagina /agents renderizou vazia" e derrubou o domínio crítico `core` do mesh
 * (`CRITICAL_DOMAIN_FAILED:core` + `BASELINE_PASS_RATE_REGRESSION`), bloqueando o
 * ciclo de selagem — enquanto a MESMA página, aberta isoladamente por browser
 * real (login + seleção de tenant pelo helper canônico), renderizava 757
 * caracteres com ZERO erros de console.
 *
 * Causa: o validador media `innerText`, que depende de LAYOUT/pintura e devolve
 * '' quando o conteúdo ainda não foi pintado sob a carga concorrente do mesh.
 * A medição passou a usar `textContent` (DOM), mantendo a reprovação para página
 * GENUINAMENTE vazia.
 */

jest.mock('../../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  assertBusinessPage,
  readRenderedText,
  PAGE_RENDER_READY_TIMEOUT_MS,
} = require('../../rpa/business/runtime');

function makePage({ rootText = '', bodyText = '' } = {}) {
  return {
    goto: jest.fn(async () => {}),
    waitForFunction: jest.fn(async (fn) => fn()),
    waitForTimeout: jest.fn(async () => {}),
    evaluate: jest.fn(async (fn) => fn()),
    on: jest.fn(),
    off: jest.fn(),
    url: jest.fn(() => 'http://localhost:5173/agents'),
  };
}

const PAGE_DEF = { path: '/agents' };

describe('assertBusinessPage — medição de render por textContent', () => {
  beforeEach(() => {
    global.document = undefined;
  });

  afterAll(() => {
    delete global.document;
  });

  test('PÁGINA MONTANDO: innerText vazio mas textContent com conteúdo NÃO reprova', async () => {
    // Reproduz o defeito: `innerText` devolve '' (layout ainda não pintado) e o
    // DOM JÁ tem conteúdo. Antes, isto lançava "renderizou vazia".
    global.document = {
      querySelector: (selector) => (selector === '#root'
        ? { textContent: 'Agentes Gerenciamento de Agentes' }
        : null),
      body: { textContent: 'Agentes Gerenciamento de Agentes' },
    };
    const page = makePage();

    await expect(assertBusinessPage(page, PAGE_DEF, {})).resolves.toMatchObject({
      path: '/agents',
      finalPath: '/agents',
    });
  });

  test('página GENUINAMENTE vazia continua reprovando', async () => {
    global.document = {
      querySelector: () => null,
      body: { textContent: '   ' },
    };
    const page = makePage();

    await expect(assertBusinessPage(page, PAGE_DEF, {}))
      .rejects.toThrow('Pagina /agents renderizou vazia');
  });

  test('conteúdo só no body (sem #root povoado) é aceito', async () => {
    global.document = {
      querySelector: () => null,
      body: { textContent: 'Conteúdo no body' },
    };
    const page = makePage();

    await expect(assertBusinessPage(page, PAGE_DEF, {})).resolves.toBeTruthy();
  });

  test('a espera semântica usa o teto declarado (não espera infinita)', async () => {
    global.document = {
      querySelector: () => ({ textContent: 'ok' }),
      body: { textContent: 'ok' },
    };
    const page = makePage();

    await assertBusinessPage(page, PAGE_DEF, {});

    expect(page.waitForFunction).toHaveBeenCalled();
    const options = page.waitForFunction.mock.calls[0][2];
    expect(options).toEqual({ timeout: PAGE_RENDER_READY_TIMEOUT_MS });
    expect(PAGE_RENDER_READY_TIMEOUT_MS).toBeGreaterThanOrEqual(60000);
  });

  test('readRenderedText normaliza espaços e nunca lança', async () => {
    global.document = {
      querySelector: () => ({ textContent: '  linha1\n\n   linha2  ' }),
      body: { textContent: 'fallback' },
    };
    const page = makePage();
    await expect(readRenderedText(page)).resolves.toBe('linha1 linha2');

    const brokenPage = { evaluate: jest.fn(async () => { throw new Error('boom'); }) };
    await expect(readRenderedText(brokenPage)).resolves.toBe('');
  });
});
