'use strict';

/**
 * engine/engineeringRouter/modelSelector.js
 *
 * Seleção determinística e explicável de CODER/REVIEWER — V1 não usa aprendizado histórico
 * (proibido pelo escopo congelado). Critérios, nesta ordem: capability fit, enabled, provider
 * saudável (breaker), credencial disponível, política de custo preferida, independência de
 * provider para HIGH/CRITICAL.
 *
 * Módulo puro: recebe a lista de modelos candidatos JÁ resolvida (capabilities + status real
 * de enabled/healthy/hasCredential) pela camada de serviço — não faz I/O, não consulta banco,
 * não consulta o control plane diretamente.
 *
 * Cada candidato de entrada (`availableModels[i]`) tem o shape:
 *   { providerId, modelId, roles, capabilities, contextClass, costClass, enabled, healthy, hasCredential }
 */

const { REASON_CODES } = require('./constants');
const {
  scoreModel,
  modelKey,
  currentExecutionPenalty,
} = require('./modelDecision');

const COST_RANK = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2 });

function evaluateCandidate(model, { requiredCapabilities }) {
  const reasons = [];
  if (!model.enabled) {
    return { qualified: false, reasons: [REASON_CODES.PROVIDER_DISABLED] };
  }
  if (!model.hasCredential) {
    return { qualified: false, reasons: [REASON_CODES.PROVIDER_NO_CREDENTIAL] };
  }
  if (model.healthy === false) {
    return { qualified: false, reasons: [REASON_CODES.PROVIDER_UNHEALTHY] };
  }
  // ERV1-CLOSE-008: provider saudável (breaker fechado) não implica que ESTE modelId funcione —
  // `available` vem de falhas reais recentes específicas do modelo (404/retirado/auth negada),
  // não do circuit breaker do provider.
  if (model.available === false) {
    return { qualified: false, reasons: [REASON_CODES.MODEL_UNAVAILABLE] };
  }
  const missing = (requiredCapabilities || []).filter((c) => !model.capabilities.includes(c));
  if (missing.length > 0) {
    return { qualified: false, reasons: [REASON_CODES.CAPABILITY_MISSING], missing };
  }
  reasons.push(REASON_CODES.CAPABILITY_MATCH);
  reasons.push(REASON_CODES.PROVIDER_HEALTHY);
  return { qualified: true, reasons };
}

/**
 * Comparação entre dois candidatos JÁ qualificados (Safety/Governance e Capability são filtros de
 * `evaluateCandidate` — nada aqui pode reabrir um candidato inseguro ou sem capacidade).
 *
 * Prevalência exigida pela política: Reliability > Cost.
 *   1. evidência explícita de sucesso do chamador (`preferredModelKeys`) quando houver;
 *   2. FAIXA de confiabilidade (comprovado / sem evidência / degradado / saída inválida);
 *   3. `expected_cost_per_GREEN` (custo efetivo, não preço de token);
 *   4. classe de custo relativa;
 *   5. chave estável (determinismo).
 *
 * @param {Object} [options] aceita também o formato legado `compareCandidates(a, b, 'LOW')`.
 */
