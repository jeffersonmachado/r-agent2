'use strict';

/**
 * Regressao do defeito medido em 2026-09-30: a prova de CDR do smoke L-03
 * aceitava QUALQUER registro com o mesmo `dst` dentro da janela de 5 minutos.
 * Consequencias opostas, ambas erradas:
 *  - falso POSITIVO: evidencia gerada 23:28:10 para chamada originada 23:28:04
 *    reportou o CDR de 23:27:09 (de OUTRA execucao), provando nada sobre a
 *    chamada atual;
 *  - falso NEGATIVO: quando so havia CDR antigo fora da janela, cdrFound=false.
 * O sinal `cdr` da prova PBX prod-like consome esse campo, entao a correlacao
 * precisa ser ancorada no instante do originate.
 */

const { selectCorrelatedCdr } = require('../../../scripts/test-pbx-voice-tts-asr-smoke');

const EXT = '9191';
const ORIGINATED_AT = Date.parse('2026-09-30T23:44:18.000Z');
const TOLERANCE = 5000;

function cdr(dst, calldate, overrides = {}) {
  return {
    dst,
    calldate,
    uniqueid: overrides.uniqueid || 'unique-default',
    disposition: overrides.disposition || 'ANSWERED',
  };
}

describe('selectCorrelatedCdr — prova de CDR ancorada no originate', () => {
  test('REGRESSAO: CDR anterior ao originate nao satisfaz a prova', () => {
    const antigo = cdr(EXT, '2026-09-30T23:27:09.353Z', { uniqueid: '1790810828.17' });
    expect(selectCorrelatedCdr([antigo], { extension: EXT, originatedAtMs: ORIGINATED_AT, toleranceMs: TOLERANCE })).toBeNull();
  });

  test('CDR gerado apos o originate e aceito', () => {
    const atual = cdr(EXT, '2026-09-30T23:44:19.240Z', { uniqueid: '1790811858.24' });
    const found = selectCorrelatedCdr([atual], { extension: EXT, originatedAtMs: ORIGINATED_AT, toleranceMs: TOLERANCE });
    expect(found).not.toBeNull();
    expect(found.uniqueid).toBe('1790811858.24');
    expect(found.disposition).toBe('ANSWERED');
  });

  test('entre varios elegiveis escolhe o MAIS ANTIGO (inicio da chamada atual)', () => {
    const itens = [
      cdr(EXT, '2026-09-30T23:44:19.240Z', { uniqueid: 'primeiro' }),
      cdr(EXT, '2026-09-30T23:44:19.700Z', { uniqueid: 'segundo' }),
      cdr(EXT, '2026-09-30T23:45:30.000Z', { uniqueid: 'terceiro' }),
    ];
    const found = selectCorrelatedCdr(itens, { extension: EXT, originatedAtMs: ORIGINATED_AT, toleranceMs: TOLERANCE });
    expect(found.uniqueid).toBe('primeiro');
  });

  test('CDR antigo e CDR atual na mesma lista: descarta o antigo', () => {
    const itens = [
      cdr(EXT, '2026-09-30T23:27:09.353Z', { uniqueid: 'alheio' }),
      cdr(EXT, '2026-09-30T23:44:19.240Z', { uniqueid: 'atual' }),
    ];
    const found = selectCorrelatedCdr(itens, { extension: EXT, originatedAtMs: ORIGINATED_AT, toleranceMs: TOLERANCE });
    expect(found.uniqueid).toBe('atual');
  });

  test('dst diferente e ignorado mesmo dentro da janela', () => {
    const itens = [cdr('2000', '2026-09-30T23:44:19.000Z', { uniqueid: 'outro-dst' })];
    expect(selectCorrelatedCdr(itens, { extension: EXT, originatedAtMs: ORIGINATED_AT, toleranceMs: TOLERANCE })).toBeNull();
  });

  test('tolerancia cobre o registro gravado no mesmo segundo do originate', () => {
    const mesmoSegundo = cdr(EXT, '2026-09-30T23:44:14.000Z', { uniqueid: 'limite' });
    expect(selectCorrelatedCdr([mesmoSegundo], { extension: EXT, originatedAtMs: ORIGINATED_AT, toleranceMs: TOLERANCE })).not.toBeNull();
  });

  test('calldate ausente ou invalido nao vira prova', () => {
    const itens = [
      { dst: EXT, uniqueid: 'sem-data' },
      cdr(EXT, 'not-a-date', { uniqueid: 'data-invalida' }),
    ];
    expect(selectCorrelatedCdr(itens, { extension: EXT, originatedAtMs: ORIGINATED_AT, toleranceMs: TOLERANCE })).toBeNull();
  });

  test('entrada vazia ou nao-array nao lanca', () => {
    expect(selectCorrelatedCdr([], { extension: EXT, originatedAtMs: ORIGINATED_AT })).toBeNull();
    expect(selectCorrelatedCdr(null, { extension: EXT, originatedAtMs: ORIGINATED_AT })).toBeNull();
    expect(selectCorrelatedCdr(undefined, { extension: EXT, originatedAtMs: ORIGINATED_AT })).toBeNull();
  });

  test('dst numerico comparado como string (coercao do scanner)', () => {
    const numerico = { dst: 9191, calldate: '2026-09-30T23:44:19.240Z', uniqueid: 'num' };
    const found = selectCorrelatedCdr([numerico], { extension: EXT, originatedAtMs: ORIGINATED_AT, toleranceMs: TOLERANCE });
    expect(found).not.toBeNull();
    expect(found.uniqueid).toBe('num');
  });
});
