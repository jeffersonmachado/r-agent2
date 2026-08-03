/**
 * Testes: ragContextCache — TTL, evicção por capacidade e poda de disco.
 */

const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', '..', 'cache', 'rag-contexts');

describe('ragContextCache', () => {
  let cache;
  let savedTtl;
  let savedMax;

  beforeEach(() => {
    jest.resetModules();
    savedTtl = process.env.RAG_CONTEXT_CACHE_TTL_MS;
    savedMax = process.env.RAG_CONTEXT_CACHE_MAX;
    delete process.env.RAG_CONTEXT_CACHE_TTL_MS;
    delete process.env.RAG_CONTEXT_CACHE_MAX;
    cache = require('../../rag/ragContextCache');
    cache.clearCachedContext();
  });

  afterEach(() => {
    cache.clearCachedContext();
    if (savedTtl === undefined) delete process.env.RAG_CONTEXT_CACHE_TTL_MS;
    else process.env.RAG_CONTEXT_CACHE_TTL_MS = savedTtl;
    if (savedMax === undefined) delete process.env.RAG_CONTEXT_CACHE_MAX;
    else process.env.RAG_CONTEXT_CACHE_MAX = savedMax;
  });

  function wipeDisk() {
    if (!fs.existsSync(CACHE_DIR)) return;
    for (const file of fs.readdirSync(CACHE_DIR)) {
      if (file.endsWith('.json')) fs.unlinkSync(path.join(CACHE_DIR, file));
    }
  }

  it('set/get roundtrip e hasCachedContext', () => {
    expect(cache.getCachedContext('exec-1')).toBeNull();
    expect(cache.hasCachedContext('exec-1')).toBe(false);

    cache.setCachedContext('exec-1', { chunks: [{ id: 'c1' }], sources: [] });

    expect(cache.hasCachedContext('exec-1')).toBe(true);
    const cached = cache.getCachedContext('exec-1');
    expect(cached).toBeTruthy();
    expect(cached.chunks).toHaveLength(1);
  });

  it('entrada expirada por TTL é miss (memória e disco)', async () => {
    process.env.RAG_CONTEXT_CACHE_TTL_MS = '1';

    cache.setCachedContext('exec-ttl', { chunks: [], sources: [] });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(cache.getCachedContext('exec-ttl')).toBeNull();
    expect(cache.hasCachedContext('exec-ttl')).toBe(false);
  });

  it('evicção remove a entrada mais antiga quando atinge a capacidade', () => {
    process.env.RAG_CONTEXT_CACHE_MAX = '2';

    cache.setCachedContext('exec-a', { chunks: [{ id: 'a' }] });
    cache.setCachedContext('exec-b', { chunks: [{ id: 'b' }] });
    cache.setCachedContext('exec-c', { chunks: [{ id: 'c' }] });

    // Isola a camada de memória (disco é persistência opcional com TTL próprio)
    wipeDisk();

    expect(cache.getCachedContext('exec-a')).toBeNull(); // mais antigo: evictado
    expect(cache.getCachedContext('exec-b')).toBeTruthy();
    expect(cache.getCachedContext('exec-c')).toBeTruthy();
  });

  it('poda oportunista remove arquivos de disco mais velhos que 7 dias', async () => {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const oldFile = path.join(CACHE_DIR, 'exec-old.json');
    fs.writeFileSync(oldFile, JSON.stringify({ chunks: [] }), 'utf8');
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldFile, eightDaysAgo, eightDaysAgo);

    // Primeira escrita do processo dispara a poda (assíncrona, best-effort)
    cache.setCachedContext('exec-trigger', { chunks: [] });
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(path.join(CACHE_DIR, 'exec-trigger.json'))).toBe(true);
  });
});
