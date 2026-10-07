'use strict';

/**
 * engine/engineeringRouter/modelDecision.js
 *
 * HUMAN_EXTERNAL_BOOTSTRAP (2026-10-07) — DECISÃO POR EVIDÊNCIA EMPÍRICA do roteador.
 *
 * Módulo PURO: recebe evidência JÁ LIDA (attempts reais das tasks da mesma classe) e devolve o
 * score/ordenação. Não faz I/O, não consulta banco, não conhece nome de modelo nenhum — a política
 * vale para QUALQUER candidato qualificado. Nenhuma lista fixa de modelos aqui.
 *
 * A função objetivo deixa de ser "menor preço de token" e passa a ser `expected_cost_per_GREEN`:
 *   custo_efetivo = custo_por_tentativa / probabilidade_de_GREEN
 *                 + penalidade_de_latência
 *                 + penalidade_de_desperdício (timeout, reasoning exhaustion, quota, saída inválida)
 *
 * ORDEM DE PREVALÊNCIA (exigida como política, não como heurística): Safety/Governance >
 * Capability > Reliability > Cost. Safety e Capability são filtros (ver `modelSelector.evaluateCandidate`);
 * este módulo decide DENTRO do conjunto já qualificado: primeiro faixa de confiabilidade, depois
 * custo efetivo.
 */

/** Unidades de custo relativo por classe declarada no catálogo de modelos (não é preço em USD). */
const COST_UNITS = Object.freeze({ LOW: 1, MEDIUM: 3, HIGH: 9 });

/**
 * Faixas de CONFIABILIDADE (menor = melhor). Deliberadamente discretas: a evidência histórica é
 * esparsa e um score contínuo daria falsa precisão; a faixa é auditável e estável.
 */
const RELIABILITY_TIER = Object.freeze({
  PROVEN: 0,        // já entregou patch aplicado nesta classe de tarefa
  UNKNOWN: 1,       // sem evidência suficiente
  DEGRADED: 2,      // histórico recente de timeout/reasoning exhaustion/quota
  INVALID_OUTPUT: 3, // falha estrutural de saída recorrente SEM nenhum sucesso conhecido
});

const MIN_PROBABILITY = 0.05; // evita divisão por zero; nunca "infinito"

/**
 * Mapa EXPLÍCITO kind → campo de evidência. Bug real capturado por teste: sem este mapa, o
 * incremento usava o nome do kind como campo (`entry.timeout`, `entry.quota`) e os contadores
 * reais (`timeouts`, `quotaFailures`) ficavam eternamente zerados — evidência silenciosamente
 * inválida para justamente os dois fatores mais caros da política.
 */
const OUTCOME_FIELD = Object.freeze({
  applied: 'applied',
  invalidFormat: 'invalidFormat',
  timeout: 'timeouts',
  reasoningExhausted: 'reasoningExhausted',
  quota: 'quotaFailures',
});

function emptyEvidence() {
  return {
    attempts: 0,
    applied: 0,
    invalidFormat: 0,
    timeouts: 0,
    reasoningExhausted: 0,
    quotaFailures: 0,
    latencySumMs: 0,
    latencySamples: 0,
    greenFinal: 0,
    redFinal: 0,
    blockedFinal: 0,
  };
}

/** Chave canônica do candidato. Exportada para reuso (mesmo formato em todo o roteador). */
function modelKey(providerId, modelId) {
  return `${providerId}:${modelId}`;
}

function isUsableKey(key) {
  return Boolean(key) && !key.includes('null') && !key.includes('undefined');
}

/**
 * Classifica um attempt real em um contador de evidência.
 * @param {Object} attempt - { coder_provider, coder_model, status, error }
 * @returns {{kind:string}|null}
 */
function classifyAttemptOutcome(attempt = {}) {
  const status = String(attempt.status || '');
  const error = attempt.error || {};
  const code = String(error.code || '');
  const failureClass = String(error.failureClass || '');
  const message = String(error.message || '').toLowerCase();

  if (status === 'DONE' || status === 'APPLIED') return { kind: 'applied' };
  if (code === 'PATCH_BODY_MISSING_PREFIX' || code === 'PATCH_APPLY_FAILED' || code === 'PATCH_INVALID_FORMAT') return { kind: 'invalidFormat' };
  if (failureClass === 'PROVIDER_TIMEOUT' || code === 'PROVIDER_TIMEOUT') return { kind: 'timeout' };
  if (failureClass === 'PROVIDER_EMPTY_RESPONSE' || /sem conteúdo utilizável|reasoning/i.test(message)) return { kind: 'reasoningExhausted' };
  if (failureClass === 'credit_balance_exhausted' || /no credits remaining|insufficient|quota|rate limit|sem saldo|sem crédito/i.test(message)) return { kind: 'quota' };
  return null;
}

