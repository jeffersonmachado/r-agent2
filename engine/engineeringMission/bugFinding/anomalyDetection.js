'use strict';

/**
 * engine/engineeringMission/bugFinding/anomalyDetection.js
 *
 * DETECÇÃO DE PADRÕES a partir de telemetria. Produz CANDIDATOS a finding — sempre SUSPECTED.
 *
 * Regra central (missão, explícita): "Não transformar todo pico em bug confirmado." Um pico de
 * exceções, retries ou fallback é EVIDÊNCIA DE PADRÃO, não prova de defeito: o candidato nasce
 * SUSPECTED, com a categoria sugerida, e só vira CONFIRMED depois de reprodução/invariante.
 *
 * TIMEOUT tem tratamento dedicado (BUG-12): um timeout individual é transitório; o que vira
 * candidato é o PADRÃO (repetição/encadeamento), e mesmo assim com categoria candidata TIMEOUT —
 * não BUG — até que a evidência diga outra coisa.
 *
 * Módulo PURO.
 */

/** Limiares default, conservadores e explícitos. Podem ser sobrepostos por política injetada. */
const DEFAULT_THRESHOLDS = Object.freeze({
  exceptionRate: 0.05,          // > 5% das operações com exceção
  minSamplesForRate: 20,        // sem amostra mínima, taxa não é medida
  excessiveRetries: 5,          // retries da MESMA operação
  providerFallbackRatio: 0.5,   // > 50% das chamadas caindo para fallback
  repeatedTimeoutCount: 3,      // o MESMO deadline estourado 3x
  crashLoopCount: 3,            // 3 reinícios na janela
  regressionFailureStreak: 2,   // 2 execuções consecutivas de regressão reprovadas
});

const ANOMALY_CODES = Object.freeze({
  EXCEPTION_RATE_SPIKE: 'EXCEPTION_RATE_SPIKE',
  EXCESSIVE_RETRIES: 'EXCESSIVE_RETRIES',
  PROVIDER_FALLBACK_SPIKE: 'PROVIDER_FALLBACK_SPIKE',
  STALE_WRITE: 'STALE_WRITE',
  REPEATED_TIMEOUT: 'REPEATED_TIMEOUT',
  CRASH_LOOP: 'CRASH_LOOP',
  REPEATED_REGRESSION_FAILURE: 'REPEATED_REGRESSION_FAILURE',
  NO_PROGRESS: 'NO_PROGRESS',
});

function thresholdOf(thresholds, key) {
  const override = thresholds && Number.isFinite(thresholds[key]) ? thresholds[key] : null;
  return override !== null ? override : DEFAULT_THRESHOLDS[key];
}

/**
 * Detecta anomalias em uma janela de métricas.
 *
 * @param {object} params
 * @param {object} params.metrics   amostra objetiva da janela (contadores e séries)
 * @param {object} [params.thresholds] política de limiares (sobrepõe os defaults)
 * @param {object} [params.context] subsystem/route/test para o fingerprint
 */
