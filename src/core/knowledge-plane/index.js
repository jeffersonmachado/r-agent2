'use strict';

/**
 * RAP Knowledge Plane — barrel export.
 *
 * O Knowledge Plane governa:
 *  - Domínios (OPERATIONAL / SYSTEM)
 *  - Retrieval Purposes
 *  - Knowledge Types (SEMANTIC / STRUCTURAL / EPISODIC)
 *  - Provenance & Authority
 *  - Hybrid Retrieval (Vector RAG + Knowledge Graph + Episodic)
 *
 * NUNCA expor internals na operação.
 */

const knowledgeRouter = require('./knowledge-router');
const provenance = require('./provenance');
const hybridRetrieval = require('./hybrid-retrieval');
const episodicProjector = require('./episodic-projector');
const knowledgeTools = require('./knowledge-tools');
const knowledgePromotion = require('./knowledge-promotion');
const knowledgeGraphGovernance = require('./knowledge-graph-governance');
const releaseKnowledge = require('./release-knowledge');
const inventoryGraphBridge = require('./inventory-graph-bridge');
const qaCoverageIntelligence = require('./qa-coverage-intelligence');
const observability = require('./observability');

module.exports = {
  // Knowledge Router
  resolveKnowledgeContext: knowledgeRouter.resolveKnowledgeContext,
  resolveRetrievalScope: knowledgeRouter.resolveRetrievalScope,
  createResolvedScope: knowledgeRouter.createResolvedScope,
  isResolvedScope: knowledgeRouter.isResolvedScope,
  sanitizeScope: knowledgeRouter.sanitizeScope,
  mapCapabilityToPurpose: knowledgeRouter.mapCapabilityToPurpose,

  // Escopo de tenant (GLOBAL_OPERATIONAL ∪ TENANT_OPERATIONAL)
  resolveRetrievalTenantKeys: knowledgeRouter.resolveRetrievalTenantKeys,
  getGlobalOperationalTenant: knowledgeRouter.getGlobalOperationalTenant,
  GLOBAL_OPERATIONAL_TENANT_ENV: knowledgeRouter.GLOBAL_OPERATIONAL_TENANT_ENV,
  DEFAULT_GLOBAL_OPERATIONAL_TENANT: knowledgeRouter.DEFAULT_GLOBAL_OPERATIONAL_TENANT,

  // Constants
  DOMAINS: knowledgeRouter.DOMAINS,
  KNOWLEDGE_TYPES: knowledgeRouter.KNOWLEDGE_TYPES,
  OPERATIONAL_PURPOSES: knowledgeRouter.OPERATIONAL_PURPOSES,
  SYSTEM_PURPOSES: knowledgeRouter.SYSTEM_PURPOSES,
  PURPOSE_DOMAIN_MAP: knowledgeRouter.PURPOSE_DOMAIN_MAP,
  PURPOSE_KNOWLEDGE_TYPES: knowledgeRouter.PURPOSE_KNOWLEDGE_TYPES,

  // Provenance
  buildProvenance: provenance.buildProvenance,
  SOURCE_KINDS: provenance.SOURCE_KINDS,
  SYSTEM_AUTHORITY: provenance.SYSTEM_AUTHORITY,
  OPERATIONAL_AUTHORITY: provenance.OPERATIONAL_AUTHORITY,
  systemAuthorityScore: provenance.systemAuthorityScore,
  operationalAuthorityScore: provenance.operationalAuthorityScore,

  // Hybrid Retrieval
  hybridRetrieve: hybridRetrieval.hybridRetrieve,
  HYBRID_WEIGHTS: hybridRetrieval.HYBRID_WEIGHTS,
  RETRIEVAL_STRATEGY: hybridRetrieval.RETRIEVAL_STRATEGY,

  // Episodic Projector
  projectEpisodicKnowledge: episodicProjector.projectEpisodicKnowledge,
  SYSTEM_EVENT_TYPES: episodicProjector.SYSTEM_EVENT_TYPES,
  OPERATIONAL_EVENT_TYPES: episodicProjector.OPERATIONAL_EVENT_TYPES,

  // Knowledge Tools
  registerKnowledgeTools: knowledgeTools.registerKnowledgeTools,

  // Knowledge Promotion
  createPromotionCandidate: knowledgePromotion.createPromotionCandidate,
  sanitizeForOperational: knowledgePromotion.sanitizeForOperational,
  validatePromotionCandidate: knowledgePromotion.validatePromotionCandidate,
  approvePromotion: knowledgePromotion.approvePromotion,

  // Knowledge Graph Governance
  validateGraphAccess: knowledgeGraphGovernance.validateGraphAccess,
  filterGraphNodes: knowledgeGraphGovernance.filterGraphNodes,
  withGovernance: knowledgeGraphGovernance.withGovernance,

  // Release & Incident Knowledge
  buildReleaseKnowledge: releaseKnowledge.buildReleaseKnowledge,
  buildIncidentKnowledge: releaseKnowledge.buildIncidentKnowledge,

  // Inventory → Graph Bridge
  buildGraphFromInventory: inventoryGraphBridge.buildGraphFromInventory,

  // QA Coverage Intelligence
  analyzeCapabilityCoverage: qaCoverageIntelligence.analyzeCapabilityCoverage,
  analyzeJourneyCoverage: qaCoverageIntelligence.analyzeJourneyCoverage,
  analyzeStaleCoverage: qaCoverageIntelligence.analyzeStaleCoverage,
  analyzeRequiredWaves: qaCoverageIntelligence.analyzeRequiredWaves,

  // Observability
  createKnowledgeEventEmitter: observability.createKnowledgeEventEmitter,
  createKnowledgeMetrics: observability.createKnowledgeMetrics,
};
