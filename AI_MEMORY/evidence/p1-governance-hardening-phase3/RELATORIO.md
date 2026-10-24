# RELATÓRIO TÉCNICO — P1 GOVERNANCE HARDENING, FASE 3

**Repositório:** `jeffersonmachado/r-agent2`
**Branch:** `codex/p1-governance-hardening-20261023` (worktree `/tmp/r-agent2-p1-hardening`)
**PR:** #16 → `dev/engineering-hardening` — **NÃO MESCLADO**
**Baseline do PR:** `484eee4788e553907e31f7b0528cac9ee41d9298`
**Base desta fase (fim da Fase 2):** `a3aa22d2869ff6c162968cac64dd33de9403738c`
**HEAD desta fase (código validado por CI):** `23ab5d768fa22a85d2f3804e29f7a3d66f519ec4`
**CI (SHA exato):** run `40114341579` — merge `56c435e3a6e0` — **success**
**Diff da fase:**  21 files changed, 1167 insertions(+), 63 deletions(-)
**Node:** v22.12.0 · **npm:** 10.9.0 · **Jest:** 29.7.0 · **Docker:** 27.3.1
**Ambiente:** Linux 6.8.0-146-generic (12 CPUs) · host `jmachado-Precision-5530`
**Relatórios anteriores (NÃO substituídos):** `AI_MEMORY/evidence/p1-governance-hardening-2026-10-23/RELATORIO.md` (Fase 1),
`AI_MEMORY/evidence/p1-governance-hardening-phase2/RELATORIO.md` (Fase 2)

Veredito: **ver §12** (`DEVELOPMENT_VERIFIED_NO_SHA_R`, certificação `NO_GO`). Nada foi mesclado,
tagueado, publicado ou implantado.

---

## 0. ETAPA ZERO — sincronização e inventário

| Item | Valor medido |
|---|---|
| `origin/main` | `04cad9c1b639cdae357687f7febf47e490834665` (intocado) |
| `origin/dev/engineering-hardening` | `484eee4788e553907e31f7b0528cac9ee41d9298` (intocado) |
| Branch remota antes desta fase | `a3aa22d28` (push da Fase 2 autorizado pelo operador) |
| Commits posteriores ao SHA auditado (`cad7caaad`) | `a3aa22d28` — apenas sincronização do relatório (código idêntico) |
| Worktree local | limpo (0 alterações pendentes no início) |
| PR #16 | `OPEN`, base `dev/engineering-hardening`, 23 commits, `+9377/−136` |

**Identidade de SHAs (regra da missão E):** ver §12 — `SOURCE_SHA`, `TESTED_SHA`, `REVIEWED_SHA`,
`DELIVERED_SHA` são registrados separadamente e só coincidem se o HEAD final tiver sido testado.

---

## 1. MISSÃO A — BYPASS DE PUBLICAÇÃO POR CONFIGURAÇÃO GIT

### 1.1 Vulnerabilidade REPRODUZIDA (P0/P1)

A Fase 2 dispensava o porteiro quando a URL "parecia local", decidindo por
`git remote get-url <remote>`. Reproduzido em repositório descartável (2026-10-24):

| # | Configuração | Efeito observado |
|---|---|---|
| 1 | `remote.origin.pushurl = git@example.invalid:org/repo.git` com fetch URL local | `git remote get-url origin` devolvia o **caminho local** (dispensa disparava) e `git push --dry-run` tentava **ssh para `example.invalid`** — comprovado com `GIT_SSH_COMMAND` falso que registrou os argumentos |
| 2 | `url.<destino>.pushInsteadOf <origem>` | `git remote get-url --push` devolve o destino **reescrito**: a URL observada não é a URL usada pelo transporte |

Conclusão: **classificação por string de URL é contornável por configuração Git legítima**. Corrigir
apenas o caso reproduzido não fecharia a classe.

### 1.2 Correção (classe, não caso)

`scripts/governance/publication-gate.sh` foi reescrito:

- **default = SEMPRE exigir o gate** (autorização explícita `RAP_PUBLISH_AUTHORIZED=1` **e** GO
  definitivo por `assert-canonical-release-decision`), independentemente de URL/nome de remote;
- a **única** dispensa é o modo local de teste declarado, que exige:
  1. `RAP_RELEASE_TAG_LOCAL_REMOTE_ALLOW` = caminho absoluto (intenção explícita do operador);
  2. recusa em `CI=true` e `NODE_ENV=production` (impossível ativar em silêncio);
  3. recusa quando existe **qualquer** regra `url.*.insteadOf`/`pushInsteadOf` no repositório;
  4. exige que **todos** os destinos de push (`git remote get-url --push --all`) sejam exatamente o
     caminho autorizado (basta um externo para recusar);
  5. registra os destinos resolvidos (auditável).
