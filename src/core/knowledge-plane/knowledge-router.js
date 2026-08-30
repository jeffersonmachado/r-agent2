'use strict';

/**
 * RAP Knowledge Plane — evolução do Domain Router para Knowledge Router.
 *
 * Responsabilidades:
 *  - Resolver escopo de conhecimento a partir do Principal + SpecialistContext
 *  - Governar domínios (OPERATIONAL / SYSTEM), purposes e knowledge types
 *  - Substituir filters.scope como bypass — apenas ResolvedKnowledgeScope interno
 *  - Integrar com SpecialistRuntimeContext para retrievalPurpose
 */

const {
  CLASSIFICATIONS,
  getClassificationForAgent,
} = require('../../../api/modules/agent-os/experience-segregation');

const DOMAINS = Object.freeze(['OPERATIONAL', 'SYSTEM']);

const DOMAIN_CLASSIFICATIONS = Object.freeze({
  OPERATIONAL: Object.freeze(['PRODUCTION', 'SUPPORT']),
  SYSTEM: Object.freeze(['SUPPORT', 'DEVELOPMENT']),
});

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

// ---------------------------------------------------------------------------
// Retrieval Purposes
// ---------------------------------------------------------------------------

const OPERATIONAL_PURPOSES = Object.freeze([
  'CUSTOMER_SERVICE',
  'SALES',
  'SCHEDULING',
  'CRM',
  'CAMPAIGN',
  'BILLING',
  'OPERATION',
  'VOICE',
]);

const SYSTEM_PURPOSES = Object.freeze([
  'DIAGNOSIS',
  'AUDIT',
  'DEVELOPMENT',
  'QA',
  'IMPACT_ANALYSIS',
  'COVERAGE_ANALYSIS',
  'RELEASE_VALIDATION',
  'DOCUMENTATION',
  'INCIDENT_ANALYSIS',
]);

const ALL_PURPOSES = Object.freeze([...OPERATIONAL_PURPOSES, ...SYSTEM_PURPOSES]);

// ---------------------------------------------------------------------------
// Knowledge Types
// ---------------------------------------------------------------------------

const KNOWLEDGE_TYPES = Object.freeze({
  SEMANTIC: 'SEMANTIC',     // docs, manuais, políticas, FAQ, runbooks, arquitetura
  STRUCTURAL: 'STRUCTURAL', // APIs, models, tables, tools, capabilities, agents, schemas
  EPISODIC: 'EPISODIC',     // incidentes, execuções, outcomes, releases, falhas
});

// ---------------------------------------------------------------------------
// Purpose → Domain mapping (determinístico)
// ---------------------------------------------------------------------------

const PURPOSE_DOMAIN_MAP = Object.freeze({
  ...Object.fromEntries(OPERATIONAL_PURPOSES.map((p) => [p, 'OPERATIONAL'])),
  ...Object.fromEntries(SYSTEM_PURPOSES.map((p) => [p, 'SYSTEM'])),
});

// Default knowledge types por purpose
const PURPOSE_KNOWLEDGE_TYPES = Object.freeze({
  CUSTOMER_SERVICE: ['SEMANTIC'],
  SALES: ['SEMANTIC'],
  SCHEDULING: ['SEMANTIC'],
  CRM: ['SEMANTIC'],
  CAMPAIGN: ['SEMANTIC'],
  BILLING: ['SEMANTIC'],
  OPERATION: ['SEMANTIC'],
  VOICE: ['SEMANTIC'],
  DIAGNOSIS: ['SEMANTIC', 'STRUCTURAL', 'EPISODIC'],
  AUDIT: ['EPISODIC'],
  DEVELOPMENT: ['SEMANTIC', 'STRUCTURAL'],
  QA: ['STRUCTURAL', 'EPISODIC'],
  IMPACT_ANALYSIS: ['STRUCTURAL'],
  COVERAGE_ANALYSIS: ['STRUCTURAL', 'EPISODIC'],
  RELEASE_VALIDATION: ['STRUCTURAL', 'EPISODIC'],
  DOCUMENTATION: ['SEMANTIC'],
  INCIDENT_ANALYSIS: ['SEMANTIC', 'STRUCTURAL', 'EPISODIC'],
});

