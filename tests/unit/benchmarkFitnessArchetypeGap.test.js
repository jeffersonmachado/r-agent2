'use strict';

/**
 * MISSÃO CORRETIVA §17 — GAP DE ARQUÉTIPOS DO FITNESS: REPRODUZIDO, DEPOIS
 * FECHADO POR PESQUISA REAL.
 *
 * `financial-billing` e `student-digital-experience` são arquétipos REQUIRED da
 * vertical fitness. Até o run fitness-real-2026-09-15-r4 NENHUM benchmark os
 * representava. No run r5 (2026-09-15) o gap foi fechado por PESQUISA REAL:
 * dois candidatos descobertos IN_MARKET pela varredura de mercado (ABC Fitness
 * e Wellhub, evidência hash-bound em market_candidates) foram pesquisados pelo
 * caminho governado (fetch/inspeção reais, findings verificados) e declarados
 * representantes dos dois arquétipos — cada um com `archetypeEvidence`
 * apontando findings VERIFICADOS que casam o vocabulário versionado do
 * arquétipo (config/benchmark-normalization.json#archetypeEvidenceTerms,
 * derivação em qa/benchmarks/archetypeEvidenceDerivation.js).
 *
 * O risco que este teste vigia NÃO mudou: o gap ser "resolvido" por
 * conveniência — rebaixando o arquétipo, removendo-o da lista, declarando
 * cobertura sem pesquisa, usando marketScarcityException sem escassez real ou
 * preenchendo novelty sem fonte. Se um dia a cobertura deixar de ser
 * sustentada por evidência, este arquivo volta a gritar.
 */

const fs = require('fs');
const path = require('path');

const engine = require('../../qa/benchmarks/benchmarkSufficiencyEngine');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SAMPLE_PATH = path.join(REPO_ROOT, 'config', 'benchmarks', 'fitness.json');
const REPORT_PATH = path.join(REPO_ROOT, 'reports', 'benchmark-sufficiency-report.json');
const POLICY = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'config', 'benchmark-sufficiency-policy.json'), 'utf8'),
);

const SAMPLE = JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8'));
const GAP_ARCHETYPES = ['financial-billing', 'student-digital-experience'];

function loadReport() {
  if (!fs.existsSync(REPORT_PATH)) return null;
  return JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
}

function fitnessEntry(report) {
  if (!report) return null;
  const verticals = report.verticals || {};
  if (Array.isArray(verticals)) return verticals.find((v) => v.vertical === 'fitness') || null;
  return verticals.fitness || null;
}

