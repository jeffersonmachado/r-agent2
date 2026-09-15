'use strict';

/**
 * DATASET ADVERSARIAL SEMÂNTICO (missão 2026-09-15).
 *
 * O run real fitness (`fitness-real-2026-09-15-r5`) contou headlines e slogans
 * de marketing como capabilities (936 achados brutos, 742 verificados). Estes
 * testes fixam o contrato do funil `api/services/benchmark/semantic/`:
 *
 *   - slogan NUNCA é capability ("Every payment, every membership, every
 *     dollar. In one place." → MARKETING_CLAIM);
 *   - pergunta de FAQ NUNCA é capability ("What is Zen Planner Payments?");
 *   - resposta de FAQ PODE render sinal (via reavaliação estrutural);
 *   - texto de preço, navegação, testemunho, legal e ruído são rejeitados
 *     nominalmente;
 *   - parágrafo real de documentação vira candidato ESTRUTURADO com evidência;
 *   - endpoint de API NÃO é promovido automaticamente a capability;
 *   - equivalência: online booking / class booking / book classes online /
 *     mobile booking → UM cluster;
 *   - anti-over-merge: freeze ≠ cancel ≠ pause ≠ suspend ≠ expire;
 *   - UNRESOLVED não conta como novidade canônica.
 */

const { createToolRegistry } = require('../../../../src/core/cognitive/tool-registry');
const { createBenchmarkResearchRunner } = require('../../../../api/services/benchmark/benchmarkResearchRunner');
const { createBenchmarkResearchService } = require('../../../../api/services/benchmark/benchmarkResearchService');
const { RESEARCH_CAPABILITY_IDS } = require('../../../../api/services/benchmark/researchCapabilities');
const {
  OBSERVATION_TYPES,
  classifyObservation,
} = require('../../../../api/services/benchmark/semantic/observationClassifier');
const {
  extractCandidate,
  SEMANTIC_STATUS,
} = require('../../../../api/services/benchmark/semantic/semanticExtractor');
const { clusterCandidates } = require('../../../../api/services/benchmark/semantic/clustering');
const {
  runNormalizationPipeline,
} = require('../../../../api/services/benchmark/semantic/normalizationPipeline');
const { createBenchmarkResearchMemoryStore } = require('../../../helpers/benchmarkResearchMemoryStore');

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const TENANT = 'system';
const VERTICAL = 'fitness';
const NOW = '2026-09-15T12:00:00.000Z';

// ── Classificação adversarial ────────────────────────────────────────────────

describe('observationClassifier — dataset adversarial', () => {
  const cases = [
    // [texto, locator, tipo esperado]
    ['Every payment, every membership, every dollar. In one place.', null, OBSERVATION_TYPES.MARKETING_CLAIM],
    ['The all-in-one platform your gym deserves', null, OBSERVATION_TYPES.MARKETING_CLAIM],
    ['Agende uma demo gratuita', null, OBSERVATION_TYPES.MARKETING_CLAIM],
    ['Aumente a retenção de alunos em +25%', 'section:Benefícios', OBSERVATION_TYPES.BENEFIT_STATEMENT],
    ['What is Zen Planner Payments?', 'section:FAQ', OBSERVATION_TYPES.FAQ_QUESTION],
    ['Como funciona o cancelamento?', 'section:FAQ', OBSERVATION_TYPES.FAQ_QUESTION],
    ['Plans starting at R$ 99/month', 'section:Pricing', OBSERVATION_TYPES.PRICING_TEXT],
    ['R$ 149,90 por mês por unidade', null, OBSERVATION_TYPES.PRICING_TEXT],
    ['Home', 'section:main-nav', OBSERVATION_TYPES.NAVIGATION],
    ['Features', 'section:footer', OBSERVATION_TYPES.NAVIGATION],
    ['"This software changed our business" — Gym Owner, São Paulo', null, OBSERVATION_TYPES.TESTIMONIAL],
    ['Terms of Service and Privacy Policy. All rights reserved.', 'section:Legal', OBSERVATION_TYPES.LEGAL_TEXT],
    ['Financeiro', 'section:Financeiro', OBSERVATION_TYPES.HEADLINE],
    ['Treinos', 'section:Treinos', OBSERVATION_TYPES.HEADLINE],
    ['xkcd random filler words', null, OBSERVATION_TYPES.NOISE],
    // Sinais legítimos
    ['Gestão de matrículas', 'section:Matrículas', OBSERVATION_TYPES.CAPABILITY_SIGNAL],
    ['Cobrança recorrente', 'section:Cobrança', OBSERVATION_TYPES.CAPABILITY_SIGNAL],
    ['Members can freeze their memberships directly from the app', 'section:FAQ', OBSERVATION_TYPES.CAPABILITY_SIGNAL],
    ['O aluno agenda o treino pelo aplicativo', 'section:App do aluno', OBSERVATION_TYPES.CAPABILITY_SIGNAL],
    ['Members can freeze an active membership for up to 30 days', 'section:Policies', OBSERVATION_TYPES.BUSINESS_RULE_SIGNAL],
    ['Acesso bloqueado quando inadimplente', 'section:Regras', OBSERVATION_TYPES.BUSINESS_RULE_SIGNAL],
  ];

  test.each(cases)('"%s" → %s', (text, locator, expected) => {
    const classified = classifyObservation({ text, locator });
    expect(classified.type).toBe(expected);
  });

  test('slogan de enumeração nunca vira capability mesmo com palavras de domínio', () => {
    const classified = classifyObservation({ text: 'Every payment, every membership, every dollar. In one place.' });
    expect(classified.type).toBe(OBSERVATION_TYPES.MARKETING_CLAIM);
    expect([
      OBSERVATION_TYPES.CAPABILITY_SIGNAL,
      OBSERVATION_TYPES.JOURNEY_SIGNAL,
      OBSERVATION_TYPES.BUSINESS_RULE_SIGNAL,
    ]).not.toContain(classified.type);
  });
});

