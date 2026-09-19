'use strict';

/**
 * Benchmark Research Runner — subagente de pesquisa usando CAPABILITIES
 * governadas (ordem de execução #14 / M21 / M22).
 */

const { createToolRegistry } = require('../../src/core/cognitive/tool-registry');
const {
  createBenchmarkResearchService,
  FINDING_KINDS,
} = require('../../api/services/benchmark/benchmarkResearchService');
const {
  RESEARCH_CAPABILITY_IDS,
  RESEARCH_CAPABILITIES,
  ensureResearchCapabilities,
} = require('../../api/services/benchmark/researchCapabilities');
const {
  RESEARCH_RUN_STATES,
  createBenchmarkResearchRunner,
} = require('../../api/services/benchmark/benchmarkResearchRunner');
const { createBenchmarkResearchMemoryStore } = require('../helpers/benchmarkResearchMemoryStore');
const { completeAnalysisEvidence } = require('../helpers/benchmarkAnalysisEvidence');

/** Tenant do run de pesquisa (pesquisa é superfície SYSTEM). */
const TENANT = 'system';

function fitnessSummary(service) {
  return service.summarize({ tenantId: TENANT, vertical: 'fitness' });
}

const silent = { info() {}, warn() {}, error() {}, debug() {} };

/** Runners de capability com I/O controlado pelo teste (a rede é o transporte). */
function buildRunners({ candidates = [], fetchResult = null, evidenceRef = 'ev-1' } = {}) {
  return {
    search: async () => ({ candidates }),
    fetch: async () => fetchResult || { httpStatus: 200, content: 'conteúdo oficial' },
    inspectDocumentation: async () => ({ sections: ['Matrículas'] }),
    inspectApiDocs: async () => ({ operations: ['GET /members'] }),
    captureEvidence: async () => ({ evidenceRef, contentHash: 'sha256:deadbeef' }),
  };
}

async function buildHarness({ runners, archetype = 'independent-gym' } = {}) {
  const registry = createToolRegistry({ logger: silent });
  const service = createBenchmarkResearchService({
    store: createBenchmarkResearchMemoryStore(),
    now: () => '2026-09-11T00:00:00.000Z',
  });
  await service.openDiscoverySet({
    tenantId: TENANT,
    vertical: 'fitness',
    researchVersion: 'fitness-research-v1',
    benchmarkIds: ['evo', 'zenplanner'],
    holdoutBenchmarkId: 'zenplanner',
  });
  const runner = createBenchmarkResearchRunner({
    registry,
    runners,
    tenantId: TENANT,
    actor: { classification: 'DEVELOPMENT', permissions: RESEARCH_CAPABILITY_IDS },
    service,
    now: () => '2026-09-11T00:00:00.000Z',
  });
  return { registry, service, runner, archetype };
}

describe('Research runner — sem acesso externo é BLOQUEIO, não resultado', () => {
  test('sem runners de capability o run é declarado bloqueado (nada é registrado)', async () => {
    const { runner, service } = await buildHarness({ runners: undefined });

    const result = await runner.researchAndRecord({
      vertical: 'fitness', benchmarkId: 'evo', query: 'EVO academia funcionalidades',
      externalName: 'Gestão de matrículas', kind: FINDING_KINDS.CAPABILITY,
    });

    expect(result.status).toBe(RESEARCH_RUN_STATES.BLOCKED_NO_EXTERNAL_ACCESS);
    expect(result.reason).toMatch(/research_capability_unavailable/);
    expect(result.provenance).toBeNull();

    // O estado do sample NÃO muda por ausência de trabalho.
    const summary = await fitnessSummary(service);
    expect(summary.state).toBe('RESEARCH_DISCOVERY_OPEN');
    expect(summary.totalFindings).toBe(0);
    expect(summary.analysedBenchmarks).toBe(0);
  });

  test('capability de pesquisa indisponível é reportada nominalmente', async () => {
    const { runner } = await buildHarness({ runners: {} });
    const available = runner.availableCapabilities();
    expect(available).toEqual([]);
  });
});