// ---------------------------------------------------------------------------
// ResolvedKnowledgeScope — objeto selado, não criável por payload externo
// ---------------------------------------------------------------------------

/**
 * Cria um escopo de conhecimento resolvido internamente.
 * NUNCA expor esta factory para payloads externos.
 */
function createResolvedScope({ domain, classifications, retrievalPurpose, knowledgeTypes, collections, policy, reason }) {
  return Object.freeze({
    _internal: true,
    domain,
    classifications: Object.freeze([...classifications]),
    retrievalPurpose: retrievalPurpose || null,
    knowledgeTypes: Object.freeze([...(knowledgeTypes || [])]),
    collections: Object.freeze([...(collections || [])]),
    policy,
    reason,
    resolvedAt: new Date().toISOString(),
  });
}

function isResolvedScope(obj) {
  return !!(obj && obj._internal === true);
}

// ---------------------------------------------------------------------------
// Knowledge Router
// ---------------------------------------------------------------------------

/**
 * Resolve o contexto de conhecimento autorizado.
 *
 * @param {Object} input
 * @param {Object} input.principal - Principal canônico (com classification)
 * @param {Object} [input.specialistContext] - SpecialistRuntimeContext
 * @param {string} [input.requestedDomain] - Domínio solicitado (limitado pela policy)
 * @param {string} [input.retrievalPurpose] - Propósito (do SpecialistContext, nunca do prompt)
 * @returns {Object} { allowed, scope: ResolvedKnowledgeScope }
 */
function resolveKnowledgeContext({
  principal = null,
  specialistContext = null,
  requestedDomain = null,
  retrievalPurpose = null,
} = {}) {
  // P0: Fail closed — sem principal, escopo mais restritivo.
  if (!principal) {
    return {
      allowed: true,
      scope: createResolvedScope({
        domain: 'OPERATIONAL',
        classifications: ['PRODUCTION'],
        retrievalPurpose: null,
        knowledgeTypes: ['SEMANTIC'],
        policy: 'restrictive_default',
        reason: 'no_principal_defaults_to_operational_production',
      }),
    };
  }

  // P1: Fonte da verdade é Principal.classification (não role).
  const classification = String(principal.classification || 'PRODUCTION').toUpperCase();
  if (!['PRODUCTION', 'SUPPORT', 'DEVELOPMENT'].includes(classification)) {
    return {
      allowed: true,
      scope: createResolvedScope({
        domain: 'OPERATIONAL',
        classifications: ['PRODUCTION'],
        retrievalPurpose: null,
        knowledgeTypes: ['SEMANTIC'],
        policy: 'restrictive_default',
        reason: 'unknown_classification_defaults_to_production',
      }),
    };
  }

  // Resolve domínio: purpose do specialist > requested > default OPERATIONAL.
  let domain = 'OPERATIONAL';
  if (retrievalPurpose && PURPOSE_DOMAIN_MAP[retrievalPurpose]) {
    domain = PURPOSE_DOMAIN_MAP[retrievalPurpose];
  } else if (requestedDomain) {
    const req = String(requestedDomain).toUpperCase();
    if (DOMAINS.includes(req)) domain = req;
  }

  // Valida se a classificação pode acessar o domínio.
  const policy = ACTOR_DOMAIN_POLICY[classification] || ACTOR_DOMAIN_POLICY.PRODUCTION;
  const allowedClassifications = policy[domain] || [];

  if (allowedClassifications.length === 0) {
    return {
      allowed: false,
      scope: createResolvedScope({
        domain: 'OPERATIONAL',
        classifications: ['PRODUCTION'],
        retrievalPurpose: null,
        knowledgeTypes: [],
        policy: 'deny',
        reason: `classification_${classification.toLowerCase()}_cannot_access_${domain.toLowerCase()}`,
      }),
    };
  }

  // Knowledge types: do purpose, filtrados pelo domínio.
  const purpose = retrievalPurpose
    || (specialistContext?.capabilities?.[0] ? mapCapabilityToPurpose(specialistContext.capabilities[0]) : null);
  const knowledgeTypes = purpose
    ? (PURPOSE_KNOWLEDGE_TYPES[purpose] || ['SEMANTIC'])
    : ['SEMANTIC'];

  // SYSTEM purpose só com SUPPORT/DEVELOPMENT
  if (domain === 'SYSTEM' && classification === 'PRODUCTION') {
    return {
      allowed: false,
      scope: createResolvedScope({
        domain,
        classifications: [],
        retrievalPurpose: purpose,
        knowledgeTypes: [],
        policy: 'deny',
        reason: 'production_cannot_access_system',
      }),
    };
  }

  return {
    allowed: true,
    scope: createResolvedScope({
      domain,
      classifications: allowedClassifications,
      retrievalPurpose: purpose,
      knowledgeTypes,
      policy: 'authorized',
      reason: `actor_${classification.toLowerCase()}_${domain.toLowerCase()}`,
    }),
  };
}

