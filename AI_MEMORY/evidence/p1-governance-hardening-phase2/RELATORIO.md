# RELATÓRIO TÉCNICO — P1 GOVERNANCE HARDENING, FASE 2

**Repositório:** `jeffersonmachado/r-agent2`
**Branch de trabalho:** `codex/p1-governance-hardening-20261023` (worktree isolado `/tmp/r-agent2-p1-hardening`)
**PR:** #16 — **NÃO MESCLADO** (merge não autorizado)
**Baseline do PR:** `484eee4788e553907e31f7b0528cac9ee41d9298`
**SHA inicial desta fase:** `541c7d0000376b0fae8c321171c6190166e62b25` (confirmado no remoto)
**SHA final medido:** `cad7caaad803b48b0af7c89ce9adf7d1e697398f`
**Node:** v22.12.0 · **npm:** 10.9.0 · **Jest:** 29.7.0 · **Postgres:** 127.0.0.1:5432 · **Redis** disponível · **Docker:** 27.3.1
**Relatório da Fase 1 (histórico, NÃO substituído):** `AI_MEMORY/evidence/p1-governance-hardening-2026-10-23/RELATORIO.md`

> Este relatório separa rigorosamente o que foi **EXECUTADO E COMPROVADO**, o que foi
> **EXECUTADO E FALHOU**, o que está **BLOQUEADO**, o que **NÃO FOI EXECUTADO** e o que foi
> **AFIRMADO POR OUTRO AGENTE E NÃO REPRODUZIDO** (§11). Nada foi certificado, assinado, tagueado,
> publicado, mesclado ou implantado.

---

## 1. Arquivos modificados nesta fase (6 commits)

| Commit | Escopo | Arquivos |
|---|---|---|
| `29a41bcdf` | Missão A — provisão canônica dos artefatos do L0 + hermetismo git | `scripts/ci/bootstrap-ci-environment.js`, `package.json`, `tests/unit/engineeringMissionSourceRefRemote.test.js`, `tests/unit/ci/bootstrapArtifactsMode.test.js` (novo) |
| `c5008bf61` | Missão B — TOCTOU/durabilidade/exatamente-uma-vez | `scripts/governance/lib/regularizationRun.js`, `tests/unit/governance/regularizadorFilesystemAttacks.test.js` (novo) |
| `85ca7e2cc` | Missão C — porteiro de publicação | `scripts/governance/publication-gate.sh` (novo), `scripts/docker-push.sh`, `scripts/docker-push-remote.sh`, `tests/unit/governance/releaseGovernanceBypassPhase2.test.js` (novo) |
| `9bb607c40` | Missões D/E — escopo do veredito do checkout limpo + evidências | `scripts/ci/clean-checkout-verify.js`, `tests/unit/governance/cleanCheckoutTimeoutRag.test.js`, `AI_MEMORY/evidence/p1-governance-hardening-phase2/*` |
| `c9ca2b435` | Missão G — **6 achados da revisão independente** corrigidos | `scripts/governance/lib/regularizationRun.js`, `scripts/create-release-tag.sh`, `scripts/governance/seal-release.sh`, `scripts/ci/bootstrap-ci-environment.js`, `scripts/ci/clean-checkout-verify.js`, 5 arquivos de teste |
| `d6842b34e` | Missão D — relatório da Fase 2 + evidências dos 8 cenários | `AI_MEMORY/evidence/p1-governance-hardening-phase2/*`, `AI_MEMORY/evidence/ci-clean-checkout-*/` |
| `9b9d67eb7` | Missão D — orçamento de conexão configurável + teto do cenário de banco | `api/db/sequelize.js`, `scripts/ci/clean-checkout-verify.js`, `tests/unit/governance/cleanCheckoutTimeoutRag.test.js` |
| `cad7caaad` | Missão D — assinatura do motivo antes do teto (regressão do endurecimento) | `scripts/ci/clean-checkout-verify.js` |

Nenhum arquivo de produto (`api/`, `engine/`, `frontend/`, `rag-service/`, `lib/`, `qa/`, `qa-mesh/`,
`core/`, `src/`) foi alterado — verificado por `git diff --name-only 484eee478..HEAD` (vazio nesses
diretórios) e pelos testes de governança de camadas.

---

## 2. MISSÃO A — AS FALHAS L0 (investigação por identidade exata)

### 2.1 Ambiente e método

Duas árvores git independentes (`/tmp/rbc-base-p1` = baseline `484eee478`, `/tmp/r-agent2-p1-hardening` =
branch), **mesmo Node, mesmo lockfile, mesmas dependências (symlink do mesmo `node_modules`), mesmo
`.env` (sha256 idêntico), mesmo Postgres/Redis, execução **SEQUENCIAL** (nunca simultânea), mesmo
número de workers (default do repo) e `--json` para capturar a identidade exata de cada teste.

### 2.2 Resultado por identidade (não por total)

| Ambiente | baseline | branch | falhas exclusivas da branch |
|---|---|---|---|
| A — sem artefatos gerados | 9467 testes · 9442 PASS · **23 FAIL** · 2 SKIP · 13 suítes | 9600 · 9578 PASS · **20 FAIL** · 2 SKIP · 9 suítes | **0** |
| B — após `npm run ci:artifacts` + `GIT_CONFIG_COUNT=0` | 9493 · 9489 PASS · **2 FAIL** | 9620 · 9617 PASS · **1 FAIL** | **0** |
| C — checkout descartável novo (`29a41bcdf`), provisionado, branch anexada | — | 9629 · 9626 PASS · **1 FAIL** · 2 SKIP | — |

