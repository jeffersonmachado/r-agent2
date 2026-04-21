# Inventario Estrutural

Gerado em: 2026-04-07T15:48:29.745Z

## Estruturas duplicadas
- diretorio: qa-mesh
- diretorio: qa
- diretorio: rpa
- diretorio: tests/rpa
- diretorio: core/rpa
- runner: qa/qaRunner.js
- runner: qa-mesh/meshRunner.js
- runner: rpa/rpaTestRunner.js
- runner: tests/rpa/rpaTestRunner.js
- runner: core/rpa/rpaTestRunner.js
- replay: lib/replaySystem.js
- replay: tests/rpa/replaySystem.js
- replay: core/rpa/replaySystem.js
- replay: engine/replay.js

## Fontes atuais de evidencia
- qa-mesh/meshEvidence
- qa-mesh/meshHistory
- qa/checkpoints/logs
- qa/reports
- replays/

## Pontos de integracao
- backend: api/modules/qa/routes.js
- backend: api/modules/qa-mesh/routes.js
- frontend: frontend/src/pages/QaPage.jsx
- frontend: frontend/src/pages/QaMeshPage.jsx
- mesh: qa-mesh/meshRunner.js
- mesh: qa-mesh/intelligence/failureIntelligence.js

## Warnings criticos
-       at Object.toHaveBeenCalledWith (tests/unit/fitnessMembershipService.test.js:151:36) |  |  | Test Suites: 1 failed, 33 passed, 34 of 323 total | Tests:       1 failed, 464 passed, 465 total | Snapshots:   0 total | Time:        11.353 s | Ran all test suites matching /tests\/unit/i.
-         "stabilityScore": 0, |         "passed": 0, |         "total": 1 |       } |     ], |     "outputPath": "/opt/results/ria/r-agent2/qa-mesh/intelligence/latest.json" |   } | }

## Fallbacks mapeados
- tools/rpa/run-all.js: fallback URL condicional por env
- qa-mesh/meshRunner.js: fallback de adapter com status passed_via_fallback (degradacao explicita)
- tools/system/runtime-governance.js: classificacao REAL_FAILED_FALLBACK_USED

## Lacunas
- faltava checkpoint manager unificado por onda
- faltava snapshot unico de estabilidade em qa/mesh/intelligence
- faltava pipeline learn persistente com planos de correcao
