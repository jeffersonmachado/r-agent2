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

  it('100% de implementação convive com 0 verticais certificadas de mercado', () => {
    const impl = READINESS.certificationStates.verticalImplementationReadiness;
    const market = READINESS.certificationStates.verticalMarketCertification;
    expect(impl.percent).toBe(100);
    expect(market.certifiedVerticals).toBe(0);
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
    const perVertical = READINESS.certificationStates.verticalMarketCertification.perVertical;
    const fromReport = BENCHMARK.verticals.find((v) => v.vertical === 'fitness');
    expect(perVertical.fitness).toBe(fromReport.status);
    expect(perVertical.fitness).not.toBe('SAMPLE_SUFFICIENT');
  });

  it('Fitness segue NÃO certificado (não foi maquiado para obter GO)', () => {
    const fitness = BENCHMARK.verticals.find((v) => v.vertical === 'fitness');
    expect(fitness.status).toBe('SAMPLE_NOT_RESEARCHED');
    expect(fitness.certifiable).toBe(false);
    expect(fitness.externalBlock.code).toBe('SAMPLE_CERTIFICATION_BLOCKED_BY_EXTERNAL_RESEARCH');
  });

  it('o gap de arquétipos do fitness NÃO foi apagado para produzir verde', () => {
    const sample = readJson('config/benchmarks/fitness.json');
    const gapArchetypes = ['financial-billing', 'student-digital-experience'];
    // Os arquétipos em falta continuam declarados REQUIRED...
    for (const id of gapArchetypes) {
      const archetype = sample.archetypes.find((a) => a.id === id);
      expect(archetype).toBeDefined();
      expect(archetype.importance).toBe('REQUIRED');
    }
    // ...e nenhum benchmark os representa (o gap é real, não de leitura).
    for (const id of gapArchetypes) {
      expect(sample.benchmarks.some((b) => b.archetype === id)).toBe(false);
    }
    // ...e não existe exceção de escassez que os dispense.
    for (const id of gapArchetypes) {
      expect((sample.marketScarcityExceptions || []).some((e) => e.archetype === id)).toBe(false);
    }
  });

  it('a amostra do fitness não fabrica novelty para sustentar cobertura', () => {
    const sample = readJson('config/benchmarks/fitness.json');
    const totalFindings = sample.benchmarks.reduce(
      (acc, b) => acc + Object.values(b.novelty || {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0),
      0,
    );
    expect(totalFindings).toBe(0);
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
    expect(fitness.holdoutState).not.toBe('HOLDOUT_PASS');
    expect(fitness.findingEvidence).toBeDefined();
  });

  it('o relatório declara cobertura com numerador/denominador/escopo (§46)', () => {
    const fitness = BENCHMARK.verticals.find((v) => v.vertical === 'fitness');
    const statement = fitness.coverageStatement;
    expect(statement).toBeDefined();
    expect(statement.scope).toContain('fitness');
    expect(statement.inventoryVersion).toBeTruthy();
    expect(statement.sampleStatus).toBe(fitness.status);
    expect(statement.marketCertification).toBe('MARKET_SAMPLE_NOT_CERTIFIED');
  });
});
