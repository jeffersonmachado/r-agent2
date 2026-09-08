'use strict';

/**
 * workspace.route-classifications.js
 *
 * Fonte única PURA do mapa de classificação de rotas do workspace
 * ('METHOD /path' → 'PRODUCTION' | 'SUPPORT' | 'DEVELOPMENT').
 *
 * ZERO requires: este módulo é carregado offline pelo gate de governança
 * scripts/governance/validate-experience-api-segregation.js (sem node_modules,
 * sem express, sem DB). Nunca importar nada aqui — se a classificação
 * precisar de lógica de runtime, ela fica em workspace.routes.js /
 * workspace.controller.js, que CONSOMEM este módulo.
 */

const WORKSPACE_ROUTE_CLASSIFICATIONS = {
  'GET /workspace/entities/:id/autocorrections': 'DEVELOPMENT',
};

function getRouteClassification(routeKey) {
  return WORKSPACE_ROUTE_CLASSIFICATIONS[routeKey] || null;
}

module.exports = { WORKSPACE_ROUTE_CLASSIFICATIONS, getRouteClassification };
