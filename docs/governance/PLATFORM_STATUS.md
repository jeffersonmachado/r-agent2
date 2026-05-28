# Platform Status

- Generated at: 2026-05-16T14:23:28.870Z
- Canonical mesh execution: mesh-2026-05-16T10-17-23-237Z
- Canonical mesh decision: NO_GO
- Readiness decision: NO_GO:MESH_BLOCKED [qa-mesh/go-no-go=NO_GO (FAILURE_RATE_ABOVE_THRESHOLD,CRITICAL_DOMAIN_FAILED:omnichannel,CRITICAL_DOMAIN_FAILED:pbx,BASELINE_PASS_RATE_REGRESSION,BASELINE_BLOCKING_REGRESSION,BASELINE_INFRA_REGRESSION) | qa-mesh/release-gate=NO_GO]
- Readiness score: 79.87
- QA coverage: 85.48%
- Replay coverage: 116.67%
- Vertical coverage: 100%

## Blocking domains
- clinica
- food
- mercado
- omnichannel
- pbx
- servicos

## Canonical mesh artifacts
- History: /opt/results/ria/r-agent2/qa-mesh/meshHistory/mesh-2026-05-16T10-17-23-237Z.json
- Summary: /opt/results/ria/r-agent2/qa-mesh/meshReport.json
- GO/NO_GO: /opt/results/ria/r-agent2/qa-mesh/go-no-go-report.json
- Metrics: /opt/results/ria/r-agent2/qa-mesh/metrics.json

## GO reasons
- Foundation prod-like QA Waves governance exists and is machine-readable.
- Operational smokes L01-L05 remain available as evidence-backed platform pillars.

## NO_GO reasons
- Falha aberta no dominio omnichannel [gap-mesh-omnichannel-functional_failure-rpa-test-flow-28d2aea0-20260129T000000000Z-rpa-test-flow-3571aa07-20260129T034520103Z-rpa-test-flow-3b6cada8-20260129T042632607Z-rpa-test-flow-6309e70a-20260129T033246247Z-rpa-test-flow-7fa30156-20260129T030733925Z-rpa-test-flow-937dd7c3-20260129T000000000Z-rpa-test-flow-c0ea1c71-20260129T045514294Z-rpa-test-flow-cca122f2-20260129T000000000Z-rpa-test-flow-da6f66c1-20260131T041500000Z]
- Falha aberta no dominio pbx [gap-mesh-pbx-functional_failure-rpa-test-flow-659d7749-20260129T035608952Z-rpa-test-flow-6f484f7a-20260129T050243761Z-rpa-test-flow-a41fb4e3-20260129T051056368Z-rpa-test-flow-a85c4a4d-20260129T052758707Z]
- Falha aberta no dominio clinica [gap-mesh-clinica-functional_failure-business-clinic-flow-ticket]
- Falha aberta no dominio food [gap-mesh-food-functional_failure-business-food-flow-order]
- Falha aberta no dominio mercado [gap-mesh-mercado-functional_failure-business-market-flow-node]
- Falha aberta no dominio servicos [gap-mesh-servicos-functional_failure-business-serv-flow-solution]
- Falha aberta no dominio pbx [gap-mesh-pbx-flaky-qa-ura-publish-rollback-smoke]
- Falha aberta no dominio omnichannel [gap-mesh-omnichannel-infra_error-rpa-test-flow-6e8af7c1-20260129T033828021Z]
- Falha aberta no dominio omnichannel [gap-mesh-omnichannel-functional_failure-rpa-test-flow-cf71792a-20260129T034806356Z]
- ZIP de release nao contem todos os proofs obrigatorios [gap-proof-package-validation]
- Governance signature ou cleanup proof nao possuem artifact fisico valido [gap-proof-governance-support]
