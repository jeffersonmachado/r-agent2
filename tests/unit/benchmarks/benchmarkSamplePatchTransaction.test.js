'use strict';

/**
 * §B7 — O PATCH DO SAMPLE TEM CONSUMIDOR REAL E É TRANSACIONAL.
 *
 * `toSamplePatch()` era código morto, e o preço disso foi um patch com o
 * formato ERRADO: `findingsInventory` como OBJETO de contadores, quando o engine
 * exige um ARRAY de referências (`benchmarkAnalysisEvidenceGaps`). Como ninguém
 * aplicava o patch, o erro nunca apareceu.
 *
 * Este arquivo prova, contra o ENGINE REAL e contra o SAMPLE REAL:
 *   1. o patch novo passa a validação do engine (sem `analysisGaps`);
 *   2. o patch ANTIGO (objeto de contadores) é rejeitado — a regressão fica
 *      travada por teste;
 *   3. a aplicação é atômica e restaura o arquivo se a validação falhar;
 *   4. só campos de PESQUISA são tocados (arquétipos, baselines e política
 *      permanecem intactos);
 *   5. patch sem análise é RECUSADO — não existe caminho para "atualizar" o
 *      sample sem trabalho real (§B12).
 */

const fsReal = require('fs');
const path = require('path');

const engine = require('../../../qa/benchmarks/benchmarkSufficiencyEngine');
const {
  ERROR_CODES,
  mergeSamplePatch,
  applySamplePatch,
} = require('../../../api/services/benchmark/benchmarkSampleRegistry');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REAL_SAMPLE_PATH = path.join(REPO_ROOT, 'config', 'benchmarks', 'fitness.json');
const POLICY = JSON.parse(fsReal.readFileSync(path.join(REPO_ROOT, 'config', 'benchmark-sufficiency-policy.json'), 'utf8'));

function realSample() {
  return JSON.parse(fsReal.readFileSync(REAL_SAMPLE_PATH, 'utf8'));
}

/** Patch no formato NOVO (array de referências + inventário versionado). */
function validPatch() {
  return {
    vertical: 'fitness',
    researchVersion: 'fitness-research-patch-v1',
    holdoutBenchmarkId: 'zenplanner',
    saturationReached: false,
    inventoryVersion: 'canonical-capabilities-1.0.0',
    evidence: [
      {
        id: 'bre-1',
        benchmarkId: 'evo-w12',
        url: 'https://w12.com.br/funcionalidades/',
        evidenceRef: 'ev-1',
        capturedAt: '2026-09-13T00:00:00.000Z',
      },
    ],
    benchmarks: [
      {
        id: 'evo-w12',
        analyzedAt: '2026-09-13T00:00:00.000Z',
        researchVersion: 'fitness-research-patch-v1',
        inventoryVersion: 'canonical-capabilities-1.0.0',
        findingsInventory: ['brf-1'],
        marketArchetypeMapping: { archetype: 'integration-first-api', rationale: 'API oficial' },
        sources: [
          {
            id: 'brsrc-1',
            url: 'https://w12.com.br/funcionalidades/',
            tier: 5,
            specificity: 'SPECIFIC',
            verified: true,
            httpStatus: 200,
            retrievedAt: '2026-09-13',
          },
        ],
        novelty: {
          newCapabilities: [
            { id: 'brf-1', name: 'Matrícula digital', sourceRef: 'brsrc-1', evidenceRef: 'bre-1' },
          ],
          newRequiredCapabilities: [
            { id: 'brf-1', name: 'Matrícula digital', sourceRef: 'brsrc-1', evidenceRef: 'bre-1' },
          ],
        },
      },
      { id: 'tecnofit', analyzedAt: null, findingsInventory: null, sources: [], novelty: {} },
    ],
  };
}

