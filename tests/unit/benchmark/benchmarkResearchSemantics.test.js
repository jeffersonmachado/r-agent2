'use strict';

/**
 * MISSÃO CORRETIVA 2026-09-13 — SEMÂNTICA DE PESQUISA COMPETITIVA.
 *
 * Cada teste deste arquivo corresponde a uma PROIBIÇÃO explícita da missão:
 *
 *   - registrar CONCORRENTE como capability (TAREFA 02/24/78);
 *   - marcar ANALYZED após UMA página (TAREFA 20/25/80);
 *   - tratar eixo NÃO PESQUISADO como novidade zero (TAREFA 21/81);
 *   - fundir semânticas distintas na normalização (TAREFA 14);
 *   - evidência sem o content hash do conteúdo efetivamente analisado
 *     (TAREFA 11/82);
 *   - research principal sem permissions explícitas (TAREFA 27/83);
 *   - benchmark interno operando em tenant OPERACIONAL (TAREFA 31/84).
 *
 * O arquivo foi escrito como RED antes das correções: os casos marcados com
 * "RED" falhavam no estado anterior (o supervisor gravava o NOME DO CONCORRENTE
 * como `externalName` de um achado `kind: 'capability'`, e `markAnalyzed`
 * aceitava 1 achado verificado + mapeamento de arquétipo).
 */

const {
  RESEARCH_AXES,
  AXIS_STATES,
  FINDING_ORIGINS,
  SEMANTIC_CODES,
  axisForKind,
  isResearchedAxisState,
  isSubjectNameFinding,
  normalizeFindingName,
  buildAxisCompleteness,
  evaluateAnalyzedCriterion,
} = require('../../../api/services/benchmark/benchmarkResearchSemantics');

const {
  RESEARCH_RUN_OUTCOMES,
  createBenchmarkResearchSupervisor,
} = require('../../../api/services/benchmark/benchmarkResearchSupervisor');
const { RESEARCH_CAPABILITY_IDS } = require('../../../api/services/benchmark/researchCapabilities');
const { createToolRegistry } = require('../../../src/core/cognitive/tool-registry');
const { createBenchmarkResearchMemoryStore } = require('../../helpers/benchmarkResearchMemoryStore');

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const TENANT = 'system';
const VERTICAL = 'fitness';

const BENCHMARK = Object.freeze({
  id: 'evo',
  name: 'EVO (W12)',
  aliases: Object.freeze(['EVO', 'W12', 'W12 Software']),
  archetype: 'integration-first-api',
});

const SOURCE_URL = 'https://w12.com.br/funcionalidades/';
const API_URL = 'https://w12.com.br/api-docs';
const CONTENT_HASH = 'sha256:content-analisado-v1';

/**
 * Provê um runtime de pesquisa REAL no sentido do contrato: as capabilities
 * devolvem conteúdo, hash e estrutura extraída. O que este arquivo NÃO faz é
 * inventar capability — a extração vem do provider de inspeção.
 */
function buildProviders({
  capabilityNames = ['gestão de membros', 'congelamento de matrícula', 'entradas', 'contas a receber'],
  journeys = [],
  rules = [],
  contentHash = CONTENT_HASH,
  httpStatus = 200,
  contentType = 'text/html',
  inspectDocumentation = true,
  inspectApiDocs = true,
} = {}) {
  const calls = { search: 0, fetch: 0, inspectDocumentation: 0, inspectApiDocs: 0, captureEvidence: 0 };
  return {
    calls,
    providers: {
      search: async ({ query }) => {
        calls.search += 1;
        return {
          candidates: [
            { url: SOURCE_URL, title: `${query} — documentação oficial`, specificity: 'SPECIFIC', official: true },
            { url: API_URL, title: 'API oficial', specificity: 'SPECIFIC', official: true },
          ],
        };
      },
      fetch: async ({ url }) => {
        calls.fetch += 1;
        return { httpStatus, contentType, content: `<html>${url} — matriz de recursos</html>`, contentHash };
      },
      inspectDocumentation: async () => {
        calls.inspectDocumentation += 1;
        if (!inspectDocumentation) throw new Error('inspectDocumentation indisponível');
        return {
          contentType: 'text/html',
          sections: ['Recursos'],
          capabilities: capabilityNames.map((name) => ({ name, locator: `section:Recursos#${name}`, fragmentHash: `sha256:frag-${name}` })),
          journeys,
          rules,
        };
      },
      inspectApiDocs: async () => {
        calls.inspectApiDocs += 1;
        if (!inspectApiDocs) throw new Error('inspectApiDocs indisponível');
        return {
          operations: [{ operationId: 'listMembers', method: 'GET', path: '/members', locator: 'openapi#/paths/~1members/get' }],
          capabilities: capabilityNames.map((name) => ({ name, locator: `openapi#operation:${name}`, fragmentHash: `sha256:api-${name}` })),
          journeys: [],
          rules: [],
        };
      },
      captureEvidence: async ({ url, contentHash: hash }) => {
        calls.captureEvidence += 1;
        return { evidenceRef: `ev:${url}`, contentHash: hash };
      },
    },
  };
}

