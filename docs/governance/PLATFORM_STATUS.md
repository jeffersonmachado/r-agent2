# Platform Status

- Generated at: 2026-05-28T00:15:00.000Z
- Canonical mesh execution: mesh-2026-05-27T23-48-32-112Z
- Canonical mesh decision: **GO**
- Readiness decision: **GO** [qa-mesh/go-no-go=GO (47/47 passed, 0 failed, 0 flaky, 0 infra)]
- Readiness score: 100.00
- QA coverage: 100% (47/47 scenarios)
- Replay coverage: 100%
- Vertical coverage: 100%

## Domains (all green)
| Domain | Pass | Fail | Flaky | Infra |
|--------|------|------|-------|-------|
| beauty | 12 | 0 | 0 | 0 |
| bpmn | 1 | 0 | 0 | 0 |
| clinica | 2 | 0 | 0 | 0 |
| core | 5 | 0 | 0 | 0 |
| fitness | 14 | 0 | 0 | 0 |
| food | 2 | 0 | 0 | 0 |
| mercado | 2 | 0 | 0 | 0 |
| omnichannel | 3 | 0 | 0 | 0 |
| pbx | 3 | 0 | 0 | 0 |
| servicos | 2 | 0 | 0 | 0 |
| workspace | 1 | 0 | 0 | 0 |

## Blocking domains
- (nenhum — todos os 11 domínios 100%)

## Canonical mesh artifacts
- History: qa-mesh/meshHistory/mesh-2026-05-27T23-48-32-112Z.json
- GO/NO_GO: qa-mesh/go-no-go-report.json
- Cleanup: reports/cleanup-report.json (PASS)

## GO reasons
- 47/47 cenários QA Mesh executados com sucesso.
- Zero falhas, zero flaky, zero infra_error.
- Todos os 11 domínios com 100% de aprovação.
- Operational smokes L01-L05 como pilares com evidência.
- Auto-pruning de histórico (5) e evidências (5) ativo.
- Proteção anti-concorrência de mesh ativa.
- Validador de higiene (validate:cleanup) integrado ao gate.

## NO_GO reasons
- (nenhum)
