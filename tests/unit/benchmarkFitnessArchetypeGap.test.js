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
      let evidenced = 0;
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
        // O bloco archetypeEvidence é DERIVADO do corpus corrente
        // (derive-archetype-coverage-evidence --write): representante sem
        // achado verificado que case o vocabulário tem o bloco REMOVIDO —
        // prova velha não é prova. Medido em 2026-09-19 (T3/T7): a limpeza
        // semântica aposentou o slogan "As assinaturas do Wellhub..." (a
        // "prova" antiga de wellhub era exatamente o falso positivo que o
        // funil semântico existe para matar); student-digital-experience
        // segue evidenciado por trainerize.com.
        const evidence = benchmark.archetypeEvidence || null;
        if (!evidence) continue;
        evidenced += 1;
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
      // O que NUNCA pode acontecer: arquétipo em gap coberto sem NENHUM
      // representante com evidência derivada do corpus corrente.
      expect(evidenced).toBeGreaterThan(0);
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

  it('o relatório de suficiência DERIVA (não declara) a cobertura de mercado do fitness', () => {
    const entry = fitnessEntry(loadReport());
    expect(entry).not.toBeNull();
    // 2026-09-17: o ciclo de convergência (normalização semântica r1 → runs
    // r23/r24/r25 → holdout fitness-holdout-validation-2026-09-17-r25 PASS)
    // cumpriu as condições de desbloqueio sob a política v1.0.0 intacta. O
    // relatório agora reflete a medição real: SAMPLE_SUFFICIENT.
    expect(entry.status).toBe('SAMPLE_SUFFICIENT');
    expect(entry.certifiable).toBe(true);
    expect(entry.marketCoverageCertifiable).toBe(true);
    // O que NUNCA muda: cobertura de mercado não é DECLARADA — o percentual
    // declarado permanece nulo; quem mede é o engine.
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

  it('o bloqueio externo foi RESOLVIDO por trabalho real e a resolução é auditável', () => {
    // 2026-09-17: as três condições de desbloqueio declaradas no próprio
    // externalBlock foram cumpridas — absorção ao canônico via normalização
    // semântica (fitness-semantic-2026-09-17-r1), re-execução da pesquisa em
    // novas researchVersions (r23→r25) até a janela saturar nas 3 dimensões, e
    // re-medição do holdout (fitness-holdout-validation-2026-09-17-r25 →
    // HOLDOUT_PASS). O campo `researchState` saiu de RESEARCHING e o bloco foi
    // para `externalBlockHistory` com status RESOLVED — nunca apagado.
    // Este teste trava DOIS lados: (a) a transição é real — o engine deriva
    // SAMPLE_SUFFICIENT do arquivo — e (b) a narrativa de resolução existe.
    expect(String(SAMPLE.researchState).toUpperCase()).not.toBe('RESEARCHING');
    expect(SAMPLE.externalBlock).toBeUndefined();
    const history = SAMPLE.externalBlockHistory;
    expect(Array.isArray(history)).toBe(true);
    const resolved = history.find((entry) => entry.code === engine.EXTERNAL_BLOCK_STATE);
    expect(resolved).toBeDefined();
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolution && typeof resolved.resolution.narrative).toBe('string');
    // A trava contra "declaração sem medição": o engine precisa CONCORDAR.
    const evaluation = engine.evaluateSampleSufficiency({ sample: SAMPLE, policy: POLICY });
    expect(evaluation.status).toBe('SAMPLE_SUFFICIENT');
    expect(evaluation.certifiable).toBe(true);
    expect(evaluation.criticalBlocking).toEqual([]);
    expect(evaluation.holdoutState).toBe('HOLDOUT_PASS');
  });

  it('a política exige cobertura de arquétipos (o gap não pode ser ignorado por limiar frouxo)', () => {
    expect(Number(POLICY.minimumDistinctArchetypes)).toBeGreaterThan(0);
    expect(SAMPLE.archetypes.filter((a) => a.importance === 'REQUIRED').length)
      .toBeGreaterThan(Number(POLICY.minimumDistinctArchetypes) - 1);
  });
});
