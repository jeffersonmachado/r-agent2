# Release Gate — Decisão

**Data:** 2026-09-23T00:18:25.870Z
**Decisão:** ❌ NO_GO — RELEASE BLOQUEADO
**Score de Estabilidade:** 89.72

## Bloqueadores (1)

- ❌ qa_mesh_no_go


## Checks Executados

| Check | Status | Detalhe |
|---|---|---|
| stability | ✅ | score: 89.72 |
| checkpoints | ✅ | failures: 0 |
| mesh | ❌ | {"status":"NO_GO","passed":false} |
| replay | ✅ | {"executed":true,"passed":true} |
| regression | ✅ | {"previousScore":null,"currentScore":89.72,"delta":null,"maxAllowedDelta":5,"pas |
| evidence | ✅ | {"passed":true,"missing":[],"corrupted":[]} |
| pipelineSteps | ✅ | {"total":7,"passed":7,"failed":0,"failedNames":[],"allPassed":true} |

## Thresholds Aplicados

- `minStabilityScore`: 70
- `maxBlockers`: 0
- `regressionMaxDelta`: 5
- `replayConsistencyMin`: 0.85
- `requireEvidence`: true