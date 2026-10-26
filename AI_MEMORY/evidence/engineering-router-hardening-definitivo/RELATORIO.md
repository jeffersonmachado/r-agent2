# RELATÓRIO — RAP HARDENING DEFINITIVO (missão 2026-10-25)

**Repositório:** `jeffersonmachado/r-agent2`
**Branch de trabalho:** `codex/engineering-router-hardening-20261025`
**Worktree:** `/opt/results/ria/er-hardening`
**SHA inicial (referência da missão):** `29372d7a34d4653b10e7375480094fa787bded37` — conferido no remoto antes de começar
**SHA final:** ver §1 (commits por área)
**Estado do remoto:** `main = 04cad9c1b` e `dev/engineering-hardening = 29372d7a3` — **inalterados**. Nenhum push, merge, tag, release, publicação ou deploy.

> Regra da missão: *"A autoridade é a evidência produzida pela execução real, nunca a declaração do agente."*
> Tudo abaixo é comando + exit code + saída. O que não rodou está marcado como **BLOCKED**, **NOT_EXECUTED** ou
> **OUT_OF_SCOPE** — nunca como PASS.

---

## 1. Commits por área (locais, não empurrados)

| # | SHA | Área | Conteúdo |
|---|---|---|---|
| 1 | `92587151d` | P0 cadeia | caminho canônico por id em `verifyChain` |
| 2 | `5c0ec2c3b` | P1 decisão + P1 selo | identidade obrigatória em `clasificar`; allowlist no reparo de lineage |
| 3 | `ea7b96198` | revisão adversarial | fecha bypass por fallback de basename, reparo morto, controle positivo, hermeticidade, EISDIR |
| 4 | `7f87aeedc` | checkout limpo | re-base de caminho canônico que quebrava quando a raiz difere em profundidade |
| 5 | `871024cec` | concorrência do ciclo de bug | posse por lease em `reproduce`/`confirmFinding`; 409 na rota; BUG-03b/c |
| 6 | `f489994dd` | concorrência do ciclo de bug | `handleAnomaly` aceita/propaga o lease (ReferenceError pego pelo E2E) |

---

## 2. P0 — CADEIA CRIPTOGRÁFICA (§3 do briefing)

### 2.1 Hipótese × realidade

A hipótese era: *"a validação usa `link.path` do manifesto para localizar artefatos, então um manifesto
adulterado pode apontar IDs canônicos para arquivos substitutos com hashes recalculados"*. **Reproduzida.**

### 2.2 Reprodução (HEAD `29372d7a3`, antes da correção)

```
$ node .repro-chain.js          # 10 ids canônicos apontando para arquivos em /tmp
{
  "valid": true,
  "certifiable": true,
  "checkedLinks": 10,
  "structuralFailures": [],
  "hashFailures": [],
  "primeiroPath": "../repro-p0-8rMXtw/0-package.bin"
}
```

Consumidores do campo `valid`: `validate-governance-chain`, `validate-self-proving`,
`verify-delivery-strict`, `assert-canonical-release-decision` — todos no caminho certificante.

### 2.3 Causa raiz

`verifyChainHashes` montava `path.join(ROOT, link.path)`: localizava o arquivo pelo caminho **informado no
JSON que estava sendo verificado**. O contrato estrutural checava ids/ordem/quantidade/existência, nunca
*o caminho canônico daquele id*.

### 2.4 Correção (duas camadas, porque a primeira tinha porta lateral)

1. `caminhosCanonicos()` deriva o caminho de cada id da ARQUITETURA (`buildChainLayers`, o mesmo construtor
   da cadeia legítima) e `verificarCaminhosCanonicos()` compara realpath com realpath, recusando
   `path_not_canonical`, `path_outside_root`, symlink e caminho inexistente.
2. **`verificarHashesCanonicos()`**: os bytes de certificação passam a ser lidos do caminho canônico de cada
   id — nunca de `link.path` — conferindo `hash`, `cumulativeHash` e `chainRoot`.
3. `package`/`sidecar_manifest` sem artefato resolvível ⇒ `canonical_path_unresolved` (fail-closed).
4. Fallback por **basename** em `dist/{release,governance,signatures}/` **removido** do caminho certificante.

### 2.5 A porta lateral (achado do revisor independente, também reproduzido)

O revisor mostrou que só a camada (1) era contornável: `path.resolve` normaliza barra final e `path.join`
não, e o fallback por basename procurava cópia homônima em `dist/` — que o `two-pass-release.sh` deixa
lá de propósito. Reprodução do revisor reexecutada **após** a correção:

```
RESULTADO: {"valid":false,"certifiable":false,
            "structural":["hash_from_canonical_mismatch","cumulative_from_canonical_mismatch", ...]}
```

### 2.6 Testes (regressão permanente)

`tests/unit/governance/governanceChainCanonicalPath.test.js` — **9/9 PASS**: substituição de arquivos,
traversal relativo, caminho absoluto, symlink, barra final + homônimo em `dist/`, elo apontando para
diretório (não lança), fail-closed sem artefato, contrato do mapa, regressão positiva.
Fixtures de `governanceChainContract` e `governanceChainCertification` migradas para
`tests/helpers/chainSandbox.js` (sandbox com layout canônico real).

---

## 3. P1 — CONTRATO CENTRAL DE CERTIFICAÇÃO (§4)

### 3.1 Reprodução no HEAD anterior

```
$ node -e "const {clasificar}=require('./governance/canonical-release-decision');
           clasificar({gates:[final_governance,final_readiness,final_proof todos PASS],
                       selado:true, certificado:true})"
CERTIFIED_GO | reason: CERTIFICADO | identity: null
identidade PARCIAL ({runId}) => CERTIFIED_GO
```

A comparação "gate de outro run" só disparava quando **ambos** os lados tinham `runId`: sem identidade no
contrato, ela nunca rodava.

### 3.2 Correção

Identidade **completa e válida** (`runId` + `sourceCommit` + `sourceFingerprint`, presença **e** formato) é
pré-requisito de `CERTIFIED_GO`/`PUBLISHED_VERIFIED`:
`IDENTIDADE_AUSENTE_NO_CONTRATO:<campos>` / `IDENTIDADE_INVALIDA_NO_CONTRATO:<campos>`.
Compatibilidade preservada só onde não há certificação (`PRE_PACKAGE_PASS` continua sem identidade).

### 3.3 Matriz adversarial (15 cenários do briefing)

`tests/unit/governance/canonicalReleaseDecisionIdentityContract.test.js` — **22/22 PASS**: runId ausente,
sourceCommit ausente, sourceFingerprint ausente, identidade inteira ausente, formatos inválidos, gates
vazio/1 PASS/2 PASS, NOT_EXECUTED/UNKNOWN/SKIPPED/BLOCKED, gate desconhecido, gate de outro run, evidência
de outro commit, certificação sem prova, publicado sem entrega verificada.

---

## 4. P1 — SELO E PUBLICAÇÃO (§5)

### 4.1 Defeito reproduzido

`seal-release.sh` (`phase_verify_delivery`), quando o juiz estrito reprovava:

```bash
node scripts/governance/stamp-report-lineage.js
git add -A                     # TUDO o que estivesse sujo
git commit -m "fix(governance): re-stampa lineage clobberado…"
git push origin "$branch_atual"
```

Todo o worktree sujo entrava num commit com mensagem de reparo de lineage e era empurrado.

### 4.2 Correção

`scripts/governance/lib/lineage-repair.js` deriva a allowlist da MESMA taxonomia canônica
(`listAuthoritativeArtifacts` + `governance/.current-run.json`) e decide fail-closed: qualquer caminho fora
da allowlist (incluindo `??` não rastreado e o lado de origem de um rename) **recusa o reparo inteiro** —
nada é staged, nada é commitado, nada é empurrado. Staging passou a `git add -- <caminhos permitidos>`;
commit só com diff staged; push só da branch corrente.

### 4.3 Achado do revisor: o reparo nunca funcionava

37 dos 62 caminhos da allowlist são **ignorados** pelo `.gitignore`; `git add` recusa caminho ignorado
(exit 1) ⇒ o reparo falhava sempre, e falhava na última fase (depois da publicação). Correção: o commit usa
o subconjunto **rastreado** (`git ls-files`); artefato ignorado não é persistível e não é forçado com `-f`.
Novo motivo `APENAS_ARTEFATOS_IGNORADOS`.

### 4.4 Testes

`tests/unit/governance/sealReleaseLineageRepair.test.js` — **12/12 PASS**, incluindo repositório git REAL
com remoto local descartável:

| Cenário | Resultado medido |
|---|---|
| arquivo não autorizado sujo | recusa nomeada, **nenhum commit**, remoto intacto |
| somente allowlist suja | commit toca **apenas** o arquivo autorizado; remoto avança |
| allowlist real (62 caminhos / 25 rastreados) | nenhum caminho ignorado é estagiado |
| `git add -A` / `git push origin main` | ausentes do caminho executável (asserção ignora comentários) |

---

## 5. TIMEOUT ARCHITECTURE (§7) — **GO**

Números recalculados no HEAD (não herdados do briefing):