- `scripts/create-release-tag.sh` passou a chamar o porteiro **sempre** (`rap_publication_gate
  "create-release-tag:$TAG" "$REMOTE"`) — a dispensa por "remote local" foi removida;
- `phase_publish` do selo continua reexecutando a decisão canônica (Fase 2), fechando o `--from publish`.

### 1.3 Ataques executados (7 novos casos, todos PASS)

`tests/unit/governance/releaseGovernanceBypassPhase2.test.js` (33 casos no total):

| Caso | Resultado |
|---|---|
| A1 — `pushurl` externo com fetch local, sem autorização | BLOQUEADO; nenhuma tag no remote |
| A2 — modo de teste autorizando o caminho local **com** `pushurl` externo | RECUSADO (`destino != autorizado`) |
| A3 — `url.*.pushInsteadOf` presente | RECUSADO antes da comparação |
| A4 — múltiplos destinos (um externo) | RECUSADO |
| A5 — modo de teste com `CI=true` / `NODE_ENV=production` | RECUSADO |
| A6 — destino autorizado ≠ configurado | RECUSADO |
| A7 — **prova do transporte real** | `get-url` diz local; `git push` resolve para `example.invalid` (ssh falso registra o host) |

---

## 2. MISSÃO B — FILESYSTEM FAIL-CLOSED SEM `/proc`

### 2.1 Defeito

`PIN_INDISPONIVEL` (plataforma sem `/proc`, container restritivo) caía no caminho textual: **escrevia**
e só depois detectava a troca de diretório. Detecção não é prevenção — o efeito externo já ocorreu.

### 2.2 Correção

- `gravarResultado` → `{ok:false, motivo:'UNSUPPORTED_SECURE_FILESYSTEM:PIN_INDISPONIVEL'}`;
- `gravarManifesto` → lança `UNSUPPORTED_SECURE_FILESYSTEM:PIN_INDISPONIVEL` ⇒ `finalizar` recusa
  fechar a execução (nada de `COMPLETED` sem primitiva segura);
- costura de teste `RAP_SECURE_FS_FORCE_NO_PROC=1` (não vale em `NODE_ENV=production`; só **piora** a
  situação — força recusa, nunca habilita escrita).

### 2.3 Ataques (18 casos na suíte de filesystem, todos PASS)

Caso novo **B3c**: sem `/proc` — 2 gravações recusadas com `UNSUPPORTED_SECURE_FILESYSTEM`, **zero**
artefatos criados, sentinela externa intacta, fechamento recusado em processo filho e manifesto
permanecendo em `RUNNING`. Os 12 ataques da Fase 2 continuam verdes (symlink antes/durante/depois da
abertura, ancestral, colisão concorrente real, SIGKILL, recuperação, somente-leitura, `runs/`, `itens/`,
raiz permissiva, agregação parcial) mais **B3b** (troca do ancestral da BASE).

### 2.4 Limitação declarada

Fora do Linux (sem `/proc`) a operação agora **falha** em vez de degradar para detecção. Não há
alegação de suporte seguro a plataforma não validada — a recusa é o comportamento correto.

---

## 3. MISSÃO C — INTEGRIDADE ≠ AUTENTICIDADE ≠ CERTIFICAÇÃO

### 3.1 Separação formal implementada

Novo `governance/proof-engine/evidence-trust.js` com seis níveis **encadeados**:
`LOCAL_INTEGRITY → RUN_IDENTITY → PROVENANCE → CRYPTOGRAPHIC_AUTHENTICITY → EXTERNAL_ANCHOR → CERTIFIED`.
`classificarEvidencia()` devolve `nivel`, `alcancados`, `bloqueios` (todos os que faltam, nomeados) e
`certificante` — que só é `true` no topo da cadeia.

`agregar()` do regularizador passou a **declarar** `confianca` (nível + bloqueios + próximo nível
exigido). Com os fatos observáveis hoje (hashes conferem, runId coerente, digest da fila confere) o
nível máximo alcançável é **`PROVENANCE`**; `certificante` é **`false`** e os três bloqueios são
`CRYPTOGRAPHIC_AUTHENTICITY`, `EXTERNAL_ANCHOR`, `CERTIFIED`.

### 3.2 Testes (12 casos, todos PASS)

`tests/unit/governance/evidenceTrustLevels.test.js`: encadeamento obrigatório; integridade local
**nunca** implica certificação; adulteração com `artifactSha256` **recalculado** chega no máximo a
`PROVENANCE`; replay (runId reutilizado / artefato de outro run) bloqueia em `RUN_IDENTITY`;
proveniência divergente (fila alterada depois) bloqueia em `PROVENANCE`; `CERTIFIED` exige todos os
elementos; e, contra o regularizador **real**, `agregar()` de execução legítima declara `PROVENANCE`
com `certificante:false`.