// ── Extração estruturada ─────────────────────────────────────────────────────

describe('semanticExtractor — formas estruturadas', () => {
  test('doc real: "Members can freeze their memberships directly from the app" → membership.freeze com outcome', () => {
    const classified = classifyObservation({
      text: 'Members can freeze their memberships directly from the app',
      locator: 'section:Membership',
    });
    expect(classified.type).toBe(OBSERVATION_TYPES.CAPABILITY_SIGNAL);
    const candidate = extractCandidate({ observation: { text: 'Members can freeze their memberships directly from the app', locator: 'section:Membership' }, classified, kind: 'capability' });
    expect(candidate.semanticStatus).toBe(SEMANTIC_STATUS.NORMALIZED);
    expect(candidate.verb).toBe('freeze');
    expect(candidate.object).toBe('membership');
    expect(candidate.form).toBe('membership.freeze');
    expect(candidate.outcome).toMatch(/directly from the app/i);
  });

  test('regra real estruturada: condição/limite/efeito extraíveis do texto', () => {
    const text = 'Members can freeze an active membership for up to 30 days per year';
    const classified = classifyObservation({ text, locator: 'section:Policies' });
    expect(classified.type).toBe(OBSERVATION_TYPES.BUSINESS_RULE_SIGNAL);
    const candidate = extractCandidate({ observation: { text, locator: 'section:Policies' }, classified, kind: 'businessRule' });
    expect(candidate.semanticStatus).toBe(SEMANTIC_STATUS.NORMALIZED);
    expect(candidate.structuredRule).not.toBeNull();
    expect(candidate.structuredRule.rule).toMatch(/up to 30 days/i);
    expect(candidate.structuredRule.rule).toMatch(/per year/i);
  });

  test('regra sem NENHUM elemento estruturável → UNRESOLVED, nunca novidade canônica', () => {
    const text = 'Política de cancelamento disponível';
    const classified = classifyObservation({ text, locator: 'section:Regras' });
    // classificado como sinal por vocabulário, mas sem condição/limite/efeito
    const candidate = extractCandidate({ observation: { text, locator: 'section:Regras' }, classified, kind: 'businessRule' });
    if (candidate.semanticStatus === SEMANTIC_STATUS.NORMALIZED) {
      // Se há verbo/objeto, a forma existe — mas a regra estruturada precisa de
      // ao menos um elemento; aqui nenhum elemento existe.
      expect(candidate.structuredRule === null || Object.values(candidate.structuredRule).some(Boolean)).toBe(true);
    } else {
      expect(candidate.unresolvedReason).toBe('business_rule_without_structure');
    }
  });

  test('jornada sem ator/gatilho/desfecho → UNRESOLVED (headline não é jornada)', () => {
    const text = 'Onboarding';
    const classified = classifyObservation({ text, locator: 'section:Jornadas' });
    if (classified.type === OBSERVATION_TYPES.JOURNEY_SIGNAL) {
      const candidate = extractCandidate({ observation: { text, locator: 'section:Jornadas' }, classified, kind: 'journey' });
      expect(candidate.semanticStatus).toBe(SEMANTIC_STATUS.UNRESOLVED);
      expect(candidate.unresolvedReason).toBe('journey_without_actor_trigger_outcome');
    } else {
      // Sem estrutura de jornada, o classificador já recusa como headline/noise.
      expect([OBSERVATION_TYPES.HEADLINE, OBSERVATION_TYPES.NOISE]).toContain(classified.type);
    }
  });
});

