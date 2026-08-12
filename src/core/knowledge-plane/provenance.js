'use strict';

/**
 * Knowledge Provenance — metadados de proveniência para documentos/chunks.
 *
 * Todo conteúdo indexado no Knowledge Plane carrega proveniência.
 * A segurança (domain, classification, sensitivity, tenant) continua
 * em campos/indexes de primeira classe — nunca apenas em JSON metadata.
 */

const { KNOWLEDGE_TYPES } = require('./knowledge-router');

// ---------------------------------------------------------------------------
// Source Authority Ranking
// ---------------------------------------------------------------------------

/**
 * Authority levels para SYSTEM knowledge.
 * Ranking decrescente: current code > schemas > registries > inventory > tests > docs.
 */
const SYSTEM_AUTHORITY = Object.freeze({
  RUNTIME_CODE: 100,
  DB_SCHEMA_MIGRATION: 95,
  CANONICAL_REGISTRY: 90,
  SYSTEM_INVENTORY: 85,
  EXECUTABLE_TEST: 80,
  VALIDATED_INCIDENT: 75,
  CURRENT_ARCHITECTURE_DOC: 70,
  HISTORICAL_DOC: 40,
  UNKNOWN: 20,
});

/**
 * Authority levels para OPERATIONAL knowledge.
 */
const OPERATIONAL_AUTHORITY = Object.freeze({
  TENANT_APPROVED_POLICY: 100,
  OFFICIAL_CATALOG: 95,
  OFFICIAL_WEBSITE: 90,
  VALIDATED_PROCEDURE: 85,
  APPROVED_FAQ: 80,
  CAMPAIGN_MATERIAL: 70,
  HISTORICAL_CONTENT: 50,
  UNKNOWN: 20,
});

// ---------------------------------------------------------------------------
// Source Kinds
// ---------------------------------------------------------------------------

const SOURCE_KINDS = Object.freeze({
  // SYSTEM
  CANONICAL_DOC: 'CANONICAL_DOC',
  CODE_FILE: 'CODE_FILE',
  DB_MIGRATION: 'DB_MIGRATION',
  CAPABILITY_REGISTRY: 'CAPABILITY_REGISTRY',
  TOOL_REGISTRY: 'TOOL_REGISTRY',
  AGENT_PROFILE: 'AGENT_PROFILE',
  PROCESS_DEFINITION: 'PROCESS_DEFINITION',
  SYSTEM_INVENTORY: 'SYSTEM_INVENTORY',
  QA_COVERAGE: 'QA_COVERAGE',
  INCIDENT_RECORD: 'INCIDENT_RECORD',
  RELEASE_ARTIFACT: 'RELEASE_ARTIFACT',
  TEST_RESULT: 'TEST_RESULT',
  RUNBOOK: 'RUNBOOK',
  // OPERATIONAL
  TENANT_POLICY: 'TENANT_POLICY',
  PRODUCT_CATALOG: 'PRODUCT_CATALOG',
  FAQ: 'FAQ',
  PROCEDURE: 'PROCEDURE',
  CAMPAIGN: 'CAMPAIGN',
  PROMOTED_FROM_SYSTEM: 'PROMOTED_FROM_SYSTEM',
});

// ---------------------------------------------------------------------------
// Provenance builder
// ---------------------------------------------------------------------------

function buildProvenance({
  sourceKind,
  sourceRef,
  sourceVersion,
  knowledgeType,
  retrievalPurposes = [],
  owner = null,
  validFrom = null,
  validUntil = null,
  lastValidatedAt = null,
  contentHash = null,
  version = '1.0.0',
  authority = null,
  confidence = null,
  generatedBy = null,
  validatedBy = null,
  // Security (first-class fields, included here for traceability)
  domain,
  classification,
  sensitivity = 'internal',
  tenant,
}) {
  const resolvedAuthority = authority
    || (domain === 'SYSTEM' ? SYSTEM_AUTHORITY.UNKNOWN : OPERATIONAL_AUTHORITY.UNKNOWN);

  return Object.freeze({
    sourceKind: sourceKind || null,
    sourceRef: sourceRef || null,
    sourceVersion: sourceVersion || null,
    knowledgeType: knowledgeType || KNOWLEDGE_TYPES.SEMANTIC,
    retrievalPurposes: Object.freeze([...retrievalPurposes]),
    owner: owner || null,
    validFrom: validFrom || null,
    validUntil: validUntil || null,
    lastValidatedAt: lastValidatedAt || null,
    contentHash: contentHash || null,
    version,
    authority: resolvedAuthority,
    confidence: confidence ?? null,
    generatedBy: generatedBy || null,
    validatedBy: validatedBy || null,
    // Security trace
    domain: domain || 'OPERATIONAL',
    classification: classification || 'PRODUCTION',
    sensitivity: sensitivity || 'internal',
    tenant: tenant || null,
    generatedAt: new Date().toISOString(),
  });
}

