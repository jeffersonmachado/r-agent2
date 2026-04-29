'use strict';

const OPERATIONAL_TREND_FORMULA_TEXT = 'Fórmula: tendência = score_atual - score_anterior.';
const OPERATIONAL_TREND_NO_HISTORY_TEXT = 'Histórico insuficiente para calcular delta.';
const OPERATIONAL_STATE_LABELS = Object.freeze({
  sectionTitle: 'Estado operacional',
  health: 'Saúde',
  score: 'Score',
  openInsights: 'Insights abertos',
  openRecommendations: 'Recomendações abertas',
  trend: 'Tendência',
  noCriticalAlerts: 'Sem alertas críticos no momento.',
  updatedAt: 'atualizado em:',
});

function toFiniteOrNull(value) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function computeOperationalTrend(currentScore, previousScore) {
  const current = toFiniteOrNull(currentScore);
  const previous = toFiniteOrNull(previousScore);

  if (current == null || previous == null) {
    return {
      label: 'sem histórico',
      detail: '-',
      delta: null,
      current,
      previous,
    };
  }

  const delta = Math.round(current - previous);
  if (Math.abs(delta) < 1) {
    return {
      label: 'estável',
      detail: '(0)',
      delta: 0,
      current,
      previous,
    };
  }

  if (delta > 0) {
    return {
      label: 'alta',
      detail: `(+${delta})`,
      delta,
      current,
      previous,
    };
  }

  return {
    label: 'queda',
    detail: `(${delta})`,
    delta,
    current,
    previous,
  };
}

function buildOperationalTrendTooltip(currentScore, previousScore) {
  const trend = computeOperationalTrend(currentScore, previousScore);
  if (!Number.isFinite(trend.current) || !Number.isFinite(trend.previous) || trend.delta == null) {
    return `${OPERATIONAL_TREND_FORMULA_TEXT} ${OPERATIONAL_TREND_NO_HISTORY_TEXT}`;
  }
  return `${OPERATIONAL_TREND_FORMULA_TEXT} score_atual=${trend.current}, score_anterior=${trend.previous}, delta=${trend.delta}.`;
}

module.exports = {
  OPERATIONAL_TREND_FORMULA_TEXT,
  OPERATIONAL_TREND_NO_HISTORY_TEXT,
  OPERATIONAL_STATE_LABELS,
  computeOperationalTrend,
  buildOperationalTrendTooltip,
};