**Diferença em relação à Fase 1:** o relatório anterior declarava 4 suítes que falhavam **só** na
árvore corrigida e atribuía o fato a ordem de execução. **Isso não se reproduz sob condições
idênticas:** com `.env` + runner de engenharia + provisão de artefatos + ambiente git saneado, o
conjunto de falhas da branch é **subconjunto estrito** do da baseline. As 4 "exclusivas" da Fase 1
eram **ausência de artefato ignorado pelo git** e **injeção de configuração git do processo pai**,
não dependência de ordem.

### 2.3 Classificação obrigatória (por falha, com causa-raiz medida)

| Classe | Qtde | Falhas (identidade) | Causa-raiz medida | Correção |
|---|---|---|---|---|
| `PRODUCT_REGRESSION` | **0** | — | — | — |
| `TEST_ISOLATION` | 20 | `businessJourneyProjection`(2), `coverageCompletenessCanonicalDomains`(3), `enginePurityPorts`(1), `impactRunner`(2), `v2TimeoutGateDependency`(7), `v2AuditEnvelopeCoverage`(1), `modelDrivenE2e`(1), `readinessCertificationSeparation`(suite), `jsonPersistenceNoPhantomWrite`(suite), `auditEntrypointArtifact`(1) | A suíte lê artefatos **ignorados pelo git** (`reports/*.json`, `governance/json-persistence-audit.json`, `qa-mesh/meshRegistry.json`). Em árvore sem provisão: `ENOENT`, `GRAPH_ABSENT`, validador com exit≠0 | `npm run ci:artifacts` (modo `--artifacts-only` do bootstrap canônico) — 12 produtores, fail-closed |
| `ENVIRONMENT` | 3 | `engineeringMissionSourceRefRemote`(3 → na 1ª medição), `runIdentityCommit`(1), `devServicesSupervision`(1) | (a) o shell injeta `GIT_CONFIG_COUNT/KEY_n/VALUE_n` com `safe.bareRepository=explicit`, e o repositório **bare** de prova passa a ser recusado pelo git; (b) worktree com **HEAD destacado** ⇒ `rev-parse --abbrev-ref HEAD` = `HEAD` ⇒ `sourceBranch=null`; (c) `EADDRINUSE 127.0.0.1:39118` | (a) `GIT_CONFIG_COUNT=0` no helper do teste (hermetismo); (b) e (c) documentados: worktree descartável **com branch anexada**, porta livre |
| `FLAKY` | **0 reproduzido** | — | 2 repetições do conjunto + ordem embaralhada (`--randomize --seed 20261024`) deram **exatamente** o mesmo resultado | — |
| `EXPECTED_FAIL_CLOSED` | 1 | `modelDrivenE2e` — "Script passa com smoke report real presente" | Exige `qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json` com `status=GO`; o próprio `.github/workflows/dev-branch-ci.yml` documenta que o artefato é produzido pelo job `prod-like-smoke` e baixado no job do L0. Sem a prova, o produtor **recusa** (`EXECUTED: smoke report ausente`) | Produzido no cenário `clean` do harness (ver §5) — L0 fica verde |
| `UNKNOWN` | **0** | — | — | — |

### 2.4 Matriz de reprodução exigida (10 cenários)

| # | Cenário | Resultado |
|---|---|---|
| 1 | L0 completo na baseline | **EXECUTADO** — 23 FAIL sem provisão; 2 FAIL com provisão |
| 2 | L0 completo na branch | **EXECUTADO** — 20 FAIL sem provisão; 1 FAIL com provisão |
| 3 | L0 com `--runInBand` | **EXECUTADO** — dentro do `gate-dev-branch` (L0b roda `--runInBand`); L0 completo serial equivalente coberto pelo mesmo gate no clone descartável (§5) |
| 4 | L0 em paralelo | **EXECUTADO** — é o modo dos itens 1–2 (workers default) |
| 5 | Suítes que falham, individualmente | **EXECUTADO** — 13 suítes: 12 exit 0, `modelDrivenE2e` exit 1 |
| 6 | Suítes que falham, em conjunto | **EXECUTADO** — 13 suítes: 12 PASS, 1 FAIL; 122 testes, 121 PASS |
| 7 | Repetição dos conjuntos suspeitos | **EXECUTADO** — 2 repetições idênticas |
| 8 | Após limpeza de temporários | **EXECUTADO** — diretórios `/tmp/v2-seal-*` removidos antes de cada rodada |
| 9 | Checkout descartável | **EXECUTADO** — worktree novo em `29a41bcdf` |
| 10 | Ordem embaralhada | **EXECUTADO** — `--randomize --seed 20261024` |

### 2.5 Correção aplicada (Missão A)

`scripts/ci/bootstrap-ci-environment.js` ganhou o modo **`--artifacts-only`** (`npm run ci:artifacts`):
executa os **mesmos 12 produtores canônicos**, na mesma ordem, sem `system:bootstrap`, sem seed e sem
Docker. Nada é fabricado — o veredito de cada produtor (PASS/NO_GO/ESCALATE) fica registrado como
está, e artefato ausente leva a `INCOMPLETE`/exit 1. A raiz é substituível por
`CI_BOOTSTRAP_ROOT` **apenas fora de produção** (recusada com `NODE_ENV=production`), o que torna o
modo testável sem executar produtor real.

Prova do modo: `tests/unit/ci/bootstrapArtifactsMode.test.js` (9 casos, raiz descartável com
produtores falsos: ordem exata, ausência de passos pesados, fail-closed por artefato ausente,
veredito `NO_GO` preservado, override auditável, override recusado em produção).