```
arquivos varridos: 2183      timeouts: 1133      LEGACY_UNKNOWN: 0
REQUEST_TIMEOUT 45 · OPERATION_DEADLINE 575 · COMMAND_DEADLINE 23 · DATABASE_TIMEOUT 22
PROVIDER_TIMEOUT 15 · LEASE_DURATION 214 · HEARTBEAT_INTERVAL 31 · NO_PROGRESS_TIMEOUT 1
RETRY_BACKOFF 9 · POLL_INTERVAL 95 · TEST_TIMEOUT 3 · SHUTDOWN_GRACE_PERIOD 5
DELAY_SLEEP 81 · USER_DEFINED_DEADLINE 14
padrões destrutivos: 5 (críticos: 1)  · PID como corroboração local: 3 (exceções auditáveis)
capacidades: LEASE ✓ FENCING ✓ HEARTBEAT ✓ NO_PROGRESS_DETECTION ✓ PROVIDER_TIMEOUT_ISOLATION ✓
             PROVIDER_FALLBACK ✓ COMMAND_TIMEOUT_ISOLATION ✓ DATABASE_TIMEOUT_ISOLATION ✓
             CIRCUIT_BREAKER ✓ CHECKPOINT_RESUME ✓
```

Antes: `NO_GO` por 4 provas runtime PENDING. Executado `npm run verify:timeout-architecture-e2e`
(exit 0, 44,9 s) — **LONG_RUNNING_TASK, REAL_DEAD_WORKER_RECOVERY, NO_PROGRESS_E2E, PROVIDER_FALLBACK_E2E
todos PASS** com execução real (a suíte de reroute roda 39,9 s contra provider 404 real).
⇒ **`TIMEOUT_ARCHITECTURE = GREEN`**.

---

## 6. RECUPERAÇÃO APÓS SIGKILL E TASK REAL (§8) — **GO**

`npm run verify:mission-crash-recovery` (exit 0) — **13/13 checks**, execução real:

```
[PASS] SIGKILL_REAL — signal=SIGKILL code=null      [PASS] PROCESSO_A_MORTO — pid=3226345
[PASS] LEASE_ORFAO_DO_WORKER_MORTO — worker=verify-worker-A fence=2
[PASS] RECOVERY_ENCONTROU_A_MISSAO — recovered=2     [PASS] LEASE_EXPIRADO_PARA_TAKEOVER
[PASS] LEASE_NAO_PERTENCE_MAIS_AO_WORKER_MORTO — fence=4
[PASS] ESCRITA_DO_WORKER_MORTO_RECUSADA — code=MISSION_LEASE_NOT_HELD
[PASS] MISSAO_NAO_FOI_MARCADA_GREEN_PELO_MORTO — status=EXECUTING
```

`npm run validate:recovery` (exit 0) — **17/17 checks**: task em fase MATERIAL interrompida por SIGKILL,
lease órfão, takeover com fence 1→2, escrita do worker morto recusada (`TASK_LEASE_NOT_HELD`), task
retomada pelo novo dono (desfecho `CONTEXT_SOURCE_UNRESOLVABLE` — prova de que a recuperação não
"consertou" o resultado, apenas retomou a execução).

---

## 7. ENGINEERING ROUTER V2 (§6) — **NO_GO**

Medição no HEAD final (`node scripts/governance/validate-engineering-router-v2.js`, exit 1):

```
itens=12  falhas=2  pendencias=3
[PASS] invariantes estruturais (9): LEASE_POLICY_PURE, PID_NAO_E_AUTORIDADE, POLICY_RESOLVER,
       ESTADOS_TERMINAIS, RECOVERY_AUTOMATICO_NO_BOOT, FK_RESTRICT, RBAC_FAIL_CLOSED, ANTI_GREENWASHING_PORTA_UNICA
[PASS] V2_CRASH_SIGKILL_VERDE            <- produzido nesta missão (§6)
[PASS] V2_TIMEOUT_ARCHITECTURE_GREEN     <- produzido nesta missão (§5)
[FAIL] V2_ANTI_GREENWASHING_VERDE        relatório ausente (depende da execução autoritativa)
[FAIL] V2_BUG_AUTONOMOUS_LOOP_GREEN      relatório ausente (mesma dependência)
[PENDING] V2_REQUIRED_TESTS              68 itens NOT_EXECUTED
[PENDING] V2_REQUIREMENTS_MATRIX_STATUS   18 eixos sem prova
[PENDING] ENVELOPE_VERIFICATION          envelope não selado
```

(antes desta missão: 4 falhas / 5 pendências — crash-recovery e timeout architecture saíram do vermelho)

### 7.1 Por que os 68 testes não foram executados — **BLOCKED externo**