/**
 * Mapeamento capability → retrieval purpose.
 */
function mapCapabilityToPurpose(capabilityId) {
  const map = {
    'schedule.read': 'SCHEDULING',
    'schedule.manage': 'SCHEDULING',
    'crm.read': 'CRM',
    'crm.write': 'CRM',
    'ticket.manage': 'CUSTOMER_SERVICE',
    'campaign.manage': 'CAMPAIGN',
    'messaging.send': 'OPERATION',
    'knowledge.operational': 'OPERATION',
    'support.diagnose': 'DIAGNOSIS',
    'qa.mesh': 'QA',
    'qa.waves': 'QA',
    'knowledge.system': 'DEVELOPMENT',
  };
  return map[capabilityId] || null;
}

// ---------------------------------------------------------------------------
// Backward-compatible adapter: resolveRetrievalScope (domainRouter alias)
// ---------------------------------------------------------------------------

/**
 * @deprecated Use resolveKnowledgeContext com Principal.classification.
 * Mantido como facade para compatibilidade.
 */
function resolveRetrievalScope({ actor = null, requestedDomain = null } = {}) {
  if (!actor) {
    return {
      allowed: true,
      scope: { domain: 'OPERATIONAL', classifications: ['PRODUCTION'] },
      retrievalPolicy: 'restrictive_default',
      reason: 'no_actor_defaults_to_operational_production',
    };
  }

  // Adapter: classificação explícita ou derivada de fonte server-side
  // (platformRole/platformClassification via getClassificationForAgent);
  // tenant role (ex.: auditor) NÃO concede classificação de plataforma.
  const classification = actor.classification
    || getClassificationForAgent(actor)
    || 'PRODUCTION';

  const result = resolveKnowledgeContext({
    principal: { classification },
    requestedDomain,
  });

  return {
    allowed: result.allowed,
    scope: {
      domain: result.scope.domain,
      classifications: [...result.scope.classifications],
    },
    retrievalPolicy: result.scope.policy,
    reason: result.scope.reason,
  };
}

/**
 * @deprecated Use createResolvedScope / isResolvedScope.
 */
function sanitizeScope(scope) {
  if (!scope || typeof scope !== 'object') {
    return { domain: 'OPERATIONAL', classifications: ['PRODUCTION'] };
  }
  const domain = DOMAINS.includes(scope.domain) ? scope.domain : 'OPERATIONAL';
  const allowed = DOMAIN_CLASSIFICATIONS[domain];
  const raw = Array.isArray(scope.classifications) ? scope.classifications : [];
  const classifications = raw
    .map((c) => String(c || '').trim().toUpperCase())
    .filter((c, i, arr) => allowed.includes(c) && arr.indexOf(c) === i);
  const fallback = domain === 'SYSTEM' ? ['SUPPORT'] : ['PRODUCTION'];
  return {
    domain,
    classifications: classifications.length > 0 ? classifications : fallback,
  };
}

module.exports = {
  DOMAINS,
  DOMAIN_CLASSIFICATIONS,
  KNOWLEDGE_TYPES,
  OPERATIONAL_PURPOSES,
  SYSTEM_PURPOSES,
  ALL_PURPOSES,
  PURPOSE_DOMAIN_MAP,
  PURPOSE_KNOWLEDGE_TYPES,
  createResolvedScope,
  isResolvedScope,
  resolveKnowledgeContext,
  resolveRetrievalScope,
  sanitizeScope,
  mapCapabilityToPurpose,
};
