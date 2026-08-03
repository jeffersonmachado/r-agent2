/**
 * Testes: ragResponseCache — TTL, evicção por capacidade, normalização de
 * chave e isolamento de mutação.
 */

describe('ragResponseCache', () => {
  let cache;
  let savedTtl;
  let savedMax;

  beforeEach(() => {
    jest.resetModules();
    savedTtl = process.env.RAG_RESPONSE_CACHE_TTL_MS;
    savedMax = process.env.RAG_RESPONSE_CACHE_MAX;
    delete process.env.RAG_RESPONSE_CACHE_TTL_MS;
    delete process.env.RAG_RESPONSE_CACHE_MAX;
    cache = require('../../api/services/rag/ragResponseCache');
    cache.clearResponseCache();
  });

  afterEach(() => {
    cache.clearResponseCache();
    if (savedTtl === undefined) delete process.env.RAG_RESPONSE_CACHE_TTL_MS;
    else process.env.RAG_RESPONSE_CACHE_TTL_MS = savedTtl;
    if (savedMax === undefined) delete process.env.RAG_RESPONSE_CACHE_MAX;
    else process.env.RAG_RESPONSE_CACHE_MAX = savedMax;
  });

  const scope = { scope: { domain: 'OPERATIONAL', classifications: ['PRODUCTION'] } };

  it('set/get roundtrip', () => {
    const key = cache.buildCacheKey('tenant-1', 'pergunta?', scope);
    expect(cache.getCachedResponse(key)).toBeNull();

    cache.setCachedResponse(key, { success: true, response: 'resposta', sources: [] });

    const hit = cache.getCachedResponse(key);
    expect(hit).toBeTruthy();
    expect(hit.response).toBe('resposta');
  });

  it('entrada expirada por TTL é miss (e remove)', async () => {
    process.env.RAG_RESPONSE_CACHE_TTL_MS = '1';

    const key = cache.buildCacheKey('tenant-1', 'pergunta ttl', scope);
    cache.setCachedResponse(key, { success: true, response: 'r' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(cache.getCachedResponse(key)).toBeNull();
  });

  it('evicção remove a entrada mais antiga quando atinge a capacidade', () => {
    process.env.RAG_RESPONSE_CACHE_MAX = '2';

    const keyA = cache.buildCacheKey('tenant-1', 'a', scope);
    const keyB = cache.buildCacheKey('tenant-1', 'b', scope);
    const keyC = cache.buildCacheKey('tenant-1', 'c', scope);

    cache.setCachedResponse(keyA, { success: true, response: 'a' });
    cache.setCachedResponse(keyB, { success: true, response: 'b' });
    cache.setCachedResponse(keyC, { success: true, response: 'c' });

    expect(cache.getCachedResponse(keyA)).toBeNull(); // mais antigo: evictado
    expect(cache.getCachedResponse(keyB)).toBeTruthy();
    expect(cache.getCachedResponse(keyC)).toBeTruthy();
  });

  it('chave normaliza case e whitespace (igual ao Python)', () => {
    const k1 = cache.buildCacheKey('tenant-1', '  Olá   MUNDO\t Tudo  Bem? ', scope);
    const k2 = cache.buildCacheKey('tenant-1', 'olá mundo tudo bem?', scope);
    expect(k1).toBe(k2);
  });

  it('chave varia com tenant e escopo', () => {
    const base = cache.buildCacheKey('tenant-1', 'pergunta', scope);
    expect(cache.buildCacheKey('tenant-2', 'pergunta', scope)).not.toBe(base);
    expect(
      cache.buildCacheKey('tenant-1', 'pergunta', { ...scope, options: { topK: 10 } })
    ).not.toBe(base);
    expect(cache.buildCacheKey('tenant-1', 'pergunta')).not.toBe(base);
  });

  it('não armazena valores inválidos (erro/ausente)', () => {
    const key = cache.buildCacheKey('tenant-1', 'pergunta erro', scope);

    cache.setCachedResponse(key, null);
    cache.setCachedResponse(key, undefined);
    cache.setCachedResponse(key, 'erro string');

    expect(cache.getCachedResponse(key)).toBeNull();
  });

  it('get retorna cópia: mutar o retorno não altera a entrada cacheada', () => {
    const key = cache.buildCacheKey('tenant-1', 'pergunta cópia', scope);
    cache.setCachedResponse(key, { success: true, response: 'original', sources: [] });

    const hit = cache.getCachedResponse(key);
    hit.response = 'MUTADO';
    hit.fromCache = true;

    const hitAgain = cache.getCachedResponse(key);
    expect(hitAgain.response).toBe('original');
    expect(hitAgain.fromCache).toBeUndefined();
  });
});
