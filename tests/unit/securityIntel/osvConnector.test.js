'use strict';

/**
 * Testes do conector OSV/KEV/EPSS.
 *
 * Provas exigidas (a lógica de rede não pode ser validada só por execução real,
 * porque os caminhos de falha não acontecem quando tudo está de pé):
 *   - Retry só em erro transitório; 4xx falha imediatamente.
 *   - Rate limit respeitado (sem rajada contra o provedor).
 *   - Falha de pacote NÃO derruba a sincronização: vira `failures` explícita.
 *   - Advisory citado por dois pacotes é mesclado (não duplicado).
 *   - KEV/EPSS indisponíveis NÃO rebaixam o achado silenciosamente.
 */

jest.mock('../../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  queryOsvPackage,
  fetchAdvisoriesForPackages,
  fetchKevCatalog,
  fetchEpssScores,
  createRateLimiter,
  applyEnrichment,
  cveIdsOf,
} = require('../../../api/services/securityIntel/osvConnector');

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const VULN = {
  id: 'GHSA-test-aaaa-bbbb',
  aliases: ['CVE-2026-1111'],
  summary: 'Falha de teste',
  severity: [{ type: 'CVSS_V3', score: '7.5' }],
  affected: [{
    package: { ecosystem: 'npm', name: 'pacote-a' },
    ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '2.0.0' }] }],
  }],
};

describe('osvConnector — consulta', () => {
  test('sucesso devolve vulnerabilidades e número de tentativas', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ vulns: [VULN] }));
    const result = await queryOsvPackage({ ecosystem: 'npm', name: 'pacote-a' }, { fetchImpl });
    expect(result.vulns).toHaveLength(1);
    expect(result.attempts).toBe(1);
    expect(fetchImpl.mock.calls[0][1].body).toBe(JSON.stringify({ package: { name: 'pacote-a', ecosystem: 'npm' } }));
  });

  test('erro transitório (500) é retentado e pode ter sucesso', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, { ok: false, status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ vulns: [VULN] }));
    const result = await queryOsvPackage({ ecosystem: 'npm', name: 'pacote-a' }, {
      fetchImpl,
      sleep: async () => {},
    });
    expect(result.attempts).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('4xx NÃO é retentado (falha imediata e explícita)', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ error: 'bad request' }, { ok: false, status: 400 }));
    await expect(queryOsvPackage({ ecosystem: 'npm', name: 'pacote-a' }, {
      fetchImpl,
      sleep: async () => {},
    })).rejects.toThrow(/osv_http_400/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('esgotar tentativas lança o último erro', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({}, { ok: false, status: 503 }));
    await expect(queryOsvPackage({ ecosystem: 'npm', name: 'pacote-a' }, {
      fetchImpl,
      sleep: async () => {},
      maxAttempts: 2,
    })).rejects.toThrow(/osv_http_503/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('rate limiter respeita o intervalo mínimo', async () => {
    const sleeps = [];
    let clock = 0;
    const acquire = createRateLimiter({
      rateLimitPerSecond: 4, // 250 ms
      sleep: async (ms) => { sleeps.push(ms); clock += ms; },
      now: () => clock,
    });
    await acquire();
    await acquire();
    await acquire();
    expect(sleeps.length).toBe(2);
    expect(sleeps[0]).toBe(250);
  });
});

