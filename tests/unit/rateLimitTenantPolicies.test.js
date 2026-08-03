'use strict';

/**
 * Regressão de auditoria (achado 2026-08-03): o rate limit por tenant era
 * NO-OP — o middleware montava operationTypes dinâmicos
 * (TENANT_API_<plano>_<points>_<duration>, TENANT_USER_API_*) que getPolicy()
 * não conhecia, caindo no fallback "permite tudo + warn por request".
 * Comportamento correto: getPolicy() resolve essas operações com pontos por
 * plano (fonte canônica em infra/rate-limit/policies.js) e o limiter bloqueia
 * de verdade quando o limite é excedido.
 */

const {
  getPolicy,
  TENANT_API_PLAN_LIMITS,
  TENANT_USER_API_PLAN_LIMITS,
} = require('../../infra/rate-limit/policies');
const { checkRateLimit, clearLimitersCache } = require('../../infra/rate-limit');

describe('Rate Limit — políticas dinâmicas por tenant (TENANT_API / TENANT_USER_API)', () => {
  beforeEach(() => {
    clearLimitersCache();
  });

  describe('resolução por plano', () => {
    test('TENANT_API_<plano>_<points>_<duration> resolve nos limites canônicos do plano', () => {
      expect(getPolicy('TENANT_API_free_100_60')).toEqual(TENANT_API_PLAN_LIMITS.free);
      expect(getPolicy('TENANT_API_trial_500_60')).toEqual(TENANT_API_PLAN_LIMITS.trial);
      expect(getPolicy('TENANT_API_basic_500_60')).toEqual(TENANT_API_PLAN_LIMITS.basic);
      expect(getPolicy('TENANT_API_pro_2000_60')).toEqual(TENANT_API_PLAN_LIMITS.pro);
      expect(getPolicy('TENANT_API_enterprise_10000_60')).toEqual(TENANT_API_PLAN_LIMITS.enterprise);
    });

    test('TENANT_USER_API_<plano>_<points>_<duration> resolve nos limites por usuário', () => {
      expect(getPolicy('TENANT_USER_API_free_20_60')).toEqual(TENANT_USER_API_PLAN_LIMITS.free);
      expect(getPolicy('TENANT_USER_API_trial_100_60')).toEqual(TENANT_USER_API_PLAN_LIMITS.trial);
      expect(getPolicy('TENANT_USER_API_pro_500_60')).toEqual(TENANT_USER_API_PLAN_LIMITS.pro);
      expect(getPolicy('TENANT_USER_API_enterprise_2000_60')).toEqual(TENANT_USER_API_PLAN_LIMITS.enterprise);
    });

    test('limite customizado enterprise (sem plano) usa pontos/duração codificados', () => {
      expect(getPolicy('TENANT_API_5000_120')).toEqual({ points: 5000, duration: 120 });
      expect(getPolicy('TENANT_USER_API_300_60')).toEqual({ points: 300, duration: 60 });
    });

    test('valores por plano são sensatos: free < trial < pro < enterprise', () => {
      expect(TENANT_API_PLAN_LIMITS.free.points).toBeLessThan(TENANT_API_PLAN_LIMITS.trial.points);
      expect(TENANT_API_PLAN_LIMITS.trial.points).toBeLessThan(TENANT_API_PLAN_LIMITS.pro.points);
      expect(TENANT_API_PLAN_LIMITS.pro.points).toBeLessThan(TENANT_API_PLAN_LIMITS.enterprise.points);
      // Limites por usuário são menores que por tenant
      expect(TENANT_USER_API_PLAN_LIMITS.pro.points).toBeLessThan(TENANT_API_PLAN_LIMITS.pro.points);
    });
  });

  describe('políticas genuinamente desconhecidas continuam null (warn + fallback)', () => {
    test('plano desconhecido não resolve', () => {
      expect(getPolicy('TENANT_API_platinum_10_60')).toBeNull();
      expect(getPolicy('TENANT_USER_API_platinum_10_60')).toBeNull();
    });

    test('pontos/duração inválidos não resolvem', () => {
      expect(getPolicy('TENANT_API_pro_0_60')).toBeNull();
      expect(getPolicy('TENANT_API_pro_100_0')).toBeNull();
      expect(getPolicy('TENANT_API_abc_def')).toBeNull();
    });

    test('operação sem relação com tenant continua null', () => {
      expect(getPolicy('INEXISTENTE')).toBeNull();
    });
  });

  describe('proteção real (não é mais NO-OP)', () => {
    test('checkRateLimit com política TENANT_API bloqueia ao exceder os pontos', async () => {
      const userId = `tenant:test-${Date.now()}-${Math.random()}`;
      // Limite customizado pequeno: 2 requisições por 60s
      const operationType = 'TENANT_API_2_60';

      const first = await checkRateLimit({ userId, operationType });
      const second = await checkRateLimit({ userId, operationType });
      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(true);

      const third = await checkRateLimit({ userId, operationType });
      expect(third.allowed).toBe(false);
      expect(third.retryAfter).toBeGreaterThan(0);
    });
  });
});
