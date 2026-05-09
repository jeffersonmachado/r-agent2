# QA Waves Enterprise Governance

Status: ENTERPRISE_GOVERNANCE_READY.

Validated on: 2026-05-09.

## Architecture

QA Waves now exports an enterprise governance bridge consumed by global release, runtime and deployment gates.

Bridge command:

```bash
RUNTIME_ROOT=/tmp/ragent2-runtime-enterprise \
QA_WAVES_ENTERPRISE_GOVERNANCE_PATH=qa/qa-waves-enterprise-governance.json \
QA_WAVES_GOVERNANCE_AUDIT_PATH=qa/qa-waves-governance-audit.jsonl \
npm run qa:waves:enterprise-governance
```

Bridge output:

- `qa/qa-waves-enterprise-governance.json`
- `qa/qa-waves-governance-audit.jsonl`

Scheduled smoke command:

```bash
RUNTIME_ROOT=/tmp/ragent2-runtime-enterprise \
QA_WAVES_SCHEDULED_MODE=hourly_lightweight \
node scripts/smoke/qa-waves-scheduled-operational-smoke.js
```

Scheduled smoke output:

- `qa/smoke/qa-waves-scheduled-operational-smoke.json`

Global GO/NO_GO command used for final validation:

```bash
RUNTIME_ROOT=/tmp/ragent2-runtime-enterprise \
SYSTEM_VALIDATE_REPORT_PATH=qa/system-validate-report.json \
RELEASE_GATE_REPORT_PATH=qa/release-gate-report.json \
SMOKE_EVIDENCE_SUMMARY_PATH=qa/smoke-evidence.json \
GO_NO_GO_REPORT_PATH=qa/go-no-go-report.json \
RUNTIME_GOVERNANCE_REPORT_PATH=qa/runtime-governance-report.json \
SYSTEM_DEPLOY_REPORT_PATH=qa/deploy-report.json \
QA_WAVES_ENTERPRISE_GOVERNANCE_PATH=qa/qa-waves-enterprise-governance.json \
QA_WAVES_GOVERNANCE_AUDIT_PATH=qa/qa-waves-governance-audit.jsonl \
npm run system:go-no-go
```

## Final Evidence Snapshot

Persisted evidence paths:

- `qa/qa-waves-enterprise-governance.json`
- `qa/qa-waves-governance-audit.jsonl`
- `qa/smoke/qa-waves-scheduled-operational-smoke.json`
- `qa/go-no-go-report.json`

Final enterprise governance state:

```json
{
  "status": "ENTERPRISE_GOVERNANCE_READY",
  "governanceStatus": "GO",
  "replayIntegrity": { "valid": true },
  "governanceSignature": { "valid": true },
  "continuousValidationStatus": { "status": "GO", "healthy": true },
  "operationalConfidence": 100,
  "confidenceGrade": "A+",
  "riskLevel": "LOW",
  "activeBlockers": [],
  "failedProofs": [],
  "deploymentSafety": { "deployAllowed": true },
  "globalGoNoGo": "GO"
}
```

Governance reasoning:

- release governance consumes the enterprise bridge and blocks on non-GO, replay tampering, invalid signatures, failed proofs, degraded smoke or degraded confidence.
- deployment governance consumes `deploymentSafety` and blocks deploy whenever enterprise governance is not GO.
- runtime governance remains part of global `system:go-no-go`, which now passed with QA Waves governance loaded and validated.
- the immutable audit trail preserves decision lineage, smoke lineage, replay hashes, replay checksums, governance signatures and deployment safety state.

Final readiness decision:

- `ENTERPRISE_GOVERNANCE_READY`

Exported contract:

```json
{
  "governanceStatus": "GO",
  "replayIntegrity": { "valid": true },
  "smokeHealth": { "healthy": true },
  "operationalConfidence": 100,
  "failedProofs": [],
  "activeBlockers": [],
  "replayArtifacts": [],
  "governanceSignature": { "valid": true },
  "lastSmokeExecution": {},
  "continuousValidationStatus": { "healthy": true }
}
```

## Release Governance

`tools/system/release-gate.js` now builds and validates QA Waves enterprise governance before passing release.

Release is blocked when:

- QA Waves status is not `GO`
- replay integrity is invalid
- governance signature is invalid
- failed proofs exist
- active blockers exist
- continuous smoke is degraded
- operational confidence is below threshold

Default confidence threshold: `95`.

## Deployment Governance

`tools/system/deploy.js` now validates QA Waves before selecting an approved artifact or entering dry-run/execute mode.

Deploy is blocked when:

- `deploymentSafety.deployAllowed !== true`
- operational confidence is degraded
- replay integrity is invalid
- smoke is degraded
- governance signatures mismatch
- operational proofs fail

## System GO/NO_GO

`tools/system/go-no-go.js` now includes:

- QA Waves enterprise governance status
- operational confidence
- confidence grade
- risk level
- bridge validation reasons

`system:go-no-go` can now reflect QA Waves state together with system validate, release gate, runtime governance and smoke evidence.

## Operational Confidence Engine

`OperationalConfidenceScore` is computed from:

- smoke pass rate
- replay integrity rate
- mutation proof consistency
- provenance consistency
- replay health
- governance consistency
- runtime stability
- evidence completeness

Example final result:

```json
{
  "operationalConfidence": 100,
  "confidenceGrade": "A+",
  "riskLevel": "LOW"
}
```

## Audit Trail

The immutable governance audit trail is persisted as JSONL:

```text
qa/qa-waves-governance-audit.jsonl
```

Each entry stores:

- GO/NO_GO decision
- governance signatures
- replay hashes
- replay checksums
- smoke execution lineage
- deployment safety
- previous entry hash
- current entry hash

The hash chain makes later tampering detectable.

## Runtime Integration

The bridge unifies:

- QA Waves Governance
- Global Release Governance
- Runtime Governance
- Deployment Governance

The enterprise report is the single handoff from operational proof to platform-level release/deploy decisions.

## Observability

Enterprise dashboard:

- Path: `/dev/qa-waves/enterprise-governance`
- API: `/api/qa-waves/enterprise-governance`

Dashboard signals:

- global GO/NO_GO
- operational confidence
- release readiness
- replay integrity
- governance signatures
- deployment safety
- smoke lineage
- runtime risk
- active blockers
- failed proofs
- replay artifacts

## Deployment Safety Model

Deployment is allowed only when:

- QA Waves enterprise status is `GO`
- replay integrity is valid
- governance signatures are valid
- continuous smoke is healthy
- operational confidence is above threshold
- zero failed proofs
- zero active blockers

Current validated bridge result:

- status: `GO`
- operationalConfidence: `100`
- confidenceGrade: `A+`
- riskLevel: `LOW`

RAP QA Waves is now an Enterprise Operational Governance Layer with signed replay integrity, release governance, deployment governance, confidence scoring, continuous validation and immutable audit trail.