Nenhuma assinatura foi criada, nenhuma âncora provisionada, nenhuma aprovação humana fabricada.

---

## 4. MISSÃO D — L2 E ARTEFATO GOVERNADO

### 4.1 Diagnóstico (investigação pedida)

| Pergunta | Resposta medida |
|---|---|
| Quem produz o scorecard | `governance/master-scorecard-engine.js` / `revalidate-master-scorecard.js`, **dentro de run governado** |
| Quem consome | `generate-final-status-projections.js`, `validate-final-status-projection.js`, `seal-time-gate.js`, `verify-payload-governance.js`, `two-pass-release.sh` |
| Autoridade | o run governado do selo (`runId rap-governed-20261020150721180-09a2168d`) |
| Por que é gitignored | política `.gitignore` para `governance/*.json` (artefato derivado de runtime) |
| Deve ser gerado no bootstrap? | **Não** — regenerar localmente foi medido: `canonical_divergence: readiness.sourceFingerprint != scorecard.sourceFingerprint` + `stale_run_id` ⇒ estado fabricado |
| O teste valida comportamento ou certificação? | **Certificação** (estado canônico), não L2 |
| A dependência pertence ao L2? | **Não** |

### 4.2 Correção: separação formal, controle preservado

- asserção de estado canônico movida para **`tests/certification/canonicalProjectionState.test.js`**;
- novo script **`npm run test:certification`** (`jest tests/certification`);
- novo passo obrigatório na **fase R** do gate: `PASSOS.R → L1-projecao-estado-canonico`
  (`npm run -s test:certification`), com descrição explícita de `BLOCKED_BY_GOVERNED_EVIDENCE`;
- `tests/governance/finalStatusProjection.test.js` mantém os 11 testes de FIXTURE no L2 e ganhou um
  caso que **guarda a existência** da suíte de certificação (apagar a suíte para "limpar" o L2 reprova);
- `tests/unit/governance/phaseStepContract.test.js` (contrato de cobertura) atualizado para exigir o
  novo passo — o contrato **detectou** a mudança, como deveria;
- `tests/unit/governance/certificationSeparation.test.js` (4 casos) trava a separação nos dois sentidos.

### 4.3 Resultado

`--scenario l2-system` em **checkout descartável**, commit `5672411a2`:
`clone-limpo` PASS · `bootstrap` PASS (107 s) · **`l2-test-system` PASS (68 s)** — veredito **PASS**.
Sem scorecard governado o caminho de certificação reprova com `BLOCKED_BY_GOVERNED_EVIDENCE`
(nunca PASS por omissão).

---

## 5. MISSÃO E — CI INDEPENDENTE NO SHA EXATO

### 5.1 Achado: o PR não tinha NENHUMA validação automática

| Verificação | Resultado medido |
|---|---|
| `gh run list --branch codex/p1-governance-hardening-20261023` | **`[]`** (nenhum run) |
| `gh run list --commit a3aa22d28` | **`[]`** |
| Runs existentes | apenas em `dev/engineering-hardening` (ex.: `39993295483` @ `484eee478`, jobs com 18–20 passos, success) |
| Causa | `dev-branch-ci.yml` só tinha `push: [dev/engineering-hardening]` + `workflow_dispatch`; os demais workflows filtram `main`/`develop`/`release/**` |

### 5.2 Correção

`dev-branch-ci.yml` ganhou `pull_request: branches: [dev/engineering-hardening]` — o PR passa a ser
validado de forma independente no SHA exato. O workflow já garantia o necessário e isso passou a ser
travado por teste (`tests/unit/ci/prCiCoverage.test.js`, 5 casos):

- `permissions: contents: read` (não publica) e ausência de `git push`/`git tag`/`docker push`/`npm publish`;
- nenhum passo de validação com `continue-on-error` (job não fica verde por omissão);
- `test "$(git rev-parse HEAD)" = "$GITHUB_SHA"` — identidade do SHA **assertada**;
- artefatos nomeados por `${{ github.sha }}` (sem reutilizar evidência de outro commit);
- inventário explícito dos workflows que **não** cobrem a base do PR (`e2e`, `frontend`, `jest`, `rag`).

### 5.3 Execução real do CI (autorizada pelo usuário) — e o que ela provou

O run deixou de ser hipótese: com o push autorizado, `pull_request` passou a disparar
`Dev Hardening CI (L0 + L1 governança)` no SHA do merge do PR. **Três runs reprovaram, cada um por um
defeito DIFERENTE** — e todos eram reais, não flakiness:

