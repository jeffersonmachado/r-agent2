'use strict';

/**
 * FITNESS-ABS-12 (2026-09-16) — REDESCOBERTA de fontes específicas no deep
 * research. Gap confirmado pelo run real do ciclo 3 (vertical fitness):
 *
 * O gerador governado (`apply-market-discovery-to-sample.js`) declara apenas
 * fontes GENÉRICAS (homepage) para benchmarks derivados do market discovery —
 * disciplina de fases: antes do pré-registro só se conhece a EXISTÊNCIA do
 * fornecedor. O comentário do gerador promete que "o conteúdo específico é
 * redescoberto pelo deep research no tempo próprio", mas o runner inspecionava
 * EXATAMENTE a URL declarada e nada mais. Resultado real (vantagefit.io):
 * homepage inspecionada → 3 achados de capability → TODOS UNVERIFIED
 * (`generic_source_cannot_prove_capability`) → `findingsInventory: []` e
 * novelty zerada — benchmark "analisado" sem produzir medida nenhuma.
 *
 * A correção NÃO é enfraquecer a regra da homepage (ela está certa: homepage
 * prova existência, não capability). É o deep research cumprir a fase dele:
 * redescobrir, via `research.search`, páginas ESPECÍFICAS do MESMO domínio
 * registrável do fornecedor e inspecioná-las como fontes descobertas
 * (`sourceSelection: 'search-discovered'`), com o mesmo pipeline
 * fetch → hash → evidence → inspeção. Cross-domain NUNCA é aceito
 * (anti-substituição intacta).
 */

const crypto = require('crypto');

const { createToolRegistry } = require('../../../src/core/cognitive/tool-registry');
const { createBenchmarkResearchRunner, RESEARCH_RUN_STATES } = require('../../../api/services/benchmark/benchmarkResearchRunner');
const { RESEARCH_CAPABILITY_IDS } = require('../../../api/services/benchmark/researchCapabilities');
const {
  createBenchmarkResearchSupervisor,
  RESEARCH_RUN_OUTCOMES,
} = require('../../../api/services/benchmark/benchmarkResearchSupervisor');
const { createBenchmarkResearchMemoryStore } = require('../../helpers/benchmarkResearchMemoryStore');

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const TENANT = 'system';
const VERTICAL = 'fitness';
const NOW = '2026-09-16T12:00:00.000Z';

const HOMEPAGE = 'https://vantagefit.io/';
const FEATURES_PAGE = 'https://vantagefit.io/features/';
const REWARDS_PAGE = 'https://vantagefit.io/employee-rewards/';

function sha(content) {
  return `sha256:${crypto.createHash('sha256').update(String(content)).digest('hex')}`;
}

function buildProviders({
  fetchedUrls = [],
  searchCalls = [],
  searchCandidates = [],
  pageContent = {},
} = {}) {
  return {
    search: async (input) => {
      searchCalls.push(input.query);
      return { candidates: searchCandidates };
    },
    fetch: async (input) => {
      fetchedUrls.push(input.url);
      const content = pageContent[input.url] || `<html>conteúdo oficial de ${input.url}</html>`;
      return { httpStatus: 200, content, contentType: 'text/html', contentHash: sha(content) };
    },
    inspectDocumentation: async (input) => {
      // Achado estruturado só sai da página ESPECÍFICA (a homepage é marketing).
      if (String(input.url).includes('/features')) {
        return {
          sections: ['Planos'],
          capabilities: [{ name: 'Gestão de planos corporativos de bem-estar', locator: 'section:Planos', fragmentHash: 'sha256:frag-plans' }],
          journeys: [],
          rules: [],
        };
      }
      if (String(input.url).includes('/employee-rewards')) {
        return {
          sections: ['Aulas'],
          capabilities: [{ name: 'Agendamento de aulas de bem-estar', locator: 'section:Aulas', fragmentHash: 'sha256:frag-classes' }],
          journeys: [],
          rules: [],
        };
      }
      return { sections: [], capabilities: [], journeys: [], rules: [] };
    },
    inspectApiDocs: async () => ({ operations: [], capabilities: [], journeys: [], rules: [] }),
    captureEvidence: async ({ contentHash, url }) => ({ evidenceRef: `ev-${sha(url || contentHash).slice(7, 20)}`, contentHash }),
  };
}

