'use strict';

const {
  beautyNoShowRisk,
  beautyReengagementSuggestion,
  beautyUpsellSuggestion,
  fitnessChurnRisk,
  fitnessLowFrequencySuggestion,
  fitnessBlockFollowUpSuggestion,
} = require('../vertical/verticalRecommendationService');
const {
  collectBeautyCandidates,
  collectFitnessCandidates,
} = require('./operationsDashboardCandidates');
const {
  scoreFromSignal,
  derivedScoreForSuggestion,
} = require('./operationsDashboardHelpers');

async function computeInsightsPayload({ tenantId, selectedVertical, safeLimit, period }) {
  const items = [];

  if (selectedVertical === 'all' || selectedVertical === 'beauty') {
    const candidates = await collectBeautyCandidates({
      tenantId,
      startDate: period.startDate,
      endDate: period.endDate,
      limit: safeLimit,
    });

    for (const candidate of candidates) {
      const noShow = await beautyNoShowRisk({
        tenantId,
        subjectId: candidate.subjectId,
        membershipId: candidate.membershipId,
      }).catch(() => null);

      if (noShow && (Number(noShow.score) >= 0.4 || noShow.action !== 'none')) {
        items.push({
          vertical: 'beauty',
          subjectId: candidate.subjectId,
          customerId: candidate.customerId,
          membershipId: candidate.membershipId,
          type: 'no_show_risk',
          action: noShow.action,
          score: Number(noShow.score) || 0,
          scoreSource: 'engine',
          reason: noShow.reason,
          evidence: noShow.evidence || {},
        });
      }

      const reengagement = await beautyReengagementSuggestion({
        tenantId,
        subjectId: candidate.subjectId,
        membershipId: candidate.membershipId,
      }).catch(() => null);

      if (reengagement && reengagement.suggestion !== 'none') {
        const signalScore = scoreFromSignal(reengagement.evidence);
        items.push({
          vertical: 'beauty',
          subjectId: candidate.subjectId,
          customerId: candidate.customerId,
          membershipId: candidate.membershipId,
          type: 'return_eligibility',
          action: reengagement.suggestion,
          score: Number.isFinite(signalScore) ? signalScore : 0.6,
          scoreSource: Number.isFinite(signalScore) ? 'engine' : 'derived',
          reason: reengagement.reason,
          evidence: reengagement.evidence || {},
        });
      }

      const upsell = await beautyUpsellSuggestion({
        tenantId,
        subjectId: candidate.subjectId,
      }).catch(() => null);

      if (upsell && upsell.suggestion !== 'none') {
        items.push({
          vertical: 'beauty',
          subjectId: candidate.subjectId,
          customerId: candidate.customerId,
          membershipId: candidate.membershipId,
          type: 'upsell_opportunity',
          action: upsell.suggestion,
          score: derivedScoreForSuggestion('beauty_upsell', upsell.suggestion),
          scoreSource: 'derived',
          reason: upsell.reason,
          evidence: upsell.evidence || {},
        });
      }
    }
  }

  if (selectedVertical === 'all' || selectedVertical === 'fitness') {
    const candidates = await collectFitnessCandidates({ tenantId, limit: safeLimit });

    for (const candidate of candidates) {
      const churn = await fitnessChurnRisk({
        tenantId,
        subjectId: candidate.subjectId,
        membershipId: candidate.membershipId,
        billingStatus: candidate.billingStatus,
      }).catch(() => null);

      if (churn && (Number(churn.score) >= 0.4 || churn.action !== 'none')) {
        items.push({
          vertical: 'fitness',
          subjectId: candidate.subjectId,
          customerId: candidate.customerId,
          membershipId: candidate.membershipId,
          type: 'churn_risk',
          action: churn.action,
          score: Number(churn.score) || 0,
          scoreSource: 'engine',
          reason: churn.reason,
          evidence: churn.evidence || {},
        });
      }

      const lowFrequency = await fitnessLowFrequencySuggestion({
        tenantId,
        subjectId: candidate.subjectId,
      }).catch(() => null);

      if (lowFrequency && lowFrequency.suggestion !== 'none') {
        const signalScore = scoreFromSignal(lowFrequency.evidence);
        items.push({
          vertical: 'fitness',
          subjectId: candidate.subjectId,
          customerId: candidate.customerId,
          membershipId: candidate.membershipId,
          type: 'low_frequency',
          action: lowFrequency.suggestion,
          score: Number.isFinite(signalScore) ? signalScore : 0.65,
          scoreSource: Number.isFinite(signalScore) ? 'engine' : 'derived',
          reason: lowFrequency.reason,
          evidence: lowFrequency.evidence || {},
        });
      }

      const blockFollowup = fitnessBlockFollowUpSuggestion({
        membershipId: candidate.membershipId,
        billingStatus: candidate.billingStatus,
        blockCount: 0,
      });

      if (blockFollowup && blockFollowup.suggestion !== 'none') {
        items.push({
          vertical: 'fitness',
          subjectId: candidate.subjectId,
          customerId: candidate.customerId,
          membershipId: candidate.membershipId,
          type: 'membership_block_followup',
          action: blockFollowup.suggestion,
          score: derivedScoreForSuggestion('fitness_block_followup', blockFollowup.suggestion),
          scoreSource: 'derived',
          reason: blockFollowup.reason,
          evidence: blockFollowup.evidence || {},
        });
      }
    }
  }

  const dedupMap = new Map();
  for (const item of items) {
    const key = [item.vertical, item.type, item.subjectId || '-', item.membershipId || '-'].join(':');
    if (!dedupMap.has(key)) {
      dedupMap.set(key, item);
    }
  }

  const deduped = Array.from(dedupMap.values())
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, safeLimit);

  return {
    items: deduped,
    summary: {
      total: deduped.length,
      byVertical: {
        beauty: deduped.filter((i) => i.vertical === 'beauty').length,
        fitness: deduped.filter((i) => i.vertical === 'fitness').length,
      },
    },
    meta: {
      warnings: [],
      derivedMetrics: [
        {
          field: 'score (upsell/block_followup)',
          note: 'Quando o engine nao retorna score numerico, o painel usa score derivado mapeado por tipo de sugestao.',
        },
      ],
    },
  };
}

module.exports = {
  computeInsightsPayload,
};