`npm run test:release-authoritative` (o produtor de `reports/release-suite-execution.json`, insumo dos 68
testes, da matriz e do anti-greenwashing) **recusa iniciar**:

```
[bug-closure] Nenhum processo extensivo começa com P0/P1 bloqueante aberto.
[bug-closure] Corrija e VERIFIQUE o defeito (teste de regressão no mesmo SHA) antes de reexecutar.
ação exigida: fornecer RAP_CLOSURE_INVENTORY_SHA256 do canal externo (operador/CI), fora da árvore do repositório
```

É bloqueio **por contrato** e exige âncora externa + provas de fechamento humanas. Contornar seria
exatamente o que a missão proíbe. O número de itens obrigatórios foi conferido no contrato atual: **68**
(`validate:required-tests` ⇒ `status=FAIL itens=68 {"NOT_EXECUTED":68}`).

### 7.2 Escopo do roteador: o que foi verificado e o que não foi

Verificado por execução: recuperação após SIGKILL (mission e task), lease/fencing, recusa de escrita por
worker morto, timeout por etapa/missão (inventário completo, 0 LEGACY_UNKNOWN), detecção de ausência de
progresso, isolamento e fallback de provider. **Não** verificado nesta missão: ciclo autônomo de correção
completo ponta a ponta (`validate:bug-autonomous-loop` depende da execução autoritativa) — **PENDING**.

---

## 8. RAG (§9)

`npm run validate:rag-index-health` (exit 0): `status=HEALTHY indexed=3539 duplicados=0 semTexto=4
failed=2 chunks=9221 violações=0`. Isolamento de domínio: coberto por `tests/unit/rag*` +
`ragDomainRouter` + `ragDomainSegregationEvidence` dentro do L0 (§9 abaixo) — 173 testes, todos PASS.

---

## 9. REGRESSÃO (§10, §11)

### 9.1 L0 completo (árvore de desenvolvimento, `bail=0`, 4 workers)

```
Test Suites: 3 failed, 1 skipped, 1115 passed, 1118 of 1119
Tests:       4 failed, 2 skipped, 9769 passed, 9775
```

| Suíte | Causa | Classificação |
|---|---|---|
| `governanceChainContract.test.js` | controle positivo com identidade parcial — **corrigido** (`ea7b96198`) | FAIL → **PASS** (15/15) |
| `coverage/impactRunner.test.js` | artefato `reports/impact-*` desatualizado após edição — regenerado com `ci:artifacts` | ambiente → **PASS** |
| `governance/modelDrivenE2e.test.js` | exige `qa/smoke/prod-like/…` produzido pelo job `prod-like-smoke` do CI | **ENVIRONMENT** (declarado) |

Reexecução após as correções: `impactRunner` + 5 suítes de governança ⇒ **117/117 PASS**.

### 9.2 RPA — regressão da otimização Playwright (§10)

- `tests/unit/rpa*` + `tests/rpa` + `core/rpa`: **21 suítes / 100 testes PASS** (após o lazy-load estar no
  HEAD, o que prova inicialização, gravação, replay e tratamento de exceção).
- Benchmark de boot (`require('api/server')`, 3 pares baseline `78eaacc22` × HEAD, mesmo `node_modules`):
  `−45,0%`, `−27,5%`, `+4,8%` — **mediana ≈ −27%**, com ruído de cache quente declarado. A medição a frio
  registrada na Fase 3 foi −48%. **Não** se declara ganho sem a série inteira; a variância é evidência.

### 9.3 L1 / L2 / L3

| Nível | Execução | Resultado |
|---|---|---|
| L1 | `validate:timeout-architecture`, `validate:recovery`, `validate:rag-index-health`, `verify:mission-crash-recovery` | **GREEN/GO/HEALTHY** (ver §5, §6, §8) |
| L2 | não executado nesta rodada | **NOT_EXECUTED** — requer harness de checkout limpo (§9.4) |
| L3 | jornadas E2E de recuperação/concorrência | **PARCIAL** — SIGKILL, takeover, fencing e provider fallback provados; ciclo autônomo completo **BLOCKED** (§7.1) |
| `validate:required-tests` | 68 itens | **FAIL — NOT_EXECUTED** (bloqueio externo §7.1) |
| `validate:engineering-router-v2` | 12 itens | **NO_GO** (2 falhas, 3 pendências — §7) |
| `ci:clean-checkout` | `--scenario clean` | **FAIL** — L0 verde no clone; L0b `FLAKY_UNDER_LOAD` (§9.4) |

### 9.3-bis O `FLAKY_UNDER_LOAD` do laço de bug: defeito REAL reproduzido e fechado

