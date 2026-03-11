# Canonical Process Architecture

## Objective

Introduce a canonical process layer between authoring formats and runtime execution without breaking:
- existing Rete editor flow
- existing runtime behavior
- existing `FlowDefinition` compatibility

## Target Architecture

```text
Rete / BPMN / AI / Templates
            |
            v
CanonicalProcessDefinition
            |
            v
Canonical Normalizer + Validator + Compiler
            |
            v
Runtime Adapter (Canonical -> Legacy Engine Flow)
            |
            v
executeStep runtime + observability
```

## Implemented Core Layers

### 1. Canonical model core (frontend)
Location: `frontend/src/process-canonical/`

- `canonicalTypes.js`
  - canonical node taxonomy
  - issue/report model
- `canonicalDefaults.js`
  - default policies (retry, timeout, fallback, handoff, ai, observability)
- `canonicalNormalizer.js`
  - stable IDs
  - optional field normalization
  - edge normalization/inference
- `canonicalValidator.js`
  - semantic validation independent of visual format
- `canonicalCompiler.js`
  - deterministic compiled model
  - indexed topology for runtime readiness
  - `versionHash`

### 2. Canonical adapters (frontend)
Location: `frontend/src/process-adapters/`

- `reteToCanonical.js`
- `canonicalToRete.js`
- `engineFlowToCanonical.js`
- `canonicalToEngineFlow.js`

Adapter rules:
- preserve current behavior wherever possible
- emit warnings for degradation
- avoid hidden conversion logic spread across multiple modules

### 3. Incremental editor integration
- `frontend/src/state/editorStore.jsx` now enriches validation with canonical pipeline reports:
  - mapping report
  - semantic validation report
  - compilation report
- Legacy backend error path remains untouched for node highlighting compatibility.

### 4. Runtime preparation (backend)
Location: `api/core/process-runtime/`

- `processRuntimeService.js`
  - accepts legacy flow or canonical process definition
  - canonical definitions are adapted to legacy engine flow for execution
- `processEventBus.js`
- `processExecutionContext.js`
- `processStateMachine.js`
- `processTimerService.js`
- `processExecutionTelemetry.js`
- `processObservabilityService.js`

This enables hybrid runtime adoption without forcing an immediate engine rewrite.

## Transition Strategy

### Current (stable)
`Rete -> FlowDefinition -> compileFlow -> executeStep`

### Transitional (now enabled)
`Rete -> Canonical -> (validate + compile canonical) -> Canonical->Engine adapter -> executeStep`

### Future
- BPMN imports/exports become canonical adapters first.
- AI authoring produces canonical directly.
- Runtime can gradually move from adapter-based execution to native canonical execution.

## Backward Compatibility Guarantees

1. Existing `reteJsonToEngineFlow` path remains valid.
2. Existing backend `validateFlow` and runtime path remain intact.
3. Canonical integration is additive, not destructive.
4. Degradation is reported explicitly through warnings.

## Runtime Decision Boundary

- Editor responsibility ends at canonical/legacy conversion and validation.
- Engine/runtime responsibility starts at compiled executable flow execution.
- Canonical layer is the explicit contract between them.

## Known Current Limits

1. Canonical runtime currently executes via adapter to legacy engine handlers.
2. Full BPMN parity is intentionally deferred.
3. AI authoring modules provide baseline contracts; full UI orchestration is future work.

## Why This Enables BPMN + AI + Optimization

- BPMN: can map to canonical without coupling XML to runtime.
- AI authoring: can generate/review canonical directly.
- Optimization: canonical observability metadata and telemetry are now standardized for analytics loops.