function compareCandidates(a, b, options = null) {
  const opts = typeof options === 'string' ? { preferredCostClass: options } : (options || {});
  const { preferredCostClass = 'ANY', preferredModelKeys = null, modelEvidence = null, currentExecutionFailures = null } = opts;
  const keyOf = (m) => modelKey(m.providerId, m.modelId);

  // (1) Evidência explícita de patch aplicado (telemetria) — o chamador informa o conjunto.
  if (preferredModelKeys instanceof Set && preferredModelKeys.size > 0) {
    const aPref = preferredModelKeys.has(keyOf(a)) ? 0 : 1;
    const bPref = preferredModelKeys.has(keyOf(b)) ? 0 : 1;
    if (aPref !== bPref) return aPref - bPref;
  }

  // (2) Reliability — faixa de confiabilidade derivada da evidência por classe de tarefa.
  const evidenceGet = (m) => (modelEvidence instanceof Map ? modelEvidence.get(keyOf(m)) : null);
  const scoreA = scoreModel(a, evidenceGet(a));
  const scoreB = scoreModel(b, evidenceGet(b));
  const penaltyA = currentExecutionPenalty(a, currentExecutionFailures);
  const penaltyB = currentExecutionPenalty(b, currentExecutionFailures);
  // Penalidade da execução corrente pode rebaixar a faixa (falha determinística AGORA conta mais
  // que histórico antigo), mas nunca promove ninguém.
  const tierA = scoreA.reliabilityTier + (penaltyA > 0 ? 1 : 0);
  const tierB = scoreB.reliabilityTier + (penaltyB > 0 ? 1 : 0);
  if (tierA !== tierB) return tierA - tierB;

  // (3) Cost — custo EFETIVO por GREEN esperado (preço relativo / P(sucesso) + latência + despedício).
  const ecgDiff = scoreA.expectedCostPerGreen - scoreB.expectedCostPerGreen;
  if (ecgDiff !== 0) return ecgDiff;

  // (4) Classe de custo relativa (desempate estável).
  if (preferredCostClass && preferredCostClass !== 'ANY') {
    const aMatch = a.costClass === preferredCostClass ? 0 : 1;
    const bMatch = b.costClass === preferredCostClass ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;
  }
  const costDiff = COST_RANK[a.costClass] - COST_RANK[b.costClass];
  if (costDiff !== 0) return costDiff;

  // (5) Determinismo.
  return keyOf(a).localeCompare(keyOf(b));
}

/**
 * Seleciona o melhor candidato qualificado para um papel (CODER/REVIEWER).
 *
 * @returns {{selected: Object|null, qualifiedCandidates: Object[], reasonCodes: string[]}}
 */
function selectForRole(availableModels, {
  role,
  requiredCapabilities,
  preferredCostClass = 'ANY',
  excludeProviderId = null,
  excludedModelKeys = null,
  preferredModelKeys = null,
  modelEvidence = null,
  currentExecutionFailures = null,
}) {
  const roleCandidates = (availableModels || []).filter((m) => Array.isArray(m.roles) && m.roles.includes(role));
  const excludedKeys = excludedModelKeys instanceof Set ? excludedModelKeys : null;
  const preferredKeys = preferredModelKeys instanceof Set ? preferredModelKeys : null;

  const evaluated = roleCandidates
    .filter((m) => !excludeProviderId || m.providerId !== excludeProviderId)
    // ERV1-CLOSE-008: reroute dentro da mesma task exclui explicitamente o(s) modelo(s) que já
    // falharam nesta tentativa — nunca reselecionar o mesmo candidato que acabou de quebrar.
    .filter((m) => !excludedKeys || !excludedKeys.has(modelKey(m.providerId, m.modelId)))
    .map((m) => ({ model: m, evaluation: evaluateCandidate(m, { requiredCapabilities }) }));

  const qualified = evaluated.filter((e) => e.evaluation.qualified).map((e) => e.model);

  if (qualified.length === 0) {
    return { selected: null, qualifiedCandidates: [], reasonCodes: [REASON_CODES.NO_QUALIFIED_CANDIDATE], decisionFactors: [] };
  }

  const rankOptions = { preferredCostClass, preferredModelKeys: preferredKeys, modelEvidence, currentExecutionFailures };
  const sorted = [...qualified].sort((a, b) => compareCandidates(a, b, rankOptions));
  const winner = sorted[0];
  const winnerEval = evaluated.find((e) => e.model === winner).evaluation;
  const scoreOf = (m) => scoreModel(m, modelEvidence instanceof Map ? modelEvidence.get(modelKey(m.providerId, m.modelId)) : null);

  const reasonCodes = [...winnerEval.reasons];
  if (preferredKeys && preferredKeys.has(modelKey(winner.providerId, winner.modelId))) {
    reasonCodes.push(REASON_CODES.PROVEN_FOR_TASK_CLASS);
  }
  if (scoreOf(winner).reliabilityTier === 0) {
    reasonCodes.push(REASON_CODES.RELIABILITY_PROVEN);
  }
  if (preferredCostClass && preferredCostClass !== 'ANY' && winner.costClass === preferredCostClass) {
    reasonCodes.push(REASON_CODES.POLICY_PRIORITY);
  }
  if (sorted.length > 1 && sorted.some((c) => COST_RANK[c.costClass] > COST_RANK[winner.costClass])) {
    reasonCodes.push(REASON_CODES.LOWER_COST_AMONG_QUALIFIED);
  }

  // Fatores da decisão para TELEMETRIA (o porquê auditável de cada escolha).
  const decisionFactors = sorted.map((m) => {
    const s = scoreOf(m);
    return {
      key: modelKey(m.providerId, m.modelId),
      costClass: m.costClass,
      reliabilityTier: s.reliabilityTier,
      tierReason: s.tierReason,
      expectedCostPerGreen: s.expectedCostPerGreen,
      probabilityOfApplied: s.probabilityOfApplied,
      timeoutRate: s.timeoutRate,
      invalidRate: s.invalidRate,
      meanLatencyMs: s.meanLatencyMs,
      quotaFailures: s.quotaFailures,
      sampleSize: s.sampleSize,
      currentExecutionPenalty: currentExecutionPenalty(m, currentExecutionFailures),
      selected: m === winner,
    };
  });

  return {
    selected: { providerId: winner.providerId, modelId: winner.modelId, contextClass: winner.contextClass, costClass: winner.costClass, reliabilityTier: scoreOf(winner).reliabilityTier, expectedCostPerGreen: scoreOf(winner).expectedCostPerGreen },
    qualifiedCandidates: sorted.map((c) => ({ providerId: c.providerId, modelId: c.modelId, costClass: c.costClass })),
    reasonCodes,
    decisionFactors,
  };
}