| Run | SHA | Falha observada | Diagnóstico |
|---|---|---|---|
| `40105995013` | `1b64e6b86` | `L0-suite-oficial` exit=1 (124 s) | evidência antiga só com a cauda do log: suite desconhecida |
| `40108935675` (1ª tentativa) | `96cb1101f` | `docker build` do `rag-service` | `429 Too Many Requests` do HuggingFace — infra de terceiro |
| `40108935675` (reexecução) | `047f8798b` | `L0-suite-oficial` exit=1 (119 s) | `releaseAnchorsPreflightBlocking.test.js:128` |
| `40112925374` | `26f6acfdb` | `L0-suite-oficial` exit=1 (360 s) | `runIdentityCommit.test.js:60` (`sourceBranch` = `null`) |
| `40114341579` | `23ab5d768` (merge `56c435e3a6e0`) | — | **SUCCESS: L0a, L0, L0b e L1 verdes** |

**Resultado final do CI (run `40114341579`, SHA exato `23ab5d768`, merge `56c435e3a6e0`):**

```
A pre-voo .................. OK (10 checks, incluindo A2 sha-esperado == HEAD)
B TESTES_NEGATIVOS ......... ALLOWED, 3 suítes exit=0
C  L0a-artefatos-canoeiros . exit=0   5.6 s
C  L0-suite-oficial ........ exit=0 479.0 s
C  L0b-integracao-engenheiro exit=0 483.6 s
D  L1-release-dag .......... exit=0
D  L1-fila-oficial ......... exit=0
D  L1-ai-memory ............ exit=0
D  L1-aderencia-agente ..... exit=0
veredito = PASS_PARCIAL (completo=false — fase R não roda no CI, por desenho)
jobs: prod-like-smoke=success · integração do Engenheiro=success · L0+L1=success
```

O diagnóstico só ficou possível baixando o **artefato de evidência** do run
(`dev-branch-ci-evidence-<sha>`, cujo `dev-branch-gate-logs/L0-suite-oficial.log` carrega a saída
real do passo). Aprendizado registrado: log de CI sem a saída do passo não é evidência — por isso a
Fase 3 já havia mudado o gate para guardar o INÍCIO da saída quando o passo falha.

### 5.4 Defeito 1 — status de passo mascarado pela última linha (P0 do caminho certificante)

`releaseAnchorsPreflightBlocking.test.js:128` reprovava com `Expected: not 0`: o passo
"Preflight das âncoras do Bug Closure" — declarado **BLOQUEANTE** — devolvia exit 0 com âncora
AUSENTE.

```bash
set -o pipefail
node scripts/governance/provision-closure-anchors.js --check | tee "$RUNNER_TEMP/anchor-preflight.json"
echo "anchor_preflight=ok" >> "$GITHUB_OUTPUT"
```

Sem `set -e`, o status de um passo é o da **última** linha. No runner `$GITHUB_OUTPUT` e
`$RUNNER_TEMP` existem, então o `echo` tinha sucesso e `pipefail` sozinho não reprovava:
`governance-core` ficava verde e `release-gate` podia imprimir *"Release autorizado"* sem nenhuma
âncora de confiança. O teste do P1-C passava na máquina de desenvolvimento **por acidente de
ambiente** (sem essas variáveis, o próprio `echo` falhava e a asserção era satisfeita pelo motivo
errado).

Correção: `set -euo pipefail` nos dois passos de preflight e
`defaults.run.shell: bash --noprofile --norc -eo pipefail {0}` nos jobs certificantes
(`governance-core`, `governance-regression`, `anchors-attestation`, `release-gate`, `dev-branch-gate`).
Passo que TOLERA falha passa a precisar dizer `|| true` explicitamente.
Regressões: `releaseAnchorsPreflightBlocking.test.js` 15/16 → **16/16**;
`tests/unit/ci/stepExitMasking.test.js` (novo) trava a regra para todos os passos multi-comando
desses jobs e prova o comportamento (`set -o pipefail` ⇒ 0 mascarado; `set -euo pipefail` ⇒ não-zero).

### 5.5 Defeito 2 — asserção dependente de HEAD destacado

`runIdentityCommit.test.js:60` exigia `typeof sourceBranch === 'string'`. O CI faz checkout de
`refs/pull/<n>/merge` em **HEAD destacado**, onde `git rev-parse --abbrev-ref HEAD` devolve a string
literal `HEAD` — que `resolveGitIdentity` converte em `null` (correto: `HEAD` não é branch, é
ausência). O teste reprovava em **todo** run de PR e passava em qualquer clone com branch.
Correção: a branch tem de ser exatamente a reportada pelo git; `null` só é aceito quando
`git symbolic-ref -q HEAD` falha. Verificado nos dois sentidos (com branch e em worktree `--detach`).

### 5.6 Defeito 3 — L0 não era autossuficiente (reprodutibilidade)