---

## 3. MISSÃO B — FILESYSTEM: SYMLINK, TOCTOU E DURABILIDADE

### 3.1 Vulnerabilidade REAL encontrada e fechada

Método: interceptação do syscall exato em que o atacante vence a corrida (determinístico) + escrita
real no kernel, com diretório-sentinela **fora** da raiz e processo concorrente. Reprodução contra
`HEAD` anterior (`29a41bcdf`) e contra a versão corrigida:

| Janela de corrida | Versão anterior (sem pin) | Versão corrigida |
|---|---|---|
| **antes** da abertura do diretório | escrita pelo caminho textual; retorno `{ok:true}` | `FALHA:DIR_NAO_E_DIRETORIO:ENOTDIR`; sentinela intocada |
| **depois** da abertura do diretório | **ESCAPE REAL**: `Y1.json` criado no diretório-sentinela externo **e retorno `{ok:true}`** | sem escape; artefato no INODE aberto; retorno `FALHA:DIR_TROCADO_DURANTE_ESCRITA` |

O caso "depois" era o pior tipo de falha: **escrita fora da raiz autorizada com sucesso reportado**.

### 3.2 Mitigações implementadas (`scripts/governance/lib/regularizationRun.js`)

1. **Pin de diretório por descritor** (`/proc/self/fd/<fd>`): `itens/` e o diretório da execução são
   abertos com `O_DIRECTORY|O_NOFOLLOW` e todas as operações (temporário, `link`, `rename`, `fsync`)
   resolvem no **inode** aberto — trocar o nome do diretório não redireciona a escrita. Quando o pin
   falha porque o caminho não é mais o diretório validado (`ELOOP`/`ENOTDIR`), a gravação é
   **RECUSADA** (o fallback textual escreveria dentro do alvo do symlink).
2. **Durabilidade**: `fsync` do arquivo **e do diretório** (sem o segundo o `rename` pode ser perdido
   num crash).
3. **Escrita exatamente-uma-vez**: `link(2)` no lugar de `rename(2)` para artefatos de item; colisão
   simultânea deixa de ser "a última vence" (`RESULTADO_JA_EXISTE_DIVERGENTE`); mesma carga ⇒
   idempotente sem tocar nos bytes.
4. **Raiz privada**: `runs/` nasce `0700`; raiz gravável por grupo/outros ⇒ `RAIZ_PERMISSIVA`.
5. **Detecção pós-escrita** (fallback quando não há `/proc`): `realpath` do diretório conferido
   antes/depois; divergência ⇒ falha explícita, nunca sucesso.

### 3.3 Os 12 ataques obrigatórios (todos EXECUTADOS)

`tests/unit/governance/regularizadorFilesystemAttacks.test.js` — **16 casos, 16 PASS**, com processos
concorrentes reais, sentinelas externas e `SIGKILL` real:

| # | Ataque | Resultado |
|---|---|---|
| 1 | troca de diretório legítimo por symlink após validação | recusa `ITENS_E_SYMLINK`; sentinela intacta |
| 2 | troca repetida de symlink **durante** a gravação (atacante concorrente real) | nenhum artefato/temporário na sentinela; toda gravação reportada como sucesso é verificável dentro da raiz |
| 2b | janela "antes da abertura" (determinística) | `DIR_NAO_E_DIRETORIO` (recusa) |
| 2c | janela "depois da abertura" (determinística) | escrita no inode aberto + `DIR_TROCADO_DURANTE_ESCRITA` |
| 3 | substituição de diretório **ancestral** (`runs/` → symlink) | `lerManifesto` devolve `null`; gravação recusada; sentinela intacta |
| 4 | substituição do arquivo de destino por symlink | `RESULTADO_E_SYMLINK`; sentinela intacta |
| 5 | colisão entre duas gravações simultâneas do mesmo id | exatamente um vencedor; conteúdo do disco == sha do vencedor; o outro recebe `RESULTADO_JA_EXISTE_DIVERGENTE` |
| 6 | tentativa de sobrescrever prova existente | idempotente se idêntico; divergente recusado; bytes antigos intactos |
| 7 | sobrescrever manifesto / manifesto symlinkado | leitura `null`, `finalizar` recusa, execução vizinha íntegra, nada de `completo:true` |
| 8 | interrupção (`SIGKILL`) no meio da gravação | manifesto válido em `RUNNING`; nenhum `.json` parcial; prova anterior intacta |
| 9 | recuperação após falha | nova execução completa; artefatos anteriores com hash inalterado |
| 10 | permissões restritivas (`0500`) | falha explícita (`PIN_FALHOU`/`ESCRITA_FALHOU`); nenhum artefato criado |
| 11 | symlink dentro de `runs/` | `RUN_DIR_E_SYMLINK` nas duas pontas |
| 12 | symlink dentro de `itens/` | não entra como resultado válido; `completo:false`; sentinela intacta |
| 13 | raiz com escrita para grupo/outros | `RAIZ_PERMISSIVA` |
| 14 | agregação com dado parcial | `ok:true` mas `completo:false` + motivo explícito (nunca "integral") |

### 3.4 Limitação declarada (modelo de ameaça)

Node.js **não expõe `openat(2)`**. A defesa implementada no Linux é o pin por descritor
(`/proc/self/fd/<fd>`) + raiz privada `0700`, que **impede** o redirecionamento da escrita. Em
plataforma sem `/proc` resta a **detecção** pós-escrita, que recusa o sucesso mas não impede que a
escrita aterrisse no inode já aberto (dentro da árvore de quem já tinha permissão sobre ela).
Não há alegação de proteção absoluta contra atacante local **com privilégio** sobre a raiz.