describe('§B7 — patch do sample: formato que o engine ACEITA', () => {
  test('o benchmark analisado deixa de ter analysisGaps na curva de descoberta', () => {
    const { sample } = mergeSamplePatch(realSample(), validPatch());
    const curve = engine.evaluateSampleSufficiency({ sample, policy: POLICY }).inventoryCurves.capabilities;
    const point = curve.points.find((entry) => entry.benchmarkId === 'evo-w12');

    expect(point.analysisGaps).toEqual([]);
    expect(point.rateState).not.toBe('NOT_ANALYZED');
  });

  test('REGRESSÃO: o formato ANTIGO (findingsInventory como objeto) é RECUSADO na origem', () => {
    const broken = validPatch();
    broken.benchmarks[0].findingsInventory = { total: 1, verified: 1, unverified: 0 };

    // Antes: o patch era gravado e o engine concluía "análise não provada"
    // (§B7). Agora o formato inválido não entra no sample de jeito nenhum.
    expect(() => mergeSamplePatch(realSample(), broken))
      .toThrow(new RegExp(ERROR_CODES.FINDINGS_INVENTORY_INVALID));

    // E se passasse, o engine o rejeitaria — o formato é o do engine, não nosso.
    const wouldBeRejected = engine.evaluateSampleSufficiency({
      sample: {
        ...realSample(),
        benchmarks: realSample().benchmarks.map((benchmark) => (benchmark.id === 'evo-w12'
          ? {
            ...benchmark,
            analyzedAt: '2026-09-13T00:00:00.000Z',
            researchVersion: 'v1',
            findingsInventory: { total: 1, verified: 1 },
          }
          : benchmark)),
      },
      policy: POLICY,
    });
    const point = wouldBeRejected.inventoryCurves.capabilities.points
      .find((entry) => entry.benchmarkId === 'evo-w12');
    expect(point.analysisGaps).toContain('findingsInventory');
    expect(point.rateState).toBe('NOT_ANALYZED');
  });

  test('inventário VAZIO sem prova de eixos pesquisados é recusado; com prova é zero novidade MEDIDA (T-B1)', () => {
    // Contrato novo (T-B1, 2026-09-15): 0 achados é análise legítima quando os
    // três eixos estão comprovadamente pesquisados. Sem a prova, a recusa
    // continua — "não pesquisei" nunca vira "zero novidade".
    const withoutProof = validPatch();
    withoutProof.benchmarks[0].findingsInventory = [];
    expect(() => mergeSamplePatch(realSample(), withoutProof))
      .toThrow(new RegExp(ERROR_CODES.FINDINGS_INVENTORY_INVALID));

    const withProof = validPatch();
    withProof.benchmarks[0].findingsInventory = [];
    withProof.benchmarks[0].novelty = {};
    withProof.benchmarks[0].axisCompleteness = [
      { axis: 'CAPABILITY_AXIS', state: 'RESEARCHED_NO_FINDINGS', researched: true },
      { axis: 'JOURNEY_AXIS', state: 'RESEARCHED_NO_FINDINGS', researched: true },
      { axis: 'BUSINESS_RULE_AXIS', state: 'RESEARCHED_NO_FINDINGS', researched: true },
    ];
    const { sample } = mergeSamplePatch(realSample(), withProof);
    const benchmark = sample.benchmarks.find((entry) => entry.id === 'evo-w12');
    expect(benchmark.findingsInventory).toEqual([]);

    // E o engine o lê como ponto MENSURÁVEL com taxa 0 — não NOT_ANALYZED.
    const curve = engine.evaluateSampleSufficiency({ sample, policy: POLICY }).inventoryCurves.capabilities;
    const point = curve.points.find((entry) => entry.benchmarkId === 'evo-w12');
    expect(point.analysisGaps).toEqual([]);
    expect(point.rateState).toBe('MEASURED');
    expect(point.noveltyRate).toBe(0);
  });

  test('novelty só aceita as chaves canônicas do engine', () => {
    const patch = validPatch();
    patch.benchmarks[0].novelty.chaveInventada = [{ id: 'x' }];
    const { sample } = mergeSamplePatch(realSample(), patch);
    const benchmark = sample.benchmarks.find((entry) => entry.id === 'evo-w12');
    expect(benchmark.novelty.chaveInventada).toBeUndefined();
    expect(Object.keys(benchmark.novelty).sort()).toEqual([
      'newBusinessRules', 'newCapabilities', 'newCriticalBusinessRules', 'newCriticalCapabilities',
      'newCriticalJourneys', 'newJourneys', 'newRequiredBusinessRules', 'newRequiredCapabilities',
      'newRequiredJourneys',
    ]);
  });

  test('só campos de PESQUISA são tocados', () => {
    const before = realSample();
    const { sample } = mergeSamplePatch(before, validPatch());

    expect(sample.archetypes).toEqual(before.archetypes);
    expect(sample.marketScarcityExceptions).toEqual(before.marketScarcityExceptions);
    expect(sample.canonicalInventoryBaseline).toBe(before.canonicalInventoryBaseline);
    expect(sample.diversityDimensions).toEqual(before.diversityDimensions);
    expect(sample.sampleVersion).toBe(before.sampleVersion);
    expect(sample.inventoryVersion).toBe(before.inventoryVersion);
    // Nunca se auto-declara suficiente.
    expect(sample.sampleSufficiencyClaim).toBeUndefined();
    expect(sample.researchState).toBe(before.researchState);

    // Benchmarks não cobertos pelo patch permanecem EXATAMENTE como estavam.
    const untouchedBefore = before.benchmarks.find((entry) => entry.id === 'mindbody');
    const untouchedAfter = sample.benchmarks.find((entry) => entry.id === 'mindbody');
    expect(untouchedAfter).toEqual(untouchedBefore);
  });

  test('fontes são mescladas por URL preservando anotações humanas', () => {
    const before = realSample();
    const note = before.benchmarks
      .find((entry) => entry.id === 'evo-w12')
      .sources.find((source) => source.url === 'https://w12.com.br/funcionalidades/').note;

    const { sample } = mergeSamplePatch(before, validPatch());
    const merged = sample.benchmarks
      .find((entry) => entry.id === 'evo-w12')
      .sources.find((source) => source.url === 'https://w12.com.br/funcionalidades/');

    expect(merged.note).toBe(note);
    expect(merged.id).toBe('brsrc-1');
    expect(merged.specificity).toBe('SPECIFIC');
  });

  test('o registro de auditoria do holdout só é espelhado quando o holdout foi analisado', () => {
    // Premissa isolada do estado real da pesquisa: simula um sample em que o
    // holdout AINDA não foi analisado (o sample real passou a carregar a
    // análise real de 2026-09-15 — o espelho pré-existente é preservado).
    // O invariante é agnóstico ao holdout CORRENTE: o espelho acontece quando
    // o benchmark ANALISADO é o holdout registrado — quem quer que ele seja
    // (ciclo 1: zenplanner; ciclo 2 em diante: o pré-registrado do market
    // discovery vigente).
    const preHoldout = realSample();
    const holdoutId = preHoldout.holdout.benchmarkId;
    preHoldout.holdout.analysedAt = null;
    preHoldout.benchmarks = preHoldout.benchmarks.map((benchmark) => (
      benchmark.id === holdoutId ? { ...benchmark, analyzedAt: null } : benchmark
    ));
    const { sample } = mergeSamplePatch(preHoldout, validPatch());
    // Sem análise do holdout no patch, o espelho permanece null.
    expect(sample.holdout.analysedAt).toBeNull();

    const withHoldout = validPatch();
    withHoldout.benchmarks.push({
      id: holdoutId,
      analyzedAt: '2026-09-14T00:00:00.000Z',
      researchVersion: 'fitness-research-patch-v1',
      inventoryVersion: 'canonical-capabilities-1.0.0',
      findingsInventory: ['brf-2'],
      marketArchetypeMapping: { archetype: 'crossfit-box' },
      sources: [{ id: 'brsrc-2', url: 'https://www.zenplanner.com/', tier: 5, verified: true, httpStatus: 200 }],
      novelty: {},
    });
    const mirrored = mergeSamplePatch(preHoldout, withHoldout).sample;
    expect(mirrored.holdout.analysedAt).toBe('2026-09-14T00:00:00.000Z');
  });
});