Durante o diagnóstico, `tests/unit` foi exercitado em árvore sem os artefatos ignorados pelo git
(`reports/*.json`, `governance/json-persistence-audit.json`, `qa-mesh/meshRegistry.json`):
`npx jest tests/unit` reprovava com `Expected "EXPLICIT", Received "GRAPH_ABSENT"`. O L0 do gate,
porém, não produzia essas entradas — dependia de o bootstrap ter rodado antes (verdade no job do CI,
falso em execução local e no harness de checkout limpo).

Correção: novo passo `L0a-artefatos-canoeiros` (`npm run ci:artifacts`) imediatamente antes de
`L0-suite-oficial`, com orçamento explícito (`L0A_ORCAMENTO_MS`, default 20 min), sem
`continue-on-error` e falhando fechado (`INCOMPLETE` ⇒ exit 1). Ordem travada por
`phaseStepContract.test.js`.

### 5.7 Defeito 4 — build da imagem RAG morria por rate limit de terceiro

`docker build rag-service` falhou com `429 Client Error: Too Many Requests` no pré-download do
`sentence-transformers/all-MiniLM-L6-v2`. O L0b depende dessa imagem. Correção: 5 tentativas com
backoff linear (10 s…50 s) e **falha fechada** (`exit 1`) se todas esgotarem — retry é resiliência a
janela de rate limit, não tolerância a modelo ausente. Validado com laço forçado a falhar
(exit 1 em `bash:5`) e `docker build --check rag-service` ⇒ *no warnings found*.

### 5.8 Harness de paridade com o CI (como o "um vermelho por run" foi encerrado)

Cada rodada de CI revelava **uma** falha nova porque o ambiente do runner não era reproduzível
localmente. Fechado com uma árvore de paridade:

```bash
git worktree add --detach /tmp/detach HEAD          # HEAD destacado, como o checkout de PR
ln -s <repo>/node_modules /tmp/detach/node_modules
cp <repo>/.env /tmp/detach/.env                     # + artefato prod-like do job de smoke
CI=true GITHUB_ACTIONS=true GITHUB_SHA=$(git rev-parse HEAD) GITHUB_RUN_ID=999 \
  GITHUB_JOB=dev-branch-gate npm run ci:artifacts   # ⇒ veredito=READY
CI=true JEST_MAX_WORKERS=4 GITHUB_ACTIONS=true ... \
  npx jest tests/unit --maxWorkers=4 --bail=0       # ⇒ 1115 suítes / 9726 testes / exit 0
```

Resultado medido nessa árvore (HEAD `23ab5d768`, HEAD destacado, artefato prod-like presente,
`GITHUB_*` definidos): **1115 de 1115 suítes PASS, 9726 testes PASS, 2 skip, exit 0**. É a mesma
condição do job `L0 (Jest oficial) + L1 (gates de governanca)`; a diferença residual (Postgres/Redis/
RAG vivos, `L0b`) é coberta pelos `services:` e passos do workflow.

---

## 6. MISSÃO F — REGRESSÃO COMPLETA

| Suíte / gate | Comando | Resultado |
|---|---|---|
| L0 completo (árvore de desenvolvimento) | `jest tests/unit` (com `.env` + runner, após `ci:artifacts`) | **9726 PASS · 2 SKIP · exit 0** (HEAD `26f6acfdb`) |
| L0 completo (paridade com o CI) | worktree `--detach` + artefato prod-like + `GITHUB_*` + `--bail=0` | **1115/1115 suítes · 9726 PASS · exit 0** (HEAD `23ab5d768`) — §5.8 |
| P1-A traversal | `tests/unit/governance/regularizadorPathTraversal.test.js` | PASS |
| P1-B isolamento | `regularizadorRunIsolation.test.js` | PASS (36) |
| P1-C preflight | `releaseAnchorsPreflightBlocking.test.js` | PASS |
| P1-D prontidão | `engineerSupervisedReadinessGate.test.js` | PASS |
| P1-E classificação | `cleanCheckoutTimeoutRag.test.js` | PASS (33) |
| TOCTOU/filesystem | `regularizadorFilesystemAttacks.test.js` | **PASS (18)** |
| Bypass de publicação | `releaseGovernanceBypassPhase2.test.js` | **PASS (33)** |
| Integridade de evidência | `evidenceTrustLevels.test.js` | **PASS (12)** |
| Bug Closure First | `bugClosureFirst/AttackMatrix/BypassDefense` | PASS (164) |
| Isolamento RAG | `tests/unit/rag*` + `ragDomainRouter` + `ragDomainSegregationEvidence` | PASS (173) |
| L1 desenvolvimento | `validate-release-dag` / `validate-ai-memory` / `validate-agent-adherence` | exit 0 |
| L1 fila oficial | `validate-bug-closure-status` | **exit 1** (`FECHAMENTO_NAO_PROVADO` 130 — estado canônico) |
| L2 | `--scenario l2-system` (checkout descartável) | **PASS** |
| Checkout limpo (`clean`) | `--scenario clean` | PASS na Fase 2 (`9bb607c40`); **não reexecutado no HEAD desta fase** |
| Cenários negativos de infraestrutura | `missing-artifact`, `corrupt-artifact`, `docker-unavailable`, `bootstrap-twice`, `db-unavailable` | PASS (Fase 2, `cad7caaad`) |
| `test:certification` | `jest tests/certification` | PASS (2) |

