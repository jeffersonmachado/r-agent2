'use strict';

/**
 * RPA Lead Scoring Service
 * Automated lead scoring based on behavioral and attribute patterns
 * Implements rule engine for lead qualification and auto-assignment
 */

/**
 * Default scoring rules
 * Each rule contributes points based on matched conditions
 */
const DEFAULT_SCORING_RULES = [
  {
    id: 'rule-email-domain',
    name: 'Email Domain Quality',
    conditions: [
      { field: 'email', operator: 'includes', value: '@company.com', points: 10 },
      { field: 'email', operator: 'excludes', value: '@gmail.com', points: -5 },
      { field: 'email', operator: 'excludes', value: '@yahoo.com', points: -5 },
    ],
  },
  {
    id: 'rule-engagement',
    name: 'Lead Engagement',
    conditions: [
      { field: 'page_views', operator: 'gt', value: 5, points: 15 },
      { field: 'email_opens', operator: 'gt', value: 2, points: 10 },
      { field: 'content_downloads', operator: 'gt', value: 0, points: 20 },
    ],
  },
  {
    id: 'rule-company-size',
    name: 'Company Size',
    conditions: [
      { field: 'company_size', operator: 'eq', value: 'enterprise', points: 30 },
      { field: 'company_size', operator: 'eq', value: 'mid-market', points: 20 },
      { field: 'company_size', operator: 'eq', value: 'startup', points: 10 },
    ],
  },
  {
    id: 'rule-industry',
    name: 'Target Industry',
    conditions: [
      { field: 'industry', operator: 'eq', value: 'SaaS', points: 25 },
      { field: 'industry', operator: 'eq', value: 'Finance', points: 25 },
      { field: 'industry', operator: 'eq', value: 'Healthcare', points: 20 },
    ],
  },
  {
    id: 'rule-profile-completeness',
    name: 'Profile Completeness',
    conditions: [
      { field: 'phone', operator: 'exists', points: 15 },
      { field: 'company', operator: 'exists', points: 15 },
      { field: 'job_title', operator: 'exists', points: 10 },
    ],
  },
];

/**
 * Auto-assignment rules
 * Determines which sales rep should own a lead based on various factors
 */
const DEFAULT_ASSIGNMENT_RULES = [
  {
    id: 'rule-territory',
    name: 'Territory-based Assignment',
    matchOn: 'state',
    assignments: {
      'São Paulo': 'rep-sp-1',
      'Rio de Janeiro': 'rep-rj-1',
      'Minas Gerais': 'rep-mg-1',
    },
  },
  {
    id: 'rule-industry',
    name: 'Industry-based Assignment',
    matchOn: 'industry',
    assignments: {
      'SaaS': 'rep-saas-1',
      'Finance': 'rep-finance-1',
      'Healthcare': 'rep-health-1',
    },
  },
  {
    id: 'rule-company-size',
    name: 'Company Size Assignment',
    matchOn: 'company_size',
    assignments: {
      'enterprise': 'rep-enterprise-1',
      'mid-market': 'rep-mid-market-1',
      'startup': 'rep-startup-1',
    },
  },
];

/**
 * Evaluates a single condition against lead data
 */
function evaluateCondition(lead, condition) {
  const { field, operator, value, points = 0 } = condition;
  const fieldValue = lead[field];

  switch (operator) {
    case 'eq':
      return fieldValue === value ? points : 0;
    case 'neq':
      return fieldValue !== value ? points : 0;
    case 'gt':
      return Number(fieldValue) > Number(value) ? points : 0;
    case 'lt':
      return Number(fieldValue) < Number(value) ? points : 0;
    case 'gte':
      return Number(fieldValue) >= Number(value) ? points : 0;
    case 'lte':
      return Number(fieldValue) <= Number(value) ? points : 0;
    case 'includes':
      return String(fieldValue).includes(String(value)) ? points : 0;
    case 'excludes':
      return !String(fieldValue).includes(String(value)) ? points : 0;
    case 'exists':
      return fieldValue && fieldValue !== '' && fieldValue !== null ? points : 0;
    default:
      return 0;
  }
}

