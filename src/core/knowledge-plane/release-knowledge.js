'use strict';

/**
 * Release Knowledge — conhecimento estruturado por release.
 *
 * Alimenta o SYSTEM Knowledge Plane com:
 *  - releaseId, commit/ref, componentsChanged
 *  - migrations, capabilitiesAffected, agentsAffected
 *  - toolsAffected, APIsAffected, journeysAffected
 *  - QA evidence, regression status, known risks
 *
 * Também: Incident Memory — pipeline Incident → Root Cause → Fix → Release.
 */

const { buildProvenance, SOURCE_KINDS } = require('./provenance');

function defaultLogger() {
  try { return require('../../../api/utils/logger'); } catch (_) { return { info: () => {}, warn: () => {}, error: () => {} }; }
}

/**
 * Constrói registro de conhecimento de release.
 */
function buildReleaseKnowledge({
  releaseId,
  commitRef = null,
  componentsChanged = [],
  migrations = [],
  capabilitiesAffected = [],
  agentsAffected = [],
  toolsAffected = [],
  apisAffected = [],
  journeysAffected = [],
  qaEvidence = [],
  regressionStatus = 'unknown',
  knownRisks = [],
  tenantId = 'system',
}) {
  const content = formatReleaseContent({
    releaseId, commitRef, componentsChanged, migrations,
    capabilitiesAffected, agentsAffected, toolsAffected,
    apisAffected, journeysAffected, qaEvidence, regressionStatus, knownRisks,
  });

  const provenance = buildProvenance({
    sourceKind: SOURCE_KINDS.RELEASE_ARTIFACT,
    sourceRef: `release:${releaseId}`,
    sourceVersion: releaseId,
    knowledgeType: 'EPISODIC',
    retrievalPurposes: ['RELEASE_VALIDATION', 'IMPACT_ANALYSIS', 'AUDIT'],
    domain: 'SYSTEM',
    classification: 'SUPPORT',
    sensitivity: 'restricted',
    tenant: tenantId,
    lastValidatedAt: new Date().toISOString(),
  });

  return Object.freeze({
    id: `release:${tenantId}:${releaseId}`,
    tenantId,
    domain: 'SYSTEM',
    classification: 'SUPPORT',
    sensitivity: 'restricted',
    knowledgeType: 'EPISODIC',
    retrievalPurposes: ['RELEASE_VALIDATION', 'IMPACT_ANALYSIS'],
    content,
    releaseId,
    commitRef,
    componentsChanged: Object.freeze([...componentsChanged]),
    migrations: Object.freeze([...migrations]),
    capabilitiesAffected: Object.freeze([...capabilitiesAffected]),
    agentsAffected: Object.freeze([...agentsAffected]),
    toolsAffected: Object.freeze([...toolsAffected]),
    apisAffected: Object.freeze([...apisAffected]),
    journeysAffected: Object.freeze([...journeysAffected]),
    qaEvidence: Object.freeze([...qaEvidence]),
    regressionStatus,
    knownRisks: Object.freeze([...knownRisks]),
    provenance,
  });
}

function formatReleaseContent(args) {
  const lines = [
    `Release: ${args.releaseId}`,
    args.commitRef ? `Commit: ${args.commitRef}` : '',
    `Components: ${args.componentsChanged.join(', ') || 'none'}`,
    `Migrations: ${args.migrations.length > 0 ? args.migrations.join(', ') : 'none'}`,
    `Capabilities: ${args.capabilitiesAffected.join(', ') || 'none'}`,
    `Agents: ${args.agentsAffected.join(', ') || 'none'}`,
    `APIs: ${args.apisAffected.join(', ') || 'none'}`,
    `Journeys: ${args.journeysAffected.join(', ') || 'none'}`,
    `Regression: ${args.regressionStatus}`,
    `Risks: ${args.knownRisks.join(', ') || 'none'}`,
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * Constrói registro de conhecimento de incidente.
 */
function buildIncidentKnowledge({
  incidentId,
  incidentType = 'unknown',
  severity = 'medium',
  detectedAt = new Date().toISOString(),
  rootCause = null,
  fixDescription = null,
  fixReleaseId = null,
  regressionTestId = null,
  affectedComponents = [],
  evidenceRefs = [],
  tenantId = 'system',
}) {
  const content = [
    `Incident: ${incidentId}`,
    `Type: ${incidentType} | Severity: ${severity}`,
    `Detected: ${detectedAt}`,
    rootCause ? `Root Cause: ${rootCause}` : '',
    fixDescription ? `Fix: ${fixDescription}` : '',
    fixReleaseId ? `Release: ${fixReleaseId}` : '',
    regressionTestId ? `Regression Test: ${regressionTestId}` : '',
    `Affected: ${affectedComponents.join(', ') || 'none'}`,
  ].filter(Boolean).join('\n');

  const provenance = buildProvenance({
    sourceKind: SOURCE_KINDS.INCIDENT_RECORD,
    sourceRef: `incident:${incidentId}`,
    sourceVersion: '1.0.0',
    knowledgeType: 'EPISODIC',
    retrievalPurposes: ['INCIDENT_ANALYSIS', 'DIAGNOSIS', 'AUDIT'],
    domain: 'SYSTEM',
    classification: 'SUPPORT',
    sensitivity: 'restricted',
    tenant: tenantId,
    lastValidatedAt: fixReleaseId ? new Date().toISOString() : null,
  });

  return Object.freeze({
    id: `incident:${tenantId}:${incidentId}`,
    tenantId,
    domain: 'SYSTEM',
    classification: 'SUPPORT',
    sensitivity: 'restricted',
    knowledgeType: 'EPISODIC',
    retrievalPurposes: ['INCIDENT_ANALYSIS', 'DIAGNOSIS'],
    content,
    incidentId,
    incidentType,
    severity,
    detectedAt,
    rootCause,
    fixDescription,
    fixReleaseId,
    regressionTestId,
    affectedComponents: Object.freeze([...affectedComponents]),
    evidenceRefs: Object.freeze([...evidenceRefs]),
    provenance,
  });
}

module.exports = {
  buildReleaseKnowledge,
  buildIncidentKnowledge,
};
