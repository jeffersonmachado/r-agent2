'use strict';

function policyViolation(code, message) { const error = new Error(`${code}: ${message}`); error.code = code; return error; }
function requireTenant(tenantId) { if (!tenantId || tenantId === 'system') throw policyViolation('TENANT_REQUIRED', 'tenant execution requires an explicit tenant id'); return tenantId; }
function requirePlatformSystem(principal) { if (principal?.principalType !== 'PLATFORM_SYSTEM' || !principal.principalId) throw policyViolation('PLATFORM_SYSTEM_REQUIRED', 'platform scope requires an explicit platform principal'); return principal; }
function requirePermission(permissions, permission) { if (!Array.isArray(permissions) || !permissions.includes(permission)) throw policyViolation('TOOL_PERMISSION_REQUIRED', permission); return true; }
function requireOutcomeContract(outcome) { if (!outcome || outcome.status !== 'SUCCESS' || !outcome.contractId) throw policyViolation('OUTCOME_CONTRACT_REQUIRED', 'business success requires a validated outcome contract'); return outcome; }
function requireEvidence(evidence) { if (!evidence || !evidence.id || !evidence.hash) throw policyViolation('EVIDENCE_REQUIRED', 'validated claims require real evidence'); return evidence; }
function rejectSyntheticProducer(producer) { if (!producer || /^(simulate|synthesize|synthetic|validator|test:)/i.test(producer)) throw policyViolation('SYNTHETIC_CERTIFICATION_EVIDENCE', producer || 'missing'); return producer; }
function requireAutonomousReady({ dimensionsBelow10, mandatoryGateFailures, openGaps, openBlockers }) { if (dimensionsBelow10 || mandatoryGateFailures || openGaps || openBlockers) throw policyViolation('AUTONOMOUS_READY_BLOCKED', 'readiness predicates are not all clear'); return 'AUTONOMOUS_READY'; }
function requireArtifactLineage(artifact) { for (const field of ['runId', 'sourceFingerprint', 'producer', 'generatedAt']) if (!artifact?.[field]) throw policyViolation('ARTIFACT_LINEAGE_REQUIRED', field); return artifact; }

module.exports = { policyViolation, requireTenant, requirePlatformSystem, requirePermission, requireOutcomeContract, requireEvidence, rejectSyntheticProducer, requireAutonomousReady, requireArtifactLineage };