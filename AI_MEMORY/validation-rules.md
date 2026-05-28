# Validation Rules

## Required validation families

- Unit/domain tests: `npm run test:unit`
- Flow smoke: `npm run test:flow`
- RPA/replay checks: `npm run test:rpa:jest`, relevant `npm run rpa:*` or `npm run test:rpa:*`
- QA Mesh: `npm run qa:mesh`
- QA Waves: `npm run qa:waves:*` where relevant
- Governance: `npm run test:governance`, `npm run system:release-gate`
- Release hardening: `npm run system:validate`, `npm run zip:release`, `npm run system:release`
- Browser validation: Playwright with `tests/helpers/playwrightAuth.js`

## NO_GO conditions

- Canonical mesh `NO_GO`
- replay integrity invalid
- package contamination
- runtime governance `BLOCKED` or degraded when real runtime is required
- release manifest missing `audit=passed` or `goNoGo=GO`
- browser route required by task cannot authenticate/render and no documented canonical alias exists

