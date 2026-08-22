'use strict';

const { getSequelize } = require('../../db/sequelize');
const { MASTER_SCORECARD_REGISTRY } = require('../../../governance/master-scorecard-registry');
const getDimension = require('../../db/models/ScorecardDimension');
const getRequirement = require('../../db/models/ScorecardRequirement');
const getEvaluation = require('../../db/models/ScorecardEvaluation');
const getDimensionResult = require('../../db/models/ScorecardDimensionResult');
const getRequirementResult = require('../../db/models/ScorecardRequirementResult');
const getGap = require('../../db/models/GovernanceGap');

async function persistDefinitions({ transaction } = {}) {
  const Dimension = getDimension(); const Requirement = getRequirement();
  for (const definition of MASTER_SCORECARD_REGISTRY) {
    const [dimension] = await Dimension.findOrCreate({ where: { dimension_key: definition.id }, defaults: { name: definition.name, description: definition.description, category: definition.ownerArea, mandatory: definition.applicable !== false, target_score: 10, active: true, version: 1, metadata: { applicabilityRationale: definition.applicabilityRationale } }, transaction });
    for (const requirement of definition.requirements || []) await Requirement.findOrCreate({ where: { dimension_id: dimension.id, requirement_key: requirement.id }, defaults: { description: requirement.description, mandatory: requirement.mandatory !== false, validator_key: requirement.category, requires_runtime_evidence: requirement.category === 'RUNTIME_VALIDATED', requires_test: requirement.category === 'TESTED', active: true, version: 1, metadata: {} }, transaction });
  }
  return { dimensions: MASTER_SCORECARD_REGISTRY.length };
}

async function persistEvaluation({ runId, sourceFingerprint, results, status = 'COMPLETED' }) {
  const sequelize = getSequelize(); if (!sequelize) throw new Error('governance_db_required: Sequelize não inicializado');
  return sequelize.transaction(async (transaction) => {
    await persistDefinitions({ transaction });
    const dimensions = Array.isArray(results) ? results : [];
    const evaluation = await getEvaluation().create({ run_id: runId, status, started_at: new Date(), completed_at: new Date(), total_dimensions: dimensions.length, dimensions_at_10: dimensions.filter((item) => item.score === 10).length, dimensions_below_10: dimensions.filter((item) => item.score !== 10).length, open_gaps: dimensions.reduce((total, item) => total + (item.gapCount || 0), 0), open_blockers: dimensions.reduce((total, item) => total + (item.blockerCount || 0), 0), scorecard_fingerprint: sourceFingerprint, metadata: {} }, { transaction });
    for (const item of dimensions) {
      const dimension = await getDimension().findOne({ where: { dimension_key: item.dimensionKey }, transaction });
      if (!dimension) throw new Error(`scorecard_dimension_not_found: ${item.dimensionKey}`);
      const dimensionResult = await getDimensionResult().create({ evaluation_id: evaluation.id, dimension_id: dimension.id, score: item.score, status: item.score === 10 ? 'PASS' : 'FAIL', blocker_count: item.blockerCount || 0, gap_count: item.gapCount || 0, test_status: item.testStatus || null, runtime_evidence_status: item.runtimeEvidenceStatus || null, evaluated_at: new Date(), source_fingerprint: sourceFingerprint, metadata: {} }, { transaction });
      const requirements = await getRequirement().findAll({ where: { dimension_id: dimension.id }, transaction });
      for (const requirementResult of item.requirementResults || []) {
        const requirement = requirements.find((candidate) => candidate.requirement_key === requirementResult.requirementKey);
        if (!requirement) continue;
        await getRequirementResult().create({ dimension_result_id: dimensionResult.id, requirement_id: requirement.id, status: requirementResult.status, reason: requirementResult.reason || null, validator: requirementResult.validator || null, test_reference: requirementResult.testReference || null, evidence_reference: requirementResult.evidenceReference || null, runtime_evidence_reference: requirementResult.runtimeEvidenceReference || null, evaluated_at: new Date() }, { transaction });
      }
      for (const gap of item.gaps || []) {
        const persistedGapKey = `${gap.gapKey}:${runId}`;
        await getGap().findOrCreate({ where: { gap_key: persistedGapKey }, defaults: { run_id: runId, dimension_id: dimension.id, requirement_id: null, severity: gap.severity || 'medium', title: gap.title || gap.requirementId || item.dimensionKey, description: gap.description || null, root_cause: gap.rootCause || null, status: gap.status || 'OPEN', opened_at: new Date(), regression_test_reference: gap.testRequired || null, evidence_reference: gap.evidenceReference || null, metadata: { logicalGapKey: gap.gapKey } }, transaction });
      }
    }
    return evaluation;
  });
}

module.exports = { persistDefinitions, persistEvaluation };