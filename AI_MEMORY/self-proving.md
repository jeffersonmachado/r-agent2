# Self-Proving

Self-proving is the governance layer that proves readiness from generated reports, package validation, replay integrity, tamper checks, governance chain and runtime evidence.

## Canonical sources

- `governance/self-proving-report.js`
- `governance/self-proving-report-v2.js`
- `governance/generate-self-proving-report.js`
- `governance/proof-engine/index.js`
- `governance/final-proof-report.json`
- `governance/final-readiness-report.json`
- `governance/self-proving-report.json`
- `qa/reports/final-self-proving-report.json`
- `docs/governance/ENTERPRISE_READINESS.md`
- `docs/governance/PRODUCTION_READINESS.md`

## Rule

Self-proving must be derived from current evidence. It cannot override an active canonical `NO_GO`.

