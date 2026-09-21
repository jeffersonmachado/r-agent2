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

function compareCandidates(a, b, preferredCostClass) {
  if (preferredCostClass && preferredCostClass !== 'ANY') {
    const aMatch = a.costClass === preferredCostClass ? 0 : 1;
    const bMatch = b.costClass === preferredCostClass ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;
  }
  const costDiff = COST_RANK[a.costClass] - COST_RANK[b.costClass];
  if (costDiff !== 0) return costDiff;
  return `${a.providerId}:${a.modelId}`.localeCompare(`${b.providerId}:${b.modelId}`);
}

/**
 * Seleciona o melhor candidato qualificado para um papel (CODER/REVIEWER).
 *
 * @returns {{selected: Object|null, qualifiedCandidates: Object[], reasonCodes: string[]}}
 */
function selectForRole(availableModels, { role, requiredCapabilities, preferredCostClass = 'ANY', excludeProviderId = null, excludedModelKeys = null }) {
  const roleCandidates = (availableModels || []).filter((m) => Array.isArray(m.roles) && m.roles.includes(role));
  const excludedKeys = excludedModelKeys instanceof Set ? excludedModelKeys : null;

  const evaluated = roleCandidates
    .filter((m) => !excludeProviderId || m.providerId !== excludeProviderId)
    // ERV1-CLOSE-008: reroute dentro da mesma task exclui explicitamente o(s) modelo(s) que já
    // falharam nesta tentativa — nunca reselecionar o mesmo candidato que acabou de quebrar.
    .filter((m) => !excludedKeys || !excludedKeys.has(`${m.providerId}:${m.modelId}`))
    .map((m) => ({ model: m, evaluation: evaluateCandidate(m, { requiredCapabilities }) }));

  const qualified = evaluated.filter((e) => e.evaluation.qualified).map((e) => e.model);

  if (qualified.length === 0) {
    return { selected: null, qualifiedCandidates: [], reasonCodes: [REASON_CODES.NO_QUALIFIED_CANDIDATE] };
  }

  const sorted = [...qualified].sort((a, b) => compareCandidates(a, b, preferredCostClass));
  const winner = sorted[0];
  const winnerEval = evaluated.find((e) => e.model === winner).evaluation;

  const reasonCodes = [...winnerEval.reasons];
  if (preferredCostClass && preferredCostClass !== 'ANY' && winner.costClass === preferredCostClass) {
    reasonCodes.push(REASON_CODES.POLICY_PRIORITY);
  }
  if (sorted.length > 1 && sorted.some((c) => COST_RANK[c.costClass] > COST_RANK[winner.costClass])) {
    reasonCodes.push(REASON_CODES.LOWER_COST_AMONG_QUALIFIED);
  }

  return {
    selected: { providerId: winner.providerId, modelId: winner.modelId, contextClass: winner.contextClass, costClass: winner.costClass },
    qualifiedCandidates: sorted.map((c) => ({ providerId: c.providerId, modelId: c.modelId, costClass: c.costClass })),
    reasonCodes,
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
}) {
  const coder = selectForRole(availableModels, {
    role: 'CODER',
    requiredCapabilities: coderCapabilities,
    preferredCostClass,
    excludedModelKeys,
  });

  const excludeProviderId = independentReviewRequired && coder.selected ? coder.selected.providerId : null;

  let reviewer = selectForRole(availableModels, {
    role: 'REVIEWER',
    requiredCapabilities: reviewerCapabilities,
    preferredCostClass,
    excludeProviderId,
    excludedModelKeys,
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
