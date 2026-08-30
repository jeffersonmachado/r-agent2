'use strict';

/**
 * Regressão: a sonda de sessão do frontend (/auth/me) responde 401 por
 * desenho quando não há sessão válida — o app trata (retry + login). O
 * browser emite "Failed to load resource: 401" no console e a validação RPA
 * contava isso como erro crítico de página.
 *
 * Falha observada (2026-07-27, fitness-matricula-checkin standalone):
 * execução fria (sem sessão no contexto do browser) reprovou com ÚNICO erro
 * "Failed to load resource: the server responded with a status of 401
 * (Unauthorized)" em /auth/me — enquanto todos os 5 passos funcionais
 * passaram (finalDecision PASS). No mesh completo o contexto já tinha sessão
 * de cenários anteriores e o 401 não aparecia.
 */

const {
  isIgnorableOnboardingNoise,
  isIgnorableAuthProbeNoise,
  isNavigationAbortNoise,
  isIgnorablePageNoise,
} = require('../../api/utils/rpaPageNoiseFilters');

describe('isIgnorableAuthProbeNoise', () => {
  test('recurso 401 em /auth/me é ruído de sonda de sessão', () => {
    expect(isIgnorableAuthProbeNoise({
      level: 'error',
      text: 'Failed to load resource: the server responded with a status of 401 (Unauthorized)',
      url: 'http://localhost:5173/auth/me',
    })).toBe(true);
  });

  test('401 em outra rota NÃO é ruído de sonda', () => {
    expect(isIgnorableAuthProbeNoise({
      level: 'error',
      text: 'Failed to load resource: the server responded with a status of 401 (Unauthorized)',
      url: 'http://localhost:5173/api/qa-waves/scenarios',
    })).toBe(false);
  });

  test('500 em /auth/me NÃO é ruído de sonda (falha real do backend)', () => {
    expect(isIgnorableAuthProbeNoise({
      level: 'error',
      text: 'Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
      url: 'http://localhost:5173/auth/me',
    })).toBe(false);
  });

  test('erro funcional qualquer não é ruído de sonda', () => {
    expect(isIgnorableAuthProbeNoise({
      level: 'error',
      text: 'TypeError: Cannot read properties of undefined',
      url: 'http://localhost:5173/src/pages/QaWavesPage.jsx',
    })).toBe(false);
  });
});

describe('isIgnorableOnboardingNoise (comportamento preservado)', () => {
  test('request_failed de telemetria learning é ignorado', () => {
    expect(isIgnorableOnboardingNoise({
      type: 'request_failed',
      url: 'http://localhost:5173/api/learning/interactions',
    })).toBe(true);
  });

  test('falha de rede de onboarding é ignorada', () => {
    expect(isIgnorableOnboardingNoise({
      type: 'request_failed',
      url: 'http://localhost:5173/onboarding/status',
    })).toBe(true);
    expect(isIgnorableOnboardingNoise({
      message: 'Erro ao carregar status de onboarding: Failed to fetch',
    })).toBe(true);
  });

  test('erro sem relação com onboarding não é ignorado', () => {
    expect(isIgnorableOnboardingNoise({
      type: 'page_error',
      message: 'TypeError: x is not a function',
    })).toBe(false);
  });
});

describe('isNavigationAbortNoise', () => {
  /**
   * Regressão (QA Mesh 2026-08-28, execuções mesh-2026-08-28T18-01-39,
   * mesh-2026-08-28T19-28-53, mesh-2026-08-28T20-39-26): fitness-matricula-
   * cancelamento/checkout falharam/flapperam com request_failed
   * net::ERR_ABORTED em /api/qa-waves/intelligence/* abortados pela navegação
   * gravada /dev/qa-waves → /support, com todos os passos funcionais PASS.
   */
  test('request_failed net::ERR_ABORTED é ruído (abort iniciado pela página)', () => {
    expect(isNavigationAbortNoise({
      type: 'request_failed',
      url: 'http://localhost:5173/api/qa-waves/intelligence/business-gaps?vertical=beauty',
      method: 'GET',
      failure: 'net::ERR_ABORTED',
    })).toBe(true);
  });

  test('request_failed com outra falha NÃO é ruído de navegação', () => {
    expect(isNavigationAbortNoise({
      type: 'request_failed',
      url: 'http://localhost:5173/api/qa-waves/scenarios',
      method: 'GET',
      failure: 'net::ERR_CONNECTION_REFUSED',
    })).toBe(false);
    expect(isNavigationAbortNoise({
      type: 'request_failed',
      url: 'http://localhost:5173/api/qa-waves/scenarios',
      method: 'GET',
      failure: 'net::ERR_TIMED_OUT',
    })).toBe(false);
  });

  test('page_error com ERR_ABORTED no texto NÃO é ruído de navegação', () => {
    expect(isNavigationAbortNoise({
      type: 'page_error',
      message: 'TypeError: x is not a function (net::ERR_ABORTED)',
    })).toBe(false);
  });
});

describe('isIgnorablePageNoise (combinado)', () => {
  test('combina sonda de auth e ruído de onboarding', () => {
    expect(isIgnorablePageNoise({
      level: 'error',
      text: 'Failed to load resource: the server responded with a status of 401 (Unauthorized)',
      url: 'http://localhost:5173/auth/me',
    })).toBe(true);
    expect(isIgnorablePageNoise({
      type: 'request_failed',
      url: 'http://localhost:5173/onboarding/status',
    })).toBe(true);
    expect(isIgnorablePageNoise({
      level: 'error',
      text: 'Failed to load resource: the server responded with a status of 500 (Internal Server Error)',
      url: 'http://localhost:5173/api/tickets',
    })).toBe(false);
  });

  test('abort de navegação entra no filtro combinado', () => {
    expect(isIgnorablePageNoise({
      type: 'request_failed',
      url: 'http://localhost:5173/api/qa-waves/step-status?journeyId=beauty_new_customer',
      method: 'GET',
      failure: 'net::ERR_ABORTED',
    })).toBe(true);
  });
});
