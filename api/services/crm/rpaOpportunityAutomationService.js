'use strict';

/**
 * RPA Opportunity Pipeline Automation
 * Automates opportunity stage transitions and deal progression
 * Implements opportunity scoring, auto-progression rules, and deal intelligence
 */

/**
 * Opportunity auto-progression rules
 * Determines when an opportunity should automatically advance stages based on conditions
 */
const DEFAULT_PROGRESSION_RULES = [
  {
    id: 'rule-auto-qualification',
    name: 'Auto-Qualification',
    fromStage: 'lead',
    toStage: 'qualified',
    conditions: [
      { field: 'contact_engaged', operator: 'eq', value: true },
      { field: 'budget_confirmed', operator: 'eq', value: true },
      { field: 'timeline_aligned', operator: 'eq', value: true },
    ],
    actionType: 'auto_advance',
    notifyOnTransition: true,
  },
  {
    id: 'rule-proposal-ready',
    name: 'Ready for Proposal',
    fromStage: 'discovery',
    toStage: 'proposal',
    conditions: [
      { field: 'needs_documented', operator: 'eq', value: true },
      { field: 'stakeholders_aligned', operator: 'eq', value: true },
      { field: 'decision_timeline_known', operator: 'eq', value: true },
    ],
    actionType: 'auto_advance',
    notifyOnTransition: true,
  },
  {
    id: 'rule-negotiation-start',
    name: 'Start Negotiation',
    fromStage: 'proposal',
    toStage: 'negotiation',
    conditions: [
      { field: 'proposal_presented', operator: 'eq', value: true },
      { field: 'days_since_proposal', operator: 'gt', value: 3 },
      { field: 'client_interest_confirmed', operator: 'eq', value: true },
    ],
    actionType: 'auto_advance',
    notifyOnTransition: true,
  },
];

/**
 * Deal health scoring
 * Calculates health metrics for opportunities
 */
const DEAL_HEALTH_FACTORS = [
  {
    name: 'stakeholder_engagement',
    weight: 0.2,
    getRating: (opp) => opp.stakeholder_level || 'low',
  },
  {
    name: 'budget_alignment',
    weight: 0.2,
    getRating: (opp) => (opp.budget_confirmed ? 'high' : opp.budget_discussed ? 'medium' : 'low'),
  },
  {
    name: 'timeline_progress',
    weight: 0.2,
    getRating: (opp) => {
      if (!opp.expected_close_at) return 'low';
      const daysUntilClose = Math.floor((new Date(opp.expected_close_at) - new Date()) / (1000 * 60 * 60 * 24));
      return daysUntilClose > 30 ? 'high' : daysUntilClose > 14 ? 'medium' : 'low';
    },
  },
  {
    name: 'decision_maker_involvement',
    weight: 0.2,
    getRating: (opp) => (opp.decision_maker_involved ? 'high' : opp.coaches_identified ? 'medium' : 'low'),
  },
  {
    name: 'competition_assessment',
    weight: 0.2,
    getRating: (opp) => {
      const competitors = opp.competitors_count || 0;
      return competitors === 0 ? 'high' : competitors === 1 ? 'medium' : 'low';
    },
  },
];

/**
 * Converts rating string to numeric score
 */
function ratingToScore(rating) {
  const scores = {
    'high': 3,
    'medium': 2,
    'low': 1,
  };
  return scores[rating] || 1;
}

/**
 * Calculates deal health score (0-100)
 */
function calculateDealHealth(opportunity) {
  let totalScore = 0;
  const breakdown = [];

  for (const factor of DEAL_HEALTH_FACTORS) {
    const rating = factor.getRating(opportunity);
    const score = ratingToScore(rating);
    const weightedScore = (score / 3) * 100 * factor.weight;

    breakdown.push({
      factorName: factor.name,
      rating,
      score: score / 3 * 100,
      weighted: weightedScore,
    });

    totalScore += weightedScore;
  }

  const healthLevel = totalScore >= 75 ? 'excellent' : totalScore >= 50 ? 'good' : totalScore >= 25 ? 'at_risk' : 'poor';

  return {
    score: Math.round(totalScore),
    healthLevel,
    breakdown,
  };
}

/**
 * Win probability estimation based on stage and factors
 */