describe('§B7/§B12 — sem pesquisa não existe atualização de sample', () => {
  test('patch sem nenhum benchmark analisado é RECUSADO', () => {
    const patch = validPatch();
    patch.benchmarks = patch.benchmarks.map((benchmark) => ({ ...benchmark, analyzedAt: null }));
    expect(() => mergeSamplePatch(realSample(), patch)).toThrow(new RegExp(ERROR_CODES.PATCH_WITHOUT_ANALYSIS));
  });
  test('patch de outra vertical é recusado', () => {
    const patch = { ...validPatch(), vertical: 'beauty' };
    expect(() => mergeSamplePatch(realSample(), patch)).toThrow(new RegExp(ERROR_CODES.VERTICAL_MISMATCH));
  });

  test('patch que não casa com nenhum benchmark do sample é recusado', () => {
    const patch = validPatch();
    patch.benchmarks = [{ ...patch.benchmarks[0], id: 'inexistente' }];
    expect(() => mergeSamplePatch(realSample(), patch)).toThrow(new RegExp(ERROR_CODES.PATCH_WITHOUT_ANALYSIS));
  });
});

/** FS em memória — a transação é exercitada sem tocar o repositório. */
function memoryFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    existsSync: (file) => files.has(file),
    readFileSync: (file) => {
      if (!files.has(file)) throw new Error(`ENOENT: ${file}`);
      return files.get(file);
    },
    writeFileSync: (file, content) => files.set(file, content),
    renameSync: (from, to) => {
      if (!files.has(from)) throw new Error(`ENOENT rename: ${from}`);
      files.set(to, files.get(from));
      files.delete(from);
    },
    unlinkSync: (file) => files.delete(file),
  };
}