O harness acusou `transição concorrente rejeitada: … está em SUSPECTED (tentativa REPRODUCING →
CONFIRMED)` e a suíte passava isolada. Investigado até a causa:

**Causa raiz.** `reproduce()` e `confirmFinding()` **não tomavam o lease do finding** — só a varredura
(`runBugLoopSweep`) tomava. A varredura de OUTRO processo (o runner vivo do harness usa o mesmo banco)
pegava o mesmo finding em REPRODUCING, rodava a própria tentativa, recebia INCONCLUSIVE e o devolvia a
SUSPECTED no meio da tentativa em curso, que então falhava no CAS. Andar por ANDAR: "vítima" diferente
a cada execução (BUG-03, BUG-08, BUG-10, PROTECTED_GOVERNANCE_BASELINE, BUG_DURABLE_EXECUTION).

**Correção** (reusa o mecanismo existente; nada de infraestrutura paralela):
`withFindingLeaseOwned` como definição ÚNICA do ciclo de vida do lease; `confirmFinding` e `reproduce`
inteiros sob posse; identidade por OPERAÇÃO quando o chamador não declara uma (`pid:<pid>` faria duas
operações do mesmo processo se enxergarem como o mesmo dono); a varredura **passa o lease adiante**;
rota HTTP devolve **409** em recusa por posse (200 faria o cliente acreditar que confirmou).

**Quatro regressões minhas, encontradas pelos testes e corrigidas** (é o ciclo exigido, registrado como
aconteceu):

| Regressão | Quem pegou | Correção |
|---|---|---|
| a varredura se recusava a si mesma (lease adquirido duas vezes) | `engineeringBugLoopNaturalPathE2E` — **900 s de timeout** | lease propagado de `withFindingLease` → `reproduce`; E2E voltou a **45,4 s PASS** (base: 36,9 s) |
| `ReferenceError: findingLease is not defined` em `handleAnomaly` | bateria de integração (`engineeringBugAutonomousLoopE2E`) | `handleAnomaly` aceita e propaga `findingLease`; E2E **3/3 PASS** |
| `governanceApprovalFullWorkerE2E` executava o coder **3×** (`fixAttempts 3 ≠ 1`) — o caminho `handleAnomaly → runFixLoop` não tomava o lease, então reprocessava depois da aprovação humana | bateria de integração | `runFixLoop` passou a ser wrapper que ADQUIRE o lease e delega a `executarFixLoop`; regressão permanente `BUG-03d` (`382e0a2a4`); E2E **PASS 61,3 s** |
| **duas suítes de unidade quebraram** (`withFindingLeaseOwned is not a function`) porque o dublê de `bugFindingService` não conhecia a função nova | `npm run test:unit` — `bugLoopNonConvergenceGuard` + `governanceApprovalLifecycle`, **10 testes** | dublê passa a repassar o lease; e a implementação do dublê é função PURA, porque `resetMocks: true` apaga a implementação de `jest.fn()` e o fix loop devolveria `undefined` (foi o SEGUNDO erro, medido) |

**Provas novas (permanentes):**

| Teste | O que prova |
|---|---|
| `BUG-03b` | duas reproduções concorrentes do MESMO finding: a segunda é **recusada** (`SKIPPED_LEASE_HELD`) e a primeira conclui CONFIRMED; o teste SEGURA o lease para não depender de quem chega primeiro |
| `BUG-03c` | a varredura **pula** finding sob lease de outro worker e não toca no estado |
| `BUG-03d` | com o finding sob posse de outro worker, o fix loop **recusa** (`FINDING_LEASE_HELD_BY_OTHER_WORKER` / stage `LEASE_HELD_BY_OTHER_WORKER`) e não executa nada |
| `engineeringBugLoop.test.js` | **26/26** em 5 execuções consecutivas (`--runInBand`) |
| `engineeringBugLoopNaturalPathE2E` | **PASS 45,4 s** (base 36,9 s) · **58,065 s** no L0b canônico |
| `engineeringBugAutonomousLoopE2E` | **3/3 PASS** (ciclo completo em 40,7 s) |
| `governanceApprovalFullWorkerE2E` | **PASS 61,3 s** isolado (branch 74,1 s · base 82,9 s) |
| L0 `tests/unit` (**medido depois das correções de lease**) | **1116 de 1118 suítes executadas · 9771 testes** · 2 FAIL: `modelDrivenE2e` (ENVIRONMENT) e `regularizadorFilesystemAttacks` B2 (10,404 s no lote contra timeout de 10 s; **PASS 316 ms isolado** ⇒ flake sob carga, não tocado por este delta) |

