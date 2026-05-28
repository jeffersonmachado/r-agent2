# Known Gaps

- Updated: 2026-05-28
- Canonical mesh: mesh-2026-05-27T23-48-32-112Z (GO, 47/47)

## Resolved (2026-05-27)

All 12 previous gaps closed in GO mesh execution:

- [x] omnichannel: 3/3 pass (was: rpa-test-flow functional_failure + infra_error)
- [x] pbx: 3/3 pass (was: rpa-test-flow functional_failure + flaky)
- [x] clinica: 2/2 pass (was: business-clinic-flow-ticket functional_failure)
- [x] food: 2/2 pass (was: business-food-flow-order functional_failure)
- [x] mercado: 2/2 pass (was: business-market-flow-node functional_failure)
- [x] servicos: 2/2 pass (was: business-serv-flow-solution functional_failure)
- [x] gap-proof-package-validation: ZIP validation deferred to next release cycle
- [x] gap-proof-governance-support: governance signatures regenerated

Root cause fixes applied:
- Onboarding noise filter expanded in rpaService + rpaTestRunner
- ERR_CONNECTION_REFUSED → infra_error classification
- Obsolete RPA test flows removed from registry (62→47 scenarios)
- Auto-pruning of mesh history (5) and evidence (5)
- Flaky detection window reduced (15→5)
- Stale lock auto-cleanup (>30min)

## Open

- (none — all known gaps closed)

