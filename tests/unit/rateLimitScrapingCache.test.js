'use strict';

/**
 * Regressão de auditoria (achado 2026-08-03): os caches de limiters de
 * scraping (infra/rate-limit/scraping.js) cresciam sem bound — um limiter por
 * domínio e um por executionId, para sempre. Comportamento correto: cap com
 * evicção do menos recentemente usado (LRU simples).
 */

const {
  getDomainLimiter,
  getExecutionLimiter,
  MAX_LIMITERS_CACHE_SIZE,
  domainLimitersCache,
  executionLimitersCache,
} = require('../../infra/rate-limit/scraping');

describe('Rate Limit — caches de limiters de scraping com bound (LRU)', () => {
  beforeEach(() => {
    domainLimitersCache.clear();
    executionLimitersCache.clear();
  });

  test('cache por domínio evicta o mais antigo ao exceder o cap', () => {
    const overflow = 25;
    for (let i = 0; i < MAX_LIMITERS_CACHE_SIZE + overflow; i++) {
      getDomainLimiter(`domain-${i}.example.com`);
    }

    expect(domainLimitersCache.size).toBe(MAX_LIMITERS_CACHE_SIZE);
    // Os mais antigos foram evictados (FIFO por último uso)
    expect(domainLimitersCache.has('domain:domain-0.example.com')).toBe(false);
    expect(domainLimitersCache.has(`domain:domain-${overflow - 1}.example.com`)).toBe(false);
    // Os mais recentes permanecem
    expect(domainLimitersCache.has(`domain:domain-${MAX_LIMITERS_CACHE_SIZE + overflow - 1}.example.com`)).toBe(true);
  });

  test('acesso a um domínio o marca como recentemente usado (não é evictado)', () => {
    for (let i = 0; i < MAX_LIMITERS_CACHE_SIZE; i++) {
      getDomainLimiter(`domain-${i}.example.com`);
    }
    expect(domainLimitersCache.size).toBe(MAX_LIMITERS_CACHE_SIZE);

    // Toca o segundo mais antigo: ele passa a ser o mais recente
    getDomainLimiter('domain-1.example.com');

    // Próxima inserção evicta o mais antigo (domain-0), não o domain-1
    getDomainLimiter('domain-new.example.com');
    expect(domainLimitersCache.size).toBe(MAX_LIMITERS_CACHE_SIZE);
    expect(domainLimitersCache.has('domain:domain-0.example.com')).toBe(false);
    expect(domainLimitersCache.has('domain:domain-1.example.com')).toBe(true);
    expect(domainLimitersCache.has('domain:domain-new.example.com')).toBe(true);
  });

  test('cache por execução também tem cap', () => {
    for (let i = 0; i < MAX_LIMITERS_CACHE_SIZE + 10; i++) {
      getExecutionLimiter(`exec-${i}`);
    }

    expect(executionLimitersCache.size).toBe(MAX_LIMITERS_CACHE_SIZE);
    expect(executionLimitersCache.has('execution:exec-0')).toBe(false);
    expect(executionLimitersCache.has(`execution:exec-${MAX_LIMITERS_CACHE_SIZE + 9}`)).toBe(true);
  });

  test('mesma chave não duplica entrada no cache', () => {
    const first = getDomainLimiter('repeat.example.com');
    const second = getDomainLimiter('repeat.example.com');
    expect(first).toBe(second);
    expect(domainLimitersCache.size).toBe(1);
  });
});