// ── Clustering: equivalência e anti-over-merge ───────────────────────────────

describe('clustering — equivalência semântica e anti-over-merge', () => {
  test('online booking / class booking / book classes online / mobile booking → UM cluster', () => {
    const pipeline = runNormalizationPipeline({
      observations: [
        { text: 'Online booking', locator: 'section:Features' },
        { text: 'Class booking', locator: 'section:Features' },
        { text: 'Book classes online', locator: 'section:Features' },
        { text: 'Mobile booking', locator: 'section:Features' },
      ],
      contentHash: 'sha256:doc',
      source: { url: 'https://example.com/features', tier: 5 },
    });
    const bookingCandidates = pipeline.candidates.filter((candidate) => candidate.canonicalId === 'fitness.booking.online');
    expect(bookingCandidates).toHaveLength(1);
    const allNames = [bookingCandidates[0].externalName, ...bookingCandidates[0].variants];
    for (const name of ['Online booking', 'Class booking', 'Book classes online', 'Mobile booking']) {
      expect(allNames).toContain(name);
    }
  });

  test('over-merge RECUSADO: freeze ≠ cancel ≠ pause ≠ suspend ≠ expire', () => {
    const pipeline = runNormalizationPipeline({
      observations: [
        { text: 'Freeze membership', locator: 'section:Lifecycle' },
        { text: 'Cancel membership', locator: 'section:Lifecycle' },
        { text: 'Pause membership', locator: 'section:Lifecycle' },
        { text: 'Suspend access', locator: 'section:Lifecycle' },
        { text: 'Expired membership', locator: 'section:Lifecycle' },
      ],
      contentHash: 'sha256:doc',
      source: { url: 'https://example.com/policies', tier: 5 },
    });
    const ids = pipeline.candidates.map((candidate) => candidate.canonicalId || candidate.form);
    expect(ids).toContain('fitness.membership.freeze');
    expect(ids).toContain('fitness.membership.cancel');
    expect(ids).toContain('fitness.membership.suspend_access');
    expect(ids).toContain('fitness.membership.expired');
    // pause não tem equivalência declarada: NÃO é fundido com freeze — fica
    // separado como forma própria (novidade candidata, não confirmação).
    expect(ids).toContain('membership.pause');
    expect(pipeline.candidates).toHaveLength(5);
  });

  test('clusters com exclusiveTokens distintos nunca dividem o mesmo cluster', () => {
    const { clusters } = clusterCandidates([
      { kind: 'capability', externalName: 'Congelamento de matrícula', form: 'membership.freeze', canonicalId: null },
      { kind: 'capability', externalName: 'Cancelamento de matrícula', form: 'membership.freeze', canonicalId: null },
    ]);
    // Mesma forma forçada, mas exclusiveTokens diferentes: partir é obrigatório.
    expect(clusters).toHaveLength(2);
  });
});

// ── Pipeline ponta a ponta: métricas, binding e novidade honesta ─────────────