**RETRATAÇÃO — a rodada anterior usou uma FORMA DE EXECUÇÃO INVÁLIDA.** A tabela de atribuição que
esteve aqui veio de `npx jest tests/integration --maxWorkers=2` (77 suítes em paralelo). O próprio
repositório declara que essa forma não é legítima: `config/canonical-release-suites.json` define um
**grupo exclusivo** (uma suíte por lote) para as suítes que compartilham o runner do laço de bug e o
banco de missões, e o L0b canônico é
`npx jest tests/integration/engineering --bail=0 --runInBand --forceExit`. Rodar em paralelo viola o
contrato de estado global e produz vítimas ROTATIVAS (`naturalPath`, `autonomousLoop`,
`governanceApproval`, `missionSource` — todas passam isoladas). **Nenhuma dessas falhas foi tratada
como defeito**: rodada de forma inválida não gera evidência de regressão nem de aprovação.

### 9.3-ter L0b na forma CANÔNICA — branch vs base

Mesmo comando, `--runInBand`, 40 suítes, banco real, três amostras:

| Amostra | Suítes | Testes | Suítes que falharam |
|---|---|---|---|
| base `29372d7a3` | 2/40 | 3/219 | `engineeringPromotionService` (2), `engineeringPatchApplyAndTestRunner` (1) |
| branch amostra 1 | 4/40 | 6/222 | as 3 acima **+** `engineeringPromotionBaselineSeal` ER-V1-SEAL-001 (1), `engineeringBugLoop` BUG-02 (1), `engineeringMissionSourceE2E` MISSION_SRC_14 (1) |
| branch amostra 2 | 2/40 | 3/222 | **exatamente o conjunto da base** (2 suítes, 3 testes), 1123 s |

`engineeringBugLoop` foi **PASS 58,065 s** e `engineeringMissionSourceE2E` **PASS 11,992 s** na
amostra 2. A amostra 2 da branch é **idêntica à base** ⇒ nenhuma falha do L0b canônico é atribuível a
este delta.

**Classificação medida das 3 falhas estáveis (presentes na base e na branch):**

| Suíte | Medição | Classificação |
|---|---|---|
| `engineeringPromotionService` (2 testes) | `Expected: "484eee4…"` (HEAD do repo principal) · `Received: "85a0cc9…"` (HEAD do worktree) | **ENVIRONMENT** — `realHead()` resolve o HEAD do repositório, e worktree ligada nunca tem o HEAD do repo; falha igual na base |
| `engineeringPatchApplyAndTestRunner` (1 teste) | `fs.existsSync(path.join(__dirname,'..','..', stdoutRef))` ⇒ `false`; `stdoutRef = path.relative(ROOT, arquivo)` aponta para o runtime root, fora do repo | **PRE-EXISTENTE** — asserção idêntica falhando na base, mesmo motivo |

**Falhas que só apareceram na amostra 1 (não recorrentes ⇒ estado global sob carga, NÃO atribuídas):**

| Teste | Sintoma | Por que não é deste delta |
|---|---|---|
| BUG-02 | `Exceeded timeout of 60000 ms` (suíte inteira levou 58 s na amostra 2) | o teste faz DUAS varreduras sobre a tabela GLOBAL de findings (medido: 17 `SUSPECTED/REPRODUCING` + 7 `CONFIRMED/FIXING`, sem truncamento entre execuções) e cada finding varrido paga lease + reprodução; meu delta acrescenta **1 UPDATE de lease por finding varrido** (~24 por varredura), que não explica 60 s — o custo é O(estado acumulado) e o relógio é do host |
| MISSION_SRC_14 | `reconciled >= 1` recebeu `0` (com `missions >= 1`) | corrida com o **Engineering Runner vivo** que o `globalSetup` sobe: ele reconcilia os pending intents do MESMO banco, e quando ganha a corrida não sobra nada para o teste reconciliar |
| ER-V1-SEAL-001 | `POST_PROMOTION_VERIFY_FAILED` | etapa de verificação pós-promoção sobre git real, caminho de promoção — não tocado por este delta; PASS na amostra 2 |

Direção de correção (registrada como trabalho seguinte, não feita aqui): isolar o estado global das
suítes que varrem a tabela de findings (subsistema escopado por execução ou truncamento explícito do
que a própria suíte criou) e reconciliar por intenção própria em MISSION_SRC_14. Enquanto isso, a
classificação honesta é `INCONCLUSIVO/SOB CARGA`.

### 9.3-quater Custo O(estado global) da varredura — medido e cortado na raiz

