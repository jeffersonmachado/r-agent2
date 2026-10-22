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
`L1-cadeia-criptografica` porque a cadeia aponta para `dist/release/*.zip` (não versionado) —
`CADEIA_DIVERGENTE`, decisão canônica `NO_GO`. Só `npm run release:seal` (fase PACKAGE) muda esse
veredito; a CI não pode substituir isso.

> **CORREÇÃO MEDIDA em 2026-10-21 (checkout limpo, `npm run ci:clean-checkout`):** a causa é
> **UMA** — os bytes do pacote selado não são versionáveis (`dist/` é gitignored), então qualquer
> clone recalcula a cadeia sem o `package` e cascateia `cumulative_hash_broken`. A afirmação
> anterior de que `ci:bootstrap` "regrava elos derivados" está **errada**: no clone, depois do
> bootstrap, `governance/*.json` mantêm o mtime do checkout e aparecem limpos em `git status`. A
> regravação de 2026-10-20T13:13 foi de um `zip:release` local
> (`scripts/release-package.sh` → `tools/system/platform-readiness.js`), não do bootstrap.

O `L1` vermelho em `dev/engineering-hardening` é **estrutural, não defeito de teste**: medido em
2026-10-21, `npm run release:seal:plan` recusa antes de qualquer fase com
`✗ branch atual é 'dev/engineering-hardening' (esperado main)` (guard em
`scripts/governance/seal-release.sh`, `[ "$branch" = "main" ]`). Ou seja, o artefato da fase PACKAGE
só existe depois que o conteúdo está em `main` e o selo roda lá. Fechar o `L1` = promover para
`main` + `npm run release:seal` — nunca afrouxar o validador da cadeia.

**Reprodutibilidade medida 5× (commits `43b8825dd`, `02336a9e2`, `5e5a4196e`, `fe6837562` e o do
checkpoint):** `L0` exit 0 em 431–449 s e `L0b` exit 0 em 468–474 s em TODAS as execuções, com
`prod-like-smoke` e `dev-branch-integration` SUCCESS. O `L1` para sempre no MESMO ponto
(`L1-cadeia-criptografica`, exit 1, ≤1 s) — é um bloqueio determinístico, não flake.

**O bloqueio do `L1` tem UMA causa, não três:** os validadores seguintes ainda não executam no CI
(a fase aborta no primeiro), mas medindo-os localmente o veredito é o mesmo e aponta para a cadeia —
`validate-self-proving` reprova com `governance_chain_invalid` / `auto_declaracao_falsa` /
`certificacao_ultrapassada` e `assert-canonical-release-decision` devolve
`CADEIA_RECOMPUTADA_INVALIDA (divergências=11, raizConfere=false)`. `validate-release-dag`,
`validate-hardening-queue`, `validate-ai-memory` e `validate-agent-adherence` PASSAM. Portanto o CI
está a UM ciclo de selagem da matriz completa — e esse ciclo exige `main`.

> **CORREÇÃO MEDIDA em 2026-10-21 (checkout limpo, commit `382f83b37`):** `validate-ai-memory` e
> `validate-agent-adherence` **NÃO** passavam num clone — eles exigiam
> `.github/copilot-instructions.md`, que existia só em `.git/info/exclude` da máquina de
> desenvolvimento. Medido: `required_file_missing` e `agent_instruction_missing` em TODO checkout
> limpo. Corrigido em `c4b3fc70e` (adaptador versionado + lista canônica em
> `scripts/governance/lib/required-agent-files.js` + regressão
> `tests/unit/governance/aiGovernanceRequiredFilesTracked.test.js`). Depois da correção, o
> inventário do L1 medido no clone é **4 verdes / 3 vermelhos**, e os três vermelhos são
> exatamente a família de certificação de release (`cadeia-criptografica`, `self-proving`,
> `decisao-canonica`).

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
- **O Engineering Runner NÃO pode ser compartilhado entre árvores**: com a porta fixa 8097, um
  clone reutiliza o runner de OUTRA árvore (`runner REUTILIZADO: pid=… sessaoDona=…`, medido em
  2026-10-21) e a prova de sandbox passa a medir o código do vizinho. `ci:clean-checkout` sobe o
  runner em porta livre por run (`ENGINEERING_RUNNER_TEST_PORT`).
