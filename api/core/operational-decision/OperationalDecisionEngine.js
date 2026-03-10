'use strict';

const { OCCOperationalStateRepository } = require('../operational-state-v2');
const { OperationalPriorityEngine } = require('./OperationalPriorityEngine');
const { OperationalPolicyEngine } = require('./OperationalPolicyEngine');
const { OperationalOutcomeClassifier } = require('./OperationalOutcomeClassifier');
const { OperationalDecisionReasonBuilder } = require('./OperationalDecisionReasonBuilder');

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(parsed, max));
}

function toTs(value) {
  const parsed = Date.parse(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildPlaybookCountMaps(playbooks = []) {
  const bySignal = new Map();
  const byRecommendation = new Map();

  for (const item of Array.isArray(playbooks) ? playbooks : []) {
    const signalId = safeString(item?.signal_id || item?.signalId);
    if (signalId) {
      bySignal.set(signalId, Number(bySignal.get(signalId) || 0) + 1);
    }

    const recommendationId = safeString(item?.recommendation_id || item?.recommendationId);
    if (recommendationId) {
      byRecommendation.set(recommendationId, Number(byRecommendation.get(recommendationId) || 0) + 1);
    }
  }

  return { bySignal, byRecommendation };
}

function withDecisionSort(items = [], getDateValue) {
  return (Array.isArray(items) ? items : [])
    .slice()
    .sort((left, right) => {
      const scoreDiff = safeNumber(right?.priorityScore, 0) - safeNumber(left?.priorityScore, 0);
      if (scoreDiff !== 0) return scoreDiff;
      return toTs(getDateValue(right)) - toTs(getDateValue(left));
    });
}

class OperationalDecisionEngine {
  constructor({
    occStateRepository,
    priorityEngine,
    policyEngine,
    outcomeClassifier,
    reasonBuilder,
  } = {}) {
    this.occStateRepository = occStateRepository || new OCCOperationalStateRepository();
    this.priorityEngine = priorityEngine || new OperationalPriorityEngine();
    this.policyEngine = policyEngine || new OperationalPolicyEngine();
    this.outcomeClassifier = outcomeClassifier || new OperationalOutcomeClassifier();
    this.reasonBuilder = reasonBuilder || new OperationalDecisionReasonBuilder();
  }

  evaluateSignalDecision(signal, context = {}) {
    const scoring = this.priorityEngine.scoreSignal(signal, context);
    const policy = this.policyEngine.classifySignalDecision(signal, {
      priorityScore: scoring.priorityScore,
      activePlaybookCount: context.activePlaybookCount,
    });
    const expectedOutcome = this.outcomeClassifier.classifySignalExpectedOutcome(signal);
    const reason = this.reasonBuilder.buildSignalReason({
      signal,
      priorityScore: scoring.priorityScore,
      decisionType: policy.decisionType,
      context,
    });

    return {
      sourceType: 'signal',
      sourceId: safeString(signal?.id),
      signalId: safeString(signal?.id),
      type: safeString(signal?.type || signal?.signal_type),
      status: safeString(signal?.status),
      severity: safeString(signal?.severity),
      confidence: safeNumber(signal?.confidence, 0.5),
      contactId: safeString(signal?.contact_id || signal?.contactId),
      detectedAt: safeString(signal?.detected_at || signal?.detectedAt),
      priorityScore: scoring.priorityScore,
      decisionType: policy.decisionType,
      actionMode: policy.actionMode,
      expectedOutcome,
      reason,
      scoreBreakdown: scoring.scoreBreakdown,
    };
  }

  evaluateRecommendationDecision(recommendation, context = {}) {
    const scoring = this.priorityEngine.scoreRecommendation(recommendation, context);
    const policy = this.policyEngine.classifyRecommendationDecision(recommendation, {
      priorityScore: scoring.priorityScore,
      activePlaybookCount: context.activePlaybookCount,
    });
    const expectedOutcome = this.outcomeClassifier.classifyRecommendationExpectedOutcome(recommendation);
    const reason = this.reasonBuilder.buildRecommendationReason({
      recommendation,
      priorityScore: scoring.priorityScore,
      decisionType: policy.decisionType,
      context,
    });

    return {
      sourceType: 'recommendation',
      sourceId: safeString(recommendation?.id),
      recommendationId: safeString(recommendation?.id),
      signalId: safeString(recommendation?.signal_id || recommendation?.source_signal_id),
      type: safeString(recommendation?.type || recommendation?.recommendation_type),
      status: safeString(recommendation?.status),
      impactLevel: safeString(recommendation?.impact_level || recommendation?.impactLevel),
      confidence: safeNumber(recommendation?.confidence, 0.5),
      contactId: safeString(recommendation?.contact_id || recommendation?.contactId),
      createdAt: safeString(recommendation?.created_at || recommendation?.createdAt),
      priorityScore: scoring.priorityScore,
      decisionType: policy.decisionType,
      actionMode: policy.actionMode,
      expectedOutcome,
      reason,
      scoreBreakdown: scoring.scoreBreakdown,
    };
  }

  async listSignalDecisions({
    tenantId,
    activeOnly = true,
    limit = 200,
    contactId = null,
    status = null,
    severity = null,
    type = null,
    from = null,
    to = null,
  } = {}) {
    const safeTenant = safeString(tenantId);
    if (!safeTenant) return { ok: false, error: 'tenant_required' };

    const safeDecisionLimit = safeLimit(limit, 200, 1000);
    const [signalsOut, playbooksOut] = await Promise.all([
      this.occStateRepository.getSignals({
        tenantId: safeTenant,
        activeOnly,
        limit: safeDecisionLimit,
        contactId,
        status,
        severity,
        type,
        from,
        to,
      }),
      this.occStateRepository.getActivePlaybooks({
        tenantId: safeTenant,
        limit: 1000,
      }),
    ]);

    if (!signalsOut?.ok) return signalsOut;
    if (playbooksOut && playbooksOut.ok === false) return playbooksOut;

    const { bySignal } = buildPlaybookCountMaps(playbooksOut?.items || []);

    const items = withDecisionSort(
      (signalsOut.items || []).map((signal) => {
        const signalId = safeString(signal?.id);
        const activePlaybookCount = Number(bySignal.get(signalId) || 0);
        return this.evaluateSignalDecision(signal, {
          activePlaybookCount,
          hasActiveAction: activePlaybookCount > 0,
          revenueRiskScore: safeNumber(signal?.context_json?.revenueRiskScore, Number.NaN),
        });
      }),
      (item) => item.detectedAt,
    );

    return {
      ok: true,
      items,
      total: items.length,
      limit: safeDecisionLimit,
      source: 'decision_engine',
    };
  }

  async listRecommendationDecisions({
    tenantId,
    limit = 200,
    contactId = null,
    status = null,
    priority = null,
    type = null,
    from = null,
    to = null,
  } = {}) {
    const safeTenant = safeString(tenantId);
    if (!safeTenant) return { ok: false, error: 'tenant_required' };

    const safeDecisionLimit = safeLimit(limit, 200, 1000);
    const [recommendationsOut, playbooksOut] = await Promise.all([
      this.occStateRepository.getRecommendations({
        tenantId: safeTenant,
        limit: safeDecisionLimit,
        contactId,
        status,
        priority,
        type,
        from,
        to,
      }),
      this.occStateRepository.getActivePlaybooks({
        tenantId: safeTenant,
        limit: 1000,
      }),
    ]);

    if (!recommendationsOut?.ok) return recommendationsOut;
    if (playbooksOut && playbooksOut.ok === false) return playbooksOut;

    const { byRecommendation } = buildPlaybookCountMaps(playbooksOut?.items || []);

    const items = withDecisionSort(
      (recommendationsOut.items || []).map((recommendation) => {
        const recommendationId = safeString(recommendation?.id);
        const activePlaybookCount = Number(byRecommendation.get(recommendationId) || 0);

        return this.evaluateRecommendationDecision(recommendation, {
          activePlaybookCount,
          hasActiveAction: activePlaybookCount > 0,
          revenueRiskScore: safeNumber(recommendation?.metadata?.revenueRiskScore, Number.NaN),
        });
      }),
      (item) => item.createdAt,
    );

    return {
      ok: true,
      items,
      total: items.length,
      limit: safeDecisionLimit,
      source: 'decision_engine',
    };
  }
}

module.exports = {
  OperationalDecisionEngine,
};