describe('§B7 — aplicação TRANSACIONAL do patch', () => {
  const target = '/virtual/config/benchmarks/fitness.json';

  test('grava o patch e reporta o que foi aplicado', () => {
    const fs = memoryFs({ [target]: JSON.stringify(realSample(), null, 2) });
    const result = applySamplePatch({ patch: validPatch(), samplePath: target, fs });
    expect(result.applied).toEqual(['evo-w12']);
    expect(result.unmatched).toEqual([]);

    const written = JSON.parse(fs.readFileSync(target, 'utf8'));
    expect(written.benchmarks.find((entry) => entry.id === 'evo-w12').analyzedAt).toBe('2026-09-13T00:00:00.000Z');
    // Nenhum arquivo temporário sobra.
    expect([...fs.files.keys()]).toEqual([target]);
  });

  test('validação pós-merge que falha NÃO altera o arquivo', () => {
    const original = JSON.stringify(realSample(), null, 2);
    const fs = memoryFs({ [target]: original });

    expect(() => applySamplePatch({
      patch: validPatch(),
      samplePath: target,
      fs,
      validate: () => { throw new Error('engine recusou o sample candidato'); },
    })).toThrow(new RegExp(ERROR_CODES.VALIDATION_FAILED));

    expect(fs.readFileSync(target)).toBe(original);
    expect([...fs.files.keys()]).toEqual([target]);
  });

  test('falha de escrita restaura o conteúdo anterior', () => {
    const original = JSON.stringify(realSample(), null, 2);
    const fs = memoryFs({ [target]: original });
    fs.renameSync = () => { throw new Error('disco cheio'); };

    expect(() => applySamplePatch({ patch: validPatch(), samplePath: target, fs })).toThrow('disco cheio');
    expect(fs.readFileSync(target)).toBe(original);
  });

  test('sample inexistente falha explicitamente', () => {
    const fs = memoryFs({});
    expect(() => applySamplePatch({ patch: validPatch(), samplePath: target, fs }))
      .toThrow(new RegExp(ERROR_CODES.SAMPLE_NOT_FOUND));
  });
});
