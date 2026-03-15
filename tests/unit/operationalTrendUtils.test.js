'use strict';

const utils = require('../../frontend/src/utils/operationalTrend.cjs');

describe('operationalTrend utils', () => {
  test('computeOperationalTrend retorna sem historico quando score anterior ausente', () => {
    const out = utils.computeOperationalTrend(70, null);
    expect(out).toEqual(expect.objectContaining({
      label: 'sem historico',
      detail: '-',
      delta: null,
      current: 70,
      previous: null,
    }));
  });

  test('computeOperationalTrend retorna alta com delta positivo arredondado', () => {
    const out = utils.computeOperationalTrend(74.4, 62.1);
    expect(out).toEqual(expect.objectContaining({
      label: 'alta',
      detail: '(+12)',
      delta: 12,
      current: 74.4,
      previous: 62.1,
    }));
  });

  test('computeOperationalTrend retorna estavel com delta zero', () => {
    const out = utils.computeOperationalTrend(70.2, 70.1);
    expect(out).toEqual(expect.objectContaining({
      label: 'estavel',
      detail: '(0)',
      delta: 0,
    }));
  });

  test('buildOperationalTrendTooltip inclui formula e valores quando ha historico', () => {
    const text = utils.buildOperationalTrendTooltip(74, 62);
    expect(text).toContain('Formula: tendencia = score_atual - score_anterior.');
    expect(text).toContain('score_atual=74');
    expect(text).toContain('score_anterior=62');
    expect(text).toContain('delta=12');
  });

  test('buildOperationalTrendTooltip inclui fallback de historico insuficiente', () => {
    const text = utils.buildOperationalTrendTooltip(undefined, 62);
    expect(text).toContain('Formula: tendencia = score_atual - score_anterior.');
    expect(text).toContain('Historico insuficiente para calcular delta.');
  });
});