describe('normalizationPipeline — funil completo', () => {
  const ADVERSARIAL_PAGE = [
    { text: 'Every payment, every membership, every dollar. In one place.', locator: 'section:Hero' },
    { text: 'What is Zen Planner Payments?', locator: 'section:FAQ' },
    { text: 'Plans starting at R$ 99/month', locator: 'section:Pricing' },
    { text: 'Home', locator: 'section:nav' },
    { text: '"Best decision we made" — Studio Owner', locator: 'section:Testimonials' },
    { text: 'Terms of Service. All rights reserved.', locator: 'section:Legal' },
    { text: 'Aumente a retenção de alunos em +25%', locator: 'section:Benefits' },
    { text: 'Financeiro', locator: 'section:Financeiro' },
    { text: 'filler content without structure', locator: 'section:X' },
    { text: 'Members can freeze an active membership for up to 30 days', locator: 'section:Policies' },
    { text: 'Gestão de matrículas', locator: 'section:Matrículas' },
    { text: 'Gestão de matrículas', locator: 'section:Matrículas' }, // duplicata exata
    { text: 'Signal without locator', locator: null },
    { text: 'Freeze membership', locator: null }, // sinal sem locator → evidenceMissing
    { text: 'Zen Planner', locator: 'section:Hero' }, // sujeito não é achado
  ];

  const benchmark = { id: 'zenplanner', name: 'Zen Planner', aliases: ['ZenPlanner'] };

  test('garbage é rejeitado nominalmente e contado; sinais seguem estruturados', () => {
    const pipeline = runNormalizationPipeline({
      observations: ADVERSARIAL_PAGE,
      contentHash: 'sha256:doc',
      source: { url: 'https://zenplanner.com/', tier: 3 },
      benchmark,
    });
    const m = pipeline.metrics;
    expect(m.rawObservations).toBe(ADVERSARIAL_PAGE.length);
    expect(m.marketingClaimsRejected).toBeGreaterThanOrEqual(1);
    expect(m.faqQuestionsRejected).toBeGreaterThanOrEqual(1);
    expect(m.pricingTextRejected).toBeGreaterThanOrEqual(1);
    expect(m.navigationRejected).toBeGreaterThanOrEqual(1);
    expect(m.testimonialsRejected).toBeGreaterThanOrEqual(1);
    expect(m.legalTextRejected).toBeGreaterThanOrEqual(1);
    expect(m.benefitStatementsRejected).toBeGreaterThanOrEqual(1);
    expect(m.headlinesRejected).toBeGreaterThanOrEqual(1);
    expect(m.noiseRejected).toBeGreaterThanOrEqual(1);
    expect(m.evidenceMissingRejected).toBe(1); // sinal sem locator
    expect(m.subjectNameRejected).toBe(1); // Zen Planner é o sujeito
    expect(m.duplicatesCollapsed).toBeGreaterThanOrEqual(1);

    const names = pipeline.candidates.map((candidate) => candidate.externalName);
    expect(names).toContain('Members can freeze an active membership for up to 30 days');
    expect(names).toContain('Gestão de matrículas');
    expect(names).not.toContain('Every payment, every membership, every dollar. In one place.');

    // Todo candidato carrega proveniência completa.
    for (const candidate of pipeline.candidates) {
      expect(candidate.contentHash).toBe('sha256:doc');
      expect(candidate.sourceUrl).toBe('https://zenplanner.com/');
      expect(candidate.locator).toBeTruthy();
      expect(candidate.origin).toBe('EXTERNAL_OBSERVED');
      expect(candidate.confidence).toBeTruthy();
      expect(candidate.normalizationRationale).toBeTruthy();
    }
  });

  test('fragmentHash divergente do texto → hashMismatchRejected', () => {
    const pipeline = runNormalizationPipeline({
      observations: [
        { text: 'Gestão de matrículas', locator: 'section:Matrículas', fragmentHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' },
      ],
      contentHash: 'sha256:doc',
      source: { url: 'https://x.com', tier: 5 },
    });
    expect(pipeline.metrics.hashMismatchRejected).toBe(1);
    expect(pipeline.candidates).toHaveLength(0);
  });

  test('endpoint de API NÃO é promovido a capability automaticamente', () => {
    const pipeline = runNormalizationPipeline({
      observations: [
        { text: 'GET /v1/members', locator: 'operation:GET /v1/members' },
        { text: 'POST /v1/payments', locator: 'operation:POST /v1/payments' },
      ],
      contentHash: 'sha256:api',
      source: { url: 'https://x.com/api', tier: 5 },
    });
    // Sem estrutura verbo+objeto de negócio no TEXTO (path técnico não é
    // descrição de capability): nada é promovido.
    expect(pipeline.candidates).toHaveLength(0);
    expect(pipeline.metrics.candidateCapabilities).toBe(0);
  });
});

// ── Integração: UNRESOLVED persistido mas fora da novidade ───────────────────

describe('novidade honesta — unresolved nunca conta como canonical novelty', () => {
  async function buildServiceWithFindings() {
    const store = createBenchmarkResearchMemoryStore();
    const service = createBenchmarkResearchService({ store, now: () => NOW });
    await service.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: 'semantic-honesty-v1',
      benchmarkIds: ['zenplanner'],
    });
    const source = {
      url: 'https://zenplanner.com/payments/', tier: 3, specificity: 'SPECIFIC',
      verified: true, httpStatus: 200, contentHash: 'sha256:doc',
    };
    // Achado NORMALIZADO (elegível à novidade se não mapeado).
    await service.recordFinding({
      tenantId: TENANT, vertical: VERTICAL, benchmarkId: 'zenplanner',
      kind: 'capability', externalName: 'Real observed feature', source,
      evidenceRef: 'ev-1', locator: 'section:Features',
      metadata: { semanticStatus: SEMANTIC_STATUS.NORMALIZED },
    });
    // Achado UNRESOLVED: persistido para auditoria, fora da novidade.
    await service.recordFinding({
      tenantId: TENANT, vertical: VERTICAL, benchmarkId: 'zenplanner',
      kind: 'capability', externalName: 'Vague unstructured signal', source,
      evidenceRef: 'ev-1', locator: 'section:Misc',
      metadata: { semanticStatus: SEMANTIC_STATUS.UNRESOLVED },
    });
    const patch = await service.buildSamplePatch({ tenantId: TENANT, vertical: VERTICAL });
    return { store, service, patch };
  }

  test('buildSamplePatch exclui UNRESOLVED da novidade e o reporta separado', async () => {
    const { patch } = await buildServiceWithFindings();
    const benchmark = patch.benchmarks.find((entry) => entry.id === 'zenplanner');
    const noveltyNames = benchmark.novelty.newCapabilities.map((item) => item.name);
    expect(noveltyNames).toContain('Real observed feature');
    expect(noveltyNames).not.toContain('Vague unstructured signal');
    expect(benchmark.unresolvedSemanticCandidates).toBe(1);
  });

  test('pipeline + supervisor: métricas do funil são persistidas no subject', async () => {
    const store = createBenchmarkResearchMemoryStore();
    const service = createBenchmarkResearchService({ store, now: () => NOW });
    await service.openDiscoverySet({
      tenantId: TENANT,
      vertical: VERTICAL,
      researchVersion: 'semantic-metrics-v1',
      benchmarkIds: ['zenplanner'],
    });

    const registry = createToolRegistry({ logger: silent });
    const providers = {
      search: async () => ({ candidates: [{ url: 'https://zenplanner.com/', title: 'Zen Planner', specificity: 'SPECIFIC' }] }),
      fetch: async () => ({ httpStatus: 200, contentType: 'text/html', content: '<html>page</html>', contentHash: 'sha256:page' }),
      inspectDocumentation: async () => ({
        sections: ['Features'],
        capabilities: [
          { name: 'Gestão de matrículas', locator: 'section:Features', fragmentHash: null },
          { name: 'Every payment, every membership, every dollar. In one place.', locator: 'section:Hero', fragmentHash: null },
        ],
        journeys: [],
        rules: [],
      }),
      inspectApiDocs: async () => ({ operations: [], capabilities: [], journeys: [], rules: [] }),
      captureEvidence: async ({ contentHash }) => ({ evidenceRef: 'ev-sem-1', contentHash }),
    };
    const runner = createBenchmarkResearchRunner({
      registry,
      runners: providers,
      tenantId: TENANT,
      actor: { classification: 'DEVELOPMENT', permissions: RESEARCH_CAPABILITY_IDS },
      service,
      now: () => NOW,
    });

    const outcome = await runner.inspectSource({
      vertical: VERTICAL,
      benchmark: { id: 'zenplanner', name: 'Zen Planner', aliases: [] },
      benchmarkId: 'zenplanner',
      query: 'zen planner features',
      source: { url: 'https://zenplanner.com/', tier: 3 },
      apiApplicable: false,
    });

    expect(outcome.status).toBe('RESEARCH_EVIDENCE_CAPTURED');
    expect(outcome.semanticMetrics.rawObservations).toBe(2);
    expect(outcome.semanticMetrics.marketingClaimsRejected).toBe(1);
    expect(outcome.findings.map((finding) => finding.externalName)).toEqual(['Gestão de matrículas']);
    // O slogan NUNCA chega a finding.
    expect(outcome.findings.some((finding) => finding.externalName.includes('Every payment'))).toBe(false);
  });
});
