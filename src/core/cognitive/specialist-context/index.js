'use strict';

/**
 * Specialist Runtime Context — contexto operacional do especialista roteado.
 *
 * Extraído da decisão do Supervisor + profile do agente, fornece ao Planner
 * e ao Execution Router as políticas que influenciam planejamento e execução.
 *
 * Campos:
 *  - agentId, slug, goal, classification
 *  - capabilities, allowedTools
 *  - autonomyPolicy, knowledgeScope, delegationPolicy
 *  - riskPolicy, processPolicy
 *  - channelPolicy, verticalPolicy
 */

function buildSpecialistRuntimeContext(supervisorDecision, agentProfile = {}) {
  if (!supervisorDecision || supervisorDecision.status !== 'routed') {
    return null;
  }

  const config = agentProfile.config || {};

  return {
    agentId: supervisorDecision.agentId,
    slug: supervisorDecision.agentSlug,
    goal: config.goal || agentProfile.goal || null,
    classification: supervisorDecision.classification,

    // Capabilities e tools permitidas (filtradas pelo Supervisor)
    capabilities: supervisorDecision.capabilities || [],
    allowedTools: supervisorDecision.allowedTools || [],

    // Políticas do especialista
    autonomyPolicy: Object.freeze({
      ...(config.autonomy || {}),
    }),

    knowledgeScope: supervisorDecision.knowledgeScope || null,

    delegationPolicy: Object.freeze({
      allowed: (config.delegation && config.delegation.allowed) ? [...config.delegation.allowed] : [],
      maxDepth: (config.delegation && config.delegation.maxDepth) || null,
    }),

    riskPolicy: Object.freeze({
      maxRiskLevel: config.maxRiskLevel || 'medium',
      requireConfirmationAbove: config.requireConfirmationAbove || 'medium',
    }),

    processPolicy: Object.freeze({
      durablePreferred: config.processPolicy?.durablePreferred === true,
      maxRetries: config.processPolicy?.maxRetries ?? 3,
      compensationEnabled: config.processPolicy?.compensationEnabled !== false,
    }),

    channelPolicy: Object.freeze({
      allowed: Array.isArray(config.channels) ? [...config.channels] : [],
    }),

    verticalPolicy: Object.freeze({
      vertical: config.vertical || null,
      inherited: config.verticals?.inherited !== false,
    }),
  };
}

/**
 * Combina a política de autonomia do especialista com a política de
 * confirmação da tool para decidir se a tool pode executar sem confirmação.
 *
 * Regra:
 *  - tool.confirmationPolicy 'confirmation_required' → sempre exige confirmação
 *  - tool.confirmationPolicy 'policy_based' → consulta autonomyPolicy
 *  - tool.confirmationPolicy 'autonomous' → não exige confirmação
 *
 * A autonomia do agente NUNCA eleva a política da tool (autonomous nunca
 * sobrescreve confirmation_required). A LLM nunca pode elevar autonomia.
 */
function resolveConfirmationRequirement(tool, specialistContext) {
  if (!tool) return { requiresConfirmation: false };

  const toolPolicy = tool.confirmationPolicy || 'autonomous';

  // confirmation_required é absoluto — nem agente autônomo pode bypassar.
  if (toolPolicy === 'confirmation_required') {
    return { requiresConfirmation: true, reason: 'tool_confirmation_required' };
  }

  if (toolPolicy === 'autonomous') {
    return { requiresConfirmation: false, reason: 'tool_autonomous' };
  }

  // policy_based: consulta o perfil do especialista
  if (toolPolicy === 'policy_based') {
    if (!specialistContext) {
      // Sem especialista, policy_based exige confirmação (fail closed).
      return { requiresConfirmation: true, reason: 'policy_based_no_specialist' };
    }

    const autonomy = specialistContext.autonomyPolicy;
    const toolAction = tool.id;

    // Autonomia explícita por ação declarada no profile
    if (autonomy[toolAction] === 'autonomous') {
      return { requiresConfirmation: false, reason: 'agent_autonomous_for_action' };
    }
    if (autonomy[toolAction] === 'confirmation_required') {
      return { requiresConfirmation: true, reason: 'agent_requires_confirmation_for_action' };
    }

    // Risco da tool vs política de risco do especialista
    const toolRisk = tool.riskLevel || 'low';
    const riskLevels = { low: 0, medium: 1, high: 2 };
    const maxRisk = riskLevels[specialistContext.riskPolicy.maxRiskLevel] ?? 1;
    const confirmAbove = riskLevels[specialistContext.riskPolicy.requireConfirmationAbove] ?? 1;

    if (riskLevels[toolRisk] > maxRisk) {
      return { requiresConfirmation: true, reason: `tool_risk_${toolRisk}_exceeds_max_${specialistContext.riskPolicy.maxRiskLevel}` };
    }
    if (riskLevels[toolRisk] > confirmAbove) {
      return { requiresConfirmation: true, reason: `tool_risk_${toolRisk}_above_confirmation_threshold_${specialistContext.riskPolicy.requireConfirmationAbove}` };
    }

    return { requiresConfirmation: false, reason: 'policy_based_allowed' };
  }

  return { requiresConfirmation: false, reason: 'unknown_policy_default_deny' };
}

module.exports = {
  buildSpecialistRuntimeContext,
  resolveConfirmationRequirement,
};
