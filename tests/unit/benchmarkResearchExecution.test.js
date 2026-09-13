'use strict';

/**
 * Benchmark Research Execution — camada de execução + capabilities governadas.
 *
 * Prova que a pesquisa competitiva deixou de ser "o engine avalia algo que
 * ninguém executou":
 *   - achado sem fonte verificável NÃO é prova (vira UNVERIFIED e não conta);
 *   - benchmark sem evidência fica sem `analyzedAt` (engine → NOT_MEASURABLE);
 *   - discovery set é registrado ANTES da análise; holdout é protegido;
 *   - research subagent usa CAPABILITIES governadas (`research.*`), visíveis
 *     apenas em DEVELOPMENT e atendíveis por provider nativo OU MCP externo.
 */

const { createToolRegistry } = require('../../src/core/cognitive/tool-registry');
const {
  FINDING_KINDS,
  RESEARCH_STATES,
  RESEARCH_BLOCKERS,
  classifyResearchSource,
  createBenchmarkResearchService,
} = require('../../api/services/benchmark/benchmarkResearchService');
const { createBenchmarkResearchMemoryStore } = require('../helpers/benchmarkResearchMemoryStore');
const { completeAnalysisEvidence } = require('../helpers/benchmarkAnalysisEvidence');
const {
  RESEARCH_CAPABILITIES,
  RESEARCH_CAPABILITY_IDS,
  ensureResearchCapabilities,
  executeResearchCapability,
  buildResearchProvenance,
} = require('../../api/services/benchmark/researchCapabilities');

const RESEARCH_TOOL_IDS = RESEARCH_CAPABILITIES.map((c) => c.id);

const silent = { info() {}, warn() {}, error() {}, debug() {} };

const OFFICIAL_SOURCE = {
  url: 'https://docs.example-vendor.com/features/membership-management',
  tier: 5,
  specificity: 'SPECIFIC',
  verified: true,
  httpStatus: 200,
};

const SECONDARY_SOURCE = {
  url: 'https://help.example-vendor.com/articles/checkin',
  tier: 7,
  specificity: 'SPECIFIC',
  verified: true,
  httpStatus: 200,
};

const GENERIC_SOURCE = { url: 'https://example-vendor.com/', tier: 5, verified: true, httpStatus: 200 };
const UNFETCHED_SOURCE = { url: 'https://docs.example-vendor.com/features/billing', tier: 1 };

/**
 * TENANT fixo dos testes. A persistência é tenant-scoped por contrato: um teste
 * que omitisse o tenant não estaria exercitando o isolamento real.
 *
 * O store é EM MEMÓRIA porque esta suíte testa POLÍTICA (ordem de discovery,
 * holdout, evidência obrigatória) — a persistência real é provada contra o
 * Postgres em `tests/unit/benchmarks/benchmarkResearchPersistence.test.js`.
 */
const TENANT = 'system';

function buildService() {
  let tick = 0;
  return createBenchmarkResearchService({
    store: createBenchmarkResearchMemoryStore(),
    now: () => `2026-09-11T00:00:0${tick++}.000Z`,
  });
}

async function openRun(service) {
  return service.openDiscoverySet({
    tenantId: TENANT,
    vertical: 'fitness',
    researchVersion: 'fitness-research-v1',
    benchmarkIds: ['bench-a', 'bench-b', 'zenplanner'],
    holdoutBenchmarkId: 'zenplanner',
  });
}

