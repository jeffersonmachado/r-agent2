'use strict';

/**
 * Correção 2026-09-15 — gargalos estruturais evidenciados pelo run REAL de
 * pesquisa da vertical fitness (3/8 ANALYZED com achados UNVERIFIED, 5/8
 * FAILED com `research_no_candidate_source`):
 *
 * FIX 1 — equivalência `www.`: a fonte declarada `https://www.x.com/` casa com
 * o candidato de busca `https://x.com/` (mesmo host módulo o label `www.`);
 * host/domínio registrável diferente NUNCA casa (anti-substituição intacta).
 *
 * FIX 2 — obtenção direta da fonte declarada: quando a busca não superficia a
 * URL declarada e `declaredUrlFallback: true`, o runner obtém EXATAMENTE
 * `source.url` (confirmação de fonte pré-registrada no sample governado, nunca
 * substituição). O default continua NO_CANDIDATES para chamadores de pura
 * descoberta. A proveniência distingue `sourceSelection: 'declared-config'`
 * de `'search'`.
 */

const crypto = require('crypto');

const { createToolRegistry } = require('../../../src/core/cognitive/tool-registry');
const { createBenchmarkResearchRunner, RESEARCH_RUN_STATES } = require('../../../api/services/benchmark/benchmarkResearchRunner');
const { RESEARCH_CAPABILITY_IDS } = require('../../../api/services/benchmark/researchCapabilities');
const {
  createBenchmarkResearchSupervisor,
  normalizeSourceUrl,
  RESEARCH_RUN_OUTCOMES,
} = require('../../../api/services/benchmark/benchmarkResearchSupervisor');
const { createBenchmarkResearchMemoryStore } = require('../../helpers/benchmarkResearchMemoryStore');

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const TENANT = 'system';
const VERTICAL = 'fitness';
const NOW = '2026-09-15T12:00:00.000Z';

function sha(content) {
  return `sha256:${crypto.createHash('sha256').update(String(content)).digest('hex')}`;
}

describe('FIX 1 — equivalência www. na comparação de fonte declarada', () => {
  test('declarada com www. casa com candidato sem www. (e vice-versa)', () => {
    expect(normalizeSourceUrl('https://www.sistemapacto.com.br/'))
      .toBe(normalizeSourceUrl('https://sistemapacto.com.br/'));
    expect(normalizeSourceUrl('https://sistemapacto.com.br'))
      .toBe(normalizeSourceUrl('https://www.sistemapacto.com.br/'));
    // www. + path + caixa também equivalem.
    expect(normalizeSourceUrl('https://WWW.W12.com.br/Funcionalidades/'.toLowerCase()))
      .toBe(normalizeSourceUrl('https://w12.com.br/funcionalidades'));
  });

  test('host/domínio registrável diferente NUNCA casa (anti-substituição)', () => {
    expect(normalizeSourceUrl('https://www.sistemapacto.com.br/'))
      .not.toBe(normalizeSourceUrl('https://sistemapacto.com/'));
    expect(normalizeSourceUrl('https://sistemapacto.com.br/'))
      .not.toBe(normalizeSourceUrl('https://www.tecnofit.com.br/'));
    // Subdomínio REAL não é o label www.: app.x.com ≠ x.com.
    expect(normalizeSourceUrl('https://app.w12.com.br/'))
      .not.toBe(normalizeSourceUrl('https://w12.com.br/'));
    expect(normalizeSourceUrl('https://www.app.w12.com.br/'))
      .not.toBe(normalizeSourceUrl('https://w12.com.br/'));
    // Porta e protocolo diferentes não casam.
    expect(normalizeSourceUrl('https://w12.com.br:8443/'))
      .not.toBe(normalizeSourceUrl('https://w12.com.br/'));
    expect(normalizeSourceUrl('http://www.w12.com.br/'))
      .not.toBe(normalizeSourceUrl('https://w12.com.br/'));
  });
});

function buildRunner({ providers, store = createBenchmarkResearchMemoryStore() }) {
  const registry = createToolRegistry({ logger: silent });
  const runner = createBenchmarkResearchRunner({
    registry,
    runners: providers,
    tenantId: TENANT,
    actor: { classification: 'DEVELOPMENT', permissions: RESEARCH_CAPABILITY_IDS },
    service: {
      recordFinding: async () => { throw new Error('not_used'); },
    },
    now: () => NOW,
  });
  return { runner, registry, store };
}

