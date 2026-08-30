'use strict';

/**
 * Experience Segregation Validator
 *
 * Valida que a política de segregação PRODUCTION / SUPPORT / DEVELOPMENT está sendo respeitada.
 *
 * PRODUCTION: Workspace, Inbox, CRM, Agenda, PBX, Campanhas, Analytics, IA, Operações
 *   Oculto: Replay, QA Waves, Seeds, Validation Engine, Coverage Analysis, Regression Engine, RPA Lab
 *
 * SUPPORT: Replay, Incidentes, Diagnóstico, Logs, Auditoria, Evidências
 *
 * DEVELOPMENT: QA Waves, Replay Studio, Seeds, Scenario Builder, Validation Engine, Coverage Analysis, Regression Engine, RPA Lab
 *
 * Exceção documentada (revisão 2026-07-28): GET /replay/:sessionId
 * (api/modules/domain-flow/flow-execution/flowExecutionRoutes.js) permanece
 * PRODUCTION porque é o replay da CONVERSA SIMULADA do editor de fluxos —
 * parte do construtor operacional de chatbots, não o replay diagnóstico de
 * RPA/sessões reais (esses estão em SUPPORT/DEVELOPMENT: /rpa-replays,
 * /api/test-executions/replays, /api/qa-waves/replays). Proteções vigentes:
 * requireAuth obrigatório + isolamento por tenant (carimbo sessionTenants,
 * fail-closed 404 cross-tenant). Revisar esta exceção se o endpoint passar
 * a expor qualquer dado de sessões reais de clientes.
 */
const logger = require('../../utils/logger');

/**
 * Classificações de experiência e hierarquia (fonte única da política).
 *
 * Política (2026-08-27): tenantRole e platformClassification são eixos
 * INDEPENDENTES. O role de negócio do tenant (owner/admin/operator/auditor/...)
 * NÃO concede acesso a plataforma — um auditor de tenant é PRODUCTION.
 * Classificação de plataforma só vem de fonte server-side:
 *   1. `agent.platformClassification` explícito (setado server-side);
 *   2. `agent.platformRole` (coluna users.platform_role), mapeado via
 *      PLATFORM_ROLE_CLASSIFICATION;
 *   3. fallback legado reduzido: role `super_admin` → DEVELOPMENT
 *      (flag de plataforma, mantida);
 *   4. caso contrário → PRODUCTION.
 */
const CLASSIFICATIONS = Object.freeze({
  PRODUCTION: 'PRODUCTION',
  SUPPORT: 'SUPPORT',
  DEVELOPMENT: 'DEVELOPMENT',
});

const CLASSIFICATION_RANK = Object.freeze({
  PRODUCTION: 1,
  SUPPORT: 2,
  DEVELOPMENT: 3,
});

/**
 * Mapeamento platformRole (lowercase) → classificação de plataforma.
 * Platform roles são concedidos server-side (coluna users.platform_role);
 * usuários de tenant têm platform_role NULL e caem no fallback.
 */
const PLATFORM_ROLE_CLASSIFICATION = Object.freeze({
  support_n1: CLASSIFICATIONS.SUPPORT,
  support_n2: CLASSIFICATIONS.SUPPORT,
  support_n3: CLASSIFICATIONS.SUPPORT,
  customer_success: CLASSIFICATIONS.SUPPORT,
  platform_support: CLASSIFICATIONS.SUPPORT,
  engineer: CLASSIFICATIONS.DEVELOPMENT,
  qa_engineer: CLASSIFICATIONS.DEVELOPMENT,
  devops: CLASSIFICATIONS.DEVELOPMENT,
  platform_engineer: CLASSIFICATIONS.DEVELOPMENT,
  developer: CLASSIFICATIONS.DEVELOPMENT,
});

function getClassificationForAgent(agent) {
  // 1. Classificação explícita, setada server-side.
  const explicit = String(agent?.platformClassification || '').trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(CLASSIFICATIONS, explicit)) {
    return CLASSIFICATIONS[explicit];
  }
  // 2. Platform role concedido server-side.
  const platformRole = String(agent?.platformRole || '').trim().toLowerCase();
  if (platformRole && PLATFORM_ROLE_CLASSIFICATION[platformRole]) {
    return PLATFORM_ROLE_CLASSIFICATION[platformRole];
  }
  // 3. Fallback legado reduzido: super_admin é flag de plataforma.
  const role = String(agent?.role || '').trim().toLowerCase();
  if (role === 'super_admin') return CLASSIFICATIONS.DEVELOPMENT;
  // 4. Demais roles de tenant (inclui auditor) → PRODUCTION.
  return CLASSIFICATIONS.PRODUCTION;
}

/**
 * Hierarquia: DEVELOPMENT > SUPPORT > PRODUCTION.
 * Retorna true apenas quando a classificação do ator atinge o mínimo exigido
 * (mínimo inválido/desconhecido falha fechado).
 */
