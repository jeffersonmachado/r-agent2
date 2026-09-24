# Platform Status

- Generated at: 2026-09-24T07:26:23.845Z
- Canonical mesh execution: mesh-2026-09-24T06-55-00-751Z
- Canonical mesh decision: NO_GO
- Readiness decision: NO_GO:MANDATORY_GATE_BLOCKED [qa-mesh=NO_GO | release-gate=NO_GO | governance=NO_GO:GOVERNANCE_BLOCKED [MASTER_SCORECARD_NOT_10_OF_10: RAP-001: score=7 target=10 | RAP-001: mandatory requirement failures=governed,no-known-gap,no-open-blocker | RAP-001: open blockers=1 | RAP-001: open gaps=1 | RAP-003: score=7 target=10 | RAP-003: mandatory requirement failures=governed,no-known-gap,no-open-blocker | RAP-003: open blockers=1 | RAP-003: open gaps=1 | RAP-004: score=7 target=10 | RAP-004: mandatory requirement failures=governed,no-known-gap,no-open-blocker | RAP-004: open blockers=1 | RAP-004: open gaps=1 | RAP-005: score=7 target=10 | RAP-005: mandatory requirement failures=governed,no-known-gap,no-open-blocker | RAP-005: open blockers=1 | RAP-005: open gaps=1 | RAP-006: score=6 target=10 | RAP-006: mandatory requirement failures=runtime-validated,no-known-gap,no-open-blocker | RAP-006: open blockers=1 | RAP-006: open gaps=1 | RAP-009: score=6 target=10 | RAP-009: mandatory requirement failures=runtime-validated,governed,no-known-gap,no-open-blocker | RAP-009: open blockers=2 | RAP-009: open gaps=2 | RAP-021: score=6 target=10 | RAP-021: mandatory requirement failures=runtime-validated,governed,no-known-gap,no-open-blocker | RAP-021: open blockers=2 | RAP-021: open gaps=2 | RAP-037: score=6 target=10 | RAP-037: mandatory requirement failures=runtime-validated,governed,no-known-gap,no-open-blocker | RAP-037: open blockers=2 | RAP-037: open gaps=2 | RAP-038: score=6 target=10 | RAP-038: mandatory requirement failures=runtime-validated,governed,no-known-gap,no-open-blocker | RAP-038: open blockers=2 | RAP-038: open gaps=2 | RAP-039: score=7 target=10 | RAP-039: mandatory requirement failures=governed,no-known-gap,no-open-blocker | RAP-039: open blockers=1 | RAP-039: open gaps=1 | RAP-041: score=6 target=10 | RAP-041: mandatory requirement failures=runtime-validated,governed,no-known-gap,no-open-blocker | RAP-041: open blockers=2 | RAP-041: open gaps=2 | RAP-042: score=7 target=10 | RAP-042: mandatory requirement failures=governed,no-known-gap,no-open-blocker | RAP-042: open blockers=1 | RAP-042: open gaps=1 | RAP-043: score=7 target=10 | RAP-043: mandatory requirement failures=governed,no-known-gap,no-open-blocker | RAP-043: open blockers=1 | RAP-043: open gaps=1 | RAP-044: score=6 target=10 | RAP-044: mandatory requirement failures=runtime-validated,governed,no-known-gap,no-open-blocker | RAP-044: open blockers=2 | RAP-044: open gaps=2 | RAP-045: score=6 target=10 | RAP-045: mandatory requirement failures=runtime-validated,governed,no-known-gap,no-open-blocker | RAP-045: open blockers=2 | RAP-045: open gaps=2 | RAP-046: score=6 target=10 | RAP-046: mandatory requirement failures=runtime-validated,governed,no-known-gap,no-open-blocker | RAP-046: open blockers=2 | RAP-046: open gaps=2 | RAP-047: score=7 target=10 | RAP-047: mandatory requirement failures=governed,no-known-gap,no-open-blocker | RAP-047: open blockers=1 | RAP-047: open gaps=1 | RAP-049: score=6 target=10 | RAP-049: mandatory requirement failures=runtime-validated,governed,no-known-gap,no-open-blocker | RAP-049: open blockers=2 | RAP-049: open gaps=2 | RAP-050: score=6 target=10 | RAP-050: mandatory requirement failures=runtime-validated,no-known-gap,no-open-blocker | RAP-050: open blockers=1 | RAP-050: open gaps=1 | RAP-052: score=6 target=10 | RAP-052: mandatory requirement failures=runtime-validated,no-known-gap,no-open-blocker | RAP-052: open blockers=1 | RAP-052: open gaps=1 | RAP-054: score=6 target=10 | RAP-054: mandatory requirement failures=runtime-validated,governed,no-known-gap,no-open-blocker | RAP-054: open blockers=2 | RAP-054: open gaps=2 | RAP-056: score=7 target=10 | RAP-056: mandatory requirement failures=governed,no-known-gap | RAP-056: open gaps=1 | RAP-059: score=7 target=10 | RAP-059: mandatory requirement failures=governed,no-known-gap,no-open-blocker | RAP-059: open blockers=1 | RAP-059: open gaps=1 | RAP-060: score=7 target=10 | RAP-060: mandatory requirement failures=governed,no-known-gap,no-open-blocker | RAP-060: open blockers=1 | RAP-060: open gaps=1 | RAP-067: score=7 target=10 | RAP-067: mandatory requirement failures=governed,no-known-gap,no-open-blocker | RAP-067: open blockers=1 | RAP-067: open gaps=1 | scorecard: open blockers=34 | scorecard: open gaps=35 | FINAL_PROOF_NOT_PASS: NO_GO:BLOCKING_GAPS | FINAL_READINESS_NOT_PASS: NO_GO:BLOCKING_GAPS]]
- Readiness score: 98.09
- QA coverage: 92.36%
- Replay coverage: 100%
- Vertical coverage: 100%