describe('Research runner — evidência só entra com obtenção confirmada', () => {
  test('fluxo completo registra achado VERIFICADO com proveniência', async () => {
    const { runner, service } = await buildHarness({
      runners: buildRunners({
        candidates: [{ url: 'https://docs.evo.com.br/features/matriculas', title: 'Matrículas', specificity: 'SPECIFIC' }],
      }),
    });

    const result = await runner.researchAndRecord({
      vertical: 'fitness', benchmarkId: 'evo', query: 'EVO matrícula',
      externalName: 'Gestão de matrículas', kind: FINDING_KINDS.CAPABILITY,
      canonicalId: 'membership.manage', sourceTier: 5,
    });

    expect(result.status).toBe(RESEARCH_RUN_STATES.EVIDENCE_CAPTURED);
    expect(result.finding.verified).toBe(true);
    expect(result.source).toEqual(expect.objectContaining({
      url: 'https://docs.evo.com.br/features/matriculas', tier: 5, verified: true, httpStatus: 200,
    }));

    // Proveniência liga agente/capability/tool/fonte/evidência (M22).
    expect(result.provenance).toEqual(expect.objectContaining({
      capability: 'research.captureEvidence',
      provider: 'native',
      evidenceRef: 'ev-1',
      sourceUrl: 'https://docs.evo.com.br/features/matriculas',
      sourceTier: 5,
    }));
    expect(JSON.stringify(result.provenance)).not.toMatch(/token|password|secret/i);

    const summary = await fitnessSummary(service);
    expect(summary.totalFindings).toBe(1);
    expect(summary.unverifiedFindings).toBe(0);
  });

  test('HTTP 4xx/5xx NÃO vira prova: nenhum achado é registrado', async () => {
    const { runner, service } = await buildHarness({
      runners: buildRunners({
        candidates: [{ url: 'https://docs.evo.com.br/x', title: 'x' }],
        fetchResult: { httpStatus: 404, content: 'not found' },
      }),
    });

    const result = await runner.researchAndRecord({
      vertical: 'fitness', benchmarkId: 'evo', query: 'EVO',
      externalName: 'x', kind: FINDING_KINDS.CAPABILITY, sourceTier: 5,
    });

    expect(result.status).toBe(RESEARCH_RUN_STATES.FETCH_FAILED);
    expect(result.reason).toMatch(/research_fetch_not_confirmed: status=404/);
    expect((await fitnessSummary(service)).totalFindings).toBe(0);
  });

  test('status HTTP ausente também não é prova', async () => {
    // Fornecedor que OMITE `httpStatus` viola o contrato da capability: o
    // núcleo falha de forma TIPADA em vez de tratar a resposta como válida.
    // (O caso "status presente mas não-2xx" segue degradando por benchmark —
    // ver o teste de 404 acima.) Isto é o que teria pegado o incidente de
    // 2026-09-19, quando o serviço MCP devolvia `status` em vez de `httpStatus`.
    const { runner, service } = await buildHarness({
      runners: buildRunners({
        candidates: [{ url: 'https://docs.evo.com.br/x', title: 'x' }],
        fetchResult: { content: 'conteúdo sem status' },
      }),
    });

    await expect(runner.researchAndRecord({
      vertical: 'fitness', benchmarkId: 'evo', query: 'EVO',
      externalName: 'x', kind: FINDING_KINDS.CAPABILITY, sourceTier: 5,
    })).rejects.toThrow(/research_tool_output_contract_violation/);
    expect((await fitnessSummary(service)).totalFindings).toBe(0);
  });

  test('sem candidato de fonte não há achado (nunca inventado)', async () => {
    const { runner, service } = await buildHarness({ runners: buildRunners({ candidates: [] }) });
    const result = await runner.researchAndRecord({
      vertical: 'fitness', benchmarkId: 'evo', query: 'EVO',
      externalName: 'x', kind: FINDING_KINDS.CAPABILITY,
    });
    expect(result.status).toBe(RESEARCH_RUN_STATES.NO_CANDIDATES);
    expect((await fitnessSummary(service)).totalFindings).toBe(0);
  });

  test('evidência não capturada impede o registro do achado', async () => {
    const runners = buildRunners({
      candidates: [{ url: 'https://docs.evo.com.br/x', title: 'x' }],
    });
    runners.captureEvidence = async () => ({ evidenceRef: null });
    const { runner, service } = await buildHarness({ runners });

    const result = await runner.researchAndRecord({
      vertical: 'fitness', benchmarkId: 'evo', query: 'EVO',
      externalName: 'x', kind: FINDING_KINDS.CAPABILITY, sourceTier: 5,
    });
    expect(result.status).toBe(RESEARCH_RUN_STATES.FETCH_FAILED);
    expect(result.reason).toBe('research_evidence_not_captured');
    expect((await fitnessSummary(service)).totalFindings).toBe(0);
  });

  test('fontes genéricas continuam não contando como prova (delegado ao serviço)', async () => {
    const { runner, service } = await buildHarness({
      runners: buildRunners({
        candidates: [{ url: 'https://evo.com.br/', title: 'Home' }],
      }),
    });

    const result = await runner.researchAndRecord({
      vertical: 'fitness', benchmarkId: 'evo', query: 'EVO',
      externalName: 'x', kind: FINDING_KINDS.CAPABILITY, sourceTier: 5,
    });

    // O achado é registrado, porém MARCADO como não verificado: homepage não
    // prova capability.
    expect(result.finding.verified).toBe(false);
    const summary = await fitnessSummary(service);
    expect(summary.totalFindings).toBe(1);
    expect(summary.unverifiedFindings).toBe(1);
    expect(summary.requiresRevalidation).toBe(true);
  });

  test('input incompleto falha explicitamente', async () => {
    const { runner } = await buildHarness({ runners: buildRunners() });
    await expect(runner.researchAndRecord({ vertical: 'fitness' }))
      .rejects.toThrow('research_runner_input_invalid');
  });
});