describe('runner — filterDiscoveredSources (filtro puro anti-substituição)', () => {
  test('aceita apenas https + mesmo domínio registrável + path específico; dedup e limite', () => {
    const { filterDiscoveredSources } = require('../../../api/services/benchmark/benchmarkResearchRunner');
    const filtered = filterDiscoveredSources({
      officialUrl: HOMEPAGE,
      declaredUrls: [HOMEPAGE],
      limit: 3,
      candidates: [
        { url: FEATURES_PAGE, title: 'Features' },
        { url: 'https://www.vantagefit.io/employee-rewards/', title: 'Rewards (www equivale)' },
        { url: 'https://vantagefit.io/', title: 'homepage genérica — fora' },
        { url: 'https://outro-vendor.com/features/', title: 'cross-domain — fora' },
        { url: 'http://vantagefit.io/inseguro/', title: 'http — fora' },
        { url: FEATURES_PAGE, title: 'duplicado — fora' },
        { url: 'https://vantagefit.io/blog/post-1/', title: 'terceiro' },
        { url: 'https://vantagefit.io/blog/post-2/', title: 'acima do limite — fora' },
      ],
    });
    expect(filtered.map((c) => c.url)).toEqual([
      FEATURES_PAGE,
      'https://www.vantagefit.io/employee-rewards/',
      'https://vantagefit.io/blog/post-1/',
    ]);
  });

  test('sem domínio oficial parseável não descobre nada', () => {
    const { filterDiscoveredSources } = require('../../../api/services/benchmark/benchmarkResearchRunner');
    expect(filterDiscoveredSources({
      officialUrl: 'não-é-url',
      candidates: [{ url: FEATURES_PAGE }],
    })).toEqual([]);
  });

  test('ABS-24 (run real r23): endpoints de MÁQUINA/CMS nunca são fonte de documentação', () => {
    // Run real r23 (2026-09-17): a homepage WordPress do wellnessliving.com
    // declara `<link rel="alternate" type="application/json+oembed">` e o crawl
    // extraiu `/wp-json/oembed/1.0/embed/` como "fonte específica". O GET pelado
    // do endpoint oEmbed responde 400 (exige `?url=`) e o erro não resolvido
    // BLOQUEOU a análise do benchmark inteiro — que tinha homepage 200 com
    // evidência capturada. Plumbing de CMS/API machine-readable não é
    // documentação de produto: fora da redescoberta E do crawl.
    const { filterDiscoveredSources, extractSameDomainLinks } = require('../../../api/services/benchmark/benchmarkResearchRunner');
    const plumbing = [
      'https://vantagefit.io/wp-json/oembed/1.0/embed/',
      'https://vantagefit.io/wp-json/wp/v2/pages/',
      'https://vantagefit.io/wp-admin/admin-ajax.php',
      'https://vantagefit.io/xmlrpc.php',
      'https://vantagefit.io/feed/',
      'https://vantagefit.io/cdn-cgi/challenge-platform/',
    ];
    const filtered = filterDiscoveredSources({
      officialUrl: HOMEPAGE,
      declaredUrls: [HOMEPAGE],
      candidates: [
        { url: FEATURES_PAGE, title: 'Features' },
        ...plumbing.map((url) => ({ url, title: 'plumbing' })),
      ],
    });
    expect(filtered.map((c) => c.url)).toEqual([FEATURES_PAGE]);

    const crawled = extractSameDomainLinks({
      baseUrl: HOMEPAGE,
      content: `<html><head>
        <link rel="alternate" type="application/json+oembed" href="https://vantagefit.io/wp-json/oembed/1.0/embed/?url=x">
        </head><body>
        <a href="/funcionalidades/">Funcionalidades</a>
        <a href="https://vantagefit.io/wp-json/oembed/1.0/embed/?url=x">oembed</a>
        <a href="https://vantagefit.io/wp-admin/">admin</a>
        <a href="https://vantagefit.io/feed/">feed</a>
        </body></html>`,
    });
    expect(crawled.map((c) => c.url)).toEqual(['https://vantagefit.io/funcionalidades/']);
  });
});

