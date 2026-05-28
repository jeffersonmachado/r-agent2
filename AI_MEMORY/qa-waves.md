# QA Waves

QA Waves are governed journeys and scenario waves. They connect seeds, business journeys, replay evidence, mesh execution, gap classification and release gates.

## Canonical sources

- `docs/governance/QA_WAVES_STATUS.md`
- `docs/qa-waves-enterprise-governance.md`
- `docs/qa-waves-operational-proof-architecture.md`
- `docs/qa-waves-production-readiness.md`
- `docs/QA_WAVES_SEMANTIC_SCENARIOS.md`
- `qa-mesh/meshRegistry.json`
- `qa-mesh/go-no-go-report.json`
- `qa-mesh/release-gate-report.json`
- `qa-waves/journey-coverage/*.json`

## Operational rules

- A scenario is not release evidence without machine-readable result, replay linkage when applicable, and governance decision.
- NO_GO conditions must block release promotion.
- Seeds are operational inputs and must be reproducible.
- Auto-correction must generate evidence, never hide a failing journey.
- Scenario inference is allowed only when linked to explicit journey/domain metadata and validated runtime behavior.

## Current state

`docs/governance/QA_WAVES_STATUS.md` reports QA Waves enterprise governance as stronger than the canonical mesh, but canonical QA Mesh remains `NO_GO`. Treat the mesh as the blocking release authority until recovered.