## Blocking domains
- beauty
- bpmn
- core
- fitness
- omnichannel

## Canonical mesh artifacts
- History: /opt/results/ria/r-agent2/qa-mesh/meshHistory/mesh-2026-09-24T06-55-00-751Z.json
- Summary: /opt/results/ria/r-agent2/qa-mesh/meshReport.json
- GO/NO_GO: /opt/results/ria/r-agent2/qa-mesh/go-no-go-report.json
- Metrics: /opt/results/ria/r-agent2/qa-mesh/metrics.json

## GO reasons
- Foundation prod-like QA Waves governance exists and is machine-readable.
- Operational smokes L01-L05 remain available as evidence-backed platform pillars.

## NO_GO reasons
- Falha aberta no dominio fitness [gap-mesh-fitness-infra_error-fitness-matricula-renovacao]
- Falha aberta no dominio omnichannel [gap-mesh-omnichannel-infra_error-rpa-whatsapp-connections-rpa-support-inbox-nota-ui]
- Falha aberta no dominio core [gap-mesh-core-functional_failure-business-core-biz-academy]
- Falha aberta no dominio core [gap-mesh-core-functional_failure-business-core-biz-flows-editor]
- Falha aberta no dominio core [gap-mesh-core-functional_failure-business-core-biz-rag-segregation]
- Falha aberta no dominio bpmn [gap-mesh-bpmn-infra_error-qa-bpmn-editor-smoke]
- Falha aberta no dominio core [gap-mesh-core-infra_error-qa-core-auth-login]
- Falha aberta no dominio core [gap-mesh-core-infra_error-qa-core-config-tenant-intelligence]
- Falha aberta no dominio core [gap-mesh-core-infra_error-rpa-example-test]
- Falha aberta no dominio beauty [gap-mesh-beauty-functional_failure-business-beauty-scr-06]
- Falha aberta no dominio fitness [gap-mesh-fitness-flaky-fitness-matricula-checkout]