function classificationMeets(classification, min) {
  const current = CLASSIFICATION_RANK[String(classification || '').toUpperCase()] || 0;
  const required = CLASSIFICATION_RANK[String(min || '').toUpperCase()] || 0;
  return required > 0 && current >= required;
}

const PRODUCTION_VISIBLE_ROUTES = [
  '/workspace', '/dashboard', '/support', '/inbox', '/crm',
  '/agenda', '/pbx', '/campaigns', '/analytics', '/ai-tools',
  '/operations-dashboard', '/editor', '/tasks', '/projects',
  '/knowledge-base', '/faq', '/rag-documents',
];

const PRODUCTION_HIDDEN_ROUTES = [
  '/dev/rpa-replays', '/rpa-replays', '/dev/rpa-test', '/rpa-seeds',
  '/dev/qa-waves', '/qa', '/qa-mesh', '/qa/stability',
  '/dev/qa-gaps', '/dev/work-management',
  '/generate-system', '/dev/system-status', '/system-status', '/dev-dashboard',
  '/dev', '/admin/agents',
];

// /rpa-replays (alias que renderiza a página de replays) é acessível a SUPPORT
// no frontend; /dev/rpa-replays permanece DEVELOPMENT-only (prefixo /dev).
const SUPPORT_VISIBLE_ROUTES = [
  '/rpa-replays', '/support', '/audit',
  '/workspace', '/inbox',
];

const DEVELOPMENT_VISIBLE_ROUTES = [
  '/dev/qa-waves', '/qa', '/qa-mesh', '/qa/stability',
  '/dev/rpa-replays', '/dev/rpa-test', '/rpa-seeds',
  '/dev/qa-gaps', '/generate-system', '/dev',
  '/dev-dashboard', '/dev/system-status', '/system-status', '/dev/work-management',
  '/admin/agents',
];

function validateRouteVisibility(route, userClassification) {
  // P1: Fail closed — sem classificação, unknown, ou inválida → DENY.
  if (!userClassification) return { visible: false, reason: 'no_classification_denied' };

  switch (userClassification.toUpperCase()) {
    case 'PRODUCTION':
      if (PRODUCTION_HIDDEN_ROUTES.some(r => route.startsWith(r))) {
        return { visible: false, reason: 'hidden_in_production', route };
      }
      return { visible: true, reason: 'production_allowed' };

    case 'SUPPORT':
      if (route.startsWith('/dev/qa-waves') || route.startsWith('/qa-mesh') ||
          route.startsWith('/qa/stability') || route === '/generate-system' ||
          route.startsWith('/admin/agents')) {
        return { visible: false, reason: 'hidden_in_support', route };
      }
      return { visible: true, reason: 'support_allowed' };

    case 'DEVELOPMENT':
      return { visible: true, reason: 'development_allowed' };

    default:
      // P1: unknown classification → DENY (fail closed).
      return { visible: false, reason: `unknown_classification_denied: ${userClassification}` };
  }
}

function validateAgentVisibility(agent, userClassification) {
  // P1: Fail closed — sem classificação do agente ou do usuário → DENY.
  if (!agent || !agent.classification) return { visible: false, reason: 'missing_agent_classification' };
  if (!userClassification || !['PRODUCTION', 'SUPPORT', 'DEVELOPMENT'].includes(String(userClassification).toUpperCase())) {
    return { visible: false, reason: 'invalid_user_classification' };
  }

  switch (userClassification.toUpperCase()) {
    case 'PRODUCTION':
      if (agent.classification !== 'PRODUCTION') {
        return { visible: false, reason: 'agent_not_production', agentClassification: agent.classification };
      }
      return { visible: true };

    case 'SUPPORT':
      if (agent.classification === 'DEVELOPMENT') {
        return { visible: false, reason: 'agent_development_hidden_from_support', agentClassification: agent.classification };
      }
      return { visible: true };

    case 'DEVELOPMENT':
      return { visible: true };

    default:
      // P1: unknown classification → DENY (fail closed).
      return { visible: false, reason: `unknown_classification_denied: ${userClassification}` };
  }
}

function generateSegregationReport() {
  return {
    policy: 'PRODUCTION / SUPPORT / DEVELOPMENT',
    production: {
      visible: PRODUCTION_VISIBLE_ROUTES.length,
      hidden: PRODUCTION_HIDDEN_ROUTES.length,
    },
    support: {
      visible: SUPPORT_VISIBLE_ROUTES.length,
    },
    development: {
      visible: DEVELOPMENT_VISIBLE_ROUTES.length,
    },
    status: 'VALID',
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  validateRouteVisibility,
  validateAgentVisibility,
  generateSegregationReport,
  getClassificationForAgent,
  classificationMeets,
  CLASSIFICATIONS,
  CLASSIFICATION_RANK,
  PLATFORM_ROLE_CLASSIFICATION,
  PRODUCTION_VISIBLE_ROUTES,
  PRODUCTION_HIDDEN_ROUTES,
  SUPPORT_VISIBLE_ROUTES,
  DEVELOPMENT_VISIBLE_ROUTES,
};