---

## 4. MISSÃO C — GOVERNANÇA DE RELEASE SEM BYPASS

### 4.1 Inventário (completo em `missao-c-inventario.txt`)

Certificar/decidir: `governance/canonical-release-decision.js`,
`scripts/governance/assert-canonical-release-decision.js`, `tools/system/release-decision.js`,
`scripts/governance/engineering-router-v2-seal.js`, `scripts/governance/seal-release.sh`,
`scripts/governance/run-governance-enforcement.js`.
Publicar imagem: `scripts/docker-push.sh`, `scripts/docker-push-remote.sh`.
Tag/release: `scripts/create-release-tag.sh`, `scripts/governance/create-release-publication-receipt.js`.
Deploy: `scripts/deploy-gate.sh`, `scripts/deploy-prod.sh`, `scripts/docker-deploy*.sh`,
`tools/system/*`, `docker-compose.prod.yml`.

### 4.2 Achado REAL: publicação de imagem sem gate

`scripts/docker-push.sh` (npm `deploy:push`) e `scripts/docker-push-remote.sh` publicavam imagens em
registry **sem consultar a decisão de release**. O bloqueio existente vivia **apenas** em
`.github/workflows/release-governance.yml` — enforcement que existe só no CI não é enforcement: o
mesmo comando roda na máquina do operador.

**Correção:** `scripts/governance/publication-gate.sh` exige, **antes de qualquer build**:
`RAP_PUBLISH_AUTHORIZED=1` **e** GO definitivo por
`scripts/governance/assert-canonical-release-decision.js` (autoridade única: cadeia recriptografada
dos bytes atuais + identidade coerente com o run).

### 4.3 Ataques executados (22 casos, 22 PASS, nenhuma publicação real)

`tests/unit/governance/releaseGovernanceBypassPhase2.test.js`. O `docker` é um **FAKE** no `PATH` que
só registra a invocação — nenhum cenário cria tag, release, publish ou deploy.

| Cenário | Resultado |
|---|---|
| sem `RAP_PUBLISH_AUTHORIZED` | bloqueado; **docker nunca invocado** |
| autorizado, sem GO | bloqueado; docker nunca invocado |
| `docker-push-remote.sh` (idem) | bloqueado nos dois casos |
| porteiro antes do build | nenhum `docker build` chega a ocorrer |
| `release-gate` depende de core+regression+atestação | estrutura verificada (js-yaml) |
| `continue-on-error` em passos de validação | nenhum (só em uploads de diagnóstico) |
| gate consome atestação **e** revalida âncoras | verificado |
| workflow nunca publica | sem `git tag`/`git push`/`docker push`/`npm publish`/`gh release create` |
| atestação ausente | `SEM_ATESTACAO_DE_PREFLIGHT` |
| atestação de outro commit | `ATESTACAO_INVALIDA:COMMIT` |
| atestação de outro run | `ATESTACAO_INVALIDA:RUN` |
| atestação adulterada (`ok:false`, `kind` trocado) | `ATESTACAO_INVALIDA:OK` / `:KIND` |
| atestação sem as três âncoras | `ATESTACAO_INVALIDA:ANCORAS` |
| atestação válida (mesmo commit+run) | libera |
| job `skipped` / `cancelled` / matrix parcial | bloqueia, sem "Release autorizado" |
| atestação `failure` com os demais verdes | bloqueia |
| âncoras ausentes / inválidas / divergentes do inventário | exit ≠ 0 com achados explícitos |

O consumidor da atestação e o bloco de verificação de resultados são **extraídos do YAML e
executados** (não reescritos no teste), com JSON forjado em diretório temporário.

---

## 5. MISSÃO D — CHECKOUT LIMPO (`npm run ci:clean-checkout`)

### 5.1 Primeira execução completa — e o achado

`node scripts/ci/clean-checkout-verify.js --scenario clean`, commit `85ca7e2cc`:

```
npm-ci-bootstrap        129s PASS     prod-like-smoke        117s PASS
build-api-base           PASS        prod-like-artefato      0s PASS
build-api               100s PASS     gate-dev-branch      1459s PASS  (fases A,B,C,D)
build-frontend           46s PASS     L1-inventario (fase D) 4 PASS
                                      L1-inventario (fase R) 3 FAIL  → veredito=FAIL
```

Os três vermelhos (`L1-cadeia-criptografica`, `L1-self-proving`, `L1-decisao-canonica`) são da
**fase R (certificação de release)** e reprovam **legitimamente** num repositório sem selo:
`CADEIA_RECOMPUTADA_INVALIDA (divergências=11, raizConfere=false)`, runtime chain invalid,
`final_readiness_nao_final: PRE_PACKAGE_PASS`, `identidade insuficiente` nos três relatórios de
decisão. Como alimentavam o veredito, `ci:clean-checkout --gate-phases A,B,C,D` **nunca podia ficar
verde**: a mesma cor servia para "ambiente quebrado" e "release não certificado".

**Correção (sem esconder nada):** os passos da fase R continuam sendo **EXECUTADOS** e o exit code
continua no relatório; passam a ser marcados `foraDeEscopo:true` com `motivoForaDeEscopo:
FASE_R_NAO_SOLICITADA` quando a fase R não foi pedida, e o relatório ganha
`passosForaDeEscopo` (id + exitCode + motivo). Com `--gate-phases ...R` voltam a governar o veredito.