- **Artefato gitignored consumido por teste tem de ser PRODUZIDO na run**: o
  `qa/smoke/prod-like/…json` vem do job `prod-like-smoke`; num checkout limpo local ele não existe
  e `modelDrivenE2e` reprova (medido: L0 379 suítes / 5568 testes, 1 vermelha). O harness executa o
  produtor real (imagens do commit + API no banco da run + smoke no Chromium).

## Checkout limpo como prova (não como intenção)

`npm run ci:clean-checkout` (`scripts/ci/clean-checkout-verify.js`) é o teste adversarial de
instalação limpa. Ele clona o commit exato em diretório temporário, recusa continuar se o clone
trouxer resíduo (`git status --ignored`), provisiona banco/redis/RAG/runner próprios do run, executa
`ci:bootstrap`, o produtor prod-like e o gate versionado, grava evidência com identidade de run
(`runId`, `sourceCommit`, `sourceFingerprint`, `environmentId`, SHA-256 de cada log) e destrói o que
criou. O relatório fica em `reports/ci-clean-checkout-report.json` e o resumo versionado em
`AI_MEMORY/evidence/ci-clean-checkout-<sha>/<cenario>/RESULT.md` (ou `RUN-NOTES.md` + `gate/`, quando o run é interrompido).

Cenários negativos (provam não vacuidade, nunca "verde por ausência"). **Exercitados em 2026-10-22**,
todos com `veredito=PASS`:

| cenário | prova medida | evidência |
|---|---|---|
| `bootstrap-twice` | bootstrap 94 s + 77 s, contagem de tenants `antes=1 depois=1` | `ci-clean-checkout-3f6c30d0c/bootstrap-twice/` |
| `missing-artifact` | com artefato PASS (8 s); artefato apagado ⇒ consumidor **exit 1** (5 s); produtor regenera (69 s); consumidor volta a PASS (6 s) | `ci-clean-checkout-1e6a64b58/missing-artifact/` |
| `corrupt-artifact` | JSON prod-like truncado ⇒ consumidor **exit 1** (7 s) | `ci-clean-checkout-1e6a64b58/corrupt-artifact/` |
| `docker-unavailable` | sem Docker a suíte de sandbox **exit 1** (2 s) — nunca `SANDBOX_RUNTIME=PASS` | `ci-clean-checkout-33ef95718/docker-unavailable/` |
| `db-unavailable` | sem Postgres o bootstrap foi **abortado em 480 s** pelo orçamento (nunca virou sucesso) | `ci-clean-checkout-e38734867/db-unavailable/` |
| `l0-full` | seleção oficial inteira com `--bail=0` (bail=1 esconde o resto) | executado |

**Defeito que a própria execução negativa revelou (2026-10-22):** o primeiro par escolhido para
`missing-artifact` era `reports/coverage-completeness-report.json` ×
`coverageCompletenessCanonicalDomains.test.js` — mas esse teste **roda o produtor no `beforeAll`**, então
apagar o relatório não o reprova. O cenário passou a usar o artefato prod-like × `modelDrivenE2e`, que
apenas lê o arquivo. Um cenário negativo que nunca falha não prova nada.

**Medição FINAL (commit `2f8b5aa29`, runId `clean-checkout-20261022033303272-e0bbfe`):** clone limpo
PASS · `ci:bootstrap` exit 0 em 97 s · produtor prod-like exit 0 (`status=GO`, 9 fluxos) ·
**`L0` exit 0 em 437 s** (1095 suítes + 1 skip, 30 de flow/engine, 3 de RPA) · **`L0b` exit 0 em
983 s (40 suítes / 219 testes)** · inventário L1: 4 verdes / 3 vermelhos (`cadeia-criptografica`,
`self-proving`, `decisao-canonica` = família de certificação de release).

**`l2-system` em checkout limpo:** 1 suíte vermelha (`finalStatusProjection`, falta
`governance/rap-master-scorecard.json` — artefato gitignored que só existe após run selado); na árvore
de desenvolvimento com esses artefatos, `npm run test:system` = 18 suítes / 162 testes exit 0. É a
MESMA família de release, não defeito de teste.

**Primeira medição (commit `382f83b37`, histórico):** `L0` 379 suítes / 5568 testes com 1 vermelha
(`modelDrivenE2e`, artefato prod-like ausente — hoje o produtor é executado pelo harness).

## NO_GO conditions

- Canonical mesh `NO_GO`
- replay integrity invalid
- package contamination
- runtime governance `BLOCKED` or degraded when real runtime is required
- release manifest missing `audit=passed` or `goNoGo=GO`
- browser route required by task cannot authenticate/render and no documented canonical alias exists