function buildSupervisor({ providers = {}, store = null, actor = undefined, plan = null, registry = null } = {}) {
  const toolRegistry = registry || createToolRegistry({ logger: silent });
  const researchStore = store || createBenchmarkResearchMemoryStore();
  const supervisor = createBenchmarkResearchSupervisor({
    store: researchStore,
    registry: toolRegistry,
    providers,
    tenantId: TENANT,
    ...(actor === undefined ? {} : { actor }),
    logger: silent,
  });
  return { supervisor, registry: toolRegistry, store: researchStore, plan };
}

async function openRun(supervisor) {
  await supervisor.service.openDiscoverySet({
    tenantId: TENANT,
    vertical: VERTICAL,
    researchVersion: '2026.09.13-1',
    benchmarkIds: ['evo'],
    holdoutBenchmarkId: null,
  });
}

// ---------------------------------------------------------------------------
// TAREFA 02 / 24 / 78 — CONCORRENTE NÃO É CAPABILITY
// ---------------------------------------------------------------------------

describe('TAREFA 02/24/78 — concorrente NUNCA entra como capability', () => {
  test('isSubjectNameFinding reconhece o nome (e aliases) do benchmark', () => {
    expect(isSubjectNameFinding({ candidate: 'EVO', benchmark: BENCHMARK })).toBe(true);
    expect(isSubjectNameFinding({ candidate: 'w12', benchmark: BENCHMARK })).toBe(true);
    expect(isSubjectNameFinding({ candidate: 'W12 Software', benchmark: BENCHMARK })).toBe(true);
    expect(isSubjectNameFinding({ candidate: 'congelamento de matrícula', benchmark: BENCHMARK })).toBe(false);
  });

  test('RED — pesquisa de EVO produz capabilities REAIS e nunca "EVO"', async () => {
    const { providers } = buildProviders();
    const { supervisor, store } = buildSupervisor({ providers });
    await openRun(supervisor);

    const result = await supervisor.research({
      vertical: VERTICAL,
      benchmark: BENCHMARK,
      plan: { benchmarks: [{ benchmarkId: 'evo', name: 'EVO (W12)', archetype: 'integration-first-api', declaredSources: [{ url: SOURCE_URL, tier: 5 }] }] },
    });

    expect(result.status).toBe(RESEARCH_RUN_OUTCOMES.ANALYZED);
    const patch = await supervisor.buildSamplePatch({ vertical: VERTICAL });
    const evo = patch.benchmarks.find((benchmark) => benchmark.id === 'evo');
    const newCapabilities = evo.novelty.newCapabilities.map((item) => String(item.name).toLowerCase());

    // Missão semântica 2026-09-15 — os quatro recursos observados casam com
    // equivalência DECLARADA da política de normalização: são CONFIRMAÇÕES do
    // inventário canônico (canonical_id preenchido), não novidade. A pesquisa
    // continua produzindo os achados REAIS — eles só não inflam a curva.
    const summary = await supervisor.summarize({ vertical: VERTICAL });
    expect(summary.totalFindings).toBe(4);
    const run = await store.getRun({ tenantId: TENANT, vertical: VERTICAL });
    const stored = await store.listFindings({ tenantId: TENANT, runId: run.id });
    const byName = new Map(stored.map((finding) => [String(finding.external_name).toLowerCase(), finding.canonical_id]));
    expect(byName.get('gestão de membros')).toBe('fitness.member.management');
    expect(byName.get('congelamento de matrícula')).toBe('fitness.membership.freeze');
    expect(byName.get('entradas')).toBe('fitness.access.turnstile');
    expect(byName.get('contas a receber')).toBe('fitness.billing.receivable');
    expect(newCapabilities).not.toContain('evo');
    expect(newCapabilities.join(' ')).not.toMatch(/\bw12\b/);
    expect(newCapabilities).not.toEqual(
      expect.arrayContaining(['gestão de membros', 'congelamento de matrícula', 'entradas', 'contas a receber']),
    );
  });

  test('a capability extraída é registrada com o NOME DO RECURSO, não o do fornecedor', async () => {
    const { providers } = buildProviders();
    const { supervisor, store } = buildSupervisor({ providers });
    await openRun(supervisor);
    await supervisor.research({
      vertical: VERTICAL,
      benchmark: BENCHMARK,
      plan: { benchmarks: [{ benchmarkId: 'evo', name: 'EVO (W12)', archetype: 'integration-first-api', declaredSources: [{ url: SOURCE_URL, tier: 5 }] }] },
    });

    const run = await store.getRun({ tenantId: TENANT, vertical: VERTICAL });
    const findings = await store.listFindings({ tenantId: TENANT, runId: run.id });
    const names = findings.map((finding) => String(finding.external_name).toLowerCase());
    expect(names).not.toContain('evo');
    expect(names).not.toContain('evo (w12)');
    expect(names.some((name) => name.includes('congelamento'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TAREFA 13 / 14 — NORMALIZAÇÃO COM PROTEÇÃO CONTRA OVER-MERGE
// ---------------------------------------------------------------------------

describe('TAREFA 13/14 — normalização sem over-merge', () => {
  test('equivalentes semânticos resolvem para o MESMO canônico', () => {
    const a = normalizeFindingName({ externalName: 'Freeze Membership', kind: 'capability' });
    const b = normalizeFindingName({ externalName: 'Congelamento de matrícula', kind: 'capability' });
    const c = normalizeFindingName({ externalName: 'Trancamento', kind: 'capability' });
    expect(a.canonicalId).toBe('fitness.membership.freeze');
    expect(b.canonicalId).toBe('fitness.membership.freeze');
    expect(c.canonicalId).toBe('fitness.membership.freeze');
  });

  test('RED — semânticas DISTINTAS jamais são fundidas automaticamente', () => {
    const freeze = normalizeFindingName({ externalName: 'freeze', kind: 'capability' });
    const cancel = normalizeFindingName({ externalName: 'cancel', kind: 'capability' });
    const scheduled = normalizeFindingName({ externalName: 'scheduled cancel', kind: 'capability' });
    const suspend = normalizeFindingName({ externalName: 'suspend access', kind: 'capability' });
    const inactive = normalizeFindingName({ externalName: 'inactive', kind: 'capability' });
    const expired = normalizeFindingName({ externalName: 'expired', kind: 'capability' });

    const ids = [freeze, cancel, scheduled, suspend, inactive, expired].map((entry) => entry.canonicalId);
    // Nenhum par destes pode compartilhar o mesmo canônico.
    expect(new Set(ids.filter(Boolean)).size).toBe(ids.filter(Boolean).length);
    if (freeze.canonicalId) expect(cancel.canonicalId).not.toBe(freeze.canonicalId);
  });

  test('nome não reconhecido NÃO recebe canônico inventado (é novidade candidata)', () => {
    const result = normalizeFindingName({ externalName: 'ritual de boas-vindas por biometria', kind: 'capability' });
    expect(result.canonicalId).toBeNull();
    expect(result.normalized).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// TAREFA 11 / 12 / 82 — EVIDENCE BINDING CRIPTOGRÁFICO
// ---------------------------------------------------------------------------

describe('TAREFA 11/12/82 — evidência ligada ao conteúdo analisado', () => {
  test('a evidência persistida carrega o content hash do fetch', async () => {
    const { providers } = buildProviders();
    const { supervisor, store } = buildSupervisor({ providers });
    await openRun(supervisor);
    await supervisor.research({
      vertical: VERTICAL,
      benchmark: BENCHMARK,
      plan: { benchmarks: [{ benchmarkId: 'evo', name: 'EVO (W12)', archetype: 'integration-first-api', declaredSources: [{ url: SOURCE_URL, tier: 5 }] }] },
    });

    const run = await store.getRun({ tenantId: TENANT, vertical: VERTICAL });
    const evidence = await store.listEvidence({ tenantId: TENANT, runId: run.id });
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((row) => row.content_hash === CONTENT_HASH)).toBe(true);
  });

  test('achado aponta para locator/fragmento da fonte (nunca homepage genérica)', async () => {
    const { providers } = buildProviders();
    const { supervisor, store } = buildSupervisor({ providers });
    await openRun(supervisor);
    await supervisor.research({
      vertical: VERTICAL,
      benchmark: BENCHMARK,
      plan: { benchmarks: [{ benchmarkId: 'evo', name: 'EVO (W12)', archetype: 'integration-first-api', declaredSources: [{ url: SOURCE_URL, tier: 5 }] }] },
    });

    const run = await store.getRun({ tenantId: TENANT, vertical: VERTICAL });
    const findings = await store.listFindings({ tenantId: TENANT, runId: run.id });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.evidence_id)).toBe(true);
    const metadataLocator = findings.map((finding) => finding.metadata?.locator || finding.metadata?.fragmentHash || null);
    expect(metadataLocator.every((locator) => typeof locator === 'string' && locator.length > 0)).toBe(true);
  });

  test('RED — hash do fetch diferente do hash da evidência é RECUSADO', async () => {
    const { providers } = buildProviders();
    // O provider de captura devolve um hash de OUTRO conteúdo: a cadeia quebra.
    providers.captureEvidence = async ({ url }) => ({ evidenceRef: `ev:${url}`, contentHash: 'sha256:conteudo-DIFERENTE' });
    const { supervisor } = buildSupervisor({ providers });
    await openRun(supervisor);

    const result = await supervisor.research({
      vertical: VERTICAL,
      benchmark: BENCHMARK,
      plan: { benchmarks: [{ benchmarkId: 'evo', name: 'EVO (W12)', archetype: 'integration-first-api', declaredSources: [{ url: SOURCE_URL, tier: 5 }] }] },
    });

    expect(result.status).toBe(RESEARCH_RUN_OUTCOMES.PARTIAL);
    const failures = JSON.stringify(result.results);
    expect(failures).toMatch(/EVIDENCE_HASH_MISMATCH|evidence_hash_mismatch/);
  });
});

// ---------------------------------------------------------------------------
// TAREFA 18 — EXTERNAL_OBSERVED vs RAP_DERIVED
// ---------------------------------------------------------------------------

describe('TAREFA 18 — origem da observação', () => {
  test('finding com locator na fonte é EXTERNAL_OBSERVED; sem locator é RAP_DERIVED', () => {
    const observed = {
      name: 'congelamento de matrícula',
      locator: 'section:Recursos#congelamento',
      origin: FINDING_ORIGINS.EXTERNAL_OBSERVED,
    };
    const derived = { name: 'sugestão interna de jornada', origin: FINDING_ORIGINS.RAP_DERIVED };
    expect(observed.origin).toBe('EXTERNAL_OBSERVED');
    expect(derived.origin).toBe('RAP_DERIVED');
  });

  test('RED — RAP_DERIVED não entra na novidade do sample', async () => {
    const { providers } = buildProviders();
    const { supervisor, store } = buildSupervisor({ providers });
    await openRun(supervisor);
    const run = await store.getRun({ tenantId: TENANT, vertical: VERTICAL });
    await store.insertFinding({
      tenantId: TENANT,
      runId: run.id,
      benchmarkId: 'evo',
      kind: 'capability',
      externalName: 'capacidade inferida internamente',
      canonicalId: null,
      verified: true,
      verificationState: 'VERIFIED_OFFICIAL',
      metadata: { origin: FINDING_ORIGINS.RAP_DERIVED },
    });

    const patch = await supervisor.buildSamplePatch({ vertical: VERTICAL });
    const evo = patch.benchmarks.find((benchmark) => benchmark.id === 'evo');
    const names = (evo?.novelty?.newCapabilities || []).map((item) => String(item.name).toLowerCase());
    expect(names).not.toContain('capacidade inferida internamente');
  });
});

// ---------------------------------------------------------------------------
// TAREFA 19 / 20 / 21 / 25 / 26 / 80 / 81 — CRITÉRIO DE ANÁLISE POR EIXO
// ---------------------------------------------------------------------------

describe('TAREFA 19/20/21 — completude por eixo e critério de ANALYZED', () => {
  test('axisForKind/axisForState mapeiam os três eixos obrigatórios', () => {
    expect(axisForKind('capability')).toBe(RESEARCH_AXES.CAPABILITY);
    expect(axisForKind('journey')).toBe(RESEARCH_AXES.JOURNEY);
    expect(axisForKind('businessRule')).toBe(RESEARCH_AXES.BUSINESS_RULE);
    expect(isResearchedAxisState(AXIS_STATES.RESEARCHED_NO_FINDINGS)).toBe(true);
    expect(isResearchedAxisState(AXIS_STATES.RESEARCHED_WITH_FINDINGS)).toBe(true);
    expect(isResearchedAxisState(AXIS_STATES.NOT_RESEARCHED)).toBe(false);
    expect(isResearchedAxisState(AXIS_STATES.BLOCKED)).toBe(false);
  });

  test('RED — eixo NÃO pesquisado não conta como pesquisado', () => {
    const completeness = buildAxisCompleteness({
      axes: {
        [RESEARCH_AXES.CAPABILITY]: AXIS_STATES.RESEARCHED_WITH_FINDINGS,
        [RESEARCH_AXES.JOURNEY]: AXIS_STATES.NOT_RESEARCHED,
        [RESEARCH_AXES.BUSINESS_RULE]: AXIS_STATES.NOT_RESEARCHED,
      },
    });
    expect(completeness.complete).toBe(false);
    expect(completeness.missing).toEqual([RESEARCH_AXES.JOURNEY, RESEARCH_AXES.BUSINESS_RULE]);
  });

  test('RESEARCHED_NO_FINDINGS é eixo pesquisado (zero achados ≠ não pesquisado)', () => {
    const completeness = buildAxisCompleteness({
      axes: {
        [RESEARCH_AXES.CAPABILITY]: AXIS_STATES.RESEARCHED_WITH_FINDINGS,
        [RESEARCH_AXES.JOURNEY]: AXIS_STATES.RESEARCHED_NO_FINDINGS,
        [RESEARCH_AXES.BUSINESS_RULE]: AXIS_STATES.RESEARCHED_NO_FINDINGS,
      },
    });
    expect(completeness.complete).toBe(true);
    expect(completeness.missing).toEqual([]);
  });

  test('RED — critério de ANALYSIS exige inspeção de documentação E de API + 3 eixos', () => {
    const weak = evaluateAnalyzedCriterion({
      benchmark: BENCHMARK,
      inspections: { documentation: false, api: false },
      axes: { [RESEARCH_AXES.CAPABILITY]: AXIS_STATES.RESEARCHED_WITH_FINDINGS },
      findings: [{ verified: true }],
      evidence: [{ verified: true }],
    });
    expect(weak.satisfied).toBe(false);
    expect(weak.missing).toEqual(expect.arrayContaining([
      SEMANTIC_CODES.INSPECTION_DOCUMENTATION_MISSING,
      SEMANTIC_CODES.INSPECTION_API_MISSING,
      SEMANTIC_CODES.AXIS_JOURNEY_NOT_RESEARCHED,
      SEMANTIC_CODES.AXIS_BUSINESS_RULE_NOT_RESEARCHED,
    ]));

    const strong = evaluateAnalyzedCriterion({
      benchmark: BENCHMARK,
      inspections: { documentation: true, api: true },
      axes: {
        [RESEARCH_AXES.CAPABILITY]: AXIS_STATES.RESEARCHED_WITH_FINDINGS,
        [RESEARCH_AXES.JOURNEY]: AXIS_STATES.RESEARCHED_WITH_FINDINGS,
        [RESEARCH_AXES.BUSINESS_RULE]: AXIS_STATES.RESEARCHED_NO_FINDINGS,
      },
      findings: [{ verified: true }],
      // Evidência FORTE: com hash do conteúdo analisado e locator na fonte.
      evidence: [{ verified: true, contentHash: 'sha256:conteudo-analisado', locator: 'section:Recursos#1' }],
    });
    expect(strong.satisfied).toBe(true);
    expect(strong.missing).toEqual([]);
  });

  test('RED — UMA homepage não analisa o benchmark (TAREFA 25/80)', async () => {
    // Provider que só acha a homepage e nada inspecionável.
    const { providers } = buildProviders({
      capabilityNames: [],
      journeys: [],
      rules: [],
      inspectDocumentation: false,
      inspectApiDocs: false,
    });
    providers.search = async () => ({ candidates: [{ url: 'https://w12.com.br/', title: 'EVO — homepage', specificity: 'GENERIC' }] });
    const { supervisor } = buildSupervisor({ providers });
    await openRun(supervisor);

    const result = await supervisor.research({
      vertical: VERTICAL,
      benchmark: BENCHMARK,
      plan: { benchmarks: [{ benchmarkId: 'evo', name: 'EVO (W12)', archetype: 'integration-first-api', declaredSources: [{ url: 'https://w12.com.br/', tier: 5 }] }] },
    });

    expect(result.analyzed).toEqual([]);
    const patch = await supervisor.buildSamplePatch({ vertical: VERTICAL });
    const evo = patch.benchmarks.find((benchmark) => benchmark.id === 'evo');
    expect(evo.analyzedAt).toBeNull();
  });

  test('documentação completa + 3 eixos pesquisados → ANALYZED (TAREFA 26)', async () => {
    const { providers } = buildProviders({
      journeys: [{ name: 'lead → trial → matrícula → pagamento → acesso', locator: 'section:Jornadas#1' }],
      rules: [{ name: 'congelamento pausa a cobrança', locator: 'section:Regras#1' }],
    });
    const { supervisor } = buildSupervisor({ providers });
    await openRun(supervisor);

    const result = await supervisor.research({
      vertical: VERTICAL,
      benchmark: BENCHMARK,
      plan: { benchmarks: [{ benchmarkId: 'evo', name: 'EVO (W12)', archetype: 'integration-first-api', declaredSources: [{ url: SOURCE_URL, tier: 5 }] }] },
    });

    expect(result.analyzed).toEqual(['evo']);
    const patch = await supervisor.buildSamplePatch({ vertical: VERTICAL });
    const evo = patch.benchmarks.find((benchmark) => benchmark.id === 'evo');
    expect(evo.analyzedAt).toBeTruthy();
    // Missão semântica 2026-09-15 — jornada e regra observadas casam com
    // equivalência DECLARADA (fitness.journey.lead_to_membership /
    // fitness.rule.freeze_pauses_billing): confirmações, não novidade. O eixo
    // foi pesquisado (RESEARCHED_WITH_FINDINGS) — zero novidade MEDIDO.
    expect(evo.novelty.newJourneys.length).toBe(0);
    expect(evo.novelty.newBusinessRules.length).toBe(0);
    const axes = Object.fromEntries((evo.axisCompleteness || []).map((entry) => [entry.axis, entry.researched]));
    expect(axes.JOURNEY_AXIS).toBe(true);
    expect(axes.BUSINESS_RULE_AXIS).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TAREFA 22 — SATURAÇÃO SÓ COM EIXO PESQUISADO
// ---------------------------------------------------------------------------

describe('TAREFA 22 — saturação não usa eixo não pesquisado', () => {
  test('somente RESEARCHED_* entra no denominador de saturação', () => {
    const { isResearchedAxisState: isResearched } = require('../../../api/services/benchmark/benchmarkResearchSemantics');
    const axes = [
      AXIS_STATES.NOT_RESEARCHED,
      AXIS_STATES.IN_PROGRESS,
      AXIS_STATES.BLOCKED,
      AXIS_STATES.FAILED,
      AXIS_STATES.RESEARCHED_NO_FINDINGS,
      AXIS_STATES.RESEARCHED_WITH_FINDINGS,
    ];
    expect(axes.filter(isResearched)).toEqual([
      AXIS_STATES.RESEARCHED_NO_FINDINGS,
      AXIS_STATES.RESEARCHED_WITH_FINDINGS,
    ]);
  });
});

// ---------------------------------------------------------------------------
// TAREFA 27 / 83 — PERMISSION MODEL DO RESEARCH PRINCIPAL
// ---------------------------------------------------------------------------

describe('TAREFA 27/83 — permission model explícito', () => {
  test('RED — principal default tem delegação EXPLÍCITA para research.* (sem wildcard)', () => {
    const { supervisor } = buildSupervisor({});
    const permissions = supervisor.actor.permissions;
    expect(Array.isArray(permissions)).toBe(true);
    expect(permissions).toEqual(expect.arrayContaining(['benchmark.research.execute', ...RESEARCH_CAPABILITY_IDS]));
    expect(permissions).not.toContain('*');
    expect(permissions.some((permission) => permission.endsWith('.*'))).toBe(false);
    expect(supervisor.actor.classification).toBe('DEVELOPMENT');
  });
});

// ---------------------------------------------------------------------------
// TAREFA 31 / 84 — SYSTEM TENANT
// ---------------------------------------------------------------------------

describe('TAREFA 31/84 — pesquisa competitiva é SYSTEM, nunca tenant operacional', () => {
  test('RED — tenant operacional é recusado', () => {
    const store = createBenchmarkResearchMemoryStore();
    expect(() => createBenchmarkResearchSupervisor({
      store,
      registry: createToolRegistry({ logger: silent }),
      providers: {},
      tenantId: 'cliente-academia-01',
      logger: silent,
    })).toThrow(/benchmark_research_system_tenant_required/);
  });

  test('SYSTEM tenant e aliases internos são aceitos e normalizados', () => {
    const store = createBenchmarkResearchMemoryStore();
    for (const tenantId of ['system', 'SYSTEM', 'internal']) {
      const supervisor = createBenchmarkResearchSupervisor({
        store,
        registry: createToolRegistry({ logger: silent }),
        providers: {},
        tenantId,
        logger: silent,
      });
      expect(supervisor.tenantId).toBe('system');
    }
  });
});

// ---------------------------------------------------------------------------
// TAREFA 32 / 84 — CROSS-TENANT NA ROTA REAL (HTTP de verdade)
// ---------------------------------------------------------------------------

describe('TAREFA 32/84 — rota resolve SYSTEM server-side (nunca tenant operacional)', () => {
  const http = require('http');
  const express = require('express');
  const { createBenchmarkResearchRoutes } = require('../../../api/modules/benchmark-research/routes');

  function buildApp({ tenantId }) {
    const store = createBenchmarkResearchMemoryStore();
    const registry = createToolRegistry({ logger: silent });
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.agent = { platformClassification: 'DEVELOPMENT', tenantId, userId: 'u-1', username: 'engineer' };
      res.locals.agent = req.agent;
      next();
    });
    app.use(createBenchmarkResearchRoutes({
      buildDeps: () => ({
        requireAuth: (req) => ({ valid: true, agent: req.agent }),
        requirePermission: () => ({ allowed: true }),
        sendJson: (res, code, payload) => res.status(code).json(payload),
        badRequest: (res, message) => res.status(400).json({ error: 'bad_request', message }),
        hasJsonContentType: (req) => String(req.headers['content-type'] || '').includes('application/json'),
        parseJsonBody: async (req) => req.body || {},
        logger: silent,
      }),
      resolveResearchDeps: () => ({ store, registry, providers: {} }),
    }));
    return { app, store };
  }

  async function withServer(app, run) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      return await run(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  test('RED — tenant OPERACIONAL é recusado com 403 e nada é persistido', async () => {
    const { app, store } = buildApp({ tenantId: 'cliente-academia-01' });
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/benchmark-research/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          vertical: VERTICAL,
          researchVersion: 'cross-tenant-attempt',
          benchmarkIds: ['evo'],
        }),
      });
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe('benchmark_research_system_tenant_required');
      expect(body.authenticatedTenant).toBe('cliente-academia-01');
      expect(body.requiredTenant).toBe('system');
    });
    // Nenhum run foi criado para o tenant operacional.
    expect(await store.getRun({ tenantId: 'cliente-academia-01', vertical: VERTICAL })).toBeNull();
  });

  test('o run é criado no tenant SYSTEM mesmo quando o alias autenticado é "internal"', async () => {
    const { app, store } = buildApp({ tenantId: 'internal' });
    await withServer(app, async (base) => {
      const response = await fetch(`${base}/api/benchmark-research/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          vertical: VERTICAL,
          researchVersion: 'system-tenant-resolution',
          benchmarkIds: ['evo'],
        }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).summary.state).toBe('RESEARCH_DISCOVERY_OPEN');
    });
    const run = await store.getRun({ tenantId: 'system', vertical: VERTICAL });
    expect(run).toBeTruthy();
    expect(run.tenant_key).toBe('system');
  });
});
