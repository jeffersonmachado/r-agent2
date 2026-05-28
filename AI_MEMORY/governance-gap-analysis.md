# Governance Gap Analysis

Date: 2026-05-16

## Scope

This analysis covers the operational memory and enforcement layer for RAP/r-agent2:

- `AI_MEMORY/*`
- `AGENTS.md`
- `CLAUDE.md`
- `.github/copilot-instructions.md`
- `scripts/`
- `qa-mesh/`
- `governance/`
- `docs/governance/`
- release hardening and `dist/` hygiene

## Findings Before Enforcement

The repository already had strong release and governance concepts, but many AI-agent rules were passive:

- Agents were instructed to read `AI_MEMORY`, but no script failed when the memory was missing, empty, stale or disconnected from route/runtime maps.
- Browser validation evidence existed, but no gate checked that screenshots, route evidence and cleanup policy were present.
- Runtime route normalization existed in documentation, but there was no executable Playwright gate validating the authenticated DOM, redirects, console errors and network failures.
- QA Mesh, Replay Governance and release hardening had reports, but agents could still ignore them unless a release script happened to be executed.
- Agent adherence was narrative-only; no report proved that browser validation, release validation and mesh/replay checks were referenced by the operational evidence.
- Governance score did not exist as a single machine-readable summary for future automations.
- CI release governance focused on package/envelope validation and did not explicitly run the AI memory and agent-enforcement validators.

## Enforcement Added

Executable validators now live under `scripts/governance/`:

- `validate-ai-memory.js`
- `validate-runtime-routes.js`
- `validate-browser-evidence.js`
- `validate-release-governance.js`
- `validate-replay-governance.js`
- `validate-qa-governance.js`
- `validate-dist-cleanliness.js`
- `validate-operational-rules.js`
- `validate-agent-adherence.js`
- `validate-self-proving.js`
- `governance-summary.js`

They generate auditable JSON under `reports/` and fail with non-zero exit codes when required governance is not satisfied.

## Blocking Rules Now Enforced

- Missing or empty `AI_MEMORY` files fail `validate:ai-memory`.
- Broken Markdown links inside `AI_MEMORY` fail `validate:ai-memory`.
- Missing required route references fail `validate:ai-memory`.
- Missing browser/runtime evidence fails `validate:browser-evidence`.
- Evidence contamination in `dist/` fails `validate:browser-evidence` and `validate:dist`.
- Authenticated runtime route failures, console errors and network failures fail `validate:runtime`.
- QA Mesh `NO_GO` fails `validate:qa-governance`.
- Replay signature/checksum/hash problems fail `validate:replay-governance`.
- Release readiness `NO_GO` or failed package validation fails `validate:release-governance`.
- Missing agent instruction enforcement fails `validate:agent-adherence`.
- Invalid governance, replay, release, QA or runtime chains fail `validate:self-proving`.
- `overallGovernance < 95` fails `validate:governance-summary`.

## Current Known Runtime Gaps

The current runtime evidence still records:

- `/rpa-replays` is not a direct canonical route; canonical route is `/dev/rpa-replays`.
- `/system-status` is not a direct canonical route; canonical route is `/dev/system-status`.
- `/channel-accounts` is registered in frontend route/menu, but direct navigation returned `401` in the observed authenticated browser session.
- `/dev/rpa-replays` and `/dev/qa-waves` rendered but had failed/aborted API calls in the observed browser session.

These are intentionally not hidden by the enforcement layer. They should make `validate:runtime` fail until the runtime behavior is corrected or explicitly reclassified with validated evidence.

## Current Governance Gaps

The latest observed QA Mesh was `NO_GO`:

- `FAILURE_RATE_ABOVE_THRESHOLD`
- `CRITICAL_DOMAIN_FAILED:omnichannel`
- `CRITICAL_DOMAIN_FAILED:pbx`
- `BASELINE_PASS_RATE_REGRESSION`
- `BASELINE_BLOCKING_REGRESSION`
- `BASELINE_INFRA_REGRESSION`

Replay integrity is currently valid in `governance/replay-integrity-report.json`, but final release readiness remains blocked by mesh/readiness decisions. The enforcement layer must preserve this distinction: package self-proving can pass while operational acceptance is still blocked.

## CI/CD Integration

`.github/workflows/release-governance.yml` now includes explicit AI governance steps:

- `npm run validate:ai-memory`
- `npm run validate:runtime`
- `npm run validate:browser-evidence`
- `npm run validate:qa-governance`
- `npm run validate:replay-governance`
- `npm run validate:release-governance`
- `npm run validate:dist`
- `npm run validate:agent-adherence`
- `npm run validate:self-proving`
- `npm run validate:governance-summary`
- `npm run zip:release`

## Auto-Correction Signals

Each validator emits `suggestions` in its JSON report. These suggestions are the machine-readable auto-correction input for future agents and automations.

## Acceptance Status

The enforcement system is implemented, but the repository should not be declared `GO_FINAL_HARDENED` until the generated reports show:

- runtime validation `PASS`
- QA governance `PASS`
- replay governance `PASS`
- release governance `PASS`
- self-proving `PASS`
- dist validation `PASS`
- agent adherence `PASS`
- `overallGovernance >= 95`

