# Operational Mesh

The Operational Mesh is the execution and decision layer that consolidates scenarios, adapters, evidence, metrics, gaps and GO/NO_GO decisions.

## Canonical sources

- `qa-mesh/meshRunner.js`
- `qa-mesh/governance.js`
- `qa-mesh/meshRegistry.json`
- `qa-mesh/meshReport.json`
- `qa-mesh/go-no-go-report.json`
- `qa-mesh/release-gate-report.json`
- `qa-mesh/gap-engine/latest.json`
- `docs/governance/MESH_CANONICAL_BLOCKERS.md`
- `docs/governance/PLATFORM_STATUS.md`

## Agent rules

- Treat canonical mesh `NO_GO` as release-blocking.
- Do not replace failing mesh evidence with ad hoc green checks.
- When adding scenarios, update registry, adapter contract and evidence path.
- Evidence belongs outside `dist/` and outside release payloads unless explicitly packaged as approved release evidence.