### 6.1 `modelDrivenE2e` — dependência de artefato do CI, não regressão

`tests/unit/governance/modelDrivenE2e.test.js` depende de
`qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json`, produzido pelo job `prod-like-smoke`
e consumido pelo L0 via `download-artifact`. Em árvore de desenvolvimento o produtor **recusa**
(`EXECUTED: smoke report ausente`) — `EXPECTED_FAIL_CLOSED`. Com o artefato do run presente (árvore de
paridade do §5.8) a suíte passa 6/6. Classificação: `ENVIRONMENT` (dependência declarada no workflow),
não defeito de código — e o próprio teste falha de forma autoexplicativa.

### 6.2 Falhas de ENVIRONMENT encontradas durante a regressão (não são regressão)

4 suítes `engineeringRouter*` reprovaram por **ausência de `.env`** na árvore (removido na limpeza da
Fase 2); com `.env` presente passam (13/13). O harness cria `.env` via `ci:bootstrap`; execução manual
de L0 exige `.env`. Classificação: `ENVIRONMENT`.

---

## 7. PRESERVAÇÃO DA ARQUITETURA RAP

Nenhuma alteração tocou segregação PRODUCTION/SUPPORT/DEVELOPMENT nem domínio de RAG: as mudanças
desta fase estão em `scripts/` (porteiro, gate, harness), `governance/proof-engine/` (classificador de
confiança), `tests/` e no workflow de CI. `validate:visibility-policy`, `validate:experience-segregation`
e as suítes de domínio RAG seguem verdes (§6).

---

## 8. REVISÃO ADVERSARIAL INDEPENDENTE

Ver §11 (resultado e achados).

---

## 9. RISCOS RESIDUAIS

1. **Sem `/proc` a operação recusa** — não há degradação graciosa; é a política exigida, mas reduz a
   portabilidade do regularizador a Linux com `/proc` acessível.
2. **Identidade auto-declarada** — `artifactSha256` continua calculado pelo executor; a autenticidade
   depende de assinatura/âncora que este ambiente não possui (agora **declarado** em `agregar().confianca`).
3. **CI do PR** — resolvido: run `40114341579` verde no SHA exato (§5.3). Resta que a fase R não
   roda no CI, então a cobertura automática é L0+L1 (A–D), nunca certificação.
4. **130 defeitos históricos** — seguem `FECHAMENTO_NAO_PROVADO`; nenhum estado foi alterado.
5. **`modelDrivenE2e`** — depende do artefato do job `prod-like-smoke`; em árvore de desenvolvimento
   falha fechado e autoexplicativo (`ENVIRONMENT`, não regressão).
6. **Passos mascarados em outros workflows** — a regra de errexit foi aplicada aos jobs certificantes
   (`release-governance.yml`, `dev-branch-gate`). `e2e.yml`, `jest.yml`, `wave-reports.yml` e os jobs de
   smoke ainda têm passos multi-comando sem errexit (levantados pelo scanner; nenhum deles decide
   release). Fica como item de fila, não como exceção silenciosa.
7. **Rate limit do HuggingFace** — retry reduz a flakiness, mas não elimina a dependência de rede no
   build da imagem RAG; cache de modelo no runner seria a solução definitiva.

---

## 10. BLOQUEIOS EXTERNOS

| Bloqueio | Efeito |
|---|---|
| ~~Push não autorizado~~ | resolvido nesta rodada: push autorizado e CI verde no SHA exato (§5.3) |
| Âncoras externas (`RAP_CLOSURE_*`) não provisionadas | fase R reprova por desenho; certificação impossível |
| Scorecard governado inexistente em clone limpo | caminho de certificação = `BLOCKED_BY_GOVERNED_EVIDENCE` (por contrato) |
| Fase R fora do CI (`--fases A,B,C,D`) | veredito do gate é `PASS_PARCIAL`; certificação exige run autorizado com âncoras |
| Rate limit de terceiro (HuggingFace) no build da imagem RAG | 2 de 4 runs morreram antes do L0; mitigado com retry, não eliminado |

---

## 11. REVISÃO INDEPENDENTE — resultado

Subagente revisor **distinto** (tipo `code-review`, contexto próprio, ~16 min, 129 chamadas de
ferramenta), sem premissa de correção. **Veredito: `CHANGES_REQUESTED` — 7 achados (2 P1, 3 P2, 2 P3).**

