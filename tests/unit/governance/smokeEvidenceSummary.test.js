'use strict';

/**
 * Regressão do shape canônico de `qa/smoke-evidence.json` (P1-13).
 *
 * O fan-in existia apenas como `node -e` embutido no script destrutivo de stack. Aqui a
 * definição fica provada: seis chaves fixas, status obrigatório, e `pass` exige TODOS os
 * seis — um `unknown`/`fail` derruba o agregado (nunca verde por omissão).
 */

const {
  CHAVES,
  montarResumoSmoke,
  todosPassaram,
} = require('../../../scripts/smoke/lib/smoke-evidence-summary');

describe('montarResumoSmoke', () => {
  test('emite sempre as seis chaves, mesmo com entrada parcial', () => {
    const r = montarResumoSmoke({ smokes: { l01: { status: 'pass' } } });
    expect(Object.keys(r.smokes)).toEqual([...CHAVES]);
    expect(r.smokes.l01.status).toBe('pass');
    // Smoke não executado NÃO vira pass silencioso.
    expect(r.smokes.l02.status).toBe('unknown');
    expect(r.smokes.l06.status).toBe('unknown');
  });

  test('status ausente ou vazio é `unknown`, nunca vazio', () => {
    const r = montarResumoSmoke({ smokes: { l03: { status: '   ' }, l04: {} } });
    expect(r.smokes.l03.status).toBe('unknown');
    expect(r.smokes.l04.status).toBe('unknown');
  });

  test('evidência não-objeto é descartada (nada de lixo no relatório)', () => {
    const r = montarResumoSmoke({ smokes: { l05: { status: 'pass', evidence: 'texto' } } });
    expect(r.smokes.l05.evidence).toBeNull();
  });

  test('generatedAt é ISO e vem da entrada quando informado', () => {
    const r = montarResumoSmoke({ geradoEm: '2026-10-17T21:30:00.000Z', smokes: {} });
    expect(r.generatedAt).toBe('2026-10-17T21:30:00.000Z');
    expect(Number.isNaN(Date.parse(montarResumoSmoke({ smokes: {} }).generatedAt))).toBe(false);
  });
});

describe('todosPassaram', () => {
  test('verdadeiro apenas quando os SEIS estão em pass', () => {
    const cheio = Object.fromEntries(CHAVES.map((c) => [c, { status: 'pass' }]));
    expect(todosPassaram(montarResumoSmoke({ smokes: cheio }))).toBe(true);
  });

  test('um único fail/unknown derruba (nunca verde por omissão)', () => {
    const comFalha = Object.fromEntries(CHAVES.map((c) => [c, { status: 'pass' }]));
    comFalha.l04 = { status: 'fail' };
    expect(todosPassaram(montarResumoSmoke({ smokes: comFalha }))).toBe(false);

    const semUm = Object.fromEntries(CHAVES.filter((c) => c !== 'l06').map((c) => [c, { status: 'pass' }]));
    expect(todosPassaram(montarResumoSmoke({ smokes: semUm }))).toBe(false);
  });
});
