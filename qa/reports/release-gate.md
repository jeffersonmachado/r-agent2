# Release Gate — Decisão

**Data:** 2026-09-23T17:56:25.124Z
**Decisão:** ❌ NO_GO — RELEASE BLOQUEADO
**Score de Estabilidade:** 85.81

## Bloqueadores (2)

- ❌ qa_mesh_no_go
- ❌ failed_pipeline_steps: unit-tests


## Checks Executados

| Check | Status | Detalhe |
|---|---|---|
| stability | ✅ | score: 85.81 |
| checkpoints | ✅ | failures: 0 |
| mesh | ❌ | {"status":"NO_GO","passed":false} |
| replay | ✅ | {"executed":true,"passed":true} |
| regression | ✅ | {"previousScore":null,"currentScore":85.81,"delta":null,"maxAllowedDelta":5,"pas |
| evidence | ✅ | {"passed":true,"missing":[],"corrupted":[]} |
| pipelineSteps | ✅ | {"total":7,"passed":6,"failed":1,"failedNames":["unit-tests"],"allPassed":false} |

## Thresholds Aplicados

- `minStabilityScore`: 70
- `maxBlockers`: 0
- `regressionMaxDelta`: 5
- `replayConsistencyMin`: 0.85
- `requireEvidence`: true