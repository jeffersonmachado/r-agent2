'use strict';

/**
 * engine/engineeringMission/autoApprovalPolicy.js — autoaprovação governada por POLÍTICA.
 *
 * Princípios inegociáveis (§10–§12):
 *   - autoaprovação autoriza apenas "esta MissionSpec enriquecida pode começar a ser executada";
 *     NUNCA autoriza GREEN, nunca pula review/adversarial/regressão/evidência;
 *   - o preview é gerado e persistido mesmo quando aprovado automaticamente — autoaprovação não
 *     é execução invisível;
 *   - as condições de bloqueio são DADOS de política (administráveis), não `if` espalhados pelo
 *     código de execução.
 *
 * Módulo puro (sem I/O). Quem decide a política vigente é a camada de serviço (config/DB).
 */

const { APPROVAL_MODES, AUTO_APPROVAL_BLOCK_REASONS, MISSION_TYPES } = require('./constants');

const RISK_RANK = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 });

/** Papel responsável pela regra de autoaprovação (auditoria). */
const POLICY_ID_DEFAULT = 'engineering-mission-autoapproval-v1';

/**
 * Tipos de missão considerados reversíveis/seguros para o modo SAFE_ONLY.
 * Conservador por construção: qualquer coisa que possa alterar segurança, dados, tenancy,
 * infraestrutura ou release fica de fora e exige decisão humana/política explícita.
 */
const SAFE_ONLY_MISSION_TYPES = Object.freeze([
  'TECH_DEBT',
  'REFACTOR',
  'QA_HARDENING',
  'INVESTIGATION',
  'PERFORMANCE',
]);

const DEFAULT_POLICY = Object.freeze({
  policyId: POLICY_ID_DEFAULT,
  enabled: false,
  mode: 'MANUAL',
  maxRisk: 'MEDIUM',
  confidenceThreshold: 0.75,
  allowedMissionTypes: [],           // vazio = qualquer tipo permitido no modo POLICY_BASED
  allowedRepositories: [],           // vazio = qualquer repositório
  allowedBranches: ['main'],
  allowedScopes: ['SMALL', 'MEDIUM'],
  allowDerivedRequirements: true,
  allowPolicyRequirements: true,
});

/** Regras que, por definição de política, exigem decisão humana (§11). */
const HUMAN_ONLY_RULE_IDS = Object.freeze([
  'TENANT_ISOLATION',
  'SECRET_HYGIENE',
  'RBAC_AND_CLASSIFICATION',
  'DESTRUCTIVE_OPERATION_GUARD',
  'PRODUCTION_DESTRUCTIVE_OPERATION',
  'INCOMPATIBLE_SCHEMA_SAFETY',
]);

function resolvePolicy(overrides = {}) {
  return { ...DEFAULT_POLICY, ...overrides };
}

function addBlocker(blockers, code, detail) {
  blockers.push({ code, detail });
}

/**
 * Avalia se uma MissionSpec enriquecida pode ser autoaprovada pela política vigente.
 *
 * @param {Object} params
 * @param {Object} params.policy
 * @param {Object} params.spec           — MissionSpec corrente (vN)
 * @param {Object} params.enrichment     — saída do enrichmentBuilder
 * @param {string} [params.repository]
 * @param {string} [params.branch]
 * @returns {{eligible:boolean, mode:string, policyId:string, blockers:Array, rulesEvaluated:string[], risk:string, confidence:number}}
 */