describe('§17 o gap de arquétipos do fitness — fechamento só vale com evidência', () => {
  it('os dois arquétipos seguem declarados REQUIRED (não podem ser rebaixados para fazer PASS)', () => {
    for (const id of GAP_ARCHETYPES) {
      const archetype = (SAMPLE.archetypes || []).find((a) => a.id === id);
      expect(archetype).toBeDefined();
      expect(archetype.importance).toBe('REQUIRED');
      expect(archetype.status).toBe('ACTIVE');
    }
  });

  it('a cobertura, quando PASS, vem de benchmarks PESQUISADOS com evidência de arquétipo', () => {
    const coverage = engine.evaluateArchetypeCoverage({ sample: SAMPLE });
    if (coverage.status === 'FAIL') {
      // Lacuna honesta continua sendo um resultado válido — mas precisa ser
      // listada nominalmente, nunca escondida.
      expect(coverage.missingArchetypes.length).toBeGreaterThan(0);
      return;
    }
    expect(coverage.missingArchetypes).toEqual([]);
    for (const id of GAP_ARCHETYPES) {
      const representatives = (SAMPLE.benchmarks || []).filter((b) => b.archetype === id);
      expect(representatives.length).toBeGreaterThan(0);
      for (const benchmark of representatives) {
        // Análise real: analyzedAt + researchVersion + inventário de findings.
        expect(Number.isFinite(Date.parse(benchmark.analyzedAt || ''))).toBe(true);
        expect(typeof benchmark.researchVersion).toBe('string');
        expect(Array.isArray(benchmark.findingsInventory)).toBe(true);
        expect(benchmark.findingsInventory.length).toBeGreaterThan(0);
        // Mapeamento persistido pela pesquisa (não edição manual solta).
        expect(benchmark.marketArchetypeMapping && benchmark.marketArchetypeMapping.archetype).toBe(id);
        // Fonte oficial verificada (tier aceitável + obtenção confirmada).
        expect((benchmark.sources || []).some((source) => source.verified === true
          && !engine.isGenericSource(source))).toBe(true);
        // Evidence refs declaradas resolvendo contra o inventário verificado.
        const evidence = benchmark.archetypeEvidence || null;
        expect(evidence).not.toBeNull();
        expect(typeof evidence.derivation).toBe('string');
        const supporting = Array.isArray(evidence.supportingFindings) ? evidence.supportingFindings : [];
        expect(supporting.length).toBeGreaterThan(0);
        const inventory = new Set(benchmark.findingsInventory);
        for (const ref of supporting) {
          expect(inventory.has(ref.findingId)).toBe(true);
          expect(typeof ref.evidenceId).toBe('string');
          expect(typeof ref.sourceId).toBe('string');
        }
      }
    }
  });

  it('nenhum arquétipo em gap histórico é coberto por exceção de escassez fabricada', () => {
    const exceptions = Array.isArray(SAMPLE.marketScarcityExceptions) ? SAMPLE.marketScarcityExceptions : [];
    for (const id of GAP_ARCHETYPES) {
      // Esses arquétipos NÃO são escassos no mercado fitness — declará-los
      // escassos seria a saída conveniente que este teste existe para impedir.
      expect(exceptions.some((e) => e.archetype === id)).toBe(false);
    }
  });

  it('o relatório de suficiência não declara cobertura de mercado para o fitness', () => {
    const entry = fitnessEntry(loadReport());
    expect(entry).not.toBeNull();
    expect(entry.status).not.toBe('SAMPLE_SUFFICIENT');
    expect(entry.certifiable).toBe(false);
    expect(entry.marketCoverageCertifiable).toBe(false);
    expect(entry.coverageDeclaredPercent).toBeNull();
  });

  it('a amostra não fabrica novelty para sustentar cobertura', () => {
    // 2026-09-15: novelty REAL passou a existir (runs r3/r4, findings verificados
    // de fontes oficiais). O invariante endurece: todo item precisa de cadeia de
    // proveniência completa — id, origem externa observada, sourceRef que resolve
    // nas fontes do próprio benchmark e evidenceRef. Fabricação não sobrevive a isso.
    let totalNovelty = 0;
    for (const benchmark of SAMPLE.benchmarks || []) {
      const sourceIds = new Set((benchmark.sources || []).map((source) => source.id));
      for (const items of Object.values(benchmark.novelty || {})) {
        for (const item of Array.isArray(items) ? items : []) {
          totalNovelty += 1;
          expect(typeof item.id).toBe('string');
          expect(item.origin).toBe('EXTERNAL_OBSERVED');
          expect(sourceIds.has(item.sourceRef)).toBe(true);
          expect(typeof item.evidenceRef).toBe('string');
        }
      }
    }
    // Novelty sem pesquisa registrada é fabricação; com pesquisa é medição.
    if (totalNovelty > 0) {
      expect(SAMPLE.benchmarks.some((b) => b.analyzedAt)).toBe(true);
    }
  });

  it('a amostra declara o bloqueio externo de pesquisa de forma auditável', () => {
    expect(String(SAMPLE.researchState).toUpperCase()).toBe('RESEARCHING');
    expect(SAMPLE.externalBlock && SAMPLE.externalBlock.code).toBe(engine.EXTERNAL_BLOCK_STATE);
    expect(Array.isArray(SAMPLE.externalBlock.unblocksBy)).toBe(true);
    expect(SAMPLE.externalBlock.unblocksBy.length).toBeGreaterThan(0);
  });

  it('a política exige cobertura de arquétipos (o gap não pode ser ignorado por limiar frouxo)', () => {
    expect(Number(POLICY.minimumDistinctArchetypes)).toBeGreaterThan(0);
    expect(SAMPLE.archetypes.filter((a) => a.importance === 'REQUIRED').length)
      .toBeGreaterThan(Number(POLICY.minimumDistinctArchetypes) - 1);
  });
});
