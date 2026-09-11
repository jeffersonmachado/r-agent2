'use strict';

/**
 * MISSÃO CORRETIVA §17 — GAP DE ARQUÉTIPOS DO FITNESS REPRODUZIDO, NÃO FORÇADO.
 *
 * `financial-billing` e `student-digital-experience` são arquétipos REQUIRED da
 * vertical fitness e NÃO estão representados por nenhum benchmark da amostra.
 *
 * O risco real aqui não é o gap: é o gap ser "resolvido" por conveniência —
 * rebaixando o arquétipo, removendo-o da lista, declarando cobertura ou
 * preenchendo novelty sem pesquisa. Este teste existe para tornar essas saídas
 * impossíveis sem que o repositório grite.
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

describe('§17 o gap de arquétipos do fitness é reproduzido honestamente', () => {
  it('os dois arquétipos seguem declarados REQUIRED (não podem ser rebaixados para fazer PASS)', () => {
    for (const id of GAP_ARCHETYPES) {
      const archetype = (SAMPLE.archetypes || []).find((a) => a.id === id);
      expect(archetype).toBeDefined();
      expect(archetype.importance).toBe('REQUIRED');
      expect(archetype.status).toBe('ACTIVE');
    }
  });

  it('a cobertura de arquétipos REPROVA e lista exatamente o gap', () => {
    const coverage = engine.evaluateArchetypeCoverage({ sample: SAMPLE });
    expect(coverage.status).toBe('FAIL');
    expect(coverage.missingArchetypes).toEqual(expect.arrayContaining(GAP_ARCHETYPES));
    expect(coverage.missingArchetypes.length).toBeGreaterThan(0);
  });

  it('nenhum benchmark declara os arquétipos em falta (o gap é real, não de leitura)', () => {
    const declared = new Set((SAMPLE.benchmarks || []).map((b) => b.archetype));
    for (const id of GAP_ARCHETYPES) {
      expect(declared.has(id)).toBe(false);
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
    const totalNovelty = (SAMPLE.benchmarks || []).reduce((total, benchmark) => {
      const novelty = benchmark.novelty || {};
      return total + Object.values(novelty).reduce((sum, items) => sum + (Array.isArray(items) ? items.length : 0), 0);
    }, 0);
    expect(totalNovelty).toBe(0);
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