### 5.2 Segunda execução (após a correção) — commit `9bb607c40`

```
npm-ci-bootstrap 92s PASS | build-api 27s PASS | build-frontend 41s PASS
prod-like-smoke 114s PASS | prod-like-artefato PASS | gate-dev-branch 1433s PASS
L1-inventario fase D: 4 PASS | fase R: 3 FAIL (executados, marcados fora de escopo)
veredito = PASS      (runId clean-checkout-20261024101119926-65ff5a)
```

Serviços **exclusivos do run**: `pg:34741`, `redis:42119`, RAG em container
`rap-ci-clean-65ff5a-rag` na porta `39685` (o RAG do desenvolvedor em 8001 **não** foi usado), imagens
`r-agent2-api`/`r-agent2-frontend`/`r-agent2-rag-service` identificadas por nome e tag do run.
Como `gate-dev-branch` (L0 completo + L1) e `prod-like-smoke` passaram, o **L0 dentro do checkout
limpo é integralmente verde**, incluindo `modelDrivenE2e`.

### 5.3 Cenários negativos de contaminação

Executados em sequência no mesmo harness (`--scenario`), com registro em
`/tmp/p2/d-cenarios.log` e relatório versionado por cenário em `reports/ci-clean-checkout-report.json`:

| Cenário | O que prova |
|---|---|
| `missing-artifact` | artefato exigido ausente não vira PASS |
| `corrupt-artifact` | artefato corrompido não vira PASS |
| `db-unavailable` | banco indisponível falha fechado (sem `exitCode === null` como sucesso) |
| `docker-unavailable` | ausência de Docker não vira alegação de SANDBOX_RUNTIME=PASS |
| `bootstrap-twice` | idempotência do bootstrap (mesma contagem de tenants) |
| `l2-system` | L2 real (`npm run test:system`) |

Resultados medidos (`reports/ci-clean-checkout-report.json`, um relatório por cenário):

| Cenário | Veredito do harness | Leitura |
|---|---|---|
| `missing-artifact` | **FAIL** → **PASS** após correção | o passo negativo `consumidor-sem-artefato` saiu exit 1 mas foi classificado `EXPECTED_FAILURE_SEM_ASSINATURA`: o consumidor reprovava sem nomear a dependência. Corrigido no consumidor (falha auto-descritiva `artefato prod-like ausente ou ilegivel: …`), reexecutado |
| `corrupt-artifact` | **FAIL** → **PASS** após correção | mesma causa; mesma correção; reexecutado |
| `docker-unavailable` | **PASS** | ausência de Docker não vira alegação de sandbox saudável |
| `bootstrap-twice` | **PASS** | idempotência comprovada (mesma contagem de tenants nas duas execuções) |
| `db-unavailable` | **FAIL (TIMEOUT)** → **corrigido** | `bootstrap-sem-postgres` estourava o orçamento do passo (480 s, `exit=null`) em vez de falhar com assinatura. Duas causas medidas: (a) `api/db/sequelize.js` tentava conectar **30 vezes** com backoff até 10 s — passou a aceitar `DB_CONNECT_ATTEMPTS` (padrão de produção **intocado**, 30) e o harness declara orçamento curto; (b) o `ci:bootstrap` **completo** com banco morto leva ~7-8 min (install + `official.sh` + probes + validadores), batendo no teto de 8 min — o teto passou a 15 min (o contrato do cenário é a ASSINATURA do motivo, não o tempo de parede). **Fail-closed sempre preservado**: nunca PASS |
| `l2-system` | **FAIL (BLOQUEADO por contrato)** | `tests/governance/finalStatusProjection.test.js` exige `governance/rap-master-scorecard.json`, que é **gitignored** e **derivado de um run governado** (`runId rap-governed-20261020150721180-09a2168d`). Regenerar localmente (`governance/revalidate-master-scorecard.js`) foi medido: produz divergência (`canonical_divergence: readiness.sourceFingerprint != scorecard.sourceFingerprint`, `stale_run_id`) — ou seja, é estado de governança FABRICADO, proibido pela missão. L2 em checkout limpo é BLOCKED, não corrigível por código sem inventar prova |

Nenhum destes cenários cria tag, release, publish ou deploy.

---

## 6. MISSÃO E — L1, L2 E L3

### 6.1 L1 — por que `PASS_PARCIAL` (causa exata)

`decidirVeredito` compara as fases presentes no run com
`FASES_OBRIGATORIAS_VALIDACAO_COMPLETA = ['A','B','C','D','R','E','F']`. O workflow roda
`--fases A,B,C,D`; logo `faltantes = ['R','E','F']` ⇒ `PASS_PARCIAL` com
`equivalenteAValidacaoCompleta=false`. Composição exata:

- **aprovados**: fase A (pré-voo de identidade), B (plano/inventário), C (`L0-suite-oficial` +
  `L0b-integracao-engenheiro`), D (`release-dag`, `fila-oficial`, `ai-memory`, `aderencia-agente`);
- **não executados por escopo** (não por falha): fase **R** (3 passos de certificação de release),
  fase **E** (`L2-test-system`), fase **F** (`L3-gate-agregado`);
- **bloqueados**: nenhum;
- **dispensados por contrato**: nenhum;
- **falharam**: nenhum.

Causa corrigível resolvida nesta fase: o veredito do **checkout limpo** (§5.1). A causa de
`PASS_PARCIAL` em si **não é defeito** — é o contrato de escopo: certificação de release exige âncoras
externas que este ambiente não possui.