describe('Benchmark research — evidência é obrigatória para marcar análise', () => {
  test('fonte verificável oficial/secundária conta como prova', () => {
    expect(classifyResearchSource(OFFICIAL_SOURCE).verified).toBe(true);
    expect(classifyResearchSource(OFFICIAL_SOURCE).state).toBe('VERIFIED_OFFICIAL');
    expect(classifyResearchSource(SECONDARY_SOURCE).verified).toBe(true);
    expect(classifyResearchSource(SECONDARY_SOURCE).state).toBe('VERIFIED_SECONDARY');
  });

  test('fonte genérica (homepage) NÃO prova capability', () => {
    const result = classifyResearchSource(GENERIC_SOURCE);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('generic_source_cannot_prove_capability');
  });

  test('fonte sem obtenção confirmada é NEEDS_VERIFICATION, não prova', () => {
    const result = classifyResearchSource(UNFETCHED_SOURCE);
    expect(result.verified).toBe(false);
    expect(result.state).toBe('NEEDS_VERIFICATION');
    expect(result.reason).toBe('source_retrieval_not_confirmed');
  });

  test('fonte sem URL nunca é prova', () => {
    expect(classifyResearchSource({ tier: 1 }).verified).toBe(false);
    expect(classifyResearchSource(null).verified).toBe(false);
  });

  test('achado sem fonte verificável é registrado mas NÃO conta como prova', async () => {
    const service = buildService();
    await openRun(service);

    const finding = await service.recordFinding({
      tenantId: TENANT,
      vertical: 'fitness',
      benchmarkId: 'bench-a',
      kind: FINDING_KINDS.CAPABILITY,
      externalName: 'Gestão de matrículas',
      source: GENERIC_SOURCE,
      evidenceRef: 'ev-1',
    });

    expect(finding.verified).toBe(false);
    const summary = await service.summarize({ tenantId: TENANT, vertical: 'fitness' });
    expect(summary.totalFindings).toBe(1);
    expect(summary.unverifiedFindings).toBe(1);
    expect(summary.requiresRevalidation).toBe(true);
  });

  test('analyzedAt exige evidência COMPLETA: achado verificado + 3 eixos + inspeções + evidência ligada', async () => {
    const service = buildService();
    await openRun(service);

    // Sem nenhum achado → recusa.
    await expect(service.markAnalyzed({
      tenantId: TENANT,
      vertical: 'fitness',
      benchmarkId: 'bench-a',
      marketArchetypeMapping: { archetype: 'independent-gym' },
    })).rejects.toThrow(new RegExp(RESEARCH_BLOCKERS.ANALYSIS_INCOMPLETE));

    // Achado NÃO verificado continua não contando.
    await service.recordFinding({
      tenantId: TENANT,
      vertical: 'fitness', benchmarkId: 'bench-a', kind: FINDING_KINDS.CAPABILITY,
      externalName: 'x', source: GENERIC_SOURCE, evidenceRef: 'ev-1',
    });
    await expect(service.markAnalyzed({
      tenantId: TENANT,
      vertical: 'fitness', benchmarkId: 'bench-a',
      marketArchetypeMapping: { archetype: 'independent-gym' },
    })).rejects.toThrow(new RegExp(RESEARCH_BLOCKERS.ANALYSIS_INCOMPLETE));

    // Achado verificado SEM os eixos/inspeções declarados ainda é RECUSADO:
    // "achei uma página" deixou de ser prova de análise (TAREFA 20/25).
    const verifiedOnly = await service.recordFinding({
      tenantId: TENANT,
      vertical: 'fitness', benchmarkId: 'bench-a', kind: FINDING_KINDS.CAPABILITY,
      externalName: 'Gestão de matrículas', canonicalId: 'membership.manage',
      source: OFFICIAL_SOURCE, evidenceRef: 'ev-2',
    });
    expect(verifiedOnly.verified).toBe(true);
    await expect(service.markAnalyzed({
      tenantId: TENANT,
      vertical: 'fitness', benchmarkId: 'bench-a',
      marketArchetypeMapping: { archetype: 'independent-gym' },
    })).rejects.toThrow(/benchmark_axis_capability_not_researched/);

    // Evidência COMPLETA (três eixos + documentação + API + hash/locator) → aceito.
    await completeAnalysisEvidence(service, {
      tenantId: TENANT,
      vertical: 'fitness',
      benchmarkId: 'bench-a',
      canonicalId: 'membership.manage',
    });
    const analyzed = await service.markAnalyzed({
      tenantId: TENANT,
      vertical: 'fitness', benchmarkId: 'bench-a',
      marketArchetypeMapping: { archetype: 'independent-gym', rationale: 'foco em matrícula e caixa' },
    });
    expect(analyzed.analyzedAt).toBeTruthy();
    // Inventário é um ARRAY DE REFERÊNCIAS verificadas — o formato que o engine
    // exige para aceitar a análise como evidência (§B7).
    expect(Array.isArray(analyzed.findingsInventory)).toBe(true);
    expect(analyzed.findingsInventory.length).toBeGreaterThanOrEqual(1);
    expect(analyzed.unverifiedFindings).toBe(1);
  });

  test('achado em benchmark fora do discovery set é recusado', async () => {
    const service = buildService();
    await openRun(service);
    await expect(service.recordFinding({
      tenantId: TENANT,
      vertical: 'fitness', benchmarkId: 'nao-registrado', kind: FINDING_KINDS.CAPABILITY,
      externalName: 'x', source: OFFICIAL_SOURCE, evidenceRef: 'ev-1',
    })).rejects.toThrow(new RegExp(RESEARCH_BLOCKERS.UNKNOWN_BENCHMARK));
  });

  test('tipo de achado inválido é recusado', async () => {
    const service = buildService();
    await openRun(service);
    await expect(service.recordFinding({
      tenantId: TENANT,
      vertical: 'fitness', benchmarkId: 'bench-a', kind: 'whatever',
      externalName: 'x', source: OFFICIAL_SOURCE, evidenceRef: 'ev-1',
    })).rejects.toThrow(new RegExp(RESEARCH_BLOCKERS.INVALID_KIND));
  });
});

