'use strict';

/**
 * Não-vacuidade do gate de evidência de runtime do Ask AI.
 *
 * Cada modo de falha que existiu de verdade tem teste aqui: evidência ausente,
 * evidência PASS porém velha (20/09 provando um copiloto que não respondia em
 * 08/10), evidência sem o check de geração, e check de geração reprovado.
 */

const {
  GENERATION_CHECK_ID,
  evaluateRuntimeEvidence,
} = require('../../scripts/governance/lib/askAiRuntimeEvidence');

const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const NOW = Date.parse('2026-10-08T12:00:00.000Z');

function evidence(overrides = {}) {
  return {
    generatedAt: new Date(NOW - 3600 * 1000).toISOString(),
    status: 'PASS',
    checks: [
      { id: 'first_turn', status: 'PASS', detail: { status: 200 } },
      { id: GENERATION_CHECK_ID, status: 'PASS', detail: { confidence: 'fully_grounded' } },
    ],
    ...overrides,
  };
}

describe('askAiRuntimeEvidence — evidência fresca e com geração provada', () => {
  test('evidência fresca, PASS e com geração provada é aprovada', () => {
    const result = evaluateRuntimeEvidence({ evidence: evidence(), maxAgeMs: MAX_AGE_MS, now: NOW });
    expect(result.violations).toEqual([]);
    expect(result.generationCheck.id).toBe(GENERATION_CHECK_ID);
  });

  test('evidência ausente reprova (sem medição não há prova)', () => {
    const result = evaluateRuntimeEvidence({ evidence: null, readError: 'ENOENT', maxAgeMs: MAX_AGE_MS, now: NOW });
    expect(result.violations.map((v) => v.code)).toEqual(['ASK_AI_RUNTIME_EVIDENCE_MISSING']);
  });

  test('evidência PASS porém VELHA reprova (o caso de 20/09 em 08/10)', () => {
    const old = evidence({ generatedAt: '2026-09-20T02:42:17.865Z' });
    const result = evaluateRuntimeEvidence({ evidence: old, maxAgeMs: MAX_AGE_MS, now: NOW });
    expect(result.violations.map((v) => v.code)).toEqual(['ASK_AI_RUNTIME_EVIDENCE_STALE']);
  });

  test('evidência sem o check de geração reprova (nada prova que houve síntese)', () => {
    const withoutCheck = evidence({ checks: [{ id: 'first_turn', status: 'PASS' }] });
    const result = evaluateRuntimeEvidence({ evidence: withoutCheck, maxAgeMs: MAX_AGE_MS, now: NOW });
    expect(result.violations.map((v) => v.code)).toEqual(['ASK_AI_RUNTIME_EVIDENCE_WITHOUT_GENERATION_CHECK']);
  });

  test('check de geração reprovado reprova o gate', () => {
    const degraded = evidence({
      checks: [
        { id: 'first_turn', status: 'PASS' },
        { id: GENERATION_CHECK_ID, status: 'FAIL', detail: { reason: 'degradation_marker:…' } },
      ],
    });
    const result = evaluateRuntimeEvidence({ evidence: degraded, maxAgeMs: MAX_AGE_MS, now: NOW });
    expect(result.violations.map((v) => v.code)).toEqual(['ASK_AI_RUNTIME_EVIDENCE_GENERATION_FAILED']);
  });

  test('evidência com status FAIL reprova e lista os checks falhos', () => {
    const failed = evidence({ status: 'FAIL', checks: [{ id: GENERATION_CHECK_ID, status: 'FAIL' }] });
    const result = evaluateRuntimeEvidence({ evidence: failed, maxAgeMs: MAX_AGE_MS, now: NOW });
    expect(result.violations.map((v) => v.code)).toContain('ASK_AI_RUNTIME_EVIDENCE_FAILED');
  });

  test('evidência sem data válida reprova (idade não verificável)', () => {
    const undated = evidence({ generatedAt: undefined });
    const result = evaluateRuntimeEvidence({ evidence: undated, maxAgeMs: MAX_AGE_MS, now: NOW });
    expect(result.violations.map((v) => v.code)).toContain('ASK_AI_RUNTIME_EVIDENCE_UNDATED');
  });
});