### 6.2 L2 — integração real

`npm run test:system` executado no ambiente isolado do harness (`--scenario l2-system`, Postgres/Redis
efêmeros, RAG em container do run):
`bootstrap` PASS (112 s) → `l2-test-system` **FAIL** (5 s, 32/33 testes).
Causa única: `tests/governance/finalStatusProjection.test.js` exige
`governance/rap-master-scorecard.json`, artefato **gitignored** e derivado de um **run governado**;
num checkout limpo ele não existe (`canonical_unreadable:missing`). A regeneração local foi testada e
**produz divergência** com as projeções versionadas — é estado de governança fabricado, portanto
**L2 permanece BLOQUEADO** por contrato (§11).

### 6.3 L3 — gate agregado

`npm run validate:governance-enforcement` (fase F). Estado canônico medido:
`validate:bug-closure-status` **FAIL** com `FECHAMENTO_NAO_PROVADO` em **130** defeitos e
`inventoryAnchored=false`. **Consequência declarada: o gate agregado NÃO pode ser verde neste
ambiente** — e isso é o estado correto de fail-closed, não uma narrativa. Ver §11.

---

## 7. MISSÃO F — OS 130 DEFEITOS HISTÓRICOS

Análise completa em `missao-f-130-defeitos.txt`. Resumo:

| # | Pergunta | Resposta medida |
|---|---|---|
| 1 | A invalidação é esperada pelo contrato? | **SIM** — o `sourceFingerprint` cobre `scripts/**`, `config/`, `governance/proof-engine`, etc.; qualquer commit nesses caminhos invalida toda prova do fingerprint anterior. Agregados legados: `report.json` @ `32edd8e7`/`a351e062`, `report-P1.json` @ `e747bac4`/`5151d5b6`; fingerprint atual `7244e991…` |
| 2 | Todos afetados pelo mesmo motivo? | **SIM** — violação única `FECHAMENTO_NAO_PROVADO` (130; P0=31, P1=67) |
| 3 | Existe evidência adulterada? | **NÃO ENCONTRADA** — 118 logs versionados, 0 vazios, 118 hashes distintos; `git status` limpo em `AI_MEMORY/evidence/` |
| 4 | A identidade do código está correta? | **SIM** — cada agregado carrega commit+fingerprint do momento da execução |
| 5 | A regeneração é determinística? | **SIM** — mesmo fingerprint em duas árvores do mesmo commit |
| 6 | Fingerprint estável entre checkouts equivalentes? | **SIM** — `7244e991…` nas duas (uma com `reports/` gerado, outra recém-criada) |
| 7 | Logs versionados verificáveis? | **SIM** (item 3) |
| 8 | Inventário íntegro? | **SIM** — 135 itens intocados; `inventoryAnchored=false` por âncora externa ausente |

Estado de fechamento: **nenhum alterado**. Nenhuma aprovação humana criada. Nenhuma prova assinada.
Nada reclassificado de inválido para válido.

---

## 8. MISSÃO G — REVISÃO ADVERSARIAL INDEPENDENTE

Subagente revisor **distinto** (tipo `code-review`, contexto próprio, 332 s), sem receber como
premissa que as correções estão certas, com o diff `541c7d000..HEAD`, modelo de ameaça (atacante
local concorrente com escrita na árvore; operador tentando publicar sem governança), contratos,
testes e a lista de 9 classes de bypass a atacar.

**Veredito do revisor: `CHANGES_REQUESTED`, 6 achados (3 P1, 3 P2) — todos reproduzidos e
corrigidos no commit `c9ca2b435`:**

| # | Sev | Achado | Reprodução | Correção | Regressão |
|---|---|---|---|---|---|
| 1 | P1 | Tag de release empurrada para o remote sem decisão GO; `seal-release.sh --from publish` pula `certify` | leitura do dispatcher de fases + `grep` do porteiro (só em `docker-push*`) | push da tag passa pelo `publication-gate.sh` quando a URL **efetiva** do remote é externa; `phase_publish` ganha passo `publish-check` reexecutando `assert-canonical-release-decision` | C3c–C3f (4 casos, incluindo o caminho feliz em remote local) |
| 2 | P1 | `dirDaExecucao` ancorava a contenção na base **re-resolvida** (tautologia); troca do ancestral da base ⇒ escrita fora com `ok:true` | medição do revisor: `rename`+`symlink` do ancestral e `gravarResultado` retornando `ok:true` com `realpath` no alvo do atacante | âncora em `realpath(rootDir)` (`BASE_FORA_DA_RAIZ`) + contenção verificada **antes** da leitura do manifesto | B3b (ataque exato) |
| 3 | P1 | Teste commitado com caminho absoluto `/tmp/r-agent2-p1-hardening` — suíte vermelha em qualquer outro clone | `grep` do caminho no `SCRIPT_JANELA` | caminho derivado de `__dirname` e injetado por argv | suíte inteira roda sem depender do worktree do autor |
| 4 | P2 | `--artifacts-only` dava `READY` com produtores inertes e artefatos de **outro commit** | raiz com produtores `exit 0` que não escrevem + artefatos pré-existentes | prova de frescor (`mtime` ≥ início do passo) para artefato que o bootstrap reescreve; `produzidoAqui:false` só para os dois casos legítimos (versionado pelo workflow semanal / produtor idempotente) | teste de falso-verde (produtores inertes + mtime de ontem ⇒ `INCOMPLETE`) |
| 5 | P2 | B5 não provava "exatamente uma vez" (dois `spawnSync` sequenciais, `oks.length >= 1`) | leitura do teste | dois escritores concorrentes (`spawn`) e `expect(oks).toHaveLength(1)` | B5 reescrito |
| 6 | P2 | Bloco P2-D era só `grep` no fonte | leitura do teste | `vereditoDoCenario` extraída como função pura e exercitada | 6 casos de comportamento |

