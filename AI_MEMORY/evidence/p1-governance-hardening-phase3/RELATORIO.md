# RELATÓRIO TÉCNICO — P1 GOVERNANCE HARDENING, FASE 3

**Repositório:** `jeffersonmachado/r-agent2`
**Branch:** `codex/p1-governance-hardening-20261023` (worktree `/tmp/r-agent2-p1-hardening`)
**PR:** #16 → `dev/engineering-hardening` — **NÃO MESCLADO**
**Baseline do PR:** `484eee4788e553907e31f7b0528cac9ee41d9298`
**Base desta fase (fim da Fase 2):** `a3aa22d2869ff6c162968cac64dd33de9403738c`
**HEAD desta fase:** `95820c0fa480fd524518e6a40089c6610b3702c5`
**Diff da fase:**  21 files changed, 1167 insertions(+), 63 deletions(-)
**Node:** v22.12.0 · **npm:** 10.9.0 · **Jest:** 29.7.0 · **Docker:** 27.3.1
**Ambiente:** Linux 6.8.0-146-generic (12 CPUs) · host `jmachado-Precision-5530`
**Relatórios anteriores (NÃO substituídos):** `AI_MEMORY/evidence/p1-governance-hardening-2026-10-23/RELATORIO.md` (Fase 1),
`AI_MEMORY/evidence/p1-governance-hardening-phase2/RELATORIO.md` (Fase 2)

Veredito: **ver §12**. Nada foi mesclado, tagueado, publicado ou implantado.

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

### 5.3 Execução do run: **BLOCKED_ON_PUSH_AUTHORIZATION**

Disparar `workflow_dispatch` exige o ref no remoto; o HEAD desta fase **não foi empurrado** porque a
missão proíbe push sem autorização explícita (§2 e §14 do briefing). Não há run GitHub para o SHA
desta fase — e portanto **não existe, hoje, validação de CI independente do HEAD**.

---

## 6. MISSÃO F — REGRESSÃO COMPLETA

| Suíte / gate | Comando | Resultado |
|---|---|---|
| L0 completo | `jest tests/unit` (com `.env` + runner) | **9712 testes · 9709 PASS · 1 FAIL · 2 SKIP** — ver §6.1 |
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

### 6.1 Única falha L0

`tests/unit/governance/modelDrivenE2e.test.js` — depende de
`qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json`, produzido pelo job `prod-like-smoke`
do CI (documentado no próprio workflow). Em árvore de desenvolvimento o produtor **recusa**
(`EXECUTED: smoke report ausente`) — `EXPECTED_FAIL_CLOSED`. Dentro do harness (`--scenario clean`) o
artefato existe e o L0 fica integralmente verde (medido na Fase 2).

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
3. **CI do PR** — gatilho adicionado, mas nenhum run foi observado para o HEAD desta fase (push não
   autorizado). Sem isso, `TESTED_SHA` é local.
4. **130 defeitos históricos** — seguem `FECHAMENTO_NAO_PROVADO`; nenhum estado foi alterado.
5. **`modelDrivenE2e`** — 1 falha esperada fora do harness.

---

## 10. BLOQUEIOS EXTERNOS

| Bloqueio | Efeito |
|---|---|
| Push não autorizado nesta missão | sem run de CI no SHA desta fase (§5.3); `DELIVERED_SHA` ≠ verificado pelo GitHub |
| Âncoras externas (`RAP_CLOSURE_*`) não provisionadas | fase R reprova por desenho; certificação impossível |
| Scorecard governado inexistente em clone limpo | caminho de certificação = `BLOCKED_BY_GOVERNED_EVIDENCE` (por contrato) |

---

## 11. REVISÃO INDEPENDENTE — resultado

_(preenchido no fechamento; ver §12 para o veredito final)_

---

## 12. VEREDITO

_(preenchido no fechamento)_