function latencyMsOf(attempt = {}) {
  const start = attempt.started_at ? new Date(attempt.started_at).getTime() : null;
  const end = attempt.completed_at ? new Date(attempt.completed_at).getTime() : null;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

/**
 * Agrega EVIDÊNCIA REAL por modelo a partir de attempts persistidos de tasks da MESMA classe.
 *
 * @param {Object} params
 * @param {Array<{id:string, status:string}>} params.tasks - tasks da classe (mais recentes primeiro)
 * @param {Array<Object>} params.attempts - attempts dessas tasks, em ordem cronológica
 * @returns {Map<string, ReturnType<typeof emptyEvidence>>}
 */
function aggregateEvidenceFromAttempts({ tasks = [], attempts = [] } = {}) {
  const evidence = new Map();
  const taskStatusById = new Map(tasks.map((t) => [String(t.id), String(t.status || '')]));
  const lastModelByTask = new Map();

  for (const attempt of attempts) {
    const key = modelKey(attempt.coder_provider, attempt.coder_model);
    if (!isUsableKey(key)) continue;
    if (!evidence.has(key)) evidence.set(key, emptyEvidence());
    const entry = evidence.get(key);
    entry.attempts += 1;

    const outcome = classifyAttemptOutcome(attempt);
    if (outcome) {
      const field = OUTCOME_FIELD[outcome.kind];
      if (field) entry[field] += 1;
    }

    const latency = latencyMsOf(attempt);
    if (latency !== null) { entry.latencySumMs += latency; entry.latencySamples += 1; }

    if (attempt.task_id) lastModelByTask.set(String(attempt.task_id), key);
  }

  // Resultado FINAL da task é atribuído ao modelo que fez a ÚLTIMA tentativa (quem estava no
  // comando quando a task terminou) — é o desfecho que aquele candidato produziu de fato.
  for (const [taskId, key] of lastModelByTask.entries()) {
    const status = taskStatusById.get(taskId);
    if (!status || !evidence.has(key)) continue;
    const entry = evidence.get(key);
    if (status === 'GREEN') entry.greenFinal += 1;
    else if (status === 'RED') entry.redFinal += 1;
    else if (status === 'BLOCKED') entry.blockedFinal += 1;
  }

  return evidence;
}

/** Taxa suavizada (Laplace) de sucesso — nunca 0 absoluto nem 1 absoluto com pouca amostra. */
function probabilityOfApplied(evidence) {
  return (evidence.applied + 1) / (evidence.attempts + 2);
}

/**
 * Score auditável de um candidato, com TODOS os fatores que a política exige considerar.
 * @returns {{reliabilityTier:number, tierReason:string, probabilityOfApplied:number,
 *   timeoutRate:number, invalidRate:number, reasoningRate:number, quotaFailures:number,
 *   meanLatencyMs:number, expectedCostPerGreen:number, costUnits:number, sampleSize:number}}
 */
function scoreModel({ providerId, modelId, costClass = 'MEDIUM' }, evidence = emptyEvidence()) {
  const e = { ...emptyEvidence(), ...(evidence || {}) };
  const costUnits = COST_UNITS[costClass] ?? COST_UNITS.MEDIUM;
  const p = probabilityOfApplied(e);
  const timeoutRate = e.attempts > 0 ? e.timeouts / e.attempts : 0;
  const invalidRate = e.attempts > 0 ? e.invalidFormat / e.attempts : 0;
  const reasoningRate = e.attempts > 0 ? e.reasoningExhausted / e.attempts : 0;
  const meanLatencyMs = e.latencySamples > 0 ? Math.round(e.latencySumMs / e.latencySamples) : 0;

  let reliabilityTier = RELIABILITY_TIER.UNKNOWN;
  let tierReason = 'sem evidência suficiente para esta classe de tarefa';
  if (e.applied > 0) {
    reliabilityTier = RELIABILITY_TIER.PROVEN;
    tierReason = `já entregou ${e.applied} patch(es) aplicado(s) nesta classe`;
  } else if (e.quotaFailures > 0 || timeoutRate >= 0.5 || e.reasoningExhausted >= 2) {
    reliabilityTier = RELIABILITY_TIER.DEGRADED;
    tierReason = `histórico recente degradado (timeout=${e.timeouts}, reasoning=${e.reasoningExhausted}, quota=${e.quotaFailures})`;
  } else if (e.invalidFormat >= 2) {
    reliabilityTier = RELIABILITY_TIER.INVALID_OUTPUT;
    tierReason = `saída estruturalmente inválida recorrente (${e.invalidFormat} de ${e.attempts}) sem sucesso conhecido`;
  }

  // Custo EFETIVO: preço relativo por sucesso esperado + latência + desperdício observado.
  const latencyPenalty = meanLatencyMs / 60000;                 // minutos médios por tentativa
  const wastePenalty = (invalidRate * 2) + (timeoutRate * 4) + (reasoningRate * 3) + (e.quotaFailures * 1);
  const expectedCostPerGreen = (costUnits / Math.max(p, MIN_PROBABILITY)) + latencyPenalty + wastePenalty;

  return {
    reliabilityTier,
    tierReason,
    probabilityOfApplied: Number(p.toFixed(4)),
    timeoutRate: Number(timeoutRate.toFixed(4)),
    invalidRate: Number(invalidRate.toFixed(4)),
    reasoningRate: Number(reasoningRate.toFixed(4)),
    quotaFailures: e.quotaFailures,
    meanLatencyMs,
    expectedCostPerGreen: Number(expectedCostPerGreen.toFixed(4)),
    costUnits,
    sampleSize: e.attempts,
  };
}

/**
 * Penalidade da EXECUÇÃO CORRENTE: falha determinística já observada agora reduz a prioridade
 * deste candidato, sem apagar o histórico (evidência de longo prazo continua valendo).
 */
function currentExecutionPenalty(model, currentExecutionFailures = null) {
  if (!(currentExecutionFailures instanceof Map)) return 0;
  const entry = currentExecutionFailures.get(modelKey(model.providerId, model.modelId));
  if (!entry) return 0;
  const failures = Number(entry.count || 0);
  const kind = String(entry.kind || '');
  const weight = kind === 'invalidFormat' ? 3 : (kind === 'timeout' ? 2 : 1);
  return failures * weight;
}

module.exports = {
  COST_UNITS,
  RELIABILITY_TIER,
  MIN_PROBABILITY,
  OUTCOME_FIELD,
  emptyEvidence,
  modelKey,
  isUsableKey,
  classifyAttemptOutcome,
  latencyMsOf,
  aggregateEvidenceFromAttempts,
  probabilityOfApplied,
  scoreModel,
  currentExecutionPenalty,
};