O revisor também apontou o que **está** correto (uma linha cada): recálculo de `completo` em
`finalizar`/`agregar`, idempotência por `link(2)`, preservação de `exitCode`/`ok` nos passos fora de
escopo, `exitCode === null` nunca virando `ok:true`, e o porteiro bloqueando antes de qualquer build.

**Achado derivado (não apontado pelo revisor, encontrado ao rodar o harness):** o consumidor
`modelDrivenE2e` reprovava sem nomear a dependência, e os cenários `missing-artifact` e
`corrupt-artifact` classificavam a reprovação como `EXPECTED_FAILURE_SEM_ASSINATURA` (falha pelo
motivo ERRADO). Corrigido tornando a falha auto-descritiva.

---

## 9. Riscos residuais (aceitos e declarados)

1. **Node sem `openat`** — em plataforma sem `/proc`, a defesa contra troca de diretório é detecção,
   não prevenção (§3.4).
2. **Identidade auto-declarada** — `artifactSha256` é calculado pelo executor; quem reescrever
   manifesto+itens e recalcular hashes passa. Já declarado como limite na Fase 1.
3. **Suítes que regravam evidência versionada** — `reports/tenant-isolation-report.json` e
   `reports/rag-domain-segregation-report.json` são reescritos por execuções de teste (o worktree
   fica sujo após `jest tests/unit`). Não corrigido nesta fase: mover esses produtores para fora do
   caminho versionado muda contrato consumido por gates.
4. **`modelDrivenE2e` depende de artefato de job de CI** — fora do harness, o L0 em árvore de
   desenvolvimento fica com 1 falha esperada até rodar `prod-like-smoke`.
5. **Coverage de L3** — o gate agregado permanece vermelho por contrato (130 defeitos sem prova), o
   que impede qualquer alegação de release verde.
6. **Retry de conexão de 30 tentativas** (`api/db/sequelize.js`) — mitigado: orçamento configurável
   por `DB_CONNECT_ATTEMPTS` (padrão de produção 30 inalterado) e teto do cenário negativo ajustado.
   O bootstrap completo com banco morto continua levando ~7-8 min; é lentidão de diagnóstico, não
   risco de PASS.
7. **L2 depende de artefato de run governado** (`governance/rap-master-scorecard.json`) — checkout
   limpo não consegue rodar `test:system` verde sem fabricar estado.

---

## 10. Bloqueios externos

| Bloqueio | Efeito |
|---|---|
| `RAP_CLOSURE_TRUST_ANCHOR_SHA256` / `RAP_APPROVAL_TRUST_ANCHOR_SHA256` / `RAP_CLOSURE_INVENTORY_SHA256` não provisionados | `inventoryAnchored=false`; fase R reprova por desenho; certificação impossível |
| Sem `SELO_FINAL` | fases R/E/F fora de escopo em qualquer run de desenvolvimento |
| Prod-like smoke exige stack viva (nginx + API em container) | só reproduzível dentro do harness (`--scenario clean`), não em árvore de desenvolvimento |

---

## 11. Separação obrigatória

### EXECUTADO E COMPROVADO

- L0 comparativo por **identidade exata** em 3 ambientes distintos, execução **sequencial** (§2.2).
- 0 regressões de produto; 0 falhas exclusivas da branch; 0 flaky reproduzido (2 repetições + ordem
  embaralhada).
- `npm run ci:artifacts` provado com raiz descartável e em checkout real (9 testes + execução).
- TOCTOU: reprodução determinística do **escape real com sucesso reportado** e fechamento da classe
  (16 testes + comparação antes/depois).
- `fsync` de diretório, escrita exatamente-uma-vez e raiz privada implementados e testados.
- Inventário de publicação e **bypass real encontrado** (`docker-push*`), fechado por porteiro +
  22 testes fail-closed, sem nenhuma publicação real.
- `ci:clean-checkout --scenario clean`: **PASS** ponta a ponta (bootstrap, 2 builds Docker, prod-like
  smoke, gate A,B,C,D com L0 completo verde, inventário L1), segundo run no commit `9bb607c40`.
- Análise dos 130 defeitos em 8 eixos, com medição de determinismo do fingerprint em duas árvores.
- Regressão ampla das suítes de bug-closure: 349 testes PASS (13 suítes).

### EXECUTADO E FALHOU

- `ci:clean-checkout --scenario clean` no commit `85ca7e2cc`: veredito **FAIL** por 3 passos da fase R
  (§5.1) — corrigido em `9bb607c40` e reexecutado com PASS.
- Fase R do gate (`L1-cadeia-criptografica`, `L1-self-proving`, `L1-decisao-canonica`): **FAIL**
  legítimo e esperado (cadeia recomputada inválida, `PRE_PACKAGE_PASS`, identidade incompleta). Não é
  regressão: é o estado de fail-closed canônico.
- `validate:bug-closure-status`: **FAIL** (`FECHAMENTO_NAO_PROVADO` 130, `inventoryAnchored=false`).
- `--scenario missing-artifact` e `--scenario corrupt-artifact`: **FAIL**, corrigidos e reexecutados
  para **PASS** (o consumidor reprovava sem nomear a dependência ⇒ `EXPECTED_FAILURE_SEM_ASSINATURA`).