function estimateWinProbability(opportunity, pipelineStages) {
  const stageProbabilities = {
    'lead': 0.1,
    'qualified': 0.2,
    'discovery': 0.3,
    'proposal': 0.5,
    'negotiation': 0.7,
    'won': 1.0,
    'closed_lost': 0.0,
  };

  const baseProb = stageProbabilities[opportunity.stage_id] || 0.0;
  const health = calculateDealHealth(opportunity);
  const healthMultiplier = health.score / 100; // 0-1 scale

  // Weight: 70% stage, 30% health
  const estimatedProb = (baseProb * 0.7) + (healthMultiplier * 0.3);

  return {
    probability: Math.round(estimatedProb * 100),
    baseByStage: Math.round(baseProb * 100),
    healthAdjustment: Math.round((healthMultiplier - baseProb) * 100),
  };
}

/**
 * Identifies pipeline risks and opportunities
 */
function analyzePipelineRisks(opportunities) {
  const analysis = {
    at_risk: [],
    stalled: [],
    accelerating: [],
    near_close: [],
  };

  for (const opp of opportunities) {
    const health = calculateDealHealth(opp);
    const daysInStage = Math.floor((new Date() - new Date(opp.updated_at)) / (1000 * 60 * 60 * 24));

    // At-risk deals
    if (health.healthLevel === 'at_risk' || health.healthLevel === 'poor') {
      analysis.at_risk.push({
        opportunityId: opp.id,
        title: opp.title,
        stage: opp.stage_id,
        healthScore: health.score,
        risks: health.breakdown.filter((b) => b.rating === 'low').map((b) => b.factorName),
      });
    }

    // Stalled deals
    if (daysInStage > 30 && opp.stage_id !== 'won' && opp.stage_id !== 'closed_lost') {
      analysis.stalled.push({
        opportunityId: opp.id,
        title: opp.title,
        stage: opp.stage_id,
        daysInStage,
      });
    }

    // Accelerating deals
    if (daysInStage < 7 && opp.stage_id !== 'lead') {
      analysis.accelerating.push({
        opportunityId: opp.id,
        title: opp.title,
        stage: opp.stage_id,
        daysInStage,
      });
    }

    // Near close
    if (opp.expected_close_at) {
      const daysUntilClose = Math.floor((new Date(opp.expected_close_at) - new Date()) / (1000 * 60 * 60 * 24));
      if (daysUntilClose <= 7 && daysUntilClose >= 0) {
        analysis.near_close.push({
          opportunityId: opp.id,
          title: opp.title,
          stage: opp.stage_id,
          daysUntilClose,
        });
      }
    }
  }

  return analysis;
}

/**
 * Evaluates condition for progression rule
 */
function evaluateProgressionCondition(opportunity, condition) {
  const { field, operator, value } = condition;
  const fieldValue = opportunity[field];

  switch (operator) {
    case 'eq':
      return fieldValue === value;
    case 'neq':
      return fieldValue !== value;
    case 'gt':
      return Number(fieldValue) > Number(value);
    case 'lt':
      return Number(fieldValue) < Number(value);
    case 'gte':
      return Number(fieldValue) >= Number(value);
    case 'lte':
      return Number(fieldValue) <= Number(value);
    default:
      return false;
  }
}

/**
 * Checks if opportunity should auto-advance based on progression rules
 */
function checkAutoProgressionRules(opportunity, rules = DEFAULT_PROGRESSION_RULES) {
  const applicableRules = rules.filter((rule) => rule.fromStage === opportunity.stage_id);

  for (const rule of applicableRules) {
    let allConditionsMet = true;

    for (const condition of rule.conditions || []) {
      if (!evaluateProgressionCondition(opportunity, condition)) {
        allConditionsMet = false;
        break;
      }
    }

    if (allConditionsMet) {
      return {
        shouldProgress: true,
        fromStage: rule.fromStage,
        toStage: rule.toStage,
        ruleId: rule.id,
        ruleName: rule.name,
        notify: rule.notifyOnTransition,
      };
    }
  }

  return { shouldProgress: false };
}

/**
 * Batch analyzes opportunities for progression
 */
function batchCheckProgression(opportunities, rules = DEFAULT_PROGRESSION_RULES) {
  return opportunities
    .map((opp) => ({
      opportunity: opp,
      progression: checkAutoProgressionRules(opp, rules),
    }))
    .filter((item) => item.progression.shouldProgress);
}

module.exports = {
  calculateDealHealth,
  estimateWinProbability,
  analyzePipelineRisks,
  checkAutoProgressionRules,
  batchCheckProgression,
  DEFAULT_PROGRESSION_RULES,
  DEAL_HEALTH_FACTORS,
};
