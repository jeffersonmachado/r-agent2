'use strict';

/**
 * Detector de marcadores de pendência (`TODO`/`FIXME`) nos docs operacionais.
 *
 * Defeito real: o padrão era `TODO|FIXME` SEM fronteira de palavra. Ao registrar
 * no `AGENTS.md` que o backlog de camadas está "TODOS na classe engine/", o gate
 * `validate:operational-rules` passou a FALHAR — acusando a palavra portuguesa
 * **TODOS** ("todos" = "all") como se fosse um marcador de pendência não
 * resolvida. Isso é um falso positivo que bloqueia o gate agregado por causa de
 * uma palavra legítima da documentação.
 *
 * A correção é de PRECISÃO, não de afrouxamento: `\bTODO\b`/`\bFIXME\b` continuam
 * detectando os marcadores reais (provado abaixo, nos dois sentidos).
 */

const { hasPendingMarker } = require('../../../scripts/governance/validate-operational-rules');

describe('marcadores de pendência — os marcadores REAIS continuam sendo detectados', () => {
  const VIOLATIONS = [
    'TODO: implementar o handler',
    '- TODO resolver isso antes do release',
    'FIXME: race condition conhecida',
    'texto antes FIXME texto depois',
  ];

  test.each(VIOLATIONS)('detecta: %s', (text) => {
    expect(hasPendingMarker(text)).toBe(true);
  });
});

describe('marcadores de pendência — palavras que apenas COMEÇAM com o marcador', () => {
  const ALLOWED = [
    // O caso real: texto português legítimo que derrubou o gate.
    'Estado medido: 118 hard errors — TODOS na classe engine/ (pureza)',
    'TODOS os gates passaram',
    'TODOS_OS_TESTES',
    'fixme em minúsculas não é marcador',
    'todo em minúsculas também não',
    'sem marcadores aqui',
  ];

  test.each(ALLOWED)('não acusa: %s', (text) => {
    expect(hasPendingMarker(text)).toBe(false);
  });

  test('texto vazio nunca é violação', () => {
    expect(hasPendingMarker('')).toBe(false);
    expect(hasPendingMarker(undefined)).toBe(false);
    expect(hasPendingMarker(null)).toBe(false);
  });
});
