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

## CI no runner efêmero (`.github/workflows/dev-branch-ci.yml`)

Três jobs, todos com produtores REAIS (nenhum `continue-on-error`, nenhum skip):

| Job | Produz | Depende de |
|---|---|---|
| `prod-like-smoke` | artefato `prod-like-smoke-<sha>` (status GO, 9 jornadas) a partir de API+frontend em Docker | imagens `api/Dockerfile.base` → `api/Dockerfile` → `frontend/Dockerfile`, Chromium |
| `dev-branch-integration` | veredito de integração real | `ci:bootstrap`, RAG 8001, sandbox image, Postgres/Redis de serviço |
| `dev-branch-gate` | `reports/dev-branch-ci-evidence.json` + logs por passo | artefato prod-like do job anterior, `ci:bootstrap`, RAG, sandbox image |

Passos do gate (`scripts/ci/dev-branch-gate.js`): `B1..B3` (contratos) → `L0` (`npm test`, 4 workers)
→ `L0b` (`npx jest tests/integration/engineering --runInBand`) → `L1` (7 validadores de governança).
**Estado medido 2026-10-21 (runs 39682918570 e 39686396365):** smoke e integração SUCCESS,
`L0` exit 0 (~445 s) e `L0b` exit 0 (~475 s, 40 suítes / 219 testes); o gate para em
`L1-cadeia-criptografica` porque a cadeia aponta para `dist/release/*.zip` (não versionado) e porque
`ci:bootstrap` regrava elos derivados — `CADEIA_DIVERGENTE`, decisão canônica `NO_GO`. Só
`npm run release:seal` (fase PACKAGE) muda esse veredito; a CI não pode substituir isso.

### Regras que o CI aprendeu (não regredir)

- **Engineering Runner é recurso de SESSÃO, não de porta**: `tests/setup/engineeringRunnerGlobalSetup.js`
  grava dono por porta e uma sessão Jest aninhada (ex.: `run-impact-validation` dentro de um teste)
  REUTILIZA o runner da sessão-mãe. Antes disto o aninhado matava o runner alheio (SIGKILL + spawn
  em 3 ms) e as suítes de sandbox falhavam com `SANDBOX_UNAVAILABLE`/`ECONNREFUSED`.
- **Suítes de integração do engenheiro são serializadas** (`--runInBand`) nos DOIS jobs: o padrão
  `tests/integration/engineering` casa o grupo exclusivo `MISSION_WORKER_SHARED_RUNNER_AND_DB` de
  `config/canonical-release-suites.json`.
- **`ci:bootstrap` é o único preparo de ambiente** e roda nos dois jobs (inclui identidade git e
  `ENCRYPTION_KEY`); job sem ele divergiu e travou uma suíte por 900 s.
- **`ENCRYPTION_KEY` aceita hex de 64 caracteres e base64** (`api/utils/crypto.js`); o bootstrap
  GERA hex. Regressão: `tests/unit/cryptoEncryptionKeyFormats.test.js`.
- **Suíte E2E que provisiona credenciais de IA deve apontar `ENGINEERING_ROUTER_TENANT_ID`** para o
  próprio tenant, senão depende das credenciais de `system` da máquina do operador.

## NO_GO conditions

- Canonical mesh `NO_GO`
- replay integrity invalid
- package contamination
- runtime governance `BLOCKED` or degraded when real runtime is required
- release manifest missing `audit=passed` or `goNoGo=GO`
- browser route required by task cannot authenticate/render and no documented canonical alias exists

