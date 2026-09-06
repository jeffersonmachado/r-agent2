'use strict';

/**
 * Time Series Model — modelo estatístico aprendido da série histórica de
 * snapshots de métricas (tenant_metric_snapshots).
 *
 * Substitui o threshold fixo de 20% como detector primário de variação:
 * em vez de uma constante hardcoded, o modelo APRENDE da própria série o
 * trend (regressão linear por mínimos quadrados) e a banda de variação
 * normal (desvio-padrão dos resíduos). Um ponto é anômalo quando o resíduo
 * observado supera a banda aprendida — nunca por regra fixa.
 *
 * Funções puras, determinísticas, sem I/O. Falha de dados insuficientes é
 * sinalizada explicitamente para o chamador fazer fallback.
 */

const DEFAULT_MIN_POINTS = 4;
const DEFAULT_SIGMA_MULTIPLIER = 2;
// Banda relativa mínima: evita falso positivo quando a série é quase
// constante (sigma ~ 0) — o ponto precisa desviar ao menos esta fração do
// valor esperado para ser considerado anômalo.
const DEFAULT_MIN_RELATIVE_BAND = 0.2;

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toTimestamp(value) {
  const ts = new Date(value || 0).getTime();
  return Number.isFinite(ts) && ts > 0 ? ts : null;
}

/**
 * Normaliza a série para pontos { x, y } ordenados do mais antigo ao mais
 * recente. Aceita snapshots com value + period_end/created_at.
 */
function normalizeSeries(snapshots = []) {
  const points = [];
  for (const item of snapshots || []) {
    const data = item && typeof item.toJSON === 'function' ? item.toJSON() : item;
    if (!data || typeof data !== 'object') continue;
    const y = toFiniteNumber(data.value);
    const x = toTimestamp(data.period_end) || toTimestamp(data.created_at);
    if (y == null || x == null) continue;
    points.push({ x, y });
  }
  // Mais antigo → mais recente; empates de timestamp preservam ordem estável.
  return points.sort((a, b) => a.x - b.x);
}

/**
 * Regressão linear por mínimos quadrados sobre os pontos.
 * Retorna { slope, intercept, sigma, points } ou null se < 2 pontos.
 */
function fitLinearTrend(points = []) {
  if (!Array.isArray(points) || points.length < 2) return null;

  const n = points.length;
  // Escala x em dias a partir do primeiro ponto (estabilidade numérica).
  const x0 = points[0].x;
  const xs = points.map((p) => (p.x - x0) / 86400000);
  const ys = points.map((p) => p.y);

  const sumX = xs.reduce((acc, v) => acc + v, 0);
  const sumY = ys.reduce((acc, v) => acc + v, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;

  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
    sxx += (xs[i] - meanX) ** 2;
  }

  // Série sem variação temporal (todos os timestamps iguais): trend nulo.
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = meanY - slope * meanX;

  const residuals = ys.map((y, i) => y - (intercept + slope * xs[i]));
  const variance = residuals.reduce((acc, r) => acc + r * r, 0) / n;
  const sigma = Math.sqrt(variance);

  return { slope, intercept, sigma, points: n, x0, meanX, sxx };
}

/**
 * Detecta anomalia do ponto mais recente contra o trend aprendido dos
 * pontos anteriores.
 *
 * @param {Array} snapshots série de snapshots (qualquer ordem)
 * @returns {object|null} null quando não há histórico suficiente
 *   (o chamador deve cair no fallback de threshold). Caso contrário:
 *   { anomalous, direction, observed, expected, residual, zScore, band,
 *     sigma, changeRatio, method, historyPoints }
 */
function detectAnomaly(snapshots = [], {
  minPoints = DEFAULT_MIN_POINTS,
  sigmaMultiplier = DEFAULT_SIGMA_MULTIPLIER,
  minRelativeBand = DEFAULT_MIN_RELATIVE_BAND,
} = {}) {
  const series = normalizeSeries(snapshots);
  if (series.length < minPoints) return null;

  const latest = series[series.length - 1];
  const history = series.slice(0, -1);
  const model = fitLinearTrend(history);
  if (!model) return null;

  const expected = model.intercept + model.slope * ((latest.x - model.x0) / 86400000);
  const residual = latest.y - expected;
  const band = Math.max(sigmaMultiplier * model.sigma, minRelativeBand * Math.abs(expected));
  const zScore = model.sigma > 0 ? residual / model.sigma : (residual === 0 ? 0 : Math.sign(residual) * Infinity);

  const anomalous = Math.abs(residual) > band;
  const changeRatio = expected !== 0 ? residual / Math.abs(expected) : (residual === 0 ? 0 : Math.sign(residual));

  return {
    anomalous,
    direction: residual > 0 ? 'up' : residual < 0 ? 'down' : 'flat',
    observed: Number(latest.y.toFixed(6)),
    expected: Number(expected.toFixed(6)),
    residual: Number(residual.toFixed(6)),
    zScore: Number.isFinite(zScore) ? Number(zScore.toFixed(4)) : zScore,
    band: Number(band.toFixed(6)),
    sigma: Number(model.sigma.toFixed(6)),
    changeRatio: Number(changeRatio.toFixed(6)),
    method: 'linear_regression',
    historyPoints: history.length,
  };
}

/**
 * Projeta o valor da métrica para o fim do período corrente a partir do
 * trend aprendido de toda a série (incluindo o ponto mais recente).
 *
 * @returns {object|null} null quando não há dados suficientes; senão
 *   { projectedValue, currentValue, direction, slopePerDay, method, historyPoints }
 */
function projectToPeriodEnd(snapshots = [], { periodEnd, minPoints = 3 } = {}) {
  const series = normalizeSeries(snapshots);
  const endTs = toTimestamp(periodEnd);
  if (series.length < minPoints || endTs == null) return null;

  const model = fitLinearTrend(series);
  if (!model) return null;

  const latest = series[series.length - 1];
  if (endTs <= latest.x) return null;

  const projectedValue = model.intercept + model.slope * ((endTs - model.x0) / 86400000);
  const delta = projectedValue - latest.y;
  // Intervalo de predição da regressão no horizonte: a incerteza cresce com
  // a distância do centro da série — evita declarar tendência quando o
  // deslocamento projetado está dentro do ruído extrapolado.
  const xEnd = (endTs - model.x0) / 86400000;
  const extrapolation = model.sxx > 0 ? ((xEnd - model.meanX) ** 2) / model.sxx : 0;
  const predictionError = model.sigma * Math.sqrt(1 + (1 / model.points) + extrapolation);
  // Direção só é declarada quando o deslocamento projetado supera o erro de
  // predição no horizonte; abaixo disso a projeção é "estável".
  const direction = Math.abs(delta) <= predictionError ? 'flat' : (delta > 0 ? 'up' : 'down');

  return {
    projectedValue: Number(projectedValue.toFixed(2)),
    currentValue: Number(latest.y.toFixed(2)),
    direction,
    slopePerDay: Number(model.slope.toFixed(6)),
    sigma: Number(model.sigma.toFixed(6)),
    predictionError: Number(predictionError.toFixed(6)),
    horizon: 'period_end',
    method: 'linear_regression',
    historyPoints: series.length,
  };
}

module.exports = {
  DEFAULT_MIN_POINTS,
  DEFAULT_SIGMA_MULTIPLIER,
  DEFAULT_MIN_RELATIVE_BAND,
  normalizeSeries,
  fitLinearTrend,
  detectAnomaly,
  projectToPeriodEnd,
};
