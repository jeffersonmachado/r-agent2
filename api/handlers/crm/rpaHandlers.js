'use strict';

/**
 * RPA Handlers
 * REST endpoints for RPA automation workflows
 */

const rpaLeadScoringService = require('../../services/crm/rpaLeadScoringService');
const rpaOpportunityAutomationService = require('../../services/crm/rpaOpportunityAutomationService');

/**
 * Lead Scoring Endpoints
 */

async function scoreLeads(req, res) {
  try {
    const { leads, customRules } = req.body;
    const { tenantKey } = req;

    if (!Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ ok: false, error: 'leads array is required' });
    }

    const scoringRules = customRules || rpaLeadScoringService.DEFAULT_SCORING_RULES;

    const qualified = leads.map((lead) =>
      rpaLeadScoringService.qualifyLead(lead, scoringRules)
    );

    const summary = {
      totalLeads: qualified.length,
      hottestLeads: qualified.filter((l) => l.gradeLevel === 'hot').length,
      warmLeads: qualified.filter((l) => l.gradeLevel === 'warm').length,
      coldLeads: qualified.filter((l) => l.gradeLevel === 'cold').length,
      avgScore: Math.round(qualified.reduce((sum, l) => sum + l.score, 0) / qualified.length),
    };

    res.json({
      ok: true,
      summary,
      qualified: qualified.sort((a, b) => b.score - a.score),
    });
  } catch (err) {
    console.error('scoreLeads error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function scoreLead(req, res) {
  try {
    const { lead, customRules } = req.body;

    if (!lead || typeof lead !== 'object') {
      return res.status(400).json({ ok: false, error: 'lead object is required' });
    }

    const scoringRules = customRules || rpaLeadScoringService.DEFAULT_SCORING_RULES;
    const result = rpaLeadScoringService.qualifyLead(lead, scoringRules);

    res.json({
      ok: true,
      lead: result,
    });
  } catch (err) {
    console.error('scoreLead error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function validateScoringRule(req, res) {
  try {
    const { rule } = req.body;

    if (!rule) {
      return res.status(400).json({ ok: false, error: 'rule is required' });
    }

    const validation = rpaLeadScoringService.validateScoringRule(rule);

    res.json({
      ok: validation.valid,
      validation,
    });
  } catch (err) {
    console.error('validateScoringRule error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * Opportunity Automation Endpoints
 */

async function analyzeDealHealth(req, res) {
  try {
    const { opportunity } = req.body;

    if (!opportunity || typeof opportunity !== 'object') {
      return res.status(400).json({ ok: false, error: 'opportunity object is required' });
    }

    const health = rpaOpportunityAutomationService.calculateDealHealth(opportunity);
    const winProb = rpaOpportunityAutomationService.estimateWinProbability(opportunity);

    res.json({
      ok: true,
      dealHealth: health,
      winProbability: winProb,
    });
  } catch (err) {
    console.error('analyzeDealHealth error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function checkAutoProgression(req, res) {
  try {
    const { opportunity, customRules } = req.body;

    if (!opportunity || typeof opportunity !== 'object') {
      return res.status(400).json({ ok: false, error: 'opportunity object is required' });
    }

    const rules = customRules || rpaOpportunityAutomationService.DEFAULT_PROGRESSION_RULES;
    const progression = rpaOpportunityAutomationService.checkAutoProgressionRules(opportunity, rules);

    res.json({
      ok: true,
      progression,
    });
  } catch (err) {
    console.error('checkAutoProgression error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function analyzePipelineRisks(req, res) {
  try {
    const { opportunities } = req.body;

    if (!Array.isArray(opportunities) || opportunities.length === 0) {
      return res.status(400).json({ ok: false, error: 'opportunities array is required' });
    }

    const risks = rpaOpportunityAutomationService.analyzePipelineRisks(opportunities);

    res.json({
      ok: true,
      risks,
      summary: {
        at_risk_count: risks.at_risk.length,
        stalled_count: risks.stalled.length,
        accelerating_count: risks.accelerating.length,
        near_close_count: risks.near_close.length,
      },
    });
  } catch (err) {
    console.error('analyzePipelineRisks error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function batchAnalyzeDeals(req, res) {
  try {
    const { opportunities } = req.body;

    if (!Array.isArray(opportunities) || opportunities.length === 0) {
      return res.status(400).json({ ok: false, error: 'opportunities array is required' });
    }

    const analyzed = opportunities.map((opp) => ({
      opportunityId: opp.id,
      stage: opp.stage_id,
      dealHealth: rpaOpportunityAutomationService.calculateDealHealth(opp),
      winProbability: rpaOpportunityAutomationService.estimateWinProbability(opp),
    }));

    const avgHealth = Math.round(
      analyzed.reduce((sum, a) => sum + a.dealHealth.score, 0) / analyzed.length,
    );

    const avgWinProb = Math.round(
      analyzed.reduce((sum, a) => sum + a.winProbability.probability, 0) / analyzed.length,
    );

    res.json({
      ok: true,
      analysis: analyzed,
      summary: {
        totalOpportunities: analyzed.length,
        avgDealHealth: avgHealth,
        avgWinProbability: avgWinProb,
      },
    });
  } catch (err) {
    console.error('batchAnalyzeDeals error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}

module.exports = {
  scoreLeads,
  scoreLead,
  validateScoringRule,
  analyzeDealHealth,
  checkAutoProgression,
  analyzePipelineRisks,
  batchAnalyzeDeals,
};
