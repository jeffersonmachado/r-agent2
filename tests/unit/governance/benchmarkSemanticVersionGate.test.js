'use strict';

/**
 * Casos adversariais do gate CERTIFIED_SAMPLE_SEMANTIC_VERSION_CURRENT.
 *
 * O gate só vale se ele REPROVAR. Uma vertical certificada cuja amostra foi
 * produzida por outro pipeline é uma afirmação falsa: ela diz "esta vertical
 * foi medida" quando o programa que mediu não é mais o programa atual.
 *
 * CONTRATO NOVO (2026-09-19, eliminação do PASS vacuoso): quem define
 * "certificada" é a AUTORIDADE ÚNICA (relatório canônico do engine de
 * suficiência), nunca o campo declarado `sample.claim` — que nenhum produtor
 * grava e o design proíbe gravar. O parâmetro `certified` de `evaluateSample`
 * é a decisão da autoridade; `claim` no sample não move o veredito.
 */

const fs = require('fs');
const path = require('path');

const {
  CODES,
  STATUS,
  evaluateSample,
} = require('../../../scripts/governance/validate-benchmark-semantic-version');
const {
  getSemanticPipelineVersion,
} = require('../../../api/services/benchmark/semantic/semanticPipelineVersion');
const {
  loadCertificationAuthority,
} = require('../../../scripts/governance/lib/benchmarkCertificationAuthority');

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const CURRENT = getSemanticPipelineVersion().version;
const OTHER = 'sem-v1:' + 'f'.repeat(32);

function baseSample(overrides = {}) {
  return {
    vertical: 'fixture-vertical',
    sampleVersion: '2026-09-19-r2',
    inventoryVersion: 'canonical-capabilities-1.0.0',
    ...overrides,
  };
}

