'use strict';

/**
 * RED — business-core-biz-login flaky no QA Mesh (run rap-governed-20260920103356648,
 * 2026-09-20): sob carga do mesh (144 cenários) a sequência pós-clique
 * login → fetch de tenants → modal → acesso → bootstrap/navegação excede os
 * waits FIXOS encadeados de performLogin (1.5s + poll do modal + 10s de
 * waitForNotLoginPage), e o cenário cai com
 * "Login pode ter falhado - UI ainda aparenta estar no estado de login"
 * mesmo com credenciais corretas e login eventualmente concluído.
 *
 * O orçamento pós-login deve ser UNIFICADO e baseado em condição (sair do
 * estado de login, tratando o modal de tenant sempre que ele aparecer), não
 * uma cadeia de sleeps cujo total é menor que a latência real sob carga.
 *
 * Os testes rodam com relógio virtual: Date.now e page.waitForTimeout usam o
 * MESMO tempo simulado, então os orçamentos reais do helper (30s/10s/60s) são
 * exercitados sem espera real.
 */

const { performLogin } = require('../../../core/rpa/utils/authHelper');

let virtualNow;
let dateNowSpy;

beforeEach(() => {
  virtualNow = 0;
  dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => virtualNow);
});

afterEach(() => {
  dateNowSpy.mockRestore();
});

function createVirtualPage(script) {
  const state = {
    clickedAt: null,
    modalAccepted: false,
  };

  const modalVisible = () =>
    state.clickedAt !== null &&
    !state.modalAccepted &&
    virtualNow >= state.clickedAt + script.modalAppearsAfterMs;

  const loggedIn = () =>
    state.clickedAt !== null &&
    (script.requiresModalAccept ? state.modalAccepted : true) &&
    virtualNow >= state.clickedAt + script.loginClearsAfterMs;

  const field = () => ({ fill: async () => {} });

  const page = {
    waitForLoadState: async () => {},
    waitForSelector: async () => {},
    waitForTimeout: async (ms) => { virtualNow += ms; },
    url: () => (loggedIn() ? 'http://localhost:5173/workspace' : 'http://localhost:5173/login'),
    $: async (selector) => {
      if (loggedIn()) return null;
      if (/username|usuário|not\(\[type/.test(selector)) return field();
      if (/password|senha/.test(selector)) return field();
      return null;
    },
    $$: async (selector) => {
      if (selector.includes('Entrar')) {
        return [{
          isVisible: async () => true,
          click: async () => { if (state.clickedAt === null) state.clickedAt = virtualNow; },
        }];
      }
      return [];
    },
    locator: (selector) => {
      const isModalPart = selector.includes('Selecione o Tenant') || selector.includes('Acessar');
      return {
        first: () => ({ isVisible: async () => false, click: async () => {} }),
        isVisible: async () => (isModalPart ? modalVisible() : false),
        click: async () => { if (selector.includes('Acessar')) state.modalAccepted = true; },
        waitFor: async () => {},
      };
    },
  };

  return { page, state };
}

describe('performLogin — orçamento pós-login sob carga (T22)', () => {
  it('conclui quando modal+bootstrap levam ~15s (> 1.5s fixos + 10s atuais)', async () => {
    // Timeline sob carga do mesh: modal aos ~3s, saída do login aos ~15s.
    // Cadeia atual: 1.5s fixos + modal resolvido ~3s + waitForNotLoginPage 10s
    // = deadline ~13s < 15s → falso negativo ("Login pode ter falhado").
    const { page } = createVirtualPage({
      modalAppearsAfterMs: 3000,
      loginClearsAfterMs: 15000,
      requiresModalAccept: true,
    });

    const result = await performLogin(page, {
      username: 'systemadmin',
      password: 'Admin123!',
      tenantId: 'system',
    });

    expect(result.success).toBe(true);
  });

  it('caminho rápido não paga o orçamento cheio (sem modal, redirect imediato)', async () => {
    const { page } = createVirtualPage({
      modalAppearsAfterMs: Number.MAX_SAFE_INTEGER,
      loginClearsAfterMs: 2000,
      requiresModalAccept: false,
    });

    const started = virtualNow;
    const result = await performLogin(page, {
      username: 'systemadmin',
      password: 'Admin123!',
      tenantId: 'system',
    });

    expect(result.success).toBe(true);
    expect(virtualNow - started).toBeLessThan(30000);
  });

  it('falha honesta quando o login realmente não conclui dentro do orçamento', async () => {
    const { page } = createVirtualPage({
      modalAppearsAfterMs: Number.MAX_SAFE_INTEGER,
      loginClearsAfterMs: Number.MAX_SAFE_INTEGER,
      requiresModalAccept: false,
    });

    const started = virtualNow;
    const result = await performLogin(page, {
      username: 'systemadmin',
      password: 'errada',
      tenantId: 'system',
      postLoginTimeoutMs: 3000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/estado de login/);
    expect(virtualNow - started).toBeLessThan(30000);
  });
});
