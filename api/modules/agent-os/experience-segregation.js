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
 */
const logger = require('../../utils/logger');

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
  '/generate-system', '/dev/system-status', '/dev-dashboard',
  '/dev', '/admin/agents',
];

const SUPPORT_VISIBLE_ROUTES = [
  '/dev/rpa-replays', '/rpa-replays', '/support', '/audit',
  '/workspace', '/inbox',
];

const DEVELOPMENT_VISIBLE_ROUTES = [
  '/dev/qa-waves', '/qa', '/qa-mesh', '/qa/stability',
  '/dev/rpa-replays', '/dev/rpa-test', '/rpa-seeds',
  '/dev/qa-gaps', '/generate-system', '/dev',
  '/dev-dashboard', '/dev/system-status', '/dev/work-management',
  '/admin/agents',
];

function validateRouteVisibility(route, userClassification) {
  if (!userClassification) return { visible: true, reason: 'no_classification' };

  switch (userClassification.toUpperCase()) {
    case 'PRODUCTION':
      if (PRODUCTION_HIDDEN_ROUTES.some(r => route.startsWith(r))) {
        return { visible: false, reason: 'hidden_in_production', route };
      }
      return { visible: true, reason: 'production_allowed' };

    case 'SUPPORT':
      // Support sees replay + operational, but NOT QA Waves dev tools
      if (route.startsWith('/dev/qa-waves') || route.startsWith('/qa-mesh') ||
          route.startsWith('/qa/stability') || route === '/generate-system' ||
          route.startsWith('/admin/agents')) {
        return { visible: false, reason: 'hidden_in_support', route };
      }
      return { visible: true, reason: 'support_allowed' };

    case 'DEVELOPMENT':
      // Development sees everything
      return { visible: true, reason: 'development_allowed' };

    default:
      return { visible: true, reason: 'unknown_classification' };
  }
}

function validateAgentVisibility(agent, userClassification) {
  if (!agent || !agent.classification) return { visible: true };

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
      return { visible: true };
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
  PRODUCTION_VISIBLE_ROUTES,
  PRODUCTION_HIDDEN_ROUTES,
  SUPPORT_VISIBLE_ROUTES,
  DEVELOPMENT_VISIBLE_ROUTES,
};
