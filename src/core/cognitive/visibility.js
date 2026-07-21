'use strict';

/**
 * Política de visibilidade do Cognitive Core.
 *
 * Mesma classificação do Agent OS (api/modules/agent-os/experience-segregation.js):
 *   PRODUCTION  → usuários operacionais (Workspace, Inbox, CRM, Agenda, PBX, Campanhas, Analytics, IA operacional)
 *   SUPPORT     → suporte (Replay, diagnóstico, evidências, auditoria, logs)
 *   DEVELOPMENT → engenharia (QA Waves, Mesh, Seeds, Validation interna, Scenario Builder, Coverage, RPA Lab)
 *
 * Regra absoluta: componentes DEVELOPMENT nunca aparecem para operação.
 */

const VISIBILITY = Object.freeze({
  PRODUCTION: 'PRODUCTION',
  SUPPORT: 'SUPPORT',
  DEVELOPMENT: 'DEVELOPMENT',
});

const VISIBILITY_RANK = Object.freeze({
  PRODUCTION: 0,
  SUPPORT: 1,
  DEVELOPMENT: 2,
});

/**
 * Termos de engenharia/QA que jamais podem vazar para a camada operacional
 * (ids, descrições ou resultados de tools visíveis em PRODUCTION).
 */
const OPERATIONAL_FORBIDDEN_PATTERN = /(qa[\s_-]?wave|qa[\s_-]?mesh|\breplay\b|\bseed(s)?\b|\brpa\b|scenario[\s_-]?builder|coverage[\s_-]?analysis)/i;

function isValidVisibility(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(VISIBILITY, value);
}

/**
 * Um ator com classificação X enxerga tools com rank <= rank(X).
 * PRODUCTION enxerga apenas PRODUCTION.
 */
function canAccess(actorClassification, toolVisibility) {
  const actorRank = VISIBILITY_RANK[String(actorClassification || '').toUpperCase()];
  const toolRank = VISIBILITY_RANK[String(toolVisibility || '').toUpperCase()];
  if (actorRank === undefined || toolRank === undefined) return false;
  return toolRank <= actorRank;
}

module.exports = {
  VISIBILITY,
  VISIBILITY_RANK,
  OPERATIONAL_FORBIDDEN_PATTERN,
  isValidVisibility,
  canAccess,
};