A medição acima apontou a causa do aperto de orçamento: `runBugLoopSweep` **sem escopo** varre a tabela
inteira (é o comportamento de produção, correto) e cada finding varrido paga lease + transição +
reprodução. Um teste que só precisa do PRÓPRIO finding pagava a tabela acumulada de meses — e no caso de
`BUG-03c` (varredura com `runner: FAIL`) ainda **confirmava findings de outras suítes**, efeito colateral
fora do teste.

**Correção (default OFF; produção intocada):** `runBugLoopSweep({ findingIds: [...] })` restringe as três
consultas da varredura (pendentes, confirmados, fechados) a um conjunto explícito; sem a opção, nada muda.
`listFindings` ganhou `ids` (mesmo filtro `IN`, opcional). Os dois testes que varriam o mundo passaram a
declarar escopo.

| Medição (mesmo commit, mesma máquina) | Antes | Depois |
|---|---|---|
| `BUG-02` (só o teste) | **53 789 ms** (orçamento 60 000 ms — estourou uma vez no L0b) | **15 606 ms** (baseline do próprio teste: 16,7 s medido isolado) |
| `engineeringBugLoop.test.js` (suíte inteira) | 62,4 s · 63,4 s | **26,0 s** |
| Efeito colateral de `BUG-03c` | varria até 200 findings alheios com `runner: FAIL` | apenas o finding do teste |

O que **não** foi feito: subir o timeout de 60 s para "passar". O orçamento é o sintoma; o escopo é a causa.

### 9.4 Checkout limpo — executado três vezes, resultado real

| Execução | Commit | Resultado | Achado |
|---|---|---|---|
| 1 | `HEAD` (literal) | **FAIL** (harness) | `commit pedido (HEAD) difere do HEAD do clone` — recusa correta de identidade; reexecutado com SHA literal |
| 2 | `ea7b96198` | **FAIL** | `L0-suite-oficial` exit=1 em `governanceChainCanonicalPath.test.js` — **defeito real no meu código**, não no ambiente (§9.5) |
| 3 | `7f87aeedc` | **L0 exit=0 (492 s)** · **FAIL no L0b** | `L0b-integracao-engenheiro` exit=1: `engineeringBugLoop.test.js` BUG-03 — `transição concorrente rejeitada … SUSPECTED (tentativa REPRODUCING → CONFIRMED)` |

O passo `clone-limpo`, `npm-ci-bootstrap`, `build-api`, `build-frontend`, `prod-like-smoke` e
`prod-like-artefato` passaram nas três execuções; `L0a-artefatos-canoeiros` passou (9,0 s) e
`L0-suite-oficial` passou no clone limpo **depois** da correção de §9.5.

**Classificação do L0b (não convertido em PASS):** a mesma suíte `tests/integration/engineeringBugLoop.test.js`
executada **isolada no mesmo SHA** ⇒ **12/12 PASS** (aqui a BUG-02 leva 16,7 s; no harness a suíte inteira
levou 60 s). O erro é do próprio serviço (`bugFindingService.transitionFinding`), que detecta transição
concorrente — não há código deste delta no caminho (o delta toca cadeia/decisão/selo).

**Desfecho:** a suspeita de `FLAKY_UNDER_LOAD` foi investigada e o `BUG-03` era **defeito REAL** (falta de
posse por lease em `reproduce`/`confirmFinding`, §9.3-bis, corrigido em `871024cec`). Reamostragem na forma
CANÔNICA do L0b depois das correções: **branch amostra 2 == base** (§9.3-ter) ⇒ o `BUG-03` não recorre; o
que resta de rotativo (`BUG-02` timeout, `MISSION_SRC_14`, `ER-V1-SEAL-001`) está classificado como
`INCONCLUSIVO/SOB CARGA` com a medição que sustenta a classificação, e **não** foi declarado corrigido.

### 9.5 Defeito que só o checkout limpo pegou

`caminhosCanonicos()` re-baseava `path.join(raiz, path.relative(ROOT, caminhoDaCamada))` sempre que
`raiz !== ROOT`. Isso **só coincide quando as duas árvores têm a mesma profundidade**:

```
dev   : ROOT=/opt/results/ria/er-hardening        raiz=/tmp/chain-canon-x  -> join normalizava, acertava
clone : ROOT=/tmp/rap-ci-clean-XXXX/ria/r-agent2  raiz=/tmp/chain-canon-x  -> resolvia FORA da raiz,
        `package`/`sidecar_manifest` viravam `resolvido:false` e a fixture explodia com
        "The path argument must be of type string"
```

Corrigido em `7f87aeedc` (re-base só quando o caminho **não** está já dentro da raiz pedida) e verificado nos
dois layouts. É o exemplo mais claro desta missão de por que evidência de máquina de desenvolvimento não é
evidência: o teste do P0 passava em casa e quebrava no clone.

