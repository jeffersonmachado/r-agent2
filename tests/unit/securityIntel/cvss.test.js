'use strict';

/**
 * Testes do cálculo de CVSS v3 base.
 *
 * Provas: valores de REFERÊNCIA conhecidos (Log4Shell 9.8, Heartbleed-like 7.5,
 * scope-changed 10.0) e — o mais importante — vetor inválido devolve `null` em
 * vez de um score inventado (score inventado é decisão de gate inventada).
 */

const {
  parseVector,
  baseScore,
  severityFromScore,
  evaluateVector,
  roundUp,
} = require('../../../engine/securityIntel/cvss');

describe('cvss — parsing', () => {
  test('parseia vetor v3.1 e v3.0', () => {
    expect(parseVector('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toMatchObject({ version: '3.1' });
    expect(parseVector('CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toMatchObject({ version: '3.0' });
  });

  test('vetor inválido ou incompleto é rejeitado', () => {
    expect(parseVector('nao-e-vetor')).toBeNull();
    expect(parseVector('CVSS:3.1/AV:N/AC:L')).toBeNull();
    expect(parseVector('CVSS:2.0/AV:N/AC:L/Au:N/C:P/I:P/A:P')).toBeNull();
    expect(parseVector(null)).toBeNull();
    expect(parseVector(undefined)).toBeNull();
  });

  test('scope inválido é rejeitado', () => {
    expect(parseVector('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:X/C:H/I:H/A:H')).toBeNull();
  });
});

describe('cvss — score base (valores de referência)', () => {
  test('9.8 — AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H (Log4Shell)', () => {
    expect(baseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBe(9.8);
    expect(severityFromScore(9.8)).toBe('CRITICAL');
  });

  test('7.5 — AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N', () => {
    expect(baseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N')).toBe(7.5);
    expect(severityFromScore(7.5)).toBe('HIGH');
  });

  test('5.3 — AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:N/A:N (caso real GHSA-4r4m-qw57-chr8)', () => {
    expect(baseScore('CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:N/A:N')).toBe(5.3);
    expect(severityFromScore(5.3)).toBe('MEDIUM');
  });

  test('5.5 — AV:L/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:H', () => {
    expect(baseScore('CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:H')).toBe(5.5);
  });

  test('10.0 — escopo alterado (S:C) com impacto total', () => {
    expect(baseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H')).toBe(10);
    expect(severityFromScore(10)).toBe('CRITICAL');
  });

  test('0.0 — sem impacto em confidencialidade, integridade e disponibilidade', () => {
    expect(baseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N')).toBe(0);
  });

  test('vetor inválido devolve null (não inventa score que decidiria um gate)', () => {
    expect(baseScore('CVSS:3.1/AV:N/AC:L')).toBeNull();
    expect(baseScore('qualquer-coisa')).toBeNull();
    expect(evaluateVector('nao-e-vetor')).toBeNull();
  });

  test('evaluateVector devolve score e severidade coerentes', () => {
    expect(evaluateVector('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'))
      .toEqual({ score: 9.8, severity: 'CRITICAL' });
  });

  test('arredondamento é para CIMA em 1 casa (norma do FIRST)', () => {
    expect(roundUp(4.02)).toBe(4.1);
    expect(roundUp(5.0)).toBe(5);
    expect(roundUp(0)).toBe(0);
  });

  test('faixas de severidade cobrem as bordas', () => {
    expect(severityFromScore(9.0)).toBe('CRITICAL');
    expect(severityFromScore(8.9)).toBe('HIGH');
    expect(severityFromScore(7.0)).toBe('HIGH');
    expect(severityFromScore(6.9)).toBe('MEDIUM');
    expect(severityFromScore(4.0)).toBe('MEDIUM');
    expect(severityFromScore(3.9)).toBe('LOW');
    expect(severityFromScore(0.1)).toBe('LOW');
    expect(severityFromScore(0)).toBe('INFORMATIONAL');
    expect(severityFromScore(null)).toBeNull();
  });
});
