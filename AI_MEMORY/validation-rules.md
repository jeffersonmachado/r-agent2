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

## Execução paralela (orçamento de conexões)

`maxWorkers` do Jest é DERIVADO do teto de conexões do Postgres, não fixo:
`workers × DB_POOL_MAX ≤ orçamento` em `lib/jestDbConnectionBudget.js` (fonte única, consumida por
`jest.config.cjs` e `tests/setup.js`). Motivo medido: os workers herdam `DB_POOL_MAX=40` do `.env`
carregado pelo globalSetup e, com o default `cpus - 1` de workers, pediam 440 conexões num banco de
100 — falha de infraestrutura disfarçada de falha de teste. Um `DB_POOL_MAX` grande declarado no
ambiente reduz o número de workers (`clamped: true`), nunca estoura o banco. Os runners oficiais de
evidência (`run-release-suites.js`, `generate-*-evidence.js`) usam `--runInBand` e não dependem
deste orçamento.

## NO_GO conditions

- Canonical mesh `NO_GO`
- replay integrity invalid
- package contamination
- runtime governance `BLOCKED` or degraded when real runtime is required
- release manifest missing `audit=passed` or `goNoGo=GO`
- browser route required by task cannot authenticate/render and no documented canonical alias exists