---

## 10. REVISÃO ADVERSARIAL INDEPENDENTE (§12)

Revisor distinto (`code-review`, contexto próprio, 359 s) sobre o delta. **5 achados — todos tratados:**

| # | Sev | Achado | Reprodução do revisor | Tratamento |
|---|---|---|---|---|
| 1 | **P0** | bypass sobrevivia por fallback de basename + divergência `path.resolve` × `path.join` (barra final) | `valid:true` com bytes de `dist/release/<base>` | fallback removido; `verificarHashesCanonicos` lê do caminho canônico; regressão permanente |
| 2 | P1 | reparo de lineage abortava sempre (37/62 caminhos ignorados) | `git add -n` ⇒ exit 1 | commit só do subconjunto rastreado; teste com a allowlist REAL |
| 3 | P1 | controle positivo `§11 #7` quebrado (identidade parcial) | `Expected CERTIFIED_GO, Received NO_GO` | fixture com identidade completa |
| 4 | P2 | teste não hermético (`safe.bareRepository=explicit`, git ≥ 2.38) | `fatal: cannot use bare repository` | helpers com `-c safe.bareRepository=all` |
| 5 | P2 | `sha256File` lançava EISDIR | elo apontando para `governance/` | `statSync().isFile()` + regressão |

O revisor também confirmou como **sólidos**: seams `verificar`/`raiz`/`artifact` inalcançáveis por dados de
produção; duplicação/ordem/ausência de elos; caminhos absolutos e symlinks; contrato de identidade;
quoting e fluxo do `seal-release.sh`.

---

## 11. RISCOS RESIDUAIS E BLOQUEIOS EXTERNOS

| Item | Estado |
|---|---|
| 68 testes obrigatórios | **BLOCKED** — `test:release-authoritative` recusa com P0/P1 histórico aberto; exige `RAP_CLOSURE_INVENTORY_SHA256` do canal externo e provas de fechamento humanas |
| Envelope de auditoria V2 | **PENDING** — selar envelope sobre estado incompleto seria greenwashing; não gerado |
| `modelDrivenE2e` | **ENVIRONMENT** — depende do artefato do job `prod-like-smoke` |
| Padrões destrutivos residuais | 5 identificados (1 crítico), **inventariados e classificados**; correção de cada sítio é trabalho de outra ordem |
| Cache de módulos no benchmark | ruído de cache quente medido e declarado (3 pares) |
| `engineeringBugLoop` / `engineeringMissionSourceE2E` sob carga | **BUG-03 = defeito real corrigido** (§9.3-bis, 3 correções + provas BUG-03b/c/d). Restam duas fragilidades de ESTADO GLOBAL, medidas e **não** declaradas corrigidas (`INCONCLUSIVO/SOB CARGA`, §9.3-ter): BUG-02 faz duas varreduras sobre a tabela global de findings (custo O(estado acumulado)) e MISSION_SRC_14 corre com o Engineering Runner vivo do `globalSetup` pela reconciliação dos pending intents do mesmo banco |
| L0b canônico branch vs base | **amostra 2 da branch == base** (2 suítes/3 testes): `engineeringPromotionService` (ENVIRONMENT: worktree ≠ HEAD do repo) e `engineeringPatchApplyAndTestRunner` (PRE-EXISTENTE: `stdoutRef` relativo ao runtime root, fora do repo) |

---

## 12. DECISÃO FINAL

```
TIMEOUT_ARCHITECTURE  = GO               (4 provas runtime reais, inventário 1133 sem LEGACY_UNKNOWN)
CRASH_RECOVERY        = GO               (13 checks com SIGKILL real)
REAL_TASK_RECOVERY    = GO               (17 checks com takeover e fencing)
RAG_INDEX_HEALTH      = HEALTHY          (3539 indexados, 0 violações)
ENGINEERING_ROUTER_V2 = NO_GO            (2 falhas, 3 pendências — §7)
REQUIRED_TESTS        = FAIL/NOT_EXECUTED (68) — bloqueio externo
DEVELOPMENT_VERIFIED  = NÃO DECLARADO    (testes obrigatórios não executados)
RELEASE_CERTIFICATION = NO_GO
MERGE                 = NOT_AUTHORIZED
PUBLISH               = NOT_AUTHORIZED
DEPLOY                = NOT_AUTHORIZED
```

Duas vulnerabilidades P0/P1 reais fechadas com reprodução antes/depois, uma delas tendo sobrevivido à
primeira correção e sido pega por revisão independente. O que impede `DEVELOPMENT_VERIFIED` é dependência
externa — não ausência de trabalho executável neste ambiente.