describe('FIX 2 — obtenção direta da fonte declarada (declaredUrlFallback)', () => {
  const DECLARED = 'https://www.sistemapacto.com.br/';

  function buildProviders({ fetchedUrls = [], searchCandidates = [] } = {}) {
    return {
      search: async () => ({ candidates: searchCandidates }),
      fetch: async (input) => {
        fetchedUrls.push(input.url);
        const content = `<html>conteúdo oficial de ${input.url}: cobrança, catraca, app do aluno</html>`;
        return { httpStatus: 200, content, contentType: 'text/html', contentHash: sha(content) };
      },
      inspectDocumentation: async () => ({
        sections: ['Cobrança'],
        capabilities: [{ name: 'Cobrança recorrente', locator: 'section:Cobrança', fragmentHash: 'sha256:frag-cobranca' }],
        journeys: [],
        rules: [],
      }),
      inspectApiDocs: async () => ({ operations: [], capabilities: [], journeys: [], rules: [] }),
      captureEvidence: async ({ contentHash }) => ({ evidenceRef: 'ev-declared-1', contentHash }),
    };
  }

  test('busca vazia + flag: obtém EXATAMENTE a URL declarada, evidência hash-bound, proveniência declared-config', async () => {
    const fetchedUrls = [];
    const { runner } = buildRunner({ providers: buildProviders({ fetchedUrls }) });

    const outcome = await runner.inspectSource({
      vertical: VERTICAL,
      benchmark: { id: 'pacto', name: 'Pacto', aliases: [] },
      benchmarkId: 'pacto',
      query: 'Pacto funcionalidades documentação oficial',
      source: { url: DECLARED, tier: 5 },
      declaredUrlFallback: true,
      // A busca não devolveu a declarada: pickCandidate não a encontra.
      pickCandidate: (candidates) => candidates
        .find((c) => normalizeSourceUrl(c?.url) === normalizeSourceUrl(DECLARED)) || null,
    });

    expect(outcome.status).toBe(RESEARCH_RUN_STATES.EVIDENCE_CAPTURED);
    // Fetch de EXATAMENTE a URL declarada — nenhuma outra.
    expect(fetchedUrls).toEqual([DECLARED]);
    expect(outcome.source.url).toBe(DECLARED);
    // Hash binding intacto: a evidência é do MESMO conteúdo analisado.
    expect(outcome.evidenceRef).toBe('ev-declared-1');
    expect(outcome.analyzedContentHash).toBe(outcome.source.contentHash);
    expect(outcome.source.verified).toBe(true);
    // Proveniência distingue o caminho: declared-config, não search.
    expect(outcome.source.sourceSelection).toBe('declared-config');
    expect(outcome.provenance.sourceSelection).toBe('declared-config');
    // A cadeia normal continuou: inspeções executadas e achados extraídos.
    expect(outcome.inspections.documentation).toBe(true);
    expect(outcome.findings.length).toBeGreaterThan(0);
  });

  test('sem a flag, busca vazia continua NO_CANDIDATES (default inalterado)', async () => {
    const fetchedUrls = [];
    const { runner } = buildRunner({ providers: buildProviders({ fetchedUrls }) });

    const outcome = await runner.inspectSource({
      vertical: VERTICAL,
      benchmark: { id: 'pacto', name: 'Pacto', aliases: [] },
      benchmarkId: 'pacto',
      query: 'Pacto funcionalidades documentação oficial',
      source: { url: DECLARED, tier: 5 },
      pickCandidate: () => null,
    });

    expect(outcome.status).toBe(RESEARCH_RUN_STATES.NO_CANDIDATES);
    expect(outcome.reason).toBe('research_no_candidate_source');
    expect(fetchedUrls).toEqual([]);
  });

  test('fallback NUNCA obtém outro candidato: sem source.url é NO_CANDIDATES mesmo com a flag', async () => {
    const fetchedUrls = [];
    const { runner } = buildRunner({
      providers: buildProviders({
        fetchedUrls,
        searchCandidates: [{ url: 'https://parecido.example.com/', title: 'parecido' }],
      }),
    });

    const outcome = await runner.inspectSource({
      vertical: VERTICAL,
      benchmark: { id: 'pacto', name: 'Pacto', aliases: [] },
      benchmarkId: 'pacto',
      query: 'Pacto funcionalidades documentação oficial',
      source: { url: '', tier: 5 },
      declaredUrlFallback: true,
      pickCandidate: () => null,
    });

    expect(outcome.status).toBe(RESEARCH_RUN_STATES.NO_CANDIDATES);
    expect(fetchedUrls).toEqual([]);
  });

  test('quando a busca superficia a declarada, a seleção é search (não declared-config)', async () => {
    const fetchedUrls = [];
    const { runner } = buildRunner({
      providers: buildProviders({
        fetchedUrls,
        // Candidato sem www. casando com a declarada com www. (FIX 1 em ação).
        searchCandidates: [{ url: 'https://sistemapacto.com.br/', title: 'Pacto — Sistema para academias' }],
      }),
    });

    const outcome = await runner.inspectSource({
      vertical: VERTICAL,
      benchmark: { id: 'pacto', name: 'Pacto', aliases: [] },
      benchmarkId: 'pacto',
      query: 'Pacto funcionalidades documentação oficial',
      source: { url: DECLARED, tier: 5 },
      declaredUrlFallback: true,
      pickCandidate: (candidates) => candidates
        .find((c) => normalizeSourceUrl(c?.url) === normalizeSourceUrl(DECLARED)) || null,
    });

    expect(outcome.status).toBe(RESEARCH_RUN_STATES.EVIDENCE_CAPTURED);
    expect(fetchedUrls).toEqual(['https://sistemapacto.com.br/']);
    expect(outcome.source.sourceSelection).toBe('search');
    expect(outcome.provenance.sourceSelection).toBe('search');
  });

  test('supervisor: benchmark cuja declarada não aparece na busca é ANALISADO via fallback, com auditoria', async () => {
    const fetchedUrls = [];
    const registry = createToolRegistry({ logger: silent });
    const store = createBenchmarkResearchMemoryStore();
    const supervisor = createBenchmarkResearchSupervisor({
      store,
      registry,
      providers: buildProviders({ fetchedUrls }),
      tenantId: TENANT,
      actor: { classification: 'DEVELOPMENT', permissions: RESEARCH_CAPABILITY_IDS },
      now: () => NOW,
      logger: silent,
    });
    await supervisor.service.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: 'fitness-declared-fallback-v1',
      benchmarkIds: ['pacto'],
      holdoutBenchmarkId: null,
    });

    const sample = {
      vertical: VERTICAL,
      benchmarks: [{
        id: 'pacto',
        name: 'Pacto',
        role: 'discovery',
        archetype: 'financial-billing',
        sources: [{ tier: 5, url: DECLARED }],
        novelty: {},
      }],
    };
    const result = await supervisor.research({ vertical: VERTICAL, sample });

    expect(result.status).toBe(RESEARCH_RUN_OUTCOMES.ANALYZED);
    expect(result.analyzed).toEqual(['pacto']);
    const pacto = result.results.find((entry) => entry.benchmarkId === 'pacto');
    expect(pacto.attempts[0].status).toBe(RESEARCH_RUN_STATES.EVIDENCE_CAPTURED);
    expect(pacto.attempts[0].sourceSelection).toBe('declared-config');
    // FITNESS-ABS-12b: com a declarada sendo homepage, a passada de
    // redescoberta obtém a MESMA URL declarada para extrair links de navegação
    // (conteúdo sem links → nenhuma fonte extra). ABS-27: sem links, a
    // descoberta consulta o sitemap.xml público (aqui sem <loc> de produto) —
    // fetch de DESCOBERTA, não inspeção de fonte. O anti-substituição segue
    // intacto: nenhuma URL de terceiro é obtida como fonte do fornecedor.
    expect(fetchedUrls).toEqual([DECLARED, 'https://www.sistemapacto.com.br/sitemap.xml', DECLARED]);

    // A inspeção persistida carrega a proveniência da seleção.
    const run = await store.getRun({ tenantId: TENANT, vertical: VERTICAL });
    const inspections = typeof store.listSourceInspections === 'function'
      ? await store.listSourceInspections({ tenantId: TENANT, runId: run.id, benchmarkId: 'pacto' })
      : [];
    if (inspections.length > 0) {
      expect(inspections[0].metadata?.sourceSelection ?? inspections[0].metadata_json?.sourceSelection)
        .toBe('declared-config');
    }
    const findings = await store.listFindings({ tenantId: TENANT, runId: run.id });
    expect(findings.length).toBeGreaterThan(0);
  });
});
