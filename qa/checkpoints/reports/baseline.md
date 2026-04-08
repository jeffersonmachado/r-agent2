# Baseline Inicial RAP

Gerado em: 2026-04-07T15:40:09.822Z

## backendBuild
- status: failed
- exitCode: 1
- durationMs: 14000
- logPath: qa/checkpoints/logs/baseline-backendBuild.log
- tail:       at Object.toHaveBeenCalledWith (tests/unit/fitnessMembershipService.test.js:151:36) |  |  | Test Suites: 1 failed, 33 passed, 34 of 323 total | Tests:       1 failed, 464 passed, 465 total | Snapshots:   0 total | Time:        11.353 s | Ran all test suites matching /tests\/unit/i.

## frontendBuild
- status: passed
- exitCode: 0
- durationMs: 43000
- logPath: qa/checkpoints/logs/baseline-frontendBuild.log
- tail: ✓ built in 36.82s |  | PWA v1.2.0 | mode      generateSW | precache  16 entries (5118.70 KiB) | files generated |   dist/sw.js |   dist/workbox-1ef09536.js

## qaTechnical
- status: passed
- exitCode: 0
- durationMs: 0
- logPath: qa/checkpoints/logs/baseline-qaTechnical.log
- tail: [2026-04-07T15:39:24.708Z] [INFO] [qaRunner] Nenhum arquivo alterado detectado | [2026-04-07T15:39:24.734Z] [INFO] [qaRunner] QA concluído | { |   "status": "PASS", |   "scopes": [], |   "totalChecks": 0, |   "blockingFailures": 0 | }

## qaMesh
- status: failed
- exitCode: 1
- durationMs: 69000
- logPath: qa/checkpoints/logs/baseline-qaMesh.log
- tail:         "stabilityScore": 0, |         "passed": 0, |         "total": 1 |       } |     ], |     "outputPath": "/opt/results/ria/r-agent2/qa-mesh/intelligence/latest.json" |   } | }

## criticalReplay
- status: passed
- exitCode: 0
- durationMs: 7000
- logPath: qa/checkpoints/logs/baseline-criticalReplay.log
- tail:   RPA runtime reliability smoke |     ✓ exposes finalDecision, bugResolution and reliabilityMetrics at runtime (3111 ms) |  | Test Suites: 1 passed, 1 total | Tests:       1 passed, 1 total | Snapshots:   0 total | Time:        5.575 s | Ran all test suites matching /tests\/runtime\/rpaReliabilitySmoke.test.js/i.

## Gate Inicial
- status: blocked
- falhas: backendBuild, qaMesh
