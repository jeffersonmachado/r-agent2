'use strict';

/**
 * FRESCOR DO SELO V2 — o selo autoriza UM código, não "o release" em abstrato.
 *
 * DEFEITO REAL (2026-09-30): `scripts/release-package.sh` gerava o ZIP sem checar o selo do
 * Engineering Router V2. Um selo NO_GO, de outro source ou de dias antes autorizava o pacote por
 * omissão. Estas provas fixam cada forma de "verde emprestado" que passa a ser recusada.
 */

const { evaluateSealFreshness, CODES } = require('../../../scripts/governance/lib/v2SealFreshness');

const NOW = Date.parse('2026-09-30T18:00:00.000Z');
const FP = 'a'.repeat(64);
const OTHER_FP = 'b'.repeat(64);
const RUN = 'rap-governed-20260930011544805-3f8876d9';

function seal(overrides = {}) {
  return {
    artifactType: 'engineering-router-v2-seal-execution',
    status: 'GO',
    generatedAt: '2026-09-30T17:30:00.000Z',
    // IDENTIDADE DO CÓDIGO CERTIFICADO (conteúdo dos arquivos-fonte) — é ESTE o campo comparado com
    // o source atual. A identidade do RUN governado vive em `runSourceFingerprint`/`runId`.
    sourceFingerprint: FP,
    runSourceFingerprint: OTHER_FP,
    runId: RUN,
    ...overrides,
  };
}

describe('v2 seal freshness — o selo vale para ESTE source, ESTE run e por tempo limitado', () => {
  test('selo GO deste source e deste run, dentro da janela → autoriza', () => {
    const result = evaluateSealFreshness({ seal: seal(), sourceFingerprint: FP, lineage: { runId: RUN }, now: NOW });
    expect(result.ok).toBe(true);
    expect(result.codes).toEqual([]);
    expect(result.ageMs).toBe(30 * 60 * 1000);
    expect(result.status).toBe('GO');
  });

  test('SEAL_NOT_GO: selo NO_GO não autoriza nada, mesmo fresco e do source certo', () => {
    const result = evaluateSealFreshness({ seal: seal({ status: 'NO_GO' }), sourceFingerprint: FP, lineage: { runId: RUN }, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.codes).toContain(CODES.SEAL_NOT_GO);
  });

  test('SEAL_NO_SOURCE_BINDING: selo sem sourceFingerprint autorizaria qualquer código', () => {
    const result = evaluateSealFreshness({ seal: seal({ sourceFingerprint: null }), sourceFingerprint: FP, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.codes).toContain(CODES.SEAL_NO_SOURCE_BINDING);
  });

  test('STALE_SEAL_SOURCE: código mudou depois de selado → selo não é deste código', () => {
    // Aqui o selo carrega a identidade do RUN (não a do conteúdo) — é exatamente o defeito de
    // contrato medido: dois conceitos com o mesmo nome.
    const result = evaluateSealFreshness({ seal: seal({ sourceFingerprint: OTHER_FP }), sourceFingerprint: FP, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.codes).toContain(CODES.STALE_SEAL_SOURCE);
    expect(result.violations[0].detail).toContain('código mudou depois de selado');
  });

  test('o selo separa identidade do CONTEÚDO da identidade do RUN (runSourceFingerprint não confunde o frescor)', () => {
    const result = evaluateSealFreshness({ seal: seal(), sourceFingerprint: FP, lineage: { runId: RUN }, now: NOW });
    expect(result.ok).toBe(true);
    expect(result.sealFingerprint).toBe(FP);
  });

  test('SEAL_FOREIGN_RUN: selo de OUTRO run governado não é prova deste', () => {
    const result = evaluateSealFreshness({
      seal: seal({ runId: 'rap-governed-00000000000000000-00000000' }),
      sourceFingerprint: FP,
      lineage: { runId: RUN },
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.codes).toContain(CODES.SEAL_FOREIGN_RUN);
  });

  test('STALE_SEAL_AGE: selo dentro do source mas velho demais é evidência vencida', () => {
    const result = evaluateSealFreshness({
      seal: seal({ generatedAt: '2026-09-28T17:30:00.000Z' }),
      sourceFingerprint: FP,
      lineage: { runId: RUN },
      now: NOW,
      maxAgeMs: 24 * 60 * 60 * 1000,
    });
    expect(result.ok).toBe(false);
    expect(result.codes).toContain(CODES.STALE_SEAL_AGE);
  });

  test('SEAL_INVALID_TIMESTAMP: sem carimbo válido o frescor não é presumível', () => {
    const result = evaluateSealFreshness({ seal: seal({ generatedAt: 'ontem' }), sourceFingerprint: FP, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.codes).toContain(CODES.SEAL_INVALID_TIMESTAMP);
  });

  test('SEAL_MISSING: sem selo não há autorização (fail-closed, nunca "assume GO")', () => {
    const result = evaluateSealFreshness({ seal: null, sourceFingerprint: FP, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.codes).toEqual([CODES.SEAL_MISSING]);
    expect(result.ageMs).toBeNull();
  });

  test('acúmulo de problemas é DECLARADO por inteiro (não para no primeiro)', () => {
    const result = evaluateSealFreshness({
      seal: seal({ status: 'NO_GO', sourceFingerprint: OTHER_FP, generatedAt: '2026-09-01T00:00:00.000Z' }),
      sourceFingerprint: FP,
      lineage: { runId: RUN },
      now: NOW,
    });
    expect(result.codes).toEqual(expect.arrayContaining([CODES.SEAL_NOT_GO, CODES.STALE_SEAL_SOURCE, CODES.STALE_SEAL_AGE]));
  });
});
