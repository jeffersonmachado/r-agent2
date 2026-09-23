# Pipeline Completo — Relatório de Validação

**Data:** 2026-09-23T16:49:07.888Z
**Gate:** ❌ NO_GO
**Score de Estabilidade:** 85.81

## Etapas

| Etapa | Status |
|---|---|
| validate-invariants | ✅ PASS |
| frontend-build | ✅ PASS |
| contracts | ✅ PASS |
| unit-tests | ❌ FAIL |
| qa-mesh | ✅ PASS |
| qa-final-report | ✅ PASS |
| replay-critical | ✅ PASS |

## Bloqueadores

- qa_mesh_no_go
- failed_pipeline_steps: unit-tests

## Artefatos gerados

- `qa/reports/full-validation-report.json`
- `qa/reports/execution.json`
- `qa/reports/stability.json`
- `qa/reports/learn.json`
- `qa/reports/checkpoints.json`
- `qa/reports/release-gate.json`