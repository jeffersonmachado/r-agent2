# Platform Status

- Generated at: 2026-05-15T15:08:24.859Z
- Canonical mesh execution: mesh-2026-05-12T23-50-45-984Z
- Canonical mesh decision: NO_GO
- Readiness decision: NO_GO:MESH_BLOCKED [qa-mesh/go-no-go=NO_GO (BASELINE_PASS_RATE_REGRESSION) | qa-mesh/release-gate=NO_GO]
- Readiness score: 83.1
- QA coverage: 98.39%
- Replay coverage: 116.67%
- Vertical coverage: 100%

## Blocking domains
- pbx

## Canonical mesh artifacts
- History: /opt/results/ria/r-agent2/qa-mesh/meshHistory/mesh-2026-05-12T23-50-45-984Z.json
- Summary: /opt/results/ria/r-agent2/qa-mesh/meshReport.json
- GO/NO_GO: /opt/results/ria/r-agent2/qa-mesh/go-no-go-report.json
- Metrics: /opt/results/ria/r-agent2/qa-mesh/metrics.json

## GO reasons
- Foundation prod-like QA Waves governance exists and is machine-readable.
- Operational smokes L01-L05 remain available as evidence-backed platform pillars.

## NO_GO reasons
- Falha aberta no dominio pbx [gap-mesh-pbx-functional_failure-qa-pbx-call-events-runtime-smoke]
- ZIP de release nao contem todos os proofs obrigatorios [gap-proof-package-validation]
- Governance signature ou cleanup proof nao possuem artifact fisico valido [gap-proof-governance-support]
- Contradição cross-report: package_validation_failed [gap-cross-report-package_validation_failed]