| # | Sev | Achado | Reprodução | Tratamento |
|---|---|---|---|---|
| 1 | **P1** | modo local de teste contornável: `remote.*.receivepack` executa OUTRO comando no push; symlink no caminho autorizado escapa | fim-a-fim: gate imprimia "MODO LOCAL DE TESTE" e a tag aparecia em bare FORA do autorizado | recusa `receivepack/uploadpack` e `core.hooksPath/sshCommand`; `realpath` do caminho autorizado (recusa symlink); push vai para o **caminho validado** (`RAP_PUBLICATION_LOCAL_TARGET`), não para o nome do remote; verificação pós-push no mesmo alvo. Testes A10–A12, A14 |
| 2 | **P1** | `deploy:prod`, `deploy:remote*`, `system:test-images:push` publicavam/implantavam **sem porteiro** | `grep rap_publication_gate scripts/*.sh` = 3 arquivos só | `deploy-prod.sh`, `docker-deploy.sh` e `prewarm-test-images.sh` exigem `SYSTEM_DEPLOY_EXECUTE=1` + `rap_publication_gate`; teste A13 verifica os 6 entrypoints |
| 3 | P2 | `GIT_DIR`/`GIT_CONFIG_*` separavam repositório avaliado × repositório empurrado | revisão confirmou ausência no intervalo revisado | já corrigido em `3a9fbbef9` (`rap_ambiente_git_redirecionado`) — testes A8/A9 |
| 4 | P2 | GO não vinculado ao commit tagueado | sha arbitrário recebia tag com GO de outro conteúdo | `create-release-tag.sh` exige `COMMIT == sourceCommit` do run governado |
| 5 | P2 | commit anterior reescreveu evidência governada (`tenant-isolation` sem lineage, `rag-domain` FAIL) e quebrou o `evidence-manifest` | `sha256sum` divergente dos registros (`9340e595…`/`783fb018…`) | bytes restaurados + guard `governedEvidenceBinding.test.js` (compara `git show HEAD:<path>`) |
| 6 | P3 | guards de certificação eram `toContain` de substring; A1 não isolava o ataque | leitura | `certificationSeparation` passou a EXECUTAR a suíte em fixture sem scorecard (exit ≠ 0 + `BLOCKED_BY_GOVERNED_EVIDENCE`); A1 assere motivo específico |
| 7 | — | (itens corretos confirmados: fail-closed sem `/proc`, separação L2×certificação, gatilho de PR, testes de filesystem/trust) | — | — |

**Nota de escopo do revisor:** o worktree mudou durante a revisão (`95820c0fa` → `3a9fbbef9`); ele
revisou o intervalo pedido e reconfirmou os repros no estado atual.

**Achados DERIVADOS pelo CI (não apontados pelo revisor — o CI os encontrou porque o ambiente do
runner difere da máquina de desenvolvimento):**

| # | Sev | Achado | Onde foi provado | Tratamento |
|---|---|---|---|---|
| D1 | **P0** | passo BLOQUEANTE de preflight devolvia exit 0 com âncora ausente (status = última linha) | CI `40108935675` ⇒ `releaseAnchorsPreflightBlocking:128` | `set -euo pipefail` + `defaults.run.shell` com errexit nos jobs certificantes; regressão `stepExitMasking.test.js` |
| D2 | P1 | asserção dependente de HEAD destacado (`sourceBranch` obrigatoriamente string) | CI `40112925374` ⇒ `runIdentityCommit:60` | regra estrita: igualdade com o git, `null` só com `git symbolic-ref` falhando |
| D3 | P1 | L0 não produzia as próprias entradas (artefatos ignorados pelo git) | árvore sem `reports/*.json` ⇒ `GRAPH_ABSENT` | passo `L0a-artefatos-canoeiros` + ordem travada por contrato |
| D4 | P2 | build da imagem RAG morria por `429` do HuggingFace | CI `40108935675` (1ª tentativa) | retry com backoff e falha fechada |

**Achado DERIVADO (não apontado pelo revisor, encontrado no fechamento):** `jest tests/unit` regera
`reports/tenant-isolation-report.json` e `reports/rag-domain-segregation-report.json` — o `git add -A`
capturou os bytes regerados DUAS vezes, detectadas pelo próprio guard. É a causa-raiz da classe do
item 5 (risco residual §9.3 mantido).


---

## 12. VEREDITO

```
NÍVEL DE DESENVOLVIMENTO .......... DEVELOPMENT_VERIFIED_NO_SHA_R (ver 12.4)
NÍVEL DE CERTIFICAÇÃO ............. NO_GO

RELEASE_CERTIFICATION = NO_GO
MERGE_PR_16           = NOT_AUTHORIZED
MAIN_MODIFIED         = FALSE
PUBLISHED             = FALSE
```

### 12.1 Identidade de SHAs (regra da missão E)