/**
 * Calcula o authority score para SYSTEM content baseado em sourceKind.
 */
function systemAuthorityScore(sourceKind) {
  const map = {
    [SOURCE_KINDS.CODE_FILE]: SYSTEM_AUTHORITY.RUNTIME_CODE,
    [SOURCE_KINDS.DB_MIGRATION]: SYSTEM_AUTHORITY.DB_SCHEMA_MIGRATION,
    [SOURCE_KINDS.CAPABILITY_REGISTRY]: SYSTEM_AUTHORITY.CANONICAL_REGISTRY,
    [SOURCE_KINDS.TOOL_REGISTRY]: SYSTEM_AUTHORITY.CANONICAL_REGISTRY,
    [SOURCE_KINDS.AGENT_PROFILE]: SYSTEM_AUTHORITY.CANONICAL_REGISTRY,
    [SOURCE_KINDS.PROCESS_DEFINITION]: SYSTEM_AUTHORITY.CANONICAL_REGISTRY,
    [SOURCE_KINDS.SYSTEM_INVENTORY]: SYSTEM_AUTHORITY.SYSTEM_INVENTORY,
    [SOURCE_KINDS.TEST_RESULT]: SYSTEM_AUTHORITY.EXECUTABLE_TEST,
    [SOURCE_KINDS.QA_COVERAGE]: SYSTEM_AUTHORITY.EXECUTABLE_TEST,
    [SOURCE_KINDS.INCIDENT_RECORD]: SYSTEM_AUTHORITY.VALIDATED_INCIDENT,
    [SOURCE_KINDS.RELEASE_ARTIFACT]: SYSTEM_AUTHORITY.VALIDATED_INCIDENT,
    [SOURCE_KINDS.CANONICAL_DOC]: SYSTEM_AUTHORITY.CURRENT_ARCHITECTURE_DOC,
    [SOURCE_KINDS.RUNBOOK]: SYSTEM_AUTHORITY.CURRENT_ARCHITECTURE_DOC,
  };
  return map[sourceKind] || SYSTEM_AUTHORITY.UNKNOWN;
}

/**
 * Calcula o authority score para OPERATIONAL content.
 */
function operationalAuthorityScore(sourceKind) {
  const map = {
    [SOURCE_KINDS.TENANT_POLICY]: OPERATIONAL_AUTHORITY.TENANT_APPROVED_POLICY,
    [SOURCE_KINDS.PRODUCT_CATALOG]: OPERATIONAL_AUTHORITY.OFFICIAL_CATALOG,
    [SOURCE_KINDS.FAQ]: OPERATIONAL_AUTHORITY.APPROVED_FAQ,
    [SOURCE_KINDS.PROCEDURE]: OPERATIONAL_AUTHORITY.VALIDATED_PROCEDURE,
    [SOURCE_KINDS.CAMPAIGN]: OPERATIONAL_AUTHORITY.CAMPAIGN_MATERIAL,
    [SOURCE_KINDS.PROMOTED_FROM_SYSTEM]: OPERATIONAL_AUTHORITY.VALIDATED_PROCEDURE,
  };
  return map[sourceKind] || OPERATIONAL_AUTHORITY.UNKNOWN;
}

module.exports = {
  SYSTEM_AUTHORITY,
  OPERATIONAL_AUTHORITY,
  SOURCE_KINDS,
  buildProvenance,
  systemAuthorityScore,
  operationalAuthorityScore,
};
