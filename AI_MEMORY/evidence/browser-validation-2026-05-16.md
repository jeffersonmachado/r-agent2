# Browser Validation Evidence - 2026-05-16

## Environment

- Frontend: `http://127.0.0.1:5173`
- API process observed: `node api/server.js` on port `3001`
- Browser: Playwright Chromium headless
- User: `systemadmin`
- Role: `super_admin`
- Tenant: `system`

## Validated

- Login via `tests/helpers/playwrightAuth.js`.
- Tenant modal selection for `system`.
- Authenticated localStorage state: `auth_token`, `auth_agent`, `auth_effective_tenant_id`.
- Logout/session guard by clearing auth state and opening `/support`, which rendered Login de Agente.
- Routes: `/support`, `/dev/rpa-replays`, `/rag-documents`, `/dev/system-status`, `/channel-health`, `/generate-system`, `/dashboard`, `/workspace`, `/dev/qa-waves`.

## Screenshot artifacts

Screenshots and a machine-readable summary were generated under:

- `AI_MEMORY/evidence/screenshots-2026-05-16/summary.json`
- `AI_MEMORY/evidence/screenshots-2026-05-16/*.png`

## Gaps observed

- `/rpa-replays` redirected to `/workspace`; canonical route is `/dev/rpa-replays`.
- `/system-status` returned `{"error":"not_found"}` with HTTP 404; canonical route is `/dev/system-status`.
- `/channel-accounts` returned `{"error":"unauthorized","message":"Token de autenticacao nao fornecido"}` with HTTP 401 on direct navigation, despite being registered in frontend route/menu.
- RPA replay and QA Waves pages rendered, but API calls through the frontend origin showed failed/aborted fetches in the browser console.

## Final validation run

- `RUNTIME_ROOT=/tmp/ragent2-ai-memory-validation npm run system:validate`: failed at `npm run test:email:smoke` because the script is not present in `package.json`. Before the failure, backend tests passed (`339` suites, `1616` tests), frontend unit tests passed (`91` files, `610` tests), frontend build passed and frontend smoke passed.
- `npm run zip:release`: passed. Generated `dist/release/r-agent2-20260516-071310.payload.zip` and final envelope `r-agent2-20260516-071310.zip`; `CHECK-DIST-CLEAN` passed and the offline enterprise governance verifier passed. During readiness calculation the release still reported `NO_GO:MESH_BLOCKED`.
- `npm run test:governance`: passed (`2` suites, `19` tests).
- `RUNTIME_ROOT=/tmp/ragent2-ai-memory-validation npm run system:release-gate`: failed with `validate_step_missing:email smoke`.
- `RUNTIME_ROOT=/tmp/ragent2-ai-memory-validation PIPELINE_BYPASS=1 npm run qa:mesh`: failed with canonical `NO_GO`. It executed `62` scenarios: `42` passed, `18` failed, `1` infra error and `1` flaky. Reasons included `FAILURE_RATE_ABOVE_THRESHOLD`, `CRITICAL_DOMAIN_FAILED:omnichannel`, `CRITICAL_DOMAIN_FAILED:pbx`, `BASELINE_PASS_RATE_REGRESSION`, `BASELINE_BLOCKING_REGRESSION` and `BASELINE_INFRA_REGRESSION`.
- `npm run system:release-clean-check`: failed because the worktree has pending non-QA changes. This is distinct from the release package `CHECK-DIST-CLEAN`, which passed inside `npm run zip:release`.

## Enforcement validation run

- `npm run validate:ai-memory`: passed.
- `npm run validate:browser-evidence`: passed.
- `npm run validate:operational-rules`: passed.
- `npm run validate:runtime`: failed after authenticated Playwright navigation because required routes emitted console/network failures and `/channel-accounts` did not render as an authenticated page.
- `npm run validate:qa-governance`: failed because QA Mesh is `NO_GO`.
- `npm run validate:replay-governance`: passed.
- `npm run validate:release-governance`: failed because final readiness is `NO_GO:MESH_BLOCKED`.
- `npm run validate:dist`: passed.
- `npm run validate:agent-adherence`: passed.
- `npm run validate:self-proving`: failed because runtime, QA and final readiness chains are not green.
- `npm run validate:governance-summary`: failed with `overallGovernance=43`.
- `npm run validate:governance-enforcement`: failed fast at runtime validation, proving the aggregate gate is blocking.
- Final `npm run zip:release`: passed for package self-proof and offline verifier, producing `r-agent2-20260516-111142.zip`; operational readiness remained `NO_GO:MESH_BLOCKED`.

## Cleanup policy

This evidence file is source documentation. Future screenshots, traces and large logs must be pruned or stored under governed QA evidence paths and must never enter `dist/` release payloads.