describe('runner — inspectSource com discoveredCandidate', () => {
  test('obtém EXATAMENTE a URL descoberta SEM repetir a busca; proveniência search-discovered', async () => {
    const fetchedUrls = [];
    const searchCalls = [];
    const registry = createToolRegistry({ logger: silent });
    const store = createBenchmarkResearchMemoryStore();
    const runner = createBenchmarkResearchRunner({
      registry,
      runners: buildProviders({ fetchedUrls, searchCalls }),
      tenantId: TENANT,
      actor: { classification: 'DEVELOPMENT', permissions: RESEARCH_CAPABILITY_IDS },
      service: { recordFinding: async () => { throw new Error('not_used'); } },
      now: () => NOW,
    });

    const outcome = await runner.inspectSource({
      vertical: VERTICAL,
      benchmark: { id: 'vantagefit.io', name: 'Vantage Fit', aliases: [] },
      benchmarkId: 'vantagefit.io',
      query: 'Vantage Fit funcionalidades documentação oficial',
      source: { url: FEATURES_PAGE, tier: 5 },
      discoveredCandidate: { url: FEATURES_PAGE, title: 'Features' },
    });

    expect(outcome.status).toBe(RESEARCH_RUN_STATES.EVIDENCE_CAPTURED);
    expect(searchCalls).toEqual([]);
    expect(fetchedUrls).toEqual([FEATURES_PAGE]);
    expect(outcome.source.sourceSelection).toBe('search-discovered');
    expect(outcome.provenance.sourceSelection).toBe('search-discovered');
    expect(outcome.source.verified).toBe(true);
    expect(outcome.source.specificity).toBe('SPECIFIC');
    expect(outcome.findings.length).toBeGreaterThan(0);
  });
});

