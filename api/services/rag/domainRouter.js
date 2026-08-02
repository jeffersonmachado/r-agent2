'use strict';

/**
 * Domain Router do RAG — resolve o escopo de recuperação ANTES da busca vetorial.
 *
 * Regras (RAG Domain Segregation, 2026-08-01):
 * - O domínio NUNCA é escolhido pelo conteúdo da pergunta nem por metadados
 *   enviados pelo cliente: identidade, classificação do ator e tenant limitam
 *   as opções antes de qualquer recuperação.
 * - PRODUCTION → apenas OPERATIONAL/PRODUCTION do próprio tenant.
 * - SUPPORT    → OPERATIONAL do tenant autorizado + SYSTEM/SUPPORT.
 * - DEVELOPMENT→ OPERATIONAL + SYSTEM (SUPPORT e DEVELOPMENT).
 * - Na dúvida, o escopo mais restritivo é aplicado.
 * - Não existe fallback entre domínios: se o domínio solicitado não é permitido,
 *   a resolução é negada (o chamador responde "sem informação autorizada").
 */

const {
  CLASSIFICATIONS,
  getClassificationForAgent,
} = require('../../modules/agent-os/experience-segregation');

const CLASSIFICATION_VALUES = Object.freeze(Object.values(CLASSIFICATIONS));

const DOMAINS = Object.freeze(['OPERATIONAL', 'SYSTEM']);
const DOMAIN_CLASSIFICATIONS = Object.freeze({
  OPERATIONAL: Object.freeze(['PRODUCTION', 'SUPPORT']),
  SYSTEM: Object.freeze(['SUPPORT', 'DEVELOPMENT']),
});

// Classificações que cada perfil pode recuperar, por domínio.
const ACTOR_DOMAIN_POLICY = Object.freeze({
  PRODUCTION: Object.freeze({
    OPERATIONAL: Object.freeze(['PRODUCTION']),
    SYSTEM: Object.freeze([]),
  }),
  SUPPORT: Object.freeze({
    OPERATIONAL: Object.freeze(['PRODUCTION', 'SUPPORT']),
    SYSTEM: Object.freeze(['SUPPORT']),
  }),
  DEVELOPMENT: Object.freeze({
    OPERATIONAL: Object.freeze(['PRODUCTION', 'SUPPORT']),
    SYSTEM: Object.freeze(['SUPPORT', 'DEVELOPMENT']),
  }),
});

const DEFAULT_SCOPE = Object.freeze({
  domain: 'OPERATIONAL',
  classifications: Object.freeze(['PRODUCTION']),
});

function normalizeDomain(value) {
  const domain = String(value || '').trim().toUpperCase();
  return DOMAINS.includes(domain) ? domain : null;
}

/**
 * Resolve o escopo de recuperação para um ator.
 *
 * @param {Object} input
 * @param {Object|null} input.actor - Agente autenticado (req.agent) ou null (fluxo interno operacional)
 * @param {string} [input.requestedDomain] - Domínio solicitado pelo chamador (nunca pelo texto da pergunta)
 * @returns {{allowed: boolean, scope: {domain: string, classifications: string[]}, retrievalPolicy: string, reason: string}}
 */
function resolveRetrievalScope({ actor = null, requestedDomain = null } = {}) {
  // Fluxos internos operacionais (chatbot, aiNode) sem ator autenticado:
  // escopo mais restritivo, sempre.
  if (!actor) {
    const domain = normalizeDomain(requestedDomain);
    if (domain && domain !== 'OPERATIONAL') {
      return {
        allowed: false,
        scope: { ...DEFAULT_SCOPE, classifications: [...DEFAULT_SCOPE.classifications] },
        retrievalPolicy: 'deny',
        reason: 'anonymous_actor_cannot_leave_operational_domain',
      };
    }
    return {
      allowed: true,
      scope: { domain: 'OPERATIONAL', classifications: ['PRODUCTION'] },
      retrievalPolicy: 'restrictive_default',
      reason: 'no_actor_defaults_to_operational_production',
    };
  }

  const actorClassification = getClassificationForAgent(actor);
  const policy = ACTOR_DOMAIN_POLICY[actorClassification] || ACTOR_DOMAIN_POLICY.PRODUCTION;

  const domain = normalizeDomain(requestedDomain) || 'OPERATIONAL';
  const classifications = policy[domain] || [];

  if (classifications.length === 0) {
    return {
      allowed: false,
      scope: { domain: 'OPERATIONAL', classifications: ['PRODUCTION'] },
      retrievalPolicy: 'deny',
      reason: `classification_${String(actorClassification).toLowerCase()}_cannot_access_${domain.toLowerCase()}_domain`,
    };
  }

  return {
    allowed: true,
    scope: { domain, classifications: [...classifications] },
    retrievalPolicy: 'authorized',
    reason: `actor_${String(actorClassification).toLowerCase()}_${domain.toLowerCase()}`,
  };
}

/**
 * Sanitiza um escopo já resolvido antes de enviá-lo ao serviço RAG.
 * Nunca amplia: valores inválidos caem no escopo mais restritivo e
 * classificações incompatíveis com o domínio são descartadas.
 */
function sanitizeScope(scope) {
  if (!scope || typeof scope !== 'object') {
    return { domain: DEFAULT_SCOPE.domain, classifications: [...DEFAULT_SCOPE.classifications] };
  }
  const domain = normalizeDomain(scope.domain) || DEFAULT_SCOPE.domain;
  const allowed = DOMAIN_CLASSIFICATIONS[domain];
  const raw = Array.isArray(scope.classifications) ? scope.classifications : [];
  const classifications = raw
    .map((c) => String(c || '').trim().toUpperCase())
    .filter((c, i, arr) => CLASSIFICATION_VALUES.includes(c) && allowed.includes(c) && arr.indexOf(c) === i);

  // Fallback coerente com o domínio: o mais restritivo válido para ele.
  const fallback = domain === 'SYSTEM' ? ['SUPPORT'] : [...DEFAULT_SCOPE.classifications];

  return {
    domain,
    classifications: classifications.length > 0 ? classifications : fallback,
  };
}

module.exports = {
  DOMAINS,
  DOMAIN_CLASSIFICATIONS,
  DEFAULT_SCOPE,
  resolveRetrievalScope,
  sanitizeScope,
};