describe('Benchmark research — ordem de discovery e holdout', () => {
  test('registrar achado antes do discovery set é recusado (§5)', async () => {
    const service = buildService();
    await expect(service.recordFinding({
      tenantId: TENANT,
      vertical: 'fitness', benchmarkId: 'bench-a', kind: FINDING_KINDS.CAPABILITY,
      externalName: 'x', source: OFFICIAL_SOURCE, evidenceRef: 'ev-1',
    })).rejects.toThrow(new RegExp(RESEARCH_BLOCKERS.NO_DISCOVERY_SET));
  });

  test('discovery set exige versão de pesquisa e não aceita duplicatas', async () => {
    const service = buildService();
    await expect(service.openDiscoverySet({ tenantId: TENANT, vertical: 'fitness', benchmarkIds: ['a'] }))
      .rejects.toThrow('research_version_required');
    await expect(service.openDiscoverySet({ tenantId: TENANT, vertical: 'fitness', researchVersion: 'v1', benchmarkIds: [] }))
      .rejects.toThrow('research_discovery_set_empty');
    await expect(service.openDiscoverySet({ tenantId: TENANT, vertical: 'fitness', researchVersion: 'v1', benchmarkIds: ['a', 'a'] }))
      .rejects.toThrow('research_discovery_set_duplicate');
  });

  test('holdout NÃO pode ser analisado antes da saturação aparente (§13)', async () => {
    const service = buildService();
    await openRun(service);

    await service.recordFinding({
      tenantId: TENANT,
      vertical: 'fitness', benchmarkId: 'zenplanner', kind: FINDING_KINDS.CAPABILITY,
      externalName: 'WOD tracking', source: OFFICIAL_SOURCE, evidenceRef: 'ev-h',
    });

    // A proteção do holdout dispara ANTES do critério de evidência: abrir o
    // holdout cedo é uma violação de ORDEM, não uma questão de completude.
    await expect(service.markAnalyzed({
      tenantId: TENANT,
      vertical: 'fitness', benchmarkId: 'zenplanner',
      marketArchetypeMapping: { archetype: 'crossfit-box' },
    })).rejects.toThrow(new RegExp(RESEARCH_BLOCKERS.HOLDOUT_ORDER_VIOLATION));

    await service.markApparentSaturation({ tenantId: TENANT, vertical: 'fitness' });
    await completeAnalysisEvidence(service, {
      tenantId: TENANT,
      vertical: 'fitness',
      benchmarkId: 'zenplanner',
      externalName: 'WOD tracking',
    });
    const analyzed = await service.markAnalyzed({
      tenantId: TENANT,
      vertical: 'fitness', benchmarkId: 'zenplanner',
      marketArchetypeMapping: { archetype: 'crossfit-box' },
    });
    expect(analyzed.analyzedAt).toBeTruthy();
  });

  test('estado inicial é NOT_STARTED e passa a IN_PROGRESS com achado', async () => {
    const service = buildService();
    expect((await service.summarize({ tenantId: TENANT, vertical: 'fitness' })).state)
      .toBe(RESEARCH_STATES.NOT_STARTED);
    await openRun(service);
    expect((await service.summarize({ tenantId: TENANT, vertical: 'fitness' })).state)
      .toBe(RESEARCH_STATES.DISCOVERY_OPEN);
    await service.recordFinding({
      tenantId: TENANT,
      vertical: 'fitness', benchmarkId: 'bench-a', kind: FINDING_KINDS.CAPABILITY,
      externalName: 'x', source: OFFICIAL_SOURCE, evidenceRef: 'ev-1',
    });
    expect((await service.summarize({ tenantId: TENANT, vertical: 'fitness' })).state)
      .toBe(RESEARCH_STATES.IN_PROGRESS);
  });

  test('sample patch expõe apenas campos de pesquisa', async () => {
    const service = buildService();
    await openRun(service);
    await completeAnalysisEvidence(service, {
      tenantId: TENANT,
      vertical: 'fitness',
      benchmarkId: 'bench-a',
      externalName: 'Gestão de matrículas',
    });
    await service.markAnalyzed({
      tenantId: TENANT,
      vertical: 'fitness', benchmarkId: 'bench-a',
      marketArchetypeMapping: { archetype: 'independent-gym' },
    });

    const patch = await service.buildSamplePatch({
      tenantId: TENANT,
      vertical: 'fitness',
      inventoryVersion: 'canonical-capabilities-1.0.0',
    });
    expect(patch.researchVersion).toBe('fitness-research-v1');
    const analyzed = patch.benchmarks.find((b) => b.id === 'bench-a');
    expect(analyzed.analyzedAt).toBeTruthy();
    // §B7: array de referências + inventário versionado — o formato que o
    // engine realmente aceita. O patch antigo trazia um OBJETO de contadores e
    // por isso era um patch que o engine rejeitaria silenciosamente.
    expect(Array.isArray(analyzed.findingsInventory)).toBe(true);
    expect(analyzed.findingsInventory.length).toBeGreaterThanOrEqual(1);
    expect(analyzed.inventoryVersion).toBe('canonical-capabilities-1.0.0');
    expect(analyzed.sources.length).toBeGreaterThan(0);

    // Benchmarks não analisados continuam SEM analyzedAt — o engine os trata
    // como não mensuráveis em vez de "zero novidade".
    const pending = patch.benchmarks.find((b) => b.id === 'bench-b');
    expect(pending.analyzedAt).toBeNull();
    expect(pending.researchVersion).toBeNull();
    expect(pending.findingsInventory).toBeNull();
  });
});

