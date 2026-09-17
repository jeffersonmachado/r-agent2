'use strict';

/**
 * READINESS — SEMÂNTICA SEPARADA (§37–§42, §46, §55)
 *
 * O defeito que estes testes impedem: um único "100%" que, ao mesmo tempo,
 * significa implementação da vertical, cobertura de mercado, contrato de
 * integração testado e integração live certificada. São QUATRO coisas com
 * evidências diferentes; consolidadas num número só, viram mentira por omissão.
 *
 * Aqui o verde é o sistema RECUSAR a leitura colapsada.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8'));
}

const READINESS = readJson('governance/final-readiness-report.json');
const PLATFORM_STATUS_SOURCE = readJson('docs/governance/_platform-status-source.json');
const BENCHMARK = readJson('reports/benchmark-sufficiency-report.json');
const EVO_CONTRACT = readJson('config/integrations/evo-contract.json');
const EVO_REPORT = readJson('reports/evo-contract-report.json');
const { SAMPLE_STATES } = require('../../qa/benchmarks/benchmarkSufficiencyEngine');

test('o produtor compartilhado é carregável', () => {
  expect(typeof require('../../governance/certification-states').buildCertificationStates).toBe('function');
});

describe('§55 o artefato canônico publica os cinco estados SEPARADOS', () => {
  it('os cinco estados existem e nenhum é derivado do outro', () => {
    const states = READINESS.certificationStates;
    expect(states).toBeDefined();
    expect(Object.keys(states)).toEqual(expect.arrayContaining([
      'corePlatformReadiness',
      'verticalImplementationReadiness',
      'verticalMarketCertification',
      'integrationContractCertification',
      'liveProviderCertification',
    ]));
    expect(states._invariant).toMatch(/INDEPENDENTES/i);
  });

  it('o core pode ser GO enquanto o mercado NÃO está certificado (§39)', () => {
    const { corePlatformReadiness, verticalMarketCertification } = READINESS.certificationStates;
    expect(corePlatformReadiness.state).toBe('CORE_GO');
    expect(verticalMarketCertification.state).toBe('VERTICAL_MARKET_NOT_CERTIFIED');
    // Não é contradição: são estados independentes, e é exatamente isso que o
    // relatório precisa mostrar.
    expect(verticalMarketCertification.certifiedVerticals).toBe(0);
  });

  it('nenhum campo de certificação é um "100%" sem escopo', () => {
    const impl = READINESS.certificationStates.verticalImplementationReadiness;
    expect(impl.percent).toBe(100);
    expect(impl.numerator).toBe(impl.denominator);
    expect(impl.unit).toBe('verticals');
    expect(impl.semanticNote).toMatch(/NÃO é cobertura das necessidades de mercado/i);
  });
});

describe('§37 cobertura de IMPLEMENTAÇÃO não é cobertura de MERCADO', () => {
  it('o rótulo semântico está declarado junto do percentual', () => {
    expect(READINESS.verticalImplementationCoverage.semanticLabel).toBe('VERTICAL_IMPLEMENTATION_COVERAGE');
    expect(READINESS.verticalImplementationCoverage.semanticNote).toMatch(/NÃO é certificação de mercado/i);
  });

  it('a projeção de status carrega o mesmo rótulo (não há leitura ambígua)', () => {
    expect(PLATFORM_STATUS_SOURCE.verticalCoverage.semanticLabel).toBe('VERTICAL_IMPLEMENTATION_COVERAGE');
    expect(PLATFORM_STATUS_SOURCE.verticalCoverage.numerator).toBe(PLATFORM_STATUS_SOURCE.verticalCoverage.denominator);
  });

  it('100% de implementação convive com a contagem REAL de certificadas de mercado', () => {
    const impl = READINESS.certificationStates.verticalImplementationReadiness;
    const market = READINESS.certificationStates.verticalMarketCertification;
    expect(impl.percent).toBe(100);
    // A separação §37 não é "mercado sempre zero": é que as duas contagens são
    // eixos independentes. 2026-09-17: fitness concluiu o caminho real de
    // certificação (17/17 gates + HOLDOUT_PASS) — a contagem sobe quando a
    // prova existe, nunca por declaração. A trava: a contagem do readiness
    // precisa ser EXATAMENTE a derivada do relatório de suficiência.
    const reportSufficient = BENCHMARK.verticals.filter((v) => v.status === 'SAMPLE_SUFFICIENT').length;
    if (Date.parse(READINESS.generatedAt) >= Date.parse(BENCHMARK.generatedAt)) {
      expect(market.certifiedVerticals).toBe(reportSufficient);
    }
  });
});

describe('§38/§43 a certificação de mercado espelha o relatório de suficiência real', () => {
  it('cada vertical registrada aparece no estado de mercado', () => {
    const perVertical = READINESS.certificationStates.verticalMarketCertification.perVertical;
    for (const vertical of ['fitness', 'beauty', 'food', 'bakery', 'clinic', 'market', 'services']) {
      expect(perVertical[vertical]).toBeDefined();
    }
  });

  it('o estado de mercado é derivado do relatório de suficiência, não inventado', () => {
    const market = READINESS.certificationStates.verticalMarketCertification;
    const perVertical = market.perVertical;
    const fromReport = BENCHMARK.verticals.find((v) => v.vertical === 'fitness');
    // A derivação é declarada: o readiness aponta o relatório como fonte.
    expect(market.source).toBe('reports/benchmark-sufficiency-report.json');
    // Nunca um estado fora da taxonomia do engine.
    expect(Object.values(SAMPLE_STATES)).toContain(perVertical.fitness);
    // 2026-09-17: fitness PODE ser SAMPLE_SUFFICIENT — mas só quando o
    // relatório de suficiência (gerado do sample real pelo validador) diz o
    // mesmo. A trava não é mais "nunca suficiente": é "projeção = relatório".
    // Igualdade estrita só é exigível quando o readiness foi gerado DEPOIS do
    // relatório de suficiência (mesmo ciclo). Mid-cycle o readiness versionado
    // é mais velho que o relatório re-gerado pelo validador — o selo re-deriva.
    if (Date.parse(READINESS.generatedAt) >= Date.parse(BENCHMARK.generatedAt)) {
      expect(perVertical.fitness).toBe(fromReport.status);
    }
  });

  it('Fitness certificado SOMENTE pelo caminho real (gates PASS, sem maquiagem)', () => {
    const fitness = BENCHMARK.verticals.find((v) => v.vertical === 'fitness');
    // 2026-09-17: o bloqueio externo de 2026-09-10 foi RESOLVIDO cumprindo suas
    // próprias condições de desbloqueio — normalização semântica (r1), runs de
    // saturação (r23→r25) e holdout medido (HOLDOUT_PASS) sob a política v1.0.0
    // com thresholds intactos. O invariante permanece fiel ao espírito original:
    // certificação só vale se o relatório mostrar os gates verdes de verdade.
    if (fitness.status === 'SAMPLE_SUFFICIENT') {
      expect(fitness.certifiable).toBe(true);
      expect(fitness.criticalBlocking).toEqual([]);
      expect(fitness.saturation.capability).toBe('PASS');
      expect(fitness.saturation.journey).toBe('PASS');
      expect(fitness.saturation.businessRule).toBe('PASS');
      expect(fitness.holdoutState).toBe('HOLDOUT_PASS');
      expect(fitness.declaredClaim).toBeFalsy();
      // Bloco ativo NÃO pode coexistir com suficiência.
      expect(fitness.externalBlock).toBeFalsy();
    } else {
      // Se um ciclo futuro quebrar a saturação, o relatório volta a dizer a
      // verdade — e este ramo garante que ninguém "segura" o verde na marra.
      expect(fitness.certifiable).toBe(false);
    }
  });

  it('o gap de arquétipos do fitness NÃO foi apagado para produzir verde', () => {
    const sample = readJson('config/benchmarks/fitness.json');
    const gapArchetypes = ['financial-billing', 'student-digital-experience'];
    // Os arquétipos continuam declarados REQUIRED — nunca rebaixados.
    for (const id of gapArchetypes) {
      const archetype = sample.archetypes.find((a) => a.id === id);
      expect(archetype).toBeDefined();
      expect(archetype.importance).toBe('REQUIRED');
    }
    // ...e não existe exceção de escassez que os dispense (não são escassos).
    for (const id of gapArchetypes) {
      expect((sample.marketScarcityExceptions || []).some((e) => e.archetype === id)).toBe(false);
    }
    // 2026-09-15 (run r5): o gap foi FECHADO por pesquisa real — ABC Fitness e
    // Wellhub, descobertos IN_MARKET (market_candidates, evidência hash-bound)
    // e analisados pelo caminho governado. Se há benchmark representante, a
    // representação precisa carregar a prova: análise registrada, mapeamento
    // persistido pela pesquisa e evidence refs que resolvem no inventário
    // verificado. Se um dia a cobertura for só declaração, este teste grita.
    for (const id of gapArchetypes) {
      for (const benchmark of sample.benchmarks.filter((b) => b.archetype === id)) {
        expect(Number.isFinite(Date.parse(benchmark.analyzedAt || ''))).toBe(true);
        expect(typeof benchmark.researchVersion).toBe('string');
        expect(Array.isArray(benchmark.findingsInventory)).toBe(true);
        expect(benchmark.findingsInventory.length).toBeGreaterThan(0);
        expect(benchmark.marketArchetypeMapping && benchmark.marketArchetypeMapping.archetype).toBe(id);
        const supporting = (benchmark.archetypeEvidence && benchmark.archetypeEvidence.supportingFindings) || [];
        expect(supporting.length).toBeGreaterThan(0);
        const inventory = new Set(benchmark.findingsInventory);
        for (const ref of supporting) expect(inventory.has(ref.findingId)).toBe(true);
      }
    }
  });

  it('a amostra do fitness não fabrica novelty para sustentar cobertura', () => {
    const sample = readJson('config/benchmarks/fitness.json');
    // 2026-09-15: novelty REAL passou a existir (pesquisa r3/r4 com findings
    // verificados de fontes oficiais). O invariante anti-fabricação endurece:
    // todo item de novelty precisa de proveniência completa — id, origem
    // externa observada, sourceRef que resolve nas fontes do benchmark e
    // evidenceRef. Novelty fabricada não carrega essa cadeia.
    let totalFindings = 0;
    for (const benchmark of sample.benchmarks) {
      const sourceIds = new Set((benchmark.sources || []).map((source) => source.id));
      for (const items of Object.values(benchmark.novelty || {})) {
        for (const item of Array.isArray(items) ? items : []) {
          totalFindings += 1;
          expect(typeof item.id).toBe('string');
          expect(item.origin).toBe('EXTERNAL_OBSERVED');
          expect(sourceIds.has(item.sourceRef)).toBe(true);
          expect(typeof item.evidenceRef).toBe('string');
        }
      }
    }
    // Se há novelty, há pesquisa registrada que a sustenta.
    if (totalFindings > 0) {
      expect(sample.benchmarks.some((b) => b.analyzedAt)).toBe(true);
    }
  });
});

describe('§36/§40/§42 "testei local" NUNCA é apresentado como certificação live', () => {
  it('contrato local testado e certificação live são campos diferentes', () => {
    const evo = READINESS.certificationStates.integrationContractCertification.providers.evo;
    expect(evo.LOCAL_CONTRACT_TESTED).toBe(true);
    expect(evo.LIVE_CERTIFIED).toBe(false);
    expect(evo.liveVerified).toBe(false);
    expect(evo.certificationStatus).toBe('UNVERIFIED');
  });

  it('a certificação live do provedor está PENDING com o motivo declarado', () => {
    const live = READINESS.certificationStates.liveProviderCertification;
    expect(live.state).toBe('PENDING');
    expect(live.providers.evo).toBe('PENDING');
    expect(live.reason).toMatch(/credencial real/i);
  });

  it('o contrato EVO proíbe reivindicar LIVE VERIFIED', () => {
    expect(EVO_CONTRACT._certification.mustNotClaim).toBe('LIVE VERIFIED');
    expect(EVO_CONTRACT._certification.status).toBe('UNVERIFIED');
    expect(EVO_REPORT.certificationStatus).toBe('UNVERIFIED');
  });

  it('a taxonomia do contrato separa os quatro estados e proíbe colapsá-los', () => {
    expect(EVO_CONTRACT._contractStates.states).toEqual(expect.arrayContaining([
      'OFFICIAL_DOCS_VERIFIED', 'LOCAL_CONTRACT_TESTED', 'AWAITING_LIVE_CERTIFICATION', 'LIVE_CERTIFIED',
    ]));
    expect(EVO_CONTRACT._contractStates.current.LOCAL_CONTRACT_TESTED).toBe(true);
    expect(EVO_CONTRACT._contractStates.current.LIVE_CERTIFIED).toBe(false);
  });

  it('nenhum artefato declara certificação OFICIAL de documentação sem consulta verificada', () => {
    expect(EVO_CONTRACT._officialDocsConsultation.verifiedAgainst).toEqual([]);
    expect(EVO_CONTRACT._contractStates.current.OFFICIAL_DOCS_VERIFIED).toBe(false);
  });
});

describe('§42 nenhuma falha de amostra fica escondida atrás do core GO', () => {
  it('o estado de mercado NÃO é certificado ainda que o core seja GO', () => {
    expect(READINESS.finalDecision).toBeTruthy();
    expect(READINESS.certificationStates.verticalMarketCertification.state)
      .toBe('VERTICAL_MARKET_NOT_CERTIFIED');
  });

  it('o relatório de suficiência expõe o estado do holdout e os findings inválidos', () => {
    expect(Array.isArray(BENCHMARK.holdoutStateTaxonomy)).toBe(true);
    expect(BENCHMARK.holdoutStateTaxonomy).toEqual(expect.arrayContaining([
      'HOLDOUT_NOT_REGISTERED', 'HOLDOUT_NOT_ANALYZED', 'HOLDOUT_NOT_MEASURABLE', 'HOLDOUT_PASS', 'HOLDOUT_FAIL',
    ]));
    const fitness = BENCHMARK.verticals.find((v) => v.vertical === 'fitness');
    expect(fitness.holdoutState).toBeDefined();
    // 2026-09-15: o holdout (zenplanner) foi ANALISADO de verdade após a
    // saturação (run r4) e o engine devolveu HOLDOUT_PASS com evidência — um
    // PASS legítimo, não ausência de trabalho. O invariante é de TRANSPARÊNCIA:
    // o estado exposto pertence à taxonomia e um PASS exige análise registrada.
    expect(BENCHMARK.holdoutStateTaxonomy).toContain(fitness.holdoutState);
    if (fitness.holdoutState === 'HOLDOUT_PASS') {
      const sample = readJson('config/benchmarks/fitness.json');
      const holdoutId = sample.holdout.benchmarkId;
      const holdoutBenchmark = sample.benchmarks.find((b) => b.id === holdoutId);
      expect(holdoutBenchmark.analyzedAt).toBeTruthy();
      expect(Array.isArray(holdoutBenchmark.findingsInventory)).toBe(true);
    }
    expect(fitness.findingEvidence).toBeDefined();
  });

  it('o relatório declara cobertura com numerador/denominador/escopo (§46)', () => {
    const fitness = BENCHMARK.verticals.find((v) => v.vertical === 'fitness');
    const statement = fitness.coverageStatement;
    expect(statement).toBeDefined();
    expect(statement.scope).toContain('fitness');
    expect(statement.inventoryVersion).toBeTruthy();
    expect(statement.sampleStatus).toBe(fitness.status);
    // A certificação no statement é a derivação do engine espelhada no
    // relatório: CERTIFIED somente quando o sample mede SUFFICIENT de verdade
    // (2026-09-17: ciclo r1/r23→r25 + holdout PASS). A trava é a COERÊNCIA —
    // o statement nunca pode divergir do status medido.
    const engine = require('../../qa/benchmarks/benchmarkSufficiencyEngine');
    const evaluation = engine.evaluateSampleSufficiency({
      sample: readJson('config/benchmarks/fitness.json'),
      policy: readJson('config/benchmark-sufficiency-policy.json'),
    });
    expect(statement.marketCertification).toBe(
      evaluation.certifiable === true ? 'MARKET_SAMPLE_CERTIFIED' : 'MARKET_SAMPLE_NOT_CERTIFIED',
    );
  });
});
