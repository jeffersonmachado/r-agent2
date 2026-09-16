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
    expect(fetchedUrls.filter((url, index) => fetchedUrls.indexOf(url) === index)).toEqual([HOMEPAGE]);
    expect(entry.attempts.filter((attempt) => attempt.sourceSelection === 'search-discovered')).toEqual([]);
    expect(entry.attempts.filter((attempt) => attempt.sourceSelection === 'homepage-crawl')).toEqual([]);
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
