'use strict';

/**
 * AutoCorrectionDecisionService
 *
 * Decide se uma autocorreção proposta deve ser aprovada baseado em:
 * - resultados de QA Mesh no sandbox
 * - confiança do diagnóstico
 * - severidade das falhas originais
 * - tipo de patch proposto
 */
class AutoCorrectionDecisionService {
  constructor(deps = {}) {
    this.logger = deps.logger || console;
  }

  /**
   * Avalia se uma autocorreção deve ser aprovada.
   *
   * @param {Object} context
   * @param {Object} context.diagnosis - diagnóstico da falha original
   * @param {Object} context.proposedPatch - patch proposto
   * @param {Object} context.sandboxQAResult - resultado de QA no sandbox
   * @param {Object} context.originalQAResult - resultado de QA original
   * @returns {Object} {approved, confidence, reason, risks, recommendation}
   */
  evaluateApproval(context = {}) {
    const { diagnosis = {}, proposedPatch = {}, sandboxQAResult = {}, originalQAResult = {} } = context;

    if (!sandboxQAResult.governance) {
      return this._buildDecision({
        approved: false,
        confidence: 0,
        reason: 'No QA result available from sandbox',
        risks: ['missing_validation_data'],
        recommendation: 'require_manual_review',
      });
    }

    const sandboxDecision = sandboxQAResult.governance.decision;
    const diagnosticConfidence = diagnosis.confidence || 0.5;
    const originalSeverity = diagnosis.risk || 'medium';

    // Regra 1: Se sandbox passou com GO → forte aprovação
    if (sandboxDecision === 'GO') {
      return this._buildDecision({
        approved: true,
        confidence: Math.min(1, diagnosticConfidence + 0.2),
        reason: 'Sandbox QA validation passed (GO)',
        risks: [],
        recommendation: 'safe_to_apply',
        qaDecision: 'GO',
      });
    }

    // Regra 2: Se sandbox passou com GO_WITH_WARNINGS → aprovação condicional
    if (sandboxDecision === 'GO_WITH_WARNINGS') {
      return this._buildDecision({
        approved: true,
        confidence: Math.min(1, diagnosticConfidence + 0.1),
        reason: 'Sandbox QA validation passed with warnings',
        risks: ['has_warnings', ...(sandboxQAResult.governance.failedChecks || [])],
        recommendation: 'approve_with_monitoring',
        qaDecision: 'GO_WITH_WARNINGS',
      });
    }

    // Regra 3: Se sandbox requer REVIEW → depende de confiança
    if (sandboxDecision === 'REVIEW') {
      const shouldApprove = diagnosticConfidence >= 0.8;
      return this._buildDecision({
        approved: shouldApprove,
        confidence: diagnosticConfidence,
        reason: shouldApprove
          ? 'High diagnostic confidence overrides REVIEW decision'
          : 'Sandbox REVIEW decision requires manual intervention',
        risks: ['requires_human_review', ...(sandboxQAResult.governance.failedChecks || [])],
        recommendation: shouldApprove ? 'approve_with_extra_monitoring' : 'require_manual_review',
        qaDecision: 'REVIEW',
      });
    }

    // Regra 4: Se sandbox falhou (NO_GO) → rejeição
    return this._buildDecision({
      approved: false,
      confidence: 0,
      reason: 'Sandbox QA validation failed (NO_GO)',
      risks: ['patch_made_problem_worse', ...(sandboxQAResult.governance.failedChecks || [])],
      recommendation: 'reject_and_rollback',
      qaDecision: 'NO_GO',
    });
  }

  /**
   * Calcula score de confiança da autocorreção.
   *
   * @param {Object} context - contexto da correção
   * @returns {number} 0-1 confiança
   */
  calculateConfidenceScore(context = {}) {
    const { diagnosis = {}, sandboxQAResult = {}, patchComplexity = 'medium' } = context;

    let score = 0.5; // baseline

    // Fator 1: Confiança do diagnóstico
    score += (diagnosis.confidence || 0.5) * 0.3;

    // Fator 2: Resultado de QA no sandbox
    const qaDecision = sandboxQAResult.governance?.decision;
    if (qaDecision === 'GO') score += 0.25;
    else if (qaDecision === 'GO_WITH_WARNINGS') score += 0.15;
    else if (qaDecision === 'REVIEW') score += 0.05;
    else score -= 0.1;

    // Fator 3: Complexidade do patch (patches simples = mais confiança)
    if (patchComplexity === 'simple') score += 0.15;
    else if (patchComplexity === 'medium') score += 0.05;
    else if (patchComplexity === 'complex') score -= 0.1;

    return Math.max(0, Math.min(1, Number(score.toFixed(2))));
  }

  /**
   * Recomenda ação de risk mitigation.
   *
   * @param {Object} decision - resultado de evaluateApproval
   * @returns {Array} de ações recomendadas
   */
  getRiskMitigationActions(decision = {}) {
    const actions = [];

    if (decision.recommendation === 'safe_to_apply') {
      actions.push({
        type: 'apply_immediately',
        description: 'Patch is safe to apply; no special precautions needed.',
      });
      return actions;
    }

    if (decision.recommendation === 'approve_with_monitoring') {
      actions.push({
        type: 'apply_with_monitoring',
        description: 'Apply patch but enable extra logging and monitoring for 24 hours.',
      });
      return actions;
    }

    if (decision.recommendation === 'approve_with_extra_monitoring') {
      actions.push({
        type: 'apply_with_extra_monitoring',
        description: 'Apply patch with enhanced monitoring; set rollback threshold low.',
      });
      actions.push({
        type: 'create_monitoring_insight',
        description: 'Create WorkspaceInsight to track patch behavior.',
      });
      return actions;
    }

    if (decision.recommendation === 'require_manual_review') {
      actions.push({
        type: 'manual_review_required',
        description: 'Escalate to human review team.',
      });
      actions.push({
        type: 'create_action_for_review',
        description: 'Create WorkspaceAction requesting manual intervention.',
      });
      return actions;
    }

    if (decision.recommendation === 'reject_and_rollback') {
      actions.push({
        type: 'reject_patch',
        description: 'Do not apply this patch; it made the problem worse.',
      });
      actions.push({
        type: 'create_alternative_diagnostic',
        description: 'Generate alternative diagnostic and patch proposal.',
      });
      return actions;
    }

    return actions;
  }

  /**
   * Fornece response estruturada.
   */
  _buildDecision({ approved, confidence, reason, risks = [], recommendation, qaDecision = null }) {
    return {
      approved,
      confidence: Number(confidence.toFixed(2)),
      reason,
      risks,
      recommendation,
      qaDecision,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Retorna mensagem legível de decisão.
   */
  getDecisionMessage(decision = {}) {
    const { approved, confidence, reason, recommendation } = decision;
    const approvalEmoji = approved ? '✅' : '❌';
    const confidencePercent = (confidence * 100).toFixed(0);

    return `${approvalEmoji} [${recommendation}] ${reason} (Confiança: ${confidencePercent}%)`;
  }
}

module.exports = AutoCorrectionDecisionService;