describe('supervisor — redescoberta de fontes específicas (homepage-only)', () => {
  function buildSupervisorHarness({ providers }) {
    const registry = createToolRegistry({ logger: silent });
    const store = createBenchmarkResearchMemoryStore();
    const supervisor = createBenchmarkResearchSupervisor({
      store,
      registry,
      providers,
      tenantId: TENANT,
      actor: { classification: 'DEVELOPMENT', permissions: RESEARCH_CAPABILITY_IDS },
      now: () => NOW,
      logger: silent,
    });
    return { supervisor, store };
  }

  const SAMPLE = {
    vertical: VERTICAL,
    benchmarks: [{
      id: 'vantagefit.io',
      name: 'Vantage Fit',
      role: 'discovery',
      archetype: 'personal-wellness',
      sources: [{ tier: 5, url: HOMEPAGE, specificity: 'GENERIC' }],
      novelty: {},
    }],
  };

  test('benchmark com só homepage redescobre páginas específicas same-domain e produz achados VERIFICADOS', async () => {
    const fetchedUrls = [];
    const { supervisor, store } = buildSupervisorHarness({
      providers: buildProviders({
        fetchedUrls,
        searchCandidates: [
          { url: HOMEPAGE, title: 'Vantage Fit' },
          { url: FEATURES_PAGE, title: 'Features — Vantage Fit' },
          { url: REWARDS_PAGE, title: 'Employee Rewards' },
        ],
      }),
    });
    await supervisor.service.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: 'fitness-rediscovery-v1',
      benchmarkIds: ['vantagefit.io'],
      holdoutBenchmarkId: null,
    });

    const result = await supervisor.research({ vertical: VERTICAL, sample: SAMPLE });

    expect(result.status).toBe(RESEARCH_RUN_OUTCOMES.ANALYZED);
    const entry = result.results.find((item) => item.benchmarkId === 'vantagefit.io');
    const captured = entry.attempts.filter((attempt) => attempt.status === RESEARCH_RUN_STATES.EVIDENCE_CAPTURED);
    // Homepage (declared-config ou search) + as DUAS páginas específicas descobertas.
    expect(captured.length).toBe(3);
    const discovered = entry.attempts.filter((attempt) => attempt.sourceSelection === 'search-discovered');
    expect(discovered.map((attempt) => attempt.url).sort()).toEqual([REWARDS_PAGE, FEATURES_PAGE].sort());
    expect(fetchedUrls).toEqual(expect.arrayContaining([HOMEPAGE, FEATURES_PAGE, REWARDS_PAGE]));

    // Achados das páginas específicas são VERIFICADOS (fonte oficial confirmada).
    const findings = await store.listFindings({ tenantId: TENANT, runId: (await store.getRun({ tenantId: TENANT, vertical: VERTICAL })).id });
    const verified = findings.filter((finding) => finding.verified === true);
    expect(verified.length).toBe(2);

    // E alimentam o patch do sample: inventário + novidade medida (não zerada).
    const patch = await supervisor.service.buildSamplePatch({
      tenantId: TENANT,
      vertical: VERTICAL,
      inventoryVersion: 'canonical-capabilities-1.0.0',
    });
    const patched = patch.benchmarks.find((benchmark) => benchmark.id === 'vantagefit.io');
    expect(patched.findingsInventory.length).toBe(2);
    // Dos 2 achados verificados, UM já é mapeado no inventário canônico do RAP
    // (`fitness.booking.online`) — confirmação, não novidade. A NOVIDADE medida
    // é o que o fornecedor tem e o canônico não (`plan.manage` neste corpus).
    // Antes da redescoberta este valor era SEMPRE zero por ausência de fonte
    // específica — nunca por ausência real de novidade.
    expect(patched.novelty.newCapabilities.length).toBe(1);
    expect(patched.novelty.newCapabilities[0].normalizedId).toBe('plan.manage');
    const patchedUrls = patched.sources.map((source) => source.url);
    expect(patchedUrls).toEqual(expect.arrayContaining([FEATURES_PAGE, REWARDS_PAGE]));
    const discoveredSources = patched.sources.filter((source) => source.url !== HOMEPAGE);
    expect(discoveredSources.every((source) => source.verified === true)).toBe(true);
  });

  test('busca sem candidato same-domain específico: só a homepage é inspecionada (anti-substituição)', async () => {
    const fetchedUrls = [];
    const { supervisor, store } = buildSupervisorHarness({
      providers: buildProviders({
        fetchedUrls,
        searchCandidates: [
          { url: 'https://listicle.example.com/melhores-wellness/', title: 'listicle cross-domain' },
        ],
        // Homepage SEM links de navegação: nem a busca nem o crawl descobrem
        // páginas específicas — o resultado honesto é "só a homepage".
        pageContent: { [HOMEPAGE]: '<html><body><p>wellness para empresas</p></body></html>' },
      }),
    });
    await supervisor.service.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: 'fitness-rediscovery-v2',
      benchmarkIds: ['vantagefit.io'],
      holdoutBenchmarkId: null,
    });

    const result = await supervisor.research({ vertical: VERTICAL, sample: SAMPLE });
    const entry = result.results.find((item) => item.benchmarkId === 'vantagefit.io');
    // ABS-27: a descoberta agora também CONSULTA o sitemap.xml público (aqui sem
    // <loc> de produto — conteúdo HTML genérico do provider). O que o teste
    // continua garantindo: nenhuma página ESPECÍFICA é inspecionada.
    const uniqueFetched = fetchedUrls.filter((url, index) => fetchedUrls.indexOf(url) === index);
    expect(uniqueFetched).toEqual(expect.arrayContaining([HOMEPAGE]));
    expect(uniqueFetched.filter((url) => url !== HOMEPAGE && url !== 'https://vantagefit.io/sitemap.xml')).toEqual([]);
    expect(entry.attempts.filter((attempt) => attempt.sourceSelection === 'search-discovered')).toEqual([]);
    expect(entry.attempts.filter((attempt) => attempt.sourceSelection === 'homepage-crawl')).toEqual([]);
    expect(entry.attempts.filter((attempt) => attempt.sourceSelection === 'sitemap-discovery')).toEqual([]);
    // Zero achados verificados é a medida HONESTA deste benchmark — não um erro.
    const findings = await store.listFindings({ tenantId: TENANT, runId: (await store.getRun({ tenantId: TENANT, vertical: VERTICAL })).id });
    expect(findings.filter((finding) => finding.verified === true)).toEqual([]);
  });

  test('busca rasa (run real): links same-domain da PRÓPRIA homepage são descobertos via crawl', async () => {
    const fetchedUrls = [];
    const { supervisor, store } = buildSupervisorHarness({
      providers: buildProviders({
        fetchedUrls,
        // Busca real do ciclo 3: zero resultado same-domain (só ruído).
        searchCandidates: [
          { url: 'https://www.lenovo.com/br/pt/lenovo-vantage/', title: 'Lenovo Vantage' },
          { url: 'https://www.vantagemarkets.com/', title: 'Vantage Markets' },
        ],
        pageContent: {
          [HOMEPAGE]: `<html><body><nav>
            <a href="/features">Features</a>
            <a href="https://vantagefit.io/employee-rewards/">Rewards</a>
            <a href="https://outro-vendor.com/parceria">cross-domain — fora</a>
            <a href="/assets/site.css">asset — fora</a>
            <a href="mailto:hi@vantagefit.io">mail — fora</a>
            <a href="#section">anchor — fora</a>
            <a href="http://vantagefit.io/inseguro/">http — fora</a>
          </nav></body></html>`,
        },
      }),
    });
    await supervisor.service.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: 'fitness-rediscovery-v4',
      benchmarkIds: ['vantagefit.io'],
      holdoutBenchmarkId: null,
    });

    const result = await supervisor.research({ vertical: VERTICAL, sample: SAMPLE });
    expect(result.status).toBe(RESEARCH_RUN_OUTCOMES.ANALYZED);
    const entry = result.results.find((item) => item.benchmarkId === 'vantagefit.io');
    const crawled = entry.attempts.filter((attempt) => attempt.sourceSelection === 'homepage-crawl');
    expect(crawled.map((attempt) => attempt.url).sort()).toEqual([FEATURES_PAGE, REWARDS_PAGE].sort());
    expect(crawled.every((attempt) => attempt.status === RESEARCH_RUN_STATES.EVIDENCE_CAPTURED)).toBe(true);

    // Os links da homepage produzem achados VERIFICADOS como qualquer fonte específica.
    const findings = await store.listFindings({ tenantId: TENANT, runId: (await store.getRun({ tenantId: TENANT, vertical: VERTICAL })).id });
    expect(findings.filter((finding) => finding.verified === true).length).toBe(2);
  });

  test('benchmark que JÁ declara fonte específica não dispara redescoberta (sem busca extra)', async () => {
    const searchCalls = [];
    const { supervisor } = buildSupervisorHarness({
      providers: buildProviders({
        searchCalls,
        searchCandidates: [{ url: FEATURES_PAGE, title: 'Features' }],
      }),
    });
    await supervisor.service.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: 'fitness-rediscovery-v3',
      benchmarkIds: ['vantagefit.io'],
      holdoutBenchmarkId: null,
    });
    const sample = {
      vertical: VERTICAL,
      benchmarks: [{
        ...SAMPLE.benchmarks[0],
        sources: [{ tier: 5, url: FEATURES_PAGE, specificity: 'SPECIFIC' }],
      }],
    };

    const result = await supervisor.research({ vertical: VERTICAL, sample });
    expect(result.status).toBe(RESEARCH_RUN_OUTCOMES.ANALYZED);
    // Uma busca por fonte declarada — nenhuma busca de redescoberta adicional.
    expect(searchCalls.length).toBe(1);
  });
});