- `--scenario db-unavailable`: **FAIL por TIMEOUT** (480 s) — corrigido em duas frentes: orçamento de
  conexão configurável (`DB_CONNECT_ATTEMPTS`, padrão de produção 30 preservado) e teto do passo de
  8 → 15 min (o `ci:bootstrap` completo com banco morto leva ~7-8 min). Fail-closed nunca foi violado
  (jamais PASS); o que faltava era a prova da assinatura do motivo.
- `--scenario l2-system`: **FAIL** por dependência de artefato de run governado (§6.2).
- `--scenario docker-unavailable`, `--scenario bootstrap-twice` e `--scenario db-unavailable`
  (após a correção): **PASS**.

### BLOQUEADO

- **L3 / gate agregado** (`npm run validate:governance-enforcement`): bloqueado por contrato — exige
  âncoras externas provisionadas e selo; sem eles o resultado **deve** ser NO_GO.
- **Certificação de release**: âncoras externas ausentes (3 secrets), por definição fora do
  repositório.
- **L2 em checkout limpo** (`--scenario l2-system`): bloqueado por contrato — depende de
  `governance/rap-master-scorecard.json`, derivado de run governado; regenerar localmente fabricaria
  estado de governança (medido: divergência de `sourceFingerprint` e `stale_run_id`).

### NÃO EXECUTADO

- `ci:clean-checkout --scenario all` (7 cenários em sequência): cada cenário exige clone+bootstrap+
  builds; executados individualmente os cenários do §5.3.
- Testes destrutivos contra stack de produção: proibidos pela missão.

### AFIRMADO POR OUTRO AGENTE, MAS NÃO REPRODUZIDO

- Fase 1: "4 suítes falham apenas na árvore corrigida, por ordem de execução". **Não reproduzido**
  sob condições idênticas — as 4 suítes passam isoladas **e** no conjunto, e o conjunto de falhas da
  branch é subconjunto estrito do da baseline (§2.2).
- Fase 1: "L0 da branch 9524 PASS / 42 FAIL" e "baseline 9417 PASS / 48 FAIL". Números **não
  reproduzidos** com o ambiente correto (ver tabela do §2.2); a diferença é ambiental, não de código.

---

## 12. Veredito

```
DEVELOPMENT_VERIFIED .......... NÃO
PARTIALLY_VERIFIED ............ SIM
BLOCKED ....................... NÃO (não há bloqueio que impeça o trabalho executado)
FAILED ........................ NÃO

RELEASE_CERTIFICATION = NO_GO
MERGE_PR_16           = NOT_AUTHORIZED
MAIN_MODIFIED         = FALSE
PUBLISHED             = FALSE
```

Justificativa do `PARTIALLY_VERIFIED` (critérios do contrato): L0 em árvore de desenvolvimento tem
**1 falha esperada** (`modelDrivenE2e`, dependente do job `prod-like-smoke`); L1 é **parcial por
escopo** (fases R/E/F não solicitadas no CI de desenvolvimento); L3 (gate agregado) permanece
vermelho **por contrato** (130 defeitos sem prova válida + âncoras ausentes). Nenhum desses três é
corrigível por código sem violar a missão.

`MAIN_MODIFIED = FALSE` e `PUBLISHED = FALSE` — verificados por git, não afirmados:

```
git rev-parse origin/main                                  → 04cad9c1b…  (inalterado)
git rev-parse origin/dev/engineering-hardening             → 484eee478…  (inalterado)
git ls-remote --tags origin | grep -c selo                 → 0
git status --porcelain (branch)                            → limpo (exceto artefatos de runtime ignorados)
```

---

## 13. Hashes das evidências

| Evidência | SHA-256 |
|---|---|
| `l0-comparativo-fase2.txt` | `460b4c3cf4772f1e2c7541d3bb1f312af9844f69e4ef88c4b6ea64ccb22c95f8` |
| `missao-a-matriz.txt` | `c990a3317fa0e00d7a3c23a7d265aa171a5af41d842a255396ec9a5f2ce509cb` |
| `missao-b-toctou.txt` | `61a20d4cf6c2168e875f236ca9c2bfc7cbedb76633d07fa1bca82a2f15059889` |
| `missao-c-inventario.txt` | `da98b85f779defb2f2d6661c31b3c413af6190ef8cb92c3ed70c62fd69847f50` |
| `missao-f-130-defeitos.txt` | `d9b1f239e2f35f10f08af7c028638b8e763c3f6e6b21147e3090be173f5eede3` |

Relatórios de máquina (ignorados por git, presentes no workspace de execução):
`reports/ci-clean-checkout-report.json`, `reports/bug-closure-status.json`,
`reports/ci-bootstrap-report.json`, `reports/dev-branch-ci-evidence.json`,
`AI_MEMORY/evidence/ci-clean-checkout-<sha>/<cenário>/RESULT.md`.

Evidências de execução copiadas do clone pelo harness (não commitadas por serem evidência de
runtime): `AI_MEMORY/evidence/ci-clean-checkout-85ca7e2cc/` (primeira execução, FAIL),
`AI_MEMORY/evidence/ci-clean-checkout-9bb607c40/` (clean PASS + 5 cenários negativos),
`AI_MEMORY/evidence/ci-clean-checkout-c9ca2b435/` (docker-unavailable, bootstrap-twice, l2-system),
`AI_MEMORY/evidence/ci-clean-checkout-d6842b34e/` (db-unavailable após a correção: PASS, exit=1 com
assinatura do motivo).

Data de geração: 2026-10-24T11:32:57Z