/**
 * Calculates lead score based on rules
 */
function calculateLeadScore(lead, rules = DEFAULT_SCORING_RULES) {
  let totalScore = 0;
  const breakdown = [];

  for (const rule of rules) {
    let ruleScore = 0;

    for (const condition of rule.conditions || []) {
      ruleScore += evaluateCondition(lead, condition);
    }

    if (ruleScore > 0) {
      breakdown.push({
        ruleId: rule.id,
        ruleName: rule.name,
        score: ruleScore,
      });
      totalScore += ruleScore;
    }
  }

  // Normalize score to 0-100
  const normalizedScore = Math.min(100, Math.max(0, totalScore));

  return {
    score: normalizedScore,
    totalPoints: totalScore,
    breakdown,
    gradeLevel: normalizedScore >= 80 ? 'hot' : normalizedScore >= 60 ? 'warm' : 'cold',
  };
}

/**
 * Determines lead grade based on score
 */
function getLeadGrade(score) {
  if (score >= 80) return 'A'; // Hot lead
  if (score >= 60) return 'B'; // Warm lead
  if (score >= 40) return 'C'; // Cold lead
  return 'D'; // Very cold
}

/**
 * Assigns a sales rep based on assignment rules
 */
function assignSalesRep(lead, rules = DEFAULT_ASSIGNMENT_RULES) {
  const assignments = [];

  for (const rule of rules) {
    const { matchOn, assignments: ruleAssignments } = rule;
    const leadFieldValue = lead[matchOn];

    if (leadFieldValue && ruleAssignments[leadFieldValue]) {
      assignments.push({
        ruleId: rule.id,
        ruleName: rule.name,
        assignedTo: ruleAssignments[leadFieldValue],
      });
    }
  }

  // Return first match or null
  return assignments.length > 0 ? assignments[0].assignedTo : null;
}

/**
 * Full lead qualification workflow
 */
function qualifyLead(lead, scoringRules = DEFAULT_SCORING_RULES, assignmentRules = DEFAULT_ASSIGNMENT_RULES) {
  const scoring = calculateLeadScore(lead, scoringRules);
  const grade = getLeadGrade(scoring.score);
  const assignedTo = assignSalesRep(lead, assignmentRules);

  return {
    leadId: lead.id,
    score: scoring.score,
    grade,
    gradeLevel: scoring.gradeLevel,
    breakdown: scoring.breakdown,
    status: scoring.score >= 60 ? 'qualified' : 'unqualified',
    recommendedAction: scoring.score >= 80 ? 'immediate_outreach' : scoring.score >= 60 ? 'nurture' : 'add_to_list',
    assignedTo,
  };
}

/**
 * Batch qualify multiple leads
 */
function batchQualifyLeads(leads, scoringRules = DEFAULT_SCORING_RULES, assignmentRules = DEFAULT_ASSIGNMENT_RULES) {
  return leads.map((lead) => qualifyLead(lead, scoringRules, assignmentRules));
}

/**
 * Custom rule validation
 */
function validateScoringRule(rule) {
  if (!rule.id || !rule.name) {
    return { valid: false, error: 'Rule must have id and name' };
  }

  if (!Array.isArray(rule.conditions)) {
    return { valid: false, error: 'Rule must have conditions array' };
  }

  const validOperators = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'includes', 'excludes', 'exists'];

  for (const condition of rule.conditions) {
    if (!condition.field || !validOperators.includes(condition.operator)) {
      return { valid: false, error: `Invalid condition: ${JSON.stringify(condition)}` };
    }
  }

  return { valid: true };
}

module.exports = {
  calculateLeadScore,
  getLeadGrade,
  assignSalesRep,
  qualifyLead,
  batchQualifyLeads,
  validateScoringRule,
  DEFAULT_SCORING_RULES,
  DEFAULT_ASSIGNMENT_RULES,
};