function detectAnomalies({ metrics = {}, thresholds = null, context = {} } = {}) {
  const detections = [];
  const subsystem = context.subsystem || metrics.subsystem || null;
  const route = context.route || metrics.route || null;
  const test = context.test || metrics.test || null;

  const total = Number(metrics.operationsTotal || 0);
  const exceptions = Number(metrics.exceptions || 0);
  const minSamples = thresholdOf(thresholds, 'minSamplesForRate');
  if (total >= minSamples) {
    const rate = exceptions / total;
    if (rate > thresholdOf(thresholds, 'exceptionRate')) {
      detections.push({
        code: ANOMALY_CODES.EXCEPTION_RATE_SPIKE,
        source: 'TELEMETRY_ANOMALY',
        categoryHint: 'BUG',
        title: `Taxa de exceção acima do limiar em ${subsystem || 'subsistema'}`,
        expected: `taxa de exceção <= ${thresholdOf(thresholds, 'exceptionRate')}`,
        observed: `taxa de exceção ${rate.toFixed(4)} (${exceptions}/${total})`,
        subsystem, route, test,
        signals: [],
        metric: { rate, exceptions, total },
      });
    }
  }

  const retries = Number(metrics.retries || 0);
  if (retries > thresholdOf(thresholds, 'excessiveRetries')) {
    detections.push({
      code: ANOMALY_CODES.EXCESSIVE_RETRIES,
      source: 'TELEMETRY_ANOMALY',
      categoryHint: 'BUG',
      title: `Retries excessivos em ${metrics.operation || subsystem || 'operação'}`,
      expected: `retries <= ${thresholdOf(thresholds, 'excessiveRetries')}`,
      observed: `${retries} retries`,
      subsystem, route, test,
      signals: [],
      metric: { retries },
    });
  }

  const calls = Number(metrics.providerCalls || 0);
  const fallbacks = Number(metrics.providerFallbacks || 0);
  if (calls > 0) {
    const ratio = fallbacks / calls;
    if (ratio > thresholdOf(thresholds, 'providerFallbackRatio')) {
      detections.push({
        code: ANOMALY_CODES.PROVIDER_FALLBACK_SPIKE,
        source: 'TELEMETRY_ANOMALY',
        categoryHint: 'PROVIDER',
        title: `Fallback de provider excessivo (${metrics.provider || 'provider'})`,
        expected: `razão de fallback <= ${thresholdOf(thresholds, 'providerFallbackRatio')}`,
        observed: `razão ${ratio.toFixed(4)} (${fallbacks}/${calls})`,
        subsystem: 'PROVIDER', route, test,
        signals: [],
        metric: { ratio, fallbacks, calls },
      });
    }
  }

  const staleWrites = Number(metrics.staleWrites || 0);
  if (staleWrites > 0) {
    detections.push({
      code: ANOMALY_CODES.STALE_WRITE,
      source: 'STALE_WRITE',
      // Stale writer sobrescrevendo o dono atual é CRÍTICO por definição (mission §severidade).
      categoryHint: 'CONCURRENCY',
      title: `Escrita obsoleta detectada (${metrics.entity || subsystem || 'entidade'})`,
      expected: 'escritas de um dono substituído são recusadas pelo fence',
      observed: `${staleWrites} escrita(s) obsoleta(s) registrada(s)`,
      subsystem: subsystem || 'LEASE_FENCING', route, test,
      signals: ['STALE_WRITER_OVERWRITE'],
      metric: { staleWrites },
    });
  }

  const timeouts = Number(metrics.timeouts || 0);
  if (timeouts >= thresholdOf(thresholds, 'repeatedTimeoutCount')) {
    detections.push({
      code: ANOMALY_CODES.REPEATED_TIMEOUT,
      source: 'TIMEOUT',
      // Categoria CANDIDATA não é BUG: um timeout individual é transitório; mesmo repetido, a
      // classificação final depende de evidência (infra, provider, deadline mal configurado, hang).
      categoryHint: 'TIMEOUT',
      title: `Timeouts repetidos (${metrics.operation || subsystem || 'operação'})`,
      expected: `timeouts < ${thresholdOf(thresholds, 'repeatedTimeoutCount')}`,
      observed: `${timeouts} timeouts`,
      subsystem, route, test,
      signals: [],
      metric: { timeouts },
    });
  }

  const restarts = Number(metrics.restarts || 0);
  if (restarts >= thresholdOf(thresholds, 'crashLoopCount')) {
    detections.push({
      code: ANOMALY_CODES.CRASH_LOOP,
      source: 'PROCESS_CRASH',
      categoryHint: 'RECOVERY',
      title: `Crash loop (${metrics.process || subsystem || 'processo'})`,
      expected: `reinícios < ${thresholdOf(thresholds, 'crashLoopCount')}`,
      observed: `${restarts} reinícios na janela`,
      subsystem, route, test,
      signals: [],
      metric: { restarts },
    });
  }

  const streak = Number(metrics.regressionFailureStreak || 0);
  if (streak >= thresholdOf(thresholds, 'regressionFailureStreak')) {
    detections.push({
      code: ANOMALY_CODES.REPEATED_REGRESSION_FAILURE,
      source: 'REGRESSION_TEST',
      categoryHint: 'BUG',
      title: `Falha de regressão repetida (${test || metrics.suite || 'suíte'})`,
      expected: `streak < ${thresholdOf(thresholds, 'regressionFailureStreak')}`,
      observed: `${streak} execuções consecutivas reprovadas`,
      subsystem, route, test: test || metrics.suite || null,
      signals: [],
      metric: { streak },
    });
  }

  if (metrics.noProgress === true) {
    detections.push({
      code: ANOMALY_CODES.NO_PROGRESS,
      source: 'NO_PROGRESS',
      categoryHint: 'RECOVERY',
      title: `Sem progresso em ${metrics.operation || metrics.phase || 'operação'}`,
      expected: 'progresso significativo dentro da política de progresso',
      observed: 'worker vivo, heartbeat saudável, sem progresso significativo',
      subsystem, route, test,
      signals: [],
      metric: {
        phase: metrics.phase || null,
        operation: metrics.operation || null,
        lastProgressSignal: metrics.lastProgressSignal || null,
        providerStatus: metrics.providerStatus || null,
        childStatus: metrics.childStatus || null,
      },
      diagnosticOnly: true,
    });
  }

  return detections;
}

module.exports = {
  DEFAULT_THRESHOLDS,
  ANOMALY_CODES,
  detectAnomalies,
};
