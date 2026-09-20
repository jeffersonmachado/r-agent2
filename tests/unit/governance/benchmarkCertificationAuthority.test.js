'use strict';

/**
 * Casos adversariais da AUTORIDADE ÚNICA de certificação de benchmarks.
 *
 * O defeito que esta autoridade elimina: três gates downstream definiam
 * "vertical certificada" pelo campo DECLARADO `sample.claim` — que nenhum
 * produtor grava (e o design proíbe gravar). Resultado medido em 2026-09-19:
 * certificação DERIVADA pelo engine (MARKET_SAMPLE_CERTIFIED para fitness) e
 * gates PASSando com certifiedSamples=0 / persistedFindingsChecked=0 — um PASS
 * vacuoso, pior que um FAIL, porque finge auditoria que nunca aconteceu.
 *
 * A única fonte legítima é o relatório canônico do engine
 * (`reports/benchmark-sufficiency-report.json`). E ela é FAIL-CLOSED:
 * relatório ausente, malformado, velho ou internamente inconsistente é ERRO
 * explícito — nunca uma lista vazia silenciosa (que recriaria o PASS vacuoso).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ERROR_CODES,
  CERTIFIED_STATE,
  MARKET_CERTIFICATION_CERTIFIED,
  SUFFICIENCY_REPORT_PATH,
  BenchmarkCertificationAuthorityError,
  deriveCertifiedVerticals,
  loadCertificationAuthority,
} = require('../../../scripts/governance/lib/benchmarkCertificationAuthority');

function entry(vertical, overrides = {}) {
  return {
    vertical,
    status: CERTIFIED_STATE,
    certifiable: true,
    coverageStatement: { marketCertification: MARKET_CERTIFICATION_CERTIFIED },
    ...overrides,
  };
}

function report(verticals, extra = {}) {
  const derived = verticals
    .filter((v) => v.certifiable === true
      && v.status === CERTIFIED_STATE
      && v.coverageStatement && v.coverageStatement.marketCertification === MARKET_CERTIFICATION_CERTIFIED)
    .map((v) => v.vertical)
    .sort();
  return {
    reportType: 'benchmark-sufficiency',
    generatedAt: new Date().toISOString(),
    commit: 'abc123',
    status: 'PASS',
    sufficientVerticals: derived,
    sampleSufficientVerticals: derived,
    verticalsAnalysed: verticals.length,
    verticals,
    ...extra,
  };
}

function writeTempReport(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-authority-'));
  const reportPath = path.join(dir, 'benchmark-sufficiency-report.json');
  fs.writeFileSync(reportPath, typeof payload === 'string' ? payload : JSON.stringify(payload), 'utf8');
  return reportPath;
}

describe('deriveCertifiedVerticals — certificação DERIVADA pelo engine', () => {
  it('resolve a vertical certificada pelas TRÊS marcas do engine', () => {
    const certified = deriveCertifiedVerticals(report([
      entry('fitness'),
      entry('beauty', { status: 'SAMPLE_NOT_RESEARCHED', certifiable: false, coverageStatement: { marketCertification: 'MARKET_SAMPLE_NOT_CERTIFIED' } }),
    ]));
    expect(certified).toEqual(['fitness']);
  });

  it('exige as três marcas juntas: marca parcial NÃO certifica', () => {
    const partials = [
      entry('a', { certifiable: false }),
      entry('b', { status: 'SAMPLE_NOT_SATURATED' }),
      entry('c', { coverageStatement: { marketCertification: 'MARKET_SAMPLE_NOT_CERTIFIED' } }),
      entry('d', { coverageStatement: null }),
    ];
    expect(deriveCertifiedVerticals(report(partials))).toEqual([]);
  });

  it('não lê claim nenhum: a certificação vem do engine, nunca da declaração', () => {
    const certified = deriveCertifiedVerticals(report([
      { ...entry('fitness'), declaredClaim: null },
      { ...entry('bakery', { status: 'SAMPLE_NOT_RESEARCHED', certifiable: false, coverageStatement: { marketCertification: 'MARKET_SAMPLE_NOT_CERTIFIED' } }), declaredClaim: CERTIFIED_STATE },
    ]));
    expect(certified).toEqual(['fitness']);
  });

  it('REJEITA relatório cujos agregados top-level contradizem a derivação (fail-closed)', () => {
    const inconsistent = report([entry('fitness')], { sufficientVerticals: ['fitness', 'beauty'] });
    expect(() => deriveCertifiedVerticals(inconsistent)).toThrow(BenchmarkCertificationAuthorityError);
    try {
      deriveCertifiedVerticals(inconsistent);
    } catch (error) {
      expect(error.code).toBe(ERROR_CODES.REPORT_INCONSISTENT);
    }
  });

  it('REJEITA relatório sem a lista de verticais', () => {
    expect(() => deriveCertifiedVerticals({ generatedAt: new Date().toISOString() })).toThrow(BenchmarkCertificationAuthorityError);
  });
});

describe('loadCertificationAuthority — fail-closed, nunca lista vazia silenciosa', () => {
  it('relatório AUSENTE é erro explícito com instrução (não conjunto vazio)', () => {
    const missing = path.join(os.tmpdir(), `authority-missing-${Date.now()}.json`);
    try {
      loadCertificationAuthority({ reportPath: missing });
      throw new Error('deveria ter falhado');
    } catch (error) {
      expect(error).toBeInstanceOf(BenchmarkCertificationAuthorityError);
      expect(error.code).toBe(ERROR_CODES.REPORT_MISSING);
      expect(error.message).toMatch(/validate:benchmark-sufficiency/);
    }
  });

  it('relatório MALFORMADO é erro explícito', () => {
    const reportPath = writeTempReport('{ nao-e-json');
    try {
      loadCertificationAuthority({ reportPath });
      throw new Error('deveria ter falhado');
    } catch (error) {
      expect(error.code).toBe(ERROR_CODES.REPORT_MALFORMED);
    }
  });

  it('relatório STALE é erro explícito: evidência vencida não certifica', () => {
    const stale = report([entry('fitness')], { generatedAt: '2020-01-01T00:00:00.000Z' });
    const reportPath = writeTempReport(stale);
    try {
      loadCertificationAuthority({ reportPath, now: Date.now() });
      throw new Error('deveria ter falhado');
    } catch (error) {
      expect(error.code).toBe(ERROR_CODES.REPORT_STALE);
    }
  });

  it('relatório sem generatedAt é erro explícito (freshness não se assume)', () => {
    const noDate = report([entry('fitness')]);
    delete noDate.generatedAt;
    const reportPath = writeTempReport(noDate);
    try {
      loadCertificationAuthority({ reportPath });
      throw new Error('deveria ter falhado');
    } catch (error) {
      expect(error.code).toBe(ERROR_CODES.REPORT_MALFORMED);
    }
  });

  it('relatório fresco resolve o conjunto certificado com proveniência', () => {
    const reportPath = writeTempReport(report([entry('fitness')]));
    const authority = loadCertificationAuthority({ reportPath });
    expect(authority.certifiedVerticals).toEqual(['fitness']);
    expect(authority.generatedAt).toBeTruthy();
    expect(authority.reportPath).toBe(reportPath);
  });

  it('honra o override de idade máxima (mesma política de frescor das waves)', () => {
    const recent = report([entry('fitness')], { generatedAt: new Date(Date.now() - 60_000).toISOString() });
    const reportPath = writeTempReport(recent);
    expect(() => loadCertificationAuthority({ reportPath, maxAgeMs: 1_000 })).toThrow(BenchmarkCertificationAuthorityError);
    expect(loadCertificationAuthority({ reportPath, maxAgeMs: 3_600_000 }).certifiedVerticals).toEqual(['fitness']);
  });
});

describe('relatório REAL do repositório (estado forense de 2026-09-19)', () => {
  it('o engine certifica fitness e a autoridade a resolve — certifiedVerticals nunca é 0 enquanto o engine certificar', () => {
    const authority = loadCertificationAuthority({ reportPath: SUFFICIENCY_REPORT_PATH });
    expect(authority.certifiedVerticals).toContain('fitness');
    expect(authority.certifiedVerticals.length).toBeGreaterThanOrEqual(1);
    // Coerência com o agregado publicado pelo próprio relatório.
    const raw = JSON.parse(fs.readFileSync(SUFFICIENCY_REPORT_PATH, 'utf8'));
    expect([...authority.certifiedVerticals].sort()).toEqual([...raw.sufficientVerticals].sort());
  });
});