describe('Research runner — habilitação de análise', () => {
  test('análise só é aceita após evidência verificada', async () => {
    const { runner, service } = await buildHarness({
      runners: buildRunners({
        candidates: [{ url: 'https://docs.evo.com.br/features/matriculas', title: 'Matrículas' }],
      }),
    });

    await expect(runner.markAnalyzed({
      vertical: 'fitness', benchmarkId: 'evo',
      marketArchetypeMapping: { archetype: 'independent-gym' },
    })).rejects.toThrow(/research_analysis_evidence_incomplete/);

    await runner.researchAndRecord({
      vertical: 'fitness', benchmarkId: 'evo', query: 'EVO matrícula',
      externalName: 'Gestão de matrículas', kind: FINDING_KINDS.CAPABILITY, sourceTier: 5,
      // §TAREFA 12 — a evidência precisa apontar para o FRAGMENTO da fonte.
      locator: 'section:Matrículas#gestao',
    });

    // §TAREFA 20 — o critério deixou de ser "1 achado + arquétipo": ele exige o
    // estado de pesquisa (três eixos + inspeções + evidência ligada ao conteúdo),
    // que aqui é montado pelas MESMAS APIs públicas do serviço.
    await completeAnalysisEvidence(service, {
      tenantId: TENANT,
      vertical: 'fitness',
      benchmarkId: 'evo',
    });

    const analyzed = await runner.markAnalyzed({
      vertical: 'fitness', benchmarkId: 'evo',
      marketArchetypeMapping: { archetype: 'independent-gym', rationale: 'foco em matrícula e caixa' },
    });
    expect(analyzed.analyzedAt).toBe('2026-09-11T00:00:00.000Z');

    const patch = await service.buildSamplePatch({
      tenantId: TENANT,
      vertical: 'fitness',
      inventoryVersion: 'canonical-capabilities-1.0.0',
    });
    expect(patch.benchmarks.find((b) => b.id === 'evo').analyzedAt).toBeTruthy();
    // O holdout segue SEM análise — protegido até a saturação aparente.
    expect(patch.benchmarks.find((b) => b.id === 'zenplanner').analyzedAt).toBeNull();
  });

  test('capabilities de pesquisa são registradas no registry canônico pelo runner', () => {
    const registry = createToolRegistry({ logger: silent });
    ensureResearchCapabilities(registry, buildRunners());
    const registered = RESEARCH_CAPABILITIES.map((c) => c.id);
    for (const id of registered) {
      const tool = registry.get(id);
      expect(tool).toBeTruthy();
      expect(tool.metadata.outputTrust).toBe('DATA_ONLY');
      expect(tool.visibility).toBe('DEVELOPMENT');
    }
  });
});
