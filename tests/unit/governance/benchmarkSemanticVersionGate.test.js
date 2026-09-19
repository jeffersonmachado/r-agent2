'use strict';

/**
 * Casos adversariais do gate CERTIFIED_SAMPLE_SEMANTIC_VERSION_CURRENT.
 *
 * O gate só vale se ele REPROVAR. Uma amostra que declara certificação com
 * semântica de outro pipeline é uma afirmação falsa: ela diz "esta vertical foi
 * medida" quando o programa que mediu não é mais o programa atual. Estes testes
 * provam que o gate acusa.
 */

const {
  CODES,
  STATUS,
  CERTIFICATION_CLAIM,
  evaluateSample,
} = require('../../../scripts/governance/validate-benchmark-semantic-version');
const {
  getSemanticPipelineVersion,
} = require('../../../api/services/benchmark/semantic/semanticPipelineVersion');

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

describe('gate CERTIFIED_SAMPLE_SEMANTIC_VERSION_CURRENT', () => {
  it('REPROVA amostra certificada SEM versão do pipeline', () => {
    const result = evaluateSample(baseSample({ claim: CERTIFICATION_CLAIM }), CURRENT);
    expect(result.status).toBe(STATUS.STALE);
    const codes = result.violations.map((v) => v.code);
    expect(codes).toContain(CODES.VERSION_MISSING);
    expect(codes).toContain(CODES.REPROCESS_RUN_MISSING);
  });

  it('REPROVA amostra certificada com versão de OUTRO pipeline (STALE_SEMANTICS)', () => {
    const result = evaluateSample(baseSample({
      claim: CERTIFICATION_CLAIM,
      semanticPipelineVersion: OTHER,
      semanticReprocessRunId: 'rap-governed-x',
    }), CURRENT);
    expect(result.status).toBe(STATUS.STALE);
    expect(result.violations.map((v) => v.code)).toEqual([CODES.VERSION_STALE]);
    expect(result.recordedVersion).toBe(OTHER);
    expect(result.expectedVersion).toBe(CURRENT);
  });

  it('REPROVA formato de versão desconhecido (timestamp não é versão)', () => {
    const result = evaluateSample(baseSample({
      claim: CERTIFICATION_CLAIM,
      semanticPipelineVersion: '2026-09-19T00:00:00Z',
      semanticReprocessRunId: 'rap-governed-x',
    }), CURRENT);
    expect(result.status).toBe(STATUS.STALE);
    expect(result.violations.map((v) => v.code)).toEqual([CODES.VERSION_FORMAT_UNKNOWN]);
  });

  it('APROVA amostra certificada com a versão atual e run de reprocessamento', () => {
    const result = evaluateSample(baseSample({
      claim: CERTIFICATION_CLAIM,
      semanticPipelineVersion: CURRENT,
      semanticReprocessRunId: 'rap-governed-20260919-x',
    }), CURRENT);
    expect(result.status).toBe(STATUS.CERTIFIED_CURRENT);
    expect(result.violations).toEqual([]);
  });

  it('exige run de reprocessamento explícito na certificação', () => {
    const result = evaluateSample(baseSample({
      claim: CERTIFICATION_CLAIM,
      semanticPipelineVersion: CURRENT,
      semanticReprocessRunId: '   ',
    }), CURRENT);
    expect(result.status).toBe(STATUS.STALE);
    expect(result.violations.map((v) => v.code)).toEqual([CODES.REPROCESS_RUN_MISSING]);
  });

  it('NÃO certifica nem reprova amostra que não declara claim (NOT_CERTIFIED)', () => {
    const result = evaluateSample(baseSample(), CURRENT);
    expect(result.status).toBe(STATUS.NOT_CERTIFIED);
    expect(result.claimsCertification).toBe(false);
    expect(result.violations).toEqual([]);
  });

  it('não aceita claim diferente de SAMPLE_SUFFICIENT como certificação', () => {
    const result = evaluateSample(baseSample({ claim: 'SAMPLE_NOT_SATURATED' }), CURRENT);
    expect(result.status).toBe(STATUS.NOT_CERTIFIED);
    expect(result.violations).toEqual([]);
  });

  it('reporta amostra malformada (sem vertical) como violação, não como silêncio', () => {
    const result = evaluateSample({ claim: CERTIFICATION_CLAIM }, CURRENT);
    expect(result.status).toBe(STATUS.MALFORMED);
    expect(result.violations.length).toBeGreaterThan(0);
  });
});