describe('runner — discoverSources com fallback de sitemap (ABS-27)', () => {
  // Run real r23 (2026-09-17): wellnessliving.com é SPA — a homepage (200,
  // 179KB) não declara links de produto no HTML inicial, a busca pública veio
  // degradada e o benchmark ficou "analisado" com UMA fonte genérica. O
  // sitemap.xml público do PRÓPRIO fornecedor declara as páginas específicas
  // (/fitness/software/ etc.) — fonte primária legítima, mesmo domínio,
  // obtida pela capability governada (SSRF/timeout/hash no provider).
  const SPA_HOME = 'https://spa-vendor.com/';
  const SPA_HTML = '<html><head><script src="/app.js"></script></head><body><div id="root"></div></body></html>';
  const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://spa-vendor.com/</loc></url>
      <url><loc>https://spa-vendor.com/fitness/software/</loc></url>
      <url><loc>https://spa-vendor.com/pricing/</loc></url>
      <url><loc>https://spa-vendor.com/wp-json/oembed/1.0/embed/</loc></url>
      <url><loc>https://outro-dominio.com/features/</loc></url>
    </urlset>`;
  const SITEMAP_INDEX_XML = `<?xml version="1.0" encoding="UTF-8"?>
    <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <sitemap><loc>https://spa-vendor.com/main-sitemap.xml</loc></sitemap>
    </sitemapindex>`;

  function buildRunner({ pageContent }) {
    const registry = createToolRegistry({ logger: silent });
    const runner = createBenchmarkResearchRunner({
      registry,
      runners: buildProviders({ searchCandidates: [], pageContent }),
      tenantId: TENANT,
      actor: { classification: 'DEVELOPMENT', permissions: RESEARCH_CAPABILITY_IDS },
      service: { recordFinding: async () => { throw new Error('not_used'); } },
      now: () => NOW,
    });
    return runner;
  }

  test('SPA sem links: sitemap.xml declara as páginas específicas (via sitemap-discovery)', async () => {
    const runner = buildRunner({
      pageContent: { [SPA_HOME]: SPA_HTML, 'https://spa-vendor.com/sitemap.xml': SITEMAP_XML },
    });
    const outcome = await runner.discoverSources({
      query: 'spa vendor funcionalidades',
      officialUrl: SPA_HOME,
      declaredUrls: [SPA_HOME],
    });
    expect(outcome.status).toBe('RESEARCH_SOURCES_DISCOVERED');
    const urls = outcome.candidates.map((candidate) => candidate.url);
    expect(urls).toEqual([
      'https://spa-vendor.com/fitness/software/',
      'https://spa-vendor.com/pricing/',
    ]);
    // homepage genérica, machine endpoint (ABS-24) e cross-domain ficam fora.
    expect(outcome.candidates.every((candidate) => candidate.via === 'sitemap-discovery')).toBe(true);
  });

  test('sitemapindex é seguido ao sub-sitemap (fetch limitado e governado)', async () => {
    const runner = buildRunner({
      pageContent: {
        [SPA_HOME]: SPA_HTML,
        'https://spa-vendor.com/sitemap.xml': SITEMAP_INDEX_XML,
        'https://spa-vendor.com/main-sitemap.xml': SITEMAP_XML,
      },
    });
    const outcome = await runner.discoverSources({
      query: 'spa vendor funcionalidades',
      officialUrl: SPA_HOME,
      declaredUrls: [SPA_HOME],
    });
    expect(outcome.candidates.map((candidate) => candidate.url)).toEqual([
      'https://spa-vendor.com/fitness/software/',
      'https://spa-vendor.com/pricing/',
    ]);
  });

  test('sem sitemap obtido (404/vazio) o retorno é lista vazia honesta', async () => {
    const runner = buildRunner({
      pageContent: {
        [SPA_HOME]: SPA_HTML,
        'https://spa-vendor.com/sitemap.xml': '',
      },
    });
    const outcome = await runner.discoverSources({
      query: 'spa vendor funcionalidades',
      officialUrl: SPA_HOME,
      declaredUrls: [SPA_HOME],
    });
    expect(outcome.status).toBe('RESEARCH_SOURCES_DISCOVERED');
    expect(outcome.candidates).toEqual([]);
  });
});