describe('osvConnector — sincronização', () => {
  test('agrega, mescla advisory repetido entre pacotes e é determinístico', async () => {
    const fetchImpl = jest.fn(async (url, options) => {
      if (String(url).includes('/v1/query')) {
        const body = JSON.parse(options.body);
        if (body.package.name === 'pacote-a') return jsonResponse({ vulns: [VULN] });
        if (body.package.name === 'pacote-b') {
          return jsonResponse({
            vulns: [{
              ...VULN,
              affected: [
                ...VULN.affected,
                { package: { ecosystem: 'npm', name: 'pacote-b' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '3.0.0' }] }] },
              ],
            }],
          });
        }
        return jsonResponse({ vulns: [] });
      }
      if (String(url).includes('known_exploited_vulnerabilities')) {
        return jsonResponse({ vulnerabilities: [{ cveID: 'CVE-2026-1111', dueDate: '2026-11-01' }], dateReleased: '2026-10-01' });
      }
      if (String(url).includes('epss')) {
        return jsonResponse({ data: [{ cve: 'CVE-2026-1111', epss: '0.42', percentile: '0.91', date: '2026-10-07' }] });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const input = {
      packages: [
        { ecosystem: 'npm', name: 'pacote-a' },
        { ecosystem: 'npm', name: 'pacote-b' },
        { ecosystem: 'npm', name: 'pacote-vazio' },
      ],
      options: { fetchImpl, sleep: async () => {}, rateLimitPerSecond: 0 },
    };
    const first = await fetchAdvisoriesForPackages(input);
    const second = await fetchAdvisoriesForPackages(input);

    expect(first.advisories).toHaveLength(1); // mesclado, não duplicado
    expect(first.advisories[0].affected).toHaveLength(2);
    expect(first.snapshotSha256).toBe(second.snapshotSha256);
    expect(first.failures).toEqual([]);
    expect(first.stats).toMatchObject({ packagesQueried: 3, advisories: 1, kevMatches: 1, epssMatches: 1 });
  });

  test('falha de um pacote vira `failures` e a base fica DEGRADED (não vazia-mas-verde)', async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (String(url).includes('/v1/query')) return jsonResponse({ error: 'nope' }, { ok: false, status: 400 });
      if (String(url).includes('known_exploited_vulnerabilities')) return jsonResponse({ vulnerabilities: [] });
      return jsonResponse({ data: [] });
    });
    const result = await fetchAdvisoriesForPackages({
      packages: [{ ecosystem: 'npm', name: 'pacote-a' }],
      options: { fetchImpl, sleep: async () => {}, rateLimitPerSecond: 0 },
    });
    expect(result.advisories).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ package: 'npm:pacote-a', status: 400 });
  });

  test('KEV/EPSS indisponíveis são registrados como falha de enriquecimento', async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (String(url).includes('/v1/query')) return jsonResponse({ vulns: [VULN] });
      throw new Error('dns falhou');
    });
    const result = await fetchAdvisoriesForPackages({
      packages: [{ ecosystem: 'npm', name: 'pacote-a' }],
      options: { fetchImpl, sleep: async () => {}, rateLimitPerSecond: 0 },
    });
    const sources = result.failures.map((failure) => failure.source);
    expect(sources).toContain('cisa-kev');
    expect(sources).toContain('first-epss');
    // O advisory continua existindo: a ausência de enriquecimento não o remove.
    expect(result.advisories).toHaveLength(1);
    expect(result.advisories[0].kev).toBeFalsy();
  });

  test('truncamento por maxPackages é explícito (não silencioso)', async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (String(url).includes('/v1/query')) return jsonResponse({ vulns: [] });
      if (String(url).includes('known_exploited_vulnerabilities')) return jsonResponse({ vulnerabilities: [] });
      return jsonResponse({ data: [] });
    });
    const result = await fetchAdvisoriesForPackages({
      packages: [
        { ecosystem: 'npm', name: 'a' },
        { ecosystem: 'npm', name: 'b' },
        { ecosystem: 'npm', name: 'c' },
      ],
      options: { fetchImpl, sleep: async () => {}, rateLimitPerSecond: 0, maxPackages: 2 },
    });
    expect(result.stats.packagesQueried).toBe(2);
    expect(result.stats.packagesTruncated).toBe(true);
  });
});

describe('osvConnector — enriquecimento', () => {
  test('cveIdsOf extrai apenas CVEs', () => {
    expect(cveIdsOf({ aliases: ['CVE-2026-0001', 'GHSA-x', 'cve-2026-0002'] })).toEqual(['CVE-2026-0001', 'CVE-2026-0002']);
  });

  test('applyEnrichment marca KEV e usa o MAIOR EPSS do advisory', () => {
    const advisories = [{ id: 'X', aliases: ['CVE-2026-0001', 'CVE-2026-0002'], epss: 0.1 }];
    const stats = applyEnrichment(advisories, {
      kevCatalog: new Map([['CVE-2026-0001', { dueDate: '2026-12-01' }]]),
      epssByCve: new Map([
        ['CVE-2026-0001', { epss: 0.2, percentile: 0.8 }],
        ['CVE-2026-0002', { epss: 0.9, percentile: 0.99 }],
      ]),
      checkedAt: '2026-10-08T12:00:00.000Z',
    });
    expect(stats.kevMatches).toBe(1);
    expect(advisories[0].kev).toBe(true);
    expect(advisories[0].kevDueDate).toBe('2026-12-01');
    expect(advisories[0].epss).toBe(0.9);
  });

  test('catálogo KEV real tem o formato esperado (feed plano por CVE)', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({
      vulnerabilities: [
        { cveID: 'CVE-2021-44228', dueDate: '2021-12-24', vendorProject: 'Apache', product: 'Log4j2' },
      ],
      dateReleased: '2026-10-07',
    }));
    const kev = await fetchKevCatalog({ fetchImpl });
    expect(kev.count).toBe(1);
    expect(kev.catalog.get('CVE-2021-44228')).toMatchObject({ vendorProject: 'Apache' });
  });

  test('EPSS sem CVEs não faz requisição', async () => {
    const fetchImpl = jest.fn();
    await expect(fetchEpssScores([], { fetchImpl })).resolves.toEqual(new Map());
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
