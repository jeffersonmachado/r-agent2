# QA Waves Enterprise Governance

Contract status: implemented and fail-closed.

Observed governance state on 2026-08-14: **NO_GO**. This status is evidence-dependent and must be read from `qa/qa-waves-enterprise-governance.json`, not copied from an older documentation snapshot.

## Architecture

QA Waves now exports an enterprise governance bridge consumed by global release, runtime and deployment gates.

Bridge command:

```bash
QA_WAVES_ENTERPRISE_GOVERNANCE_PATH=qa/qa-waves-enterprise-governance.json \
QA_WAVES_GOVERNANCE_AUDIT_PATH=qa/qa-waves-governance-audit.jsonl \
npm run qa:waves:enterprise-governance
```

Bridge output:

- `qa/qa-waves-enterprise-governance.json`
- `qa/qa-waves-governance-audit.jsonl`

Scheduled smoke command:

```bash
QA_WAVES_SCHEDULED_MODE=hourly_lightweight \
node scripts/smoke/qa-waves-scheduled-operational-smoke.js
```

Scheduled smoke output:

- diagnóstico horário: `qa/smoke/qa-waves-scheduled-operational-smoke-hourly_lightweight.json`
- prova de release real-stack: `qa/smoke/qa-waves-scheduled-operational-smoke.json`

O modo leve nunca é elegível para release e não promove/substitui a evidência
canônica. Para produzir prova candidata a release, execute um modo `realStack`
como `nightly_full_replay`; o bridge ainda valida ambiente real, tenant isolado,
frescor, hash, caminho canônico, três jornadas e assinaturas.

Global GO/NO_GO command used for final validation:

```bash
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

## Current Evidence Snapshot

Persisted evidence paths:

- `qa/qa-waves-enterprise-governance.json`
- `qa/qa-waves-governance-audit.jsonl`
- `qa/smoke/qa-waves-scheduled-operational-smoke.json`
- `qa/go-no-go-report.json`

Observed enterprise governance state on 2026-08-14:

```json
{
  "governanceStatus": "NO_GO",
  "replayIntegrity": { "valid": false },
  "governanceSignature": { "valid": false },
  "continuousValidationStatus": { "status": "GO", "healthy": false },
  "operationalConfidence": 79.2,
  "confidenceGrade": "D",
  "riskLevel": "CRITICAL",
  "deploymentSafety": { "deployAllowed": false },
  "globalGoNoGo": "NO_GO"
}
```

Governance reasoning:

- release governance consumes the enterprise bridge and blocks on non-GO, replay tampering, invalid signatures, failed proofs, degraded smoke or degraded confidence.
- deployment governance consumes `deploymentSafety` and blocks deploy whenever enterprise governance is not GO.
- runtime governance remains part of global `system:go-no-go`; it cannot override a QA Waves blocker.
- the immutable audit trail preserves decision lineage, smoke lineage, replay hashes, replay checksums, governance signatures and deployment safety state.

Active evidence blockers in the observed report:

- promoted canonical mesh history is missing;
- the scheduled smoke is stale, not bound to a canonical source artifact/hash and is missing `booking_flow`;
- existing prod-like replay signatures use unsupported legacy `gov-sha256` instead of keyed `hmac-sha256`.

The following is the handoff contract shape, not a claimed GO result:

```json
{
  "governanceStatus": "GO | NO_GO",
  "replayIntegrity": { "valid": "boolean" },
  "smokeHealth": { "healthy": "boolean" },
  "operationalConfidence": "number",
  "failedProofs": "array",
  "activeBlockers": "array",
  "replayArtifacts": "array",
  "governanceSignature": { "valid": "boolean" },
  "lastSmokeExecution": "object",
  "continuousValidationStatus": { "healthy": "boolean" }
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

Replay and package signatures use keyed `hmac-sha256`. The signing root comes from `REPLAY_SIGNING_KEY` or `ENCRYPTION_KEY` (minimum 32 bytes); a hash derived only from public commit metadata and legacy `gov-sha256` values are rejected. Official npm/release commands load an optional workspace `.env` without overriding variables already exported by CI or the operator.

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

The validator recomputes every link before appending. A missing signing key, a legacy/unkeyed replay signature, a broken link or a mismatched report hash produces `NO_GO`; the bridge never substitutes a synthetic success record.

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

Observed bridge result on 2026-08-14:

- status: `NO_GO`
- operationalConfidence: `79.2`
- confidenceGrade: `D`
- riskLevel: `CRITICAL`

RAP QA Waves is an Enterprise Operational Governance Layer with signed replay integrity, release governance, deployment governance, confidence scoring, continuous validation and an immutable audit trail. The layer is ready only when its current evidence passes all of those checks.