function evaluateAutoApproval({ policy: policyOverrides = {}, spec = {}, enrichment = {}, repository = null, branch = null }) {
  const policy = resolvePolicy(policyOverrides);
  const blockers = [];
  const rulesEvaluated = [];

  const risk = enrichment.risk || spec.risk || 'MEDIUM';
  const confidence = typeof enrichment.confidence === 'number' ? enrichment.confidence : (typeof spec.confidence === 'number' ? spec.confidence : 0);
  const missionType = enrichment.missionType || spec.missionType || null;

  if (!policy.enabled) {
    addBlocker(blockers, AUTO_APPROVAL_BLOCK_REASONS.DISABLED, 'autoaprovação desabilitada nesta instalação');
  }
  if (policy.mode === 'MANUAL') {
    addBlocker(blockers, AUTO_APPROVAL_BLOCK_REASONS.MODE_MANUAL, 'modo MANUAL exige aprovação humana para toda missão enriquecida');
  }

  const requirements = Array.isArray(enrichment.derivedRequirements) ? enrichment.derivedRequirements : [];
  const policyRequirements = requirements.filter((r) => r.enrichmentType === 'POLICY_REQUIRED');
  const derivedRequirements = requirements.filter((r) => r.enrichmentType !== 'POLICY_REQUIRED');

  // Condições de bloqueio de segurança/destrutividade — valem em QUALQUER modo de autoaprovação,
  // inclusive SAFE_ONLY e POLICY_BASED (nunca são relaxáveis por configuração).
  rulesEvaluated.push('HUMAN_ONLY_ENRICHMENT_RULES');
  for (const req of requirements) {
    if (req.ruleId && HUMAN_ONLY_RULE_IDS.includes(req.ruleId)) {
      const code = {
        TENANT_ISOLATION: AUTO_APPROVAL_BLOCK_REASONS.TENANT_ISOLATION_CHANGE,
        SECRET_HYGIENE: AUTO_APPROVAL_BLOCK_REASONS.SECRET_EXPOSURE,
        RBAC_AND_CLASSIFICATION: AUTO_APPROVAL_BLOCK_REASONS.RBAC_CRITICAL_CHANGE,
        DESTRUCTIVE_OPERATION_GUARD: AUTO_APPROVAL_BLOCK_REASONS.IRREVERSIBLE_DESTRUCTIVE_ACTION,
        PRODUCTION_DESTRUCTIVE_OPERATION: AUTO_APPROVAL_BLOCK_REASONS.DESTRUCTIVE_PRODUCTION_OPERATION,
        INCOMPATIBLE_SCHEMA_SAFETY: AUTO_APPROVAL_BLOCK_REASONS.INCOMPATIBLE_SCHEMA_CHANGE,
      }[req.ruleId];
      addBlocker(blockers, code, `regra de enriquecimento "${req.ruleId}" exige decisão humana: ${req.text}`);
    }
  }

  if (Array.isArray(enrichment.contradictions) && enrichment.contradictions.length > 0) {
    rulesEvaluated.push('CONTRADICTIONS');
    for (const c of enrichment.contradictions) {
      addBlocker(blockers, AUTO_APPROVAL_BLOCK_REASONS.CONTRADICTORY_REQUIREMENT, c.reason);
    }
  }

  if (enrichment.ambiguity && enrichment.ambiguity.material) {
    rulesEvaluated.push('MATERIAL_AMBIGUITY');
    addBlocker(
      blockers,
      AUTO_APPROVAL_BLOCK_REASONS.MATERIAL_AMBIGUITY,
      `ambiguidade material detectada: ${enrichment.ambiguity.flags.join(', ')}`,
    );
  }

  // Autorização explícita de escopo irrestrito (allowedPaths vazio com scope REPOSITORY_WIDE) é
  // uma decisão de POLÍTICA de segurança: por definição exige decisão humana, nunca autoaprovação.
  if (spec.explicitPolicyAuthorization === true) {
    rulesEvaluated.push('EXPLICIT_POLICY_AUTHORIZATION');
    addBlocker(
      blockers,
      AUTO_APPROVAL_BLOCK_REASONS.SECURITY_POLICY_CHANGE,
      'a missão declara autorização explícita de política (escopo irrestrito) — exige aprovação humana',
    );
  }

  if (policy.mode === 'SAFE_ONLY') {
    rulesEvaluated.push('SAFE_ONLY_REVERSIBLE_TYPES');
    if (!SAFE_ONLY_MISSION_TYPES.includes(missionType)) {
      addBlocker(
        blockers,
        AUTO_APPROVAL_BLOCK_REASONS.MISSION_TYPE_NOT_ALLOWED,
        `missão do tipo ${missionType} não é reversível/segura para autoaprovação SAFE_ONLY (permitidos: ${SAFE_ONLY_MISSION_TYPES.join(', ')})`,
      );
    }
    // SAFE_ONLY nunca aceita requisito de política crítico nem risco acima de MEDIUM.
    if (RISK_RANK[risk] > RISK_RANK.MEDIUM) {
      addBlocker(blockers, AUTO_APPROVAL_BLOCK_REASONS.RISK_ABOVE_POLICY, `risco ${risk} acima do máximo MEDIUM do modo SAFE_ONLY`);
    }
    if (policyRequirements.length > 0) {
      addBlocker(
        blockers,
        AUTO_APPROVAL_BLOCK_REASONS.POLICY_REQUIREMENTS_NOT_ALLOWED,
        `modo SAFE_ONLY não autoaprova missões com exigência obrigatória de política (${policyRequirements.map((r) => r.ruleId).join(', ')})`,
      );
    }
  }

  if (policy.mode === 'POLICY_BASED') {
    rulesEvaluated.push('POLICY_MAX_RISK');
    if (RISK_RANK[risk] > RISK_RANK[policy.maxRisk]) {
      addBlocker(blockers, AUTO_APPROVAL_BLOCK_REASONS.RISK_ABOVE_POLICY, `risco ${risk} acima do máximo configurado (${policy.maxRisk})`);
    }
    rulesEvaluated.push('POLICY_CONFIDENCE_THRESHOLD');
    if (confidence < policy.confidenceThreshold) {
      addBlocker(
        blockers,
        AUTO_APPROVAL_BLOCK_REASONS.CONFIDENCE_BELOW_THRESHOLD,
        `confiança ${confidence} abaixo do limiar ${policy.confidenceThreshold}`,
      );
    }
  }

  rulesEvaluated.push('POLICY_MISSION_TYPES');
  if (Array.isArray(policy.allowedMissionTypes) && policy.allowedMissionTypes.length > 0) {
    if (!policy.allowedMissionTypes.includes(missionType)) {
      addBlocker(blockers, AUTO_APPROVAL_BLOCK_REASONS.MISSION_TYPE_NOT_ALLOWED, `tipo ${missionType} não permitido pela política`);
    }
    for (const t of policy.allowedMissionTypes) {
      if (!MISSION_TYPES.includes(t)) {
        addBlocker(blockers, AUTO_APPROVAL_BLOCK_REASONS.MISSION_TYPE_NOT_ALLOWED, `política declara tipo desconhecido "${t}"`);
      }
    }
  }

  rulesEvaluated.push('POLICY_REPOSITORY');
  if (Array.isArray(policy.allowedRepositories) && policy.allowedRepositories.length > 0) {
    const repo = repository || spec.repository || null;
    if (!repo || !policy.allowedRepositories.includes(repo)) {
      addBlocker(blockers, AUTO_APPROVAL_BLOCK_REASONS.REPOSITORY_NOT_ALLOWED, `repositório "${repo}" não permitido pela política`);
    }
  }

  rulesEvaluated.push('POLICY_BRANCH');
  const targetBranch = branch || spec.branch || null;
  if (Array.isArray(policy.allowedBranches) && policy.allowedBranches.length > 0) {
    if (!targetBranch || !policy.allowedBranches.includes(targetBranch)) {
      addBlocker(blockers, AUTO_APPROVAL_BLOCK_REASONS.BRANCH_NOT_ALLOWED, `branch "${targetBranch}" não permitido pela política`);
    }
  }

  rulesEvaluated.push('POLICY_SCOPE');
  if (Array.isArray(policy.allowedScopes) && policy.allowedScopes.length > 0) {
    const scope = spec.scope || null;
    if (scope && !policy.allowedScopes.includes(scope)) {
      addBlocker(blockers, AUTO_APPROVAL_BLOCK_REASONS.SCOPE_NOT_ALLOWED, `escopo "${scope}" não permitido pela política`);
    }
  }

  rulesEvaluated.push('POLICY_DERIVED_REQUIREMENTS');
  if (policy.allowDerivedRequirements === false && derivedRequirements.length > 0) {
    addBlocker(
      blockers,
      AUTO_APPROVAL_BLOCK_REASONS.DERIVED_REQUIREMENTS_NOT_ALLOWED,
      `política proíbe autoaprovar missões com requisitos derivados (${derivedRequirements.length})`,
    );
  }

  rulesEvaluated.push('POLICY_REQUIREMENTS');
  if (policy.allowPolicyRequirements === false && policyRequirements.length > 0) {
    addBlocker(
      blockers,
      AUTO_APPROVAL_BLOCK_REASONS.POLICY_REQUIREMENTS_NOT_ALLOWED,
      `política proíbe autoaprovar missões com requisitos obrigatórios de política (${policyRequirements.length})`,
    );
  }

  return {
    eligible: blockers.length === 0,
    mode: policy.mode,
    policyId: policy.policyId,
    blockers,
    rulesEvaluated,
    risk,
    confidence,
    maxRisk: policy.maxRisk,
    confidenceThreshold: policy.confidenceThreshold,
  };
}

/**
 * Uma alteração CRITICAL da MissionSpec nunca é autoaprovada (§15) — vale mesmo com
 * autoaprovação habilitada.
 */
function requiresHumanApprovalForMateriality(materiality) {
  return materiality === 'CRITICAL';
}

module.exports = {
  POLICY_ID_DEFAULT,
  DEFAULT_POLICY,
  SAFE_ONLY_MISSION_TYPES,
  HUMAN_ONLY_RULE_IDS,
  RISK_RANK,
  resolvePolicy,
  evaluateAutoApproval,
  requiresHumanApprovalForMateriality,
  isKnownApprovalMode: (mode) => APPROVAL_MODES.includes(mode),
};