describe('Research capabilities — subagente sem acesso externo irrestrito', () => {
  const runners = {
    search: async () => ({ candidates: [{ url: 'https://docs.example.com/a', title: 'docs' }] }),
    fetch: async () => ({ url: 'https://docs.example.com/a', text: 'conteúdo' }),
    inspectDocumentation: async () => ({ sections: ['Matrícula', 'Check-in'] }),
    inspectApiDocs: async () => ({ operations: ['GET /members'] }),
    captureEvidence: async () => ({ evidenceRef: 'ev-1', contentHash: 'sha256:abc' }),
  };

  test('capabilities de pesquisa são declaradas e registradas no registry canônico', () => {
    const registry = createToolRegistry({ logger: silent });
    const { registered } = ensureResearchCapabilities(registry, runners);
    expect(registered).toEqual(RESEARCH_TOOL_IDS);

    const again = ensureResearchCapabilities(registry, runners);
    expect(again.registered).toEqual([]);
    expect(again.existing).toEqual(RESEARCH_TOOL_IDS);
  });

  test('runner ausente falha explicitamente', () => {
    const registry = createToolRegistry({ logger: silent });
    expect(() => ensureResearchCapabilities(registry, {}))
      .toThrow(/research_capability_runner_missing/);
  });

  test('capabilities de pesquisa NÃO são visíveis a PRODUCTION', () => {
    const registry = createToolRegistry({ logger: silent });
    ensureResearchCapabilities(registry, runners);

    const productionVisible = registry.list({ classification: 'PRODUCTION', permissions: ['*'] })
      .filter((t) => String(t.capability).startsWith('research.'));
    expect(productionVisible).toEqual([]);

    const devVisible = registry.list({ classification: 'DEVELOPMENT', permissions: RESEARCH_CAPABILITY_IDS })
      .filter((t) => String(t.capability).startsWith('research.'));
    expect(devVisible).toHaveLength(RESEARCH_CAPABILITY_IDS.length);
  });

  test('execução passa pelo registry canônico e marca output como DADOS', async () => {
    const registry = createToolRegistry({ logger: silent });
    ensureResearchCapabilities(registry, runners);

    const result = await executeResearchCapability({
      registry,
      capability: 'research.search',
      tenantId: 'system',
      actor: { classification: 'DEVELOPMENT', permissions: RESEARCH_CAPABILITY_IDS },
      input: { query: 'evo academias funcionalidades' },
    });

    expect(result.provider).toBe('native');
    expect(result.toolId).toBe('rap.research.search');
    expect(result.output.candidates).toHaveLength(1);

    const canonical = registry.get('rap.research.search');
    expect(canonical.metadata.outputTrust).toBe('DATA_ONLY');
    expect(canonical.metadata.domain).toBe('SYSTEM');
    expect(canonical.sideEffects).toBe(false);
  });

  test('provider externo (MCP) pode atender a mesma capability de pesquisa', async () => {
    const registry = createToolRegistry({ logger: silent });
    // Provider externo declarado pelo MCP External Tool Adapter.
    registry.register({
      id: 'mcp.tsystem.research.search',
      capability: 'research.search',
      visibility: 'DEVELOPMENT',
      permissions: ['research.search'],
      description: '[MCP externo: research] busca web',
      sideEffects: false,
      metadata: Object.freeze({ provider: 'external', via: 'mcp', outputTrust: 'DATA_ONLY' }),
      execute: async () => ({ candidates: [{ url: 'https://mcp.example.com/x', title: 'mcp' }] }),
    });

    const result = await executeResearchCapability({
      registry,
      capability: 'research.search',
      tenantId: 'system',
      actor: { classification: 'DEVELOPMENT', permissions: RESEARCH_CAPABILITY_IDS },
      input: { query: 'benchmark fitness' },
    });

    expect(result.provider).toBe('external');
    expect(result.reason).toBe('external_read_only_provider_selected');
    expect(result.output.candidates[0].title).toBe('mcp');
  });

  test('capability de pesquisa desconhecida é recusada', async () => {
    const registry = createToolRegistry({ logger: silent });
    ensureResearchCapabilities(registry, runners);
    await expect(executeResearchCapability({
      registry, capability: 'research.shell', tenantId: 'system',
      actor: { classification: 'DEVELOPMENT', permissions: ['*'] },
    })).rejects.toThrow('research_capability_unknown');
  });

  test('proveniência de pesquisa liga agente, tool, fonte e evidência (§22)', () => {
    const provenance = buildResearchProvenance({
      agentId: 'research-agent-1',
      capability: 'research.fetch',
      toolId: 'rap.research.fetch',
      provider: 'native',
      source: OFFICIAL_SOURCE,
      evidenceRef: 'ev-42',
      at: '2026-09-11T00:00:00.000Z',
    });
    expect(provenance).toEqual({
      agentId: 'research-agent-1',
      capability: 'research.fetch',
      toolId: 'rap.research.fetch',
      provider: 'native',
      sourceUrl: OFFICIAL_SOURCE.url,
      sourceTier: 5,
      evidenceRef: 'ev-42',
      at: '2026-09-11T00:00:00.000Z',
    });
    expect(JSON.stringify(provenance)).not.toMatch(/token|password|secret/i);
  });
});
