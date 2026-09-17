'use strict';

/**
 * T-MR3 — NENHUMA MUTAÇÃO MANUAL DO SAMPLE: o caminho versionado e auditável
 * para aplicar a saída de um run de market discovery ao sample versionado
 * (`config/benchmarks/<vertical>.json`) é o GERADOR
 * `scripts/benchmark/apply-market-discovery-to-sample.js`.
 *
 * Provas:
 *   1. determinístico: mesma entrada → mesma saída (byte a byte);
 *   2. idempotente: aplicar duas vezes não muda o resultado;
 *   3. recusa run não concluído, holdout não pré-registrado e candidato sem
 *      evidência — nunca escreve proveniência fabricada;
 *   4. disciplina de chaves gerenciadas: entradas do sample que NÃO vieram
 *      deste gerador são preservadas intocadas;
 *   5. `--check` detecta drift (exit 1) e passa em sincronia (exit 0), no CLI
 *      real sobre arquivos temporários.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  GENERATOR_ID,
  MANAGED_KEYS,
  ERROR_CODES,
  applyMarketDiscoveryToSample,
} = require('../../../scripts/benchmark/apply-market-discovery-to-sample');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'benchmark', 'apply-market-discovery-to-sample.js');

function buildRunExport(overrides = {}) {
  return {
    runId: 'mdr-test-run',
    vertical: 'fitness-lab',
    discoveryVersion: 'fitness-lab-discovery-v1',
    state: 'MARKET_DISCOVERY_HANDED_OFF',
    completedAt: '2026-09-15T12:00:00.000Z',
    discoverySetId: 'mds-test-set',
    selectedCandidates: ['alpha-gym.com', 'beta-fit.com'],
    holdout: {
      candidateKey: 'gymnovo.com',
      preregistered: true,
      preregisteredAt: '2026-09-15T11:59:00.000Z',
      basis: { reason: 'mais distante do set por arquétipo e geografia' },
    },
    candidates: [
      {
        candidateKey: 'alpha-gym.com',
        name: 'Alpha Gym',
        officialSite: 'https://alpha-gym.com/',
        country: 'BR',
        archetypes: ['independent-gym'],
        independenceGroup: 'alpha',
        sourceEvidence: [{ url: 'https://alpha-gym.com/', evidenceRef: 'ev-alpha', contentHash: 'h1' }],
      },
      {
        candidateKey: 'beta-fit.com',
        name: 'Beta Fit',
        officialSite: 'https://beta-fit.com/',
        country: 'BR',
        archetypes: ['financial-billing'],
        independenceGroup: 'beta',
        sourceEvidence: [{ url: 'https://beta-fit.com/', evidenceRef: 'ev-beta', contentHash: 'h2' }],
      },
      {
        candidateKey: 'gymnovo.com',
        name: 'GymNovo',
        officialSite: 'https://gymnovo.com/',
        country: 'US',
        archetypes: ['financial-billing'],
        independenceGroup: 'gymnovo',
        sourceEvidence: [{ url: 'https://gymnovo.com/', evidenceRef: 'ev-gymnovo', contentHash: 'h3' }],
      },
    ],
    ...overrides,
  };
}

function buildSample() {
  return {
    vertical: 'fitness-lab',
    sampleVersion: 'fitness-lab-sample-v1',
    inventoryVersion: 'inv-1',
    canonicalInventoryBaseline: 10,
    canonicalJourneyInventoryBaseline: 5,
    canonicalBusinessRuleInventoryBaseline: 5,
    archetypes: [
      { id: 'independent-gym', importance: 'REQUIRED', status: 'ACTIVE', name: 'Academia independente' },
      { id: 'financial-billing', importance: 'REQUIRED', status: 'ACTIVE', name: 'Financeiro e cobrança' },
    ],
    benchmarks: [
      {
        id: 'legacy-manual',
        name: 'Legacy Manual',
        role: 'discovery',
        order: 1,
        archetype: 'independent-gym',
        independenceGroup: 'g-legacy',
        sources: [{ url: 'https://legacy.example.com/', tier: 5 }],
        novelty: {},
      },
    ],
    holdout: { benchmarkId: 'legacy-manual', selectedAsHoldoutAt: '2026-09-01T00:00:00.000Z', selectionReason: 'histórico' },
  };
}

describe('apply-market-discovery-to-sample — núcleo puro', () => {
  test('aplica o discovery set com proveniência por item e preserva entradas alheias', () => {
    const next = applyMarketDiscoveryToSample({ sample: buildSample(), runExport: buildRunExport() });

    // Entrada alheia (não gerenciada) preservada intacta.
    const legacy = next.benchmarks.find((b) => b.id === 'legacy-manual');
    expect(legacy).toEqual(buildSample().benchmarks[0]);

    // Entradas do discovery set com proveniência completa por item.
    const alpha = next.benchmarks.find((b) => b.id === 'alpha-gym.com');
    expect(alpha).toEqual(expect.objectContaining({
      role: 'discovery',
      archetype: 'independent-gym',
      independenceGroup: 'alpha',
    }));
    expect(alpha.provenance).toEqual(expect.objectContaining({
      generator: GENERATOR_ID,
      marketDiscoveryRunId: 'mdr-test-run',
      discoverySetId: 'mds-test-set',
      appliedAt: '2026-09-15T12:00:00.000Z',
    }));
    expect(alpha.provenance.evidenceRefs).toEqual(['ev-alpha']);

    // O holdout pré-registrado vira o holdout do sample (role validation).
    const holdout = next.benchmarks.find((b) => b.id === 'gymnovo.com');
    expect(holdout.role).toBe('validation');
    expect(next.holdout).toEqual(expect.objectContaining({
      benchmarkId: 'gymnovo.com',
      selectedAsHoldoutAt: '2026-09-15T11:59:00.000Z',
    }));
    expect(next.holdout.provenance.marketDiscoveryRunId).toBe('mdr-test-run');

    // Seção de proveniência do run.
    expect(next.marketDiscoveryProvenance).toEqual(expect.objectContaining({
      generator: GENERATOR_ID,
      marketDiscoveryRunId: 'mdr-test-run',
      discoverySetId: 'mds-test-set',
      appliedAt: '2026-09-15T12:00:00.000Z',
      selectedCandidates: ['alpha-gym.com', 'beta-fit.com'],
      holdoutCandidateKey: 'gymnovo.com',
    }));
  });

  test('determinístico e idempotente', () => {
    const first = applyMarketDiscoveryToSample({ sample: buildSample(), runExport: buildRunExport() });
    const again = applyMarketDiscoveryToSample({ sample: buildSample(), runExport: buildRunExport() });
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));

    const reapplied = applyMarketDiscoveryToSample({ sample: first, runExport: buildRunExport() });
    expect(JSON.stringify(reapplied)).toBe(JSON.stringify(first));
  });

  test('recusa run não concluído', () => {
    expect(() => applyMarketDiscoveryToSample({
      sample: buildSample(),
      runExport: buildRunExport({ state: 'MARKET_SCANNED' }),
    })).toThrow(new RegExp(ERROR_CODES.RUN_NOT_COMPLETED));
  });

  test('recusa holdout não pré-registrado', () => {
    expect(() => applyMarketDiscoveryToSample({
      sample: buildSample(),
      runExport: buildRunExport({ holdout: { candidateKey: 'gymnovo.com', preregistered: false, preregisteredAt: null } }),
    })).toThrow(new RegExp(ERROR_CODES.HOLDOUT_NOT_PREREGISTERED));
  });

  test('recusa candidato selecionado sem evidência (nunca proveniência fabricada)', () => {
    const runExport = buildRunExport();
    runExport.candidates[1].sourceEvidence = [];
    expect(() => applyMarketDiscoveryToSample({ sample: buildSample(), runExport }))
      .toThrow(new RegExp(ERROR_CODES.EVIDENCE_MISSING));
  });

  test('ABS-21 (run real r21): seed DECLARADO que também está no discovery set NUNCA é duplicado', () => {
    // Run real r21 (2026-09-17): o operador declarou seeds (proveniência
    // `declaredBy: operator`, sem `generator`) e o run os selecionou — o
    // gerador preservou a declaração E derivou uma segunda entrada para a
    // mesma chave: 6 vendors ficaram duplicados no sample e o plano de deep
    // research analisou cada um DUAS vezes. Uma chave = uma entrada; a versão
    // derivada (com lineage do run) prevalece sobre a declaração.
    const sample = buildSample();
    sample.benchmarks.push({
      id: 'alpha-gym.com',
      name: 'Alpha Gym',
      role: 'discovery',
      order: 2,
      archetype: 'independent-gym',
      independenceGroup: 'alpha',
      sources: [{ url: 'https://alpha-gym.com/', tier: 5 }],
      novelty: {},
      provenance: { declaredBy: 'operator', declaredAt: '2026-09-17' },
    });
    const next = applyMarketDiscoveryToSample({ sample, runExport: buildRunExport() });

    const alphas = next.benchmarks.filter((b) => b.id === 'alpha-gym.com');
    expect(alphas).toHaveLength(1);
    // A versão que fica é a DERIVADA (carrega a lineage do run).
    expect(alphas[0].provenance).toEqual(expect.objectContaining({
      generator: GENERATOR_ID,
      marketDiscoveryRunId: 'mdr-test-run',
    }));
  });

  test('só as chaves gerenciadas mudam', () => {
    const sample = buildSample();
    const next = applyMarketDiscoveryToSample({ sample, runExport: buildRunExport() });
    const managed = new Set([...MANAGED_KEYS]);
    for (const key of Object.keys(next)) {
      if (managed.has(key)) continue;
      expect(JSON.stringify(next[key])).toBe(JSON.stringify(sample[key]));
    }
  });

  test('a entrada derivada carrega FONTES DECLARADAS — sem elas o plano de pesquisa a pula', () => {
    // Gap confirmado em 2026-09-15: o plano de deep research
    // (`buildResearchPlanFromSample`) IGNORA benchmark sem `sources`. Uma
    // entrada aplicada pelo gerador sem fonte declarada entrava no sample e
    // nunca era pesquisada — lineage cortada entre market discovery e deep
    // research. A fonte declarada vem da EVIDÊNCIA do run (nunca inventada).
    const next = applyMarketDiscoveryToSample({ sample: buildSample(), runExport: buildRunExport() });
    const alpha = next.benchmarks.find((b) => b.id === 'alpha-gym.com');

    expect(Array.isArray(alpha.sources)).toBe(true);
    expect(alpha.sources.length).toBeGreaterThan(0);
    expect(alpha.sources[0]).toEqual(expect.objectContaining({
      url: 'https://alpha-gym.com/',
      tier: expect.any(Number),
    }));

    // O plano REAL de pesquisa não pode pular a entrada derivada.
    const { buildResearchPlanFromSample } = require('../../../api/services/benchmark/benchmarkResearchSupervisor');
    const plan = buildResearchPlanFromSample(next);
    expect(plan.skipped.map((s) => s.benchmarkId)).not.toContain('alpha-gym.com');
    const planned = plan.benchmarks.find((b) => b.benchmarkId === 'alpha-gym.com');
    expect(planned).toBeDefined();
    expect(planned.declaredSources.length).toBeGreaterThan(0);

    // O holdout (role validation) também precisa ser pesquisável após a
    // saturação aparente — mesma exigência de fonte declarada.
    const holdout = next.benchmarks.find((b) => b.id === 'gymnovo.com');
    expect(Array.isArray(holdout.sources)).toBe(true);
    expect(holdout.sources.length).toBeGreaterThan(0);
  });
});

describe('apply-market-discovery-to-sample — CLI com --check', () => {
  function withTempDir(run) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-sample-'));
    try {
      return run(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  function writeFixtures(dir) {
    const samplePath = path.join(dir, 'sample.json');
    const exportPath = path.join(dir, 'run-export.json');
    fs.writeFileSync(samplePath, `${JSON.stringify(buildSample(), null, 2)}\n`);
    fs.writeFileSync(exportPath, `${JSON.stringify(buildRunExport(), null, 2)}\n`);
    return { samplePath, exportPath };
  }

  function runCli(args) {
    return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  }

  test('write → --check PASS; drift → --check FAIL; re-write → idempotente', () => {
    withTempDir((dir) => {
      const { samplePath, exportPath } = writeFixtures(dir);

      const write = runCli(['--sample', samplePath, '--export', exportPath]);
      expect(write.status).toBe(0);

      const check = runCli(['--sample', samplePath, '--export', exportPath, '--check']);
      expect(check.status).toBe(0);

      // Idempotência byte a byte.
      const before = fs.readFileSync(samplePath, 'utf8');
      const rewrite = runCli(['--sample', samplePath, '--export', exportPath]);
      expect(rewrite.status).toBe(0);
      expect(fs.readFileSync(samplePath, 'utf8')).toBe(before);

      // Drift: mutação manual da chave gerenciada é detectada.
      const drifted = JSON.parse(before);
      drifted.marketDiscoveryProvenance.selectedCandidates = ['alpha-gym.com'];
      fs.writeFileSync(samplePath, `${JSON.stringify(drifted, null, 2)}\n`);
      const drift = runCli(['--sample', samplePath, '--export', exportPath, '--check']);
      expect(drift.status).toBe(1);
      expect(`${drift.stdout}${drift.stderr}`).toMatch(/drift/i);
    });
  });

  test('--export ausente exige banco (fail-closed, nunca silêncio)', () => {
    withTempDir((dir) => {
      const { samplePath } = writeFixtures(dir);
      const result = runCli(['--sample', samplePath, '--run-id', 'mdr-inexistente', '--check']);
      // Sem export E sem banco configurado no ambiente do filho: a única saída
      // aceitável é erro explícito (persistence_required / fonte ausente),
      // nunca exit 0 silencioso.
      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toMatch(/persistence_required|market_run_source_required|market_discovery_run_not_found/);
    });
  });
});

describe('apply-market-discovery-to-sample — contrato completo do holdout (ciclo 2, run real r8)', () => {
  // O gerador emitia o registro de holdout só com benchmarkId/selectedAt/reason
  // — o ENGINE (evaluateHoldout) exige selectionEvidence, marketArchetype e
  // inventoryVersion, e marcava holdout_preregistration_incomplete. Além
  // disso, o holdout SUBSTITUÍDO (zenplanner, analisado no ciclo 1) ficava com
  // role 'validation' para sempre: fora do discovery set, seus achados não
  // contavam no inventário — denominador encolhido por omissão. "Incorporar a
  // descoberta" é obrigatório: o holdout anterior vira benchmark de discovery.

  function buildCycleTwoSample() {
    const sample = buildSample();
    sample.benchmarks.push({
      id: 'old-holdout',
      name: 'Old Holdout',
      role: 'validation',
      order: 5,
      archetype: 'financial-billing',
      independenceGroup: 'old-holdout',
      sources: [{ url: 'https://old-holdout.com/', tier: 5 }],
      analyzedAt: '2026-09-10T10:00:00.000Z',
      researchVersion: 'v-old',
      findingsInventory: ['f-1', 'f-2'],
      novelty: { newCapabilities: [] },
    });
    sample.holdout = {
      benchmarkId: 'old-holdout',
      selectedAsHoldoutAt: '2026-09-01T00:00:00.000Z',
      selectionReason: 'ciclo 1',
      selectionEvidence: 'ciclo 1',
      marketArchetype: 'financial-billing',
      inventoryVersion: 'inv-1',
      analysedAt: '2026-09-10T10:00:00.000Z',
    };
    return sample;
  }

  test('o registro de holdout emitido satisfaz o contrato do engine', () => {
    const next = applyMarketDiscoveryToSample({ sample: buildCycleTwoSample(), runExport: buildRunExport() });

    // Todos os campos que evaluateHoldout exige (preregistrationFields).
    for (const field of ['benchmarkId', 'selectedAsHoldoutAt', 'selectionReason', 'selectionEvidence', 'marketArchetype', 'inventoryVersion']) {
      expect(next.holdout[field]).toBeTruthy();
    }
    expect(next.holdout.marketArchetype).toBe('financial-billing'); // archetypes[0] do candidato
    expect(next.holdout.inventoryVersion).toBe('inv-1'); // sample.inventoryVersion
    // selectionEvidence é composto de FATOS do run — nunca texto genérico.
    expect(next.holdout.selectionEvidence).toContain('mdr-test-run');
    expect(next.holdout.selectionEvidence).toContain('ev-gymnovo');

    // E o PRÓPRIO engine concorda: nenhuma violação de pré-registro incompleto.
    const engine = require('../../../qa/benchmarks/benchmarkSufficiencyEngine');
    const gate = engine.evaluateHoldout({ sample: next, policy: require('../../../config/benchmark-sufficiency-policy.json') });
    expect(gate.violations.map((v) => v.reason)).not.toContain('holdout_preregistration_incomplete');
  });

  test('fail-closed: holdout sem arquétipo no run não vira registro pela metade', () => {
    const runExport = buildRunExport();
    runExport.candidates[2].archetypes = [];
    expect(() => applyMarketDiscoveryToSample({ sample: buildSample(), runExport }))
      .toThrow(/archetype|arqu[eé]tipo/i);
  });

  test('o holdout substituído é INCORPORADO ao discovery set (achados contam no inventário)', () => {
    const next = applyMarketDiscoveryToSample({ sample: buildCycleTwoSample(), runExport: buildRunExport() });

    const incorporated = next.benchmarks.find((b) => b.id === 'old-holdout');
    expect(incorporated.role).toBe('discovery');
    // Análise do ciclo 1 preservada — incorporar não é apagar.
    expect(incorporated.analyzedAt).toBe('2026-09-10T10:00:00.000Z');
    expect(incorporated.findingsInventory).toEqual(['f-1', 'f-2']);
    // A incorporação é auditável: de onde veio, em que run.
    expect(incorporated.incorporation).toEqual(expect.objectContaining({
      generator: GENERATOR_ID,
      fromRole: 'validation',
      marketDiscoveryRunId: 'mdr-test-run',
    }));
    // Foi analisado DEPOIS de todos os benchmarks do ciclo 1: ordem no fim dos
    // preservados, antes das entradas derivadas deste run.
    const legacy = next.benchmarks.find((b) => b.id === 'legacy-manual');
    const alpha = next.benchmarks.find((b) => b.id === 'alpha-gym.com');
    expect(incorporated.order).toBeGreaterThan(legacy.order);
    expect(alpha.order).toBeGreaterThan(incorporated.order);

    // O único benchmark de validação restante é o NOVO holdout.
    expect(next.benchmarks.filter((b) => b.role === 'validation').map((b) => b.id)).toEqual(['gymnovo.com']);

    // Idempotente: re-aplicar não re-demove nem reordena.
    const reapplied = applyMarketDiscoveryToSample({ sample: next, runExport: buildRunExport() });
    expect(JSON.stringify(reapplied.benchmarks)).toBe(JSON.stringify(next.benchmarks));
  });

  test('holdout substituído é INCORPORADO mesmo quando já não é o registro corrente (zenplanner do ciclo 1, 2026-09-16)', () => {
    // Caso real: a aplicação do r8 (ciclo 2) rodou com o gerador ANTERIOR à
    // regra de incorporação — o zenplanner (holdout do ciclo 1, analisado)
    // ficou role 'validation' e o registro de holdout do sample passou a ser
    // OUTRO benchmark. A regra que olha só o registro corrente não o alcança:
    // qualquer 'validation' que não é o holdout pré-registrado DESTE run é
    // holdout aposentado e precisa ser incorporado — senão seus achados saem
    // do discovery set e o denominador encolhe por omissão.
    const sample = buildCycleTwoSample();
    sample.benchmarks.push({
      id: 'older-holdout',
      name: 'Older Holdout',
      role: 'validation',
      order: 6,
      archetype: 'personal-wellness',
      independenceGroup: 'older-holdout',
      sources: [{ url: 'https://older-holdout.com/', tier: 5 }],
      analyzedAt: '2026-09-05T10:00:00.000Z',
      researchVersion: 'v-older',
      findingsInventory: ['f-older'],
      novelty: { newCapabilities: [] },
    });
    const next = applyMarketDiscoveryToSample({ sample, runExport: buildRunExport() });

    const stale = next.benchmarks.find((b) => b.id === 'older-holdout');
    expect(stale.role).toBe('discovery');
    expect(stale.analyzedAt).toBe('2026-09-05T10:00:00.000Z');
    expect(stale.findingsInventory).toEqual(['f-older']);
    expect(stale.incorporation).toEqual(expect.objectContaining({
      generator: GENERATOR_ID,
      fromRole: 'validation',
      marketDiscoveryRunId: 'mdr-test-run',
    }));
    // O registro corrente também foi incorporado (regra original preservada).
    expect(next.benchmarks.find((b) => b.id === 'old-holdout').role).toBe('discovery');
    // O ÚNICO benchmark de validação é o holdout pré-registrado deste run.
    expect(next.benchmarks.filter((b) => b.role === 'validation').map((b) => b.id)).toEqual(['gymnovo.com']);
    // Idempotente.
    const reapplied = applyMarketDiscoveryToSample({ sample: next, runExport: buildRunExport() });
    expect(JSON.stringify(reapplied.benchmarks)).toBe(JSON.stringify(next.benchmarks));
  });

  test('fontes declaradas das entradas derivadas são GENÉRICAS (existência, não inventário)', () => {
    const runExport = buildRunExport();
    // Candidato cuja evidência de descoberta é uma página profunda (listicle).
    runExport.candidates[2].sourceEvidence = [
      { url: 'https://gymnovo.com/blog/wellhub-alternatives/', evidenceRef: 'ev-deep', contentHash: 'h-deep' },
      { url: 'https://gymnovo.com/', evidenceRef: 'ev-home', contentHash: 'h-home' },
    ];
    const next = applyMarketDiscoveryToSample({ sample: buildSample(), runExport });
    const engine = require('../../../qa/benchmarks/benchmarkSufficiencyEngine');

    const holdout = next.benchmarks.find((b) => b.id === 'gymnovo.com');
    expect(holdout.sources.length).toBeGreaterThan(0);
    for (const source of holdout.sources) {
      expect(engine.isGenericSource(source)).toBe(true);
    }
    // A página profunda não desaparece: fica auditável na proveniência.
    expect(holdout.provenance.evidenceRefs).toEqual(expect.arrayContaining(['ev-deep', 'ev-home']));
  });

  test('independenceGroup ausente vira o próprio candidateKey (grupo próprio até prova em contrário)', () => {
    const runExport = buildRunExport();
    runExport.candidates[0].independenceGroup = null;
    const next = applyMarketDiscoveryToSample({ sample: buildSample(), runExport });
    const alpha = next.benchmarks.find((b) => b.id === 'alpha-gym.com');
    expect(alpha.independenceGroup).toBe('alpha-gym.com');
  });
});