describe('gate CERTIFIED_SAMPLE_SEMANTIC_VERSION_CURRENT (certificação via autoridade)', () => {
  it('REPROVA vertical certificada SEM versão do pipeline — mesmo sem claim no sample', () => {
    // Este é exatamente o estado forense do fitness: o ENGINE certifica e o
    // sample não registra versão. Antes, claim ausente => NOT_CERTIFIED e o
    // gate PASSava sem olhar nada.
    const result = evaluateSample(baseSample(), CURRENT, { certified: true });
    expect(result.status).toBe(STATUS.STALE);
    const codes = result.violations.map((v) => v.code);
    expect(codes).toContain(CODES.VERSION_MISSING);
    expect(codes).toContain(CODES.REPROCESS_RUN_MISSING);
  });

  it('REPROVA vertical certificada com versão de OUTRO pipeline (STALE_SEMANTICS)', () => {
    const result = evaluateSample(baseSample({
      semanticPipelineVersion: OTHER,
      semanticReprocessRunId: 'rap-governed-x',
    }), CURRENT, { certified: true });
    expect(result.status).toBe(STATUS.STALE);
    expect(result.violations.map((v) => v.code)).toEqual([CODES.VERSION_STALE]);
    expect(result.recordedVersion).toBe(OTHER);
    expect(result.expectedVersion).toBe(CURRENT);
  });

  it('REPROVA formato de versão desconhecido (timestamp não é versão)', () => {
    const result = evaluateSample(baseSample({
      semanticPipelineVersion: '2026-09-19T00:00:00Z',
      semanticReprocessRunId: 'rap-governed-x',
    }), CURRENT, { certified: true });
    expect(result.status).toBe(STATUS.STALE);
    expect(result.violations.map((v) => v.code)).toEqual([CODES.VERSION_FORMAT_UNKNOWN]);
  });

  it('APROVA vertical certificada com a versão atual e run de reprocessamento', () => {
    const result = evaluateSample(baseSample({
      semanticPipelineVersion: CURRENT,
      semanticReprocessRunId: 'rap-governed-20260919-x',
    }), CURRENT, { certified: true });
    expect(result.status).toBe(STATUS.CERTIFIED_CURRENT);
    expect(result.violations).toEqual([]);
  });

  it('exige run de reprocessamento explícito na certificação', () => {
    const result = evaluateSample(baseSample({
      semanticPipelineVersion: CURRENT,
      semanticReprocessRunId: '   ',
    }), CURRENT, { certified: true });
    expect(result.status).toBe(STATUS.STALE);
    expect(result.violations.map((v) => v.code)).toEqual([CODES.REPROCESS_RUN_MISSING]);
  });

  it('NÃO certifica nem reprova vertical fora da autoridade (NOT_CERTIFIED, estado honesto)', () => {
    const result = evaluateSample(baseSample(), CURRENT, { certified: false });
    expect(result.status).toBe(STATUS.NOT_CERTIFIED);
    expect(result.certifiedByAuthority).toBe(false);
    expect(result.violations).toEqual([]);
  });

  it('claim declarado NÃO é fonte de certificação: sample com claim e autoridade negativa é NOT_CERTIFIED', () => {
    // Declaração não é prova. Quem declara sem o engine confirmar é pego pelo
    // gate de suficiência (SUFFICIENCY_CLAIM_UNPROVEN) — aqui, claim é inerte.
    const result = evaluateSample(baseSample({ claim: 'SAMPLE_SUFFICIENT' }), CURRENT, { certified: false });
    expect(result.status).toBe(STATUS.NOT_CERTIFIED);
    expect(result.violations).toEqual([]);
  });

  it('sem a opção certified o default é NÃO certificado (fail-closed)', () => {
    const result = evaluateSample(baseSample({ semanticPipelineVersion: CURRENT }), CURRENT);
    expect(result.status).toBe(STATUS.NOT_CERTIFIED);
    expect(result.violations).toEqual([]);
  });

  it('reporta amostra malformada (sem vertical) como violação, não como silêncio', () => {
    const result = evaluateSample({ semanticPipelineVersion: CURRENT }, CURRENT, { certified: true });
    expect(result.status).toBe(STATUS.MALFORMED);
    expect(result.violations.length).toBeGreaterThan(0);
  });
});

describe('integração com a autoridade REAL (fitness certificado, corpus regularizado em 2026-09-19)', () => {
  it('engine MARKET_SAMPLE_CERTIFIED + sample.claim undefined => o gate inclui fitness e a audita de verdade', () => {
    const authority = loadCertificationAuthority();
    expect(authority.certifiedVerticals).toContain('fitness');

    const sample = JSON.parse(
      fs.readFileSync(path.join(ROOT_DIR, 'config', 'benchmarks', 'fitness.json'), 'utf8'),
    );
    expect(sample.claim).toBeUndefined();

    const certified = authority.certifiedVerticals.includes(sample.vertical);
    const result = evaluateSample(sample, CURRENT, { certified });
    expect(result.certifiedByAuthority).toBe(true);
    expect(result.status).not.toBe(STATUS.NOT_CERTIFIED);

    // Estado GREEN real (T3/T7, 2026-09-19): o corpus fitness foi reprocessado
    // pelo pipeline semântico corrente (run fitness-semantic-2026-09-19-r2,
    // 423 achados validados; 4.449 históricos aposentados com motivo — nada
    // apagado) e o sample registra a versão via
    // `scripts/benchmark/record-semantic-version.js` contra o governance run
    // rap-governed-20260918201837632-be6d7695. Se a versão do pipeline mudar,
    // este teste volta a falhar — e DEVE: a certificação estará STALE de
    // verdade até o próximo reprocessamento governado.
    expect(result.status).toBe(STATUS.CERTIFIED_CURRENT);
    expect(result.recordedVersion).toBe(CURRENT);
    expect(result.semanticReprocessRunId).toBe('rap-governed-20260918201837632-be6d7695');
    expect(result.violations).toEqual([]);
  });
});
