# Governance Persistence & Certification Control Plane

Status: target architecture for GP-01/GP-02. The database is the canonical certification state; files are immutable evidence, projections, snapshots or release payloads.

## Convergence decisions

The design deliberately reuses existing persistence where its semantics match:

- `RuntimeArtifact` is evolved with governed lineage instead of creating a second artifact table. Legacy mutable rows remain supported during migration; certification rows are immutable and versioned.
- `CoverageEvidence` keeps its append-only hash chain and gains explicit run/journey/scenario/step/inventory/evidence lineage.
- `EventLedger` is the canonical implementation of `ExecutionTraceEvent`. A new `ExecutionTrace` owns the trace; ledger events reference it and retain runtime-produced parent/causation identifiers.
- `Evidence` remains operational evidence and is referenced by coverage/trace records; it is not certification state.
- `AuditEvent` records control-plane lifecycle events inside the same transaction as the state change.
- `AuditReport`, `AiGovernanceRecord` and `AutoCorrectionRun` keep their current domains and may be referenced, but are not reused as certification state.

New models are created only where no equivalent exists:

- `GovernanceRun`
- `ScorecardDimension`
- `ScorecardRequirement`
- `ScorecardEvaluation`
- `ScorecardDimensionResult`
- `ScorecardRequirementResult`
- `GovernanceGap`
- `GovernanceGateResult`
- `ExecutionTrace`
- `GovernanceFinalDecision`
- `ReleaseManifestRecord`

## Ownership graph

```text
GovernanceRun
├── RuntimeArtifact (evolved, immutable when governed)
├── GovernanceGateResult
├── GovernanceGap
├── ScorecardEvaluation
│   └── ScorecardDimensionResult
│       └── ScorecardRequirementResult
├── ExecutionTrace
│   └── EventLedger (ExecutionTraceEvent equivalent)
├── CoverageEvidence (evolved)
├── GovernanceFinalDecision
└── ReleaseManifestRecord

ScorecardDimension
├── ScorecardRequirement
├── ScorecardDimensionResult
└── GovernanceGap

Evidence
├── CoverageEvidence.evidence_id
└── EventLedger.evidence_id
```

All run-owned rows use the external `run_id` and foreign-key it to `governance_runs.run_id`. This makes foreign-run joins and offline exports explicit without leaking a surrogate database ID.

## Canonical invariants

### Run and source

- `run_id` is globally unique.
- `source_fingerprint` is a full SHA-256 and cannot be changed after insert.
- one active (`CREATED` or `RUNNING`) run exists per platform/tenant scope.
- `scope_type=PLATFORM` requires `tenant_id IS NULL`.
- `scope_type=TENANT` requires `tenant_id IS NOT NULL` and references `tenants.tenant_key`.
- legal transitions are `CREATED→RUNNING|INVALIDATED|FAILED`, `RUNNING→COMPLETED|INVALIDATED|FAILED`, `COMPLETED→PACKAGED`, `PACKAGED→VERIFIED`.
- source drift preserves the frozen fingerprint and commits `INVALIDATED` plus reason before returning `RUN_SOURCE_DRIFT`.

### Same-run lineage

Rows that carry both `run_id` and `source_fingerprint` are protected by database triggers that compare them to the frozen run. Service validation is additional, not a substitute for the constraint.

The rule applies to governed artifacts, gate results, execution traces, scorecard dimension results, final decisions and release manifests.

### Artifacts

- legacy `RuntimeArtifact` rows may have no run lineage and remain mutable for backward compatibility;
- certification mode accepts only rows with complete run/source/type/version/hash/generatedAt/producer lineage;
- `immutable=true` rows cannot be updated or deleted by the database;
- a changed artifact is a new row/ref/version, never an overwrite;
- large payloads remain in blob/artifact storage and the database stores SHA-256, size and storage key/URI;
- `content_jsonb` is allowed only for appropriately small structured content.

### Scorecard

- dimension definitions are distinct from per-run evaluation results;
- requirements are explicit and validator-addressable;
- every score is derived from persisted requirement results;
- a mandatory non-PASS requirement prevents score 10;
- `NOT_APPLICABLE` is valid only when the requirement policy explicitly permits it;
- evaluation fingerprints cover its immutable persisted result set;
- gaps have an explicit lifecycle and cannot disappear when an export is regenerated.

### Gates and final decision

- each mandatory gate has an explicit result for the current run;
- missing, stale, invalid, insufficient or non-PASS mandatory gates block autonomous readiness;
- the final decision transaction locks the run, current evaluation, gate results and open gaps;
- all gate/evaluation/gap writers lock the same run first, preventing a change from racing the final decision;
- `AUTONOMOUS_READY` is derived only when every dimension is 10, all mandatory gates PASS, no gap/blocker is open and source freeze remains valid;
- the transaction inserts the decision and moves the run to `COMPLETED` (or `FAILED`) atomically.

### Runtime traces

- validators never invent chronology, IDs or causality;
- runtime creates `ExecutionTrace` and appends `EventLedger` rows with the same trace/run/tenant/correlation/execution context;
- `(trace_id,event_id)` is unique;
- parent and causation references resolve inside the same trace;
- a composite tenant reference prevents cross-tenant trace events;
- broken or foreign causality is rejected by persistence and rechecked by validators.

## Transaction and concurrency protocol

Every mutating control-plane service starts by locking the `GovernanceRun` row `FOR UPDATE`. Run creation also takes a PostgreSQL transaction advisory lock keyed by scope. This yields one serialization point for:

- source freeze and drift invalidation;
- gate/result/gap updates;
- artifact registration;
- evaluation completion;
- final decision;
- package and verification transitions.

The migration runner obtains an advisory lock for the duration of `umzug.up()`, preventing concurrent application startup replicas from migrating simultaneously. The control-plane migration itself executes all DDL in an explicit transaction.

## Canonical read and export protocol

```text
PostgreSQL transaction commits canonical state
  → deterministic exporter reads the committed run
  → JSON/Markdown projection is written atomically
  → projection is registered as an immutable RuntimeArtifact
```

If a projection is missing or stale it is regenerated. It never overwrites database state.

During controlled migration, non-certification code may use a read-only legacy fallback. With `RAP_CERTIFICATION_MODE=required`, database connection, migrations and canonical rows are mandatory; legacy JSON can neither produce GO nor advance a run.

## Package and offline verification

After the run reaches `COMPLETED`, the database produces a canonical, hashed `certification-snapshot.json` containing the run/source, scorecard results, mandatory gate summary, artifacts, proof and final decision. The package also contains its real manifest. The database stores `ReleaseManifestRecord` metadata and the snapshot/package artifacts, but large package bytes stay outside the database.

The delivered verifier does not need a remote database. It verifies source + package manifest + certification snapshot + artifact hashes and proves that the snapshot was generated from the persisted final run. Tampering with source, run, score, gate, trace, relational evidence or artifact makes verification fail closed.

## Security boundary

Control-plane records are internal PLATFORM or TENANT governance data. They are not production-customer navigation or APIs. Any future HTTP access must use explicit SUPPORT/DEVELOPMENT classification, tenant scope checks and an audited principal. Internal certification commands use service-layer APIs, never controller-local SQL.