| Papel | SHA | Observação |
|---|---|---|
| `SOURCE_SHA` (base do PR) | `484eee4788e553907e31f7b0528cac9ee41d9298` | inalterado |
| `TESTED_SHA` (local) | `26f6acfdb5d414a8339512b05293c1ea90e5b56f` | L0 completo local: 9726 PASS, exit 0 |
| `TESTED_SHA` (paridade CI) | `23ab5d768fa22a85d2f3804e29f7a3d66f519ec4` | worktree `--detach` + artefato prod-like: 1115/1115 suítes, exit 0 |
| `REVIEWED_SHA` | `6770c3af12da6d69ba3ced36dad440c198211d7e` | intervalo revisado por agente distinto |
| `DELIVERED_SHA` | `23ab5d768fa22a85d2f3804e29f7a3d66f519ec4` (+ commit deste relatório) | **validado por CI no run `40114341579`** |
| `CI_VALIDATED_SHA` | merge de `23ab5d768` em `484eee478` = `56c435e3a6e06e5637e315f66690ba67ad353e92` | job L0+L1 `success`; `A2-sha-esperado` confirma identidade |

O merge commit do PR é o objeto realmente testado pelo runner (é o que o `pull_request` executa), e o
gate ASSERE a identidade (`test "$(git rev-parse HEAD)" = "$GITHUB_SHA"` + `A2-sha-esperado`), então a
validação é do conteúdo do PR e não de um ref vizinho. O commit que adiciona **este relatório** é o
único posterior ao SHA validado; ele não altera código executável (documentação de evidência).

### 12.2 Critérios de aceite

| Critério (mission §1) | Estado |
|---|---|
| Todas as vulnerabilidades reproduzidas corrigidas | **SIM** — A (2 vetores), B (fail-closed), C (trust), achados 1/2/4 da revisão |
| Testes de regressão verdes | **SIM** — 1115/1115 suítes e 9726 testes, exit 0, em árvore de paridade com o CI (`23ab5d768`) |
| Nenhum caminho de publicação contorna a decisão canônica | **SIM** para os 6 entrypoints inventariados e testados |
| Isolamento de filesystem comprovado no modelo de ameaça | **SIM** (18 ataques; sem `/proc` ⇒ recusa) |
| L2 executado e dependência resolvida legitimamente | **SIM** — `L2 = PASS` em checkout limpo, com separação formal |
| HEAD entregue == HEAD validado | **SIM** — run `40114341579` no merge de `23ab5d768` com L0+L1 verdes e identidade de SHA assertada pelo gate |
| Revisão adversarial independente concluída | **SIM** — `CHANGES_REQUESTED` → 6 de 7 tratados, item 3 já corrigido |

### 12.3 Verificações reais das declarações

```
git rev-parse origin/main                      -> 04cad9c1b639cdae357687f7febf47e490834665  (inalterado)
git rev-parse origin/dev/engineering-hardening  -> 484eee4788e553907e31f7b0528cac9ee41d9298  (inalterado)
git tag --points-at HEAD                        -> (vazio)  # nenhuma tag criada
gh run view 40114341579 --json jobs             -> prod-like-smoke/integração/L0+L1 = success
```

`MAIN_MODIFIED = FALSE` e `PUBLISHED = FALSE` conferidos por `git ls-remote`, não presumidos.
O único push feito foi para `codex/p1-governance-hardening-20261023`, autorizado pelo usuário.

### 12.4 Por que `DEVELOPMENT_VERIFIED_NO_SHA_R` e não mais que isso

O que está provado: L0 oficial (1115 suítes / 9726 testes) e L1 (release-dag, fila oficial, ai-memory,
aderência do agente) verdes **no runner do GitHub**, no SHA exato do PR, com os quatro defeitos
encontrados por CI corrigidos e travados por regressão.

O que **não** está provado, e por isso o veredito é restrito:

1. **Fase R (certificação) não roda no CI.** O workflow roda `--fases A,B,C,D` por decisão explícita
   (o comentário do próprio workflow registra que R depende de âncoras externas e de artefato
   governado). Logo `completo=false` e o veredito do gate é `PASS_PARCIAL` — nunca `PASS`.
2. **Gate agregado continua vermelho por contrato**: `validate-bug-closure-status` reprova 130 itens
   sem prova de fechamento e as âncoras de confiança não existem no ambiente do runner. Isso é o
   estado canônico correto, não um defeito a "consertar".
3. **L2/certificação de release** seguem `NO_GO`: selagem exige decisão canônica GO, que exige
   âncoras externas que este ambiente não tem.
4. Nenhum release, tag, merge ou publicação foi executado (`MERGE_PR_16 = NOT_AUTHORIZED`).

Ou seja: **o desenvolvimento está validado de forma independente; a certificação de release não está,
e não estava no escopo autorizado.**