/**
 * Seleciona CODER e REVIEWER para uma task, aplicando independência de provider quando exigida
 * pela policy (HIGH/CRITICAL por padrão). Nunca finge independência: se não houver um segundo
 * provider qualificado, registra INDEPENDENT_PROVIDER_UNAVAILABLE e cai de volta para o melhor
 * reviewer qualificado (mesmo que do mesmo provider do coder).
 *
 * @param {Object[]} availableModels
 * @param {Object} params
 * @param {string[]} params.coderCapabilities
 * @param {string[]} params.reviewerCapabilities
 * @param {string} params.preferredCostClass
 * @param {boolean} params.independentReviewRequired
 * @param {string} params.policyVersion
 */
function selectCoderAndReviewer(availableModels, {
  coderCapabilities,
  reviewerCapabilities,
  preferredCostClass = 'ANY',
  independentReviewRequired = false,
  policyVersion,
  excludedModelKeys = null,
  preferredCoderModelKeys = null,
  modelEvidence = null,
  currentExecutionFailures = null,
}) {
  const coder = selectForRole(availableModels, {
    role: 'CODER',
    requiredCapabilities: coderCapabilities,
    preferredCostClass,
    excludedModelKeys,
    preferredModelKeys: preferredCoderModelKeys,
    modelEvidence,
    currentExecutionFailures,
  });

  const excludeProviderId = independentReviewRequired && coder.selected ? coder.selected.providerId : null;

  let reviewer = selectForRole(availableModels, {
    role: 'REVIEWER',
    requiredCapabilities: reviewerCapabilities,
    preferredCostClass,
    excludeProviderId,
    excludedModelKeys,
    modelEvidence,
    currentExecutionFailures,
  });

  let independentReviewApplied = false;

  if (excludeProviderId) {
    if (reviewer.selected) {
      independentReviewApplied = true;
      reviewer = { ...reviewer, reasonCodes: [...reviewer.reasonCodes, REASON_CODES.INDEPENDENT_PROVIDER_APPLIED] };
    } else {
      // Nenhum reviewer qualificado independente — cai para o melhor reviewer qualificado
      // sem a restrição de provider, registrando explicitamente a indisponibilidade.
      const fallback = selectForRole(availableModels, {
        role: 'REVIEWER',
        requiredCapabilities: reviewerCapabilities,
        preferredCostClass,
        excludedModelKeys,
        modelEvidence,
        currentExecutionFailures,
      });
      reviewer = {
        ...fallback,
        reasonCodes: [...fallback.reasonCodes, REASON_CODES.INDEPENDENT_PROVIDER_UNAVAILABLE],
      };
      independentReviewApplied = false;
    }
  }

  return {
    coder,
    reviewer,
    independentReviewRequired,
    independentReviewApplied,
    policyVersion,
    selectedAt: new Date().toISOString(),
  };
}

module.exports = {
  evaluateCandidate,
  compareCandidates,
  selectForRole,
  selectCoderAndReviewer,
};
