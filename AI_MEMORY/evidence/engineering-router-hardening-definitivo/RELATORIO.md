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
| 5 | `90c89e2c0` | evidência | relatório e `report.json` da missão |
| 6 | `d41ee60c3` | evidência | gates medidos no checkout limpo |
| 7 | `871024cec` | concorrência do ciclo de bug | posse por lease em `reproduce`/`confirmFinding`; 409 na rota; BUG-03b/c |
| 8 | `f489994dd` | concorrência do ciclo de bug | `handleAnomaly` aceita/propaga o lease (ReferenceError pego pelo E2E) |
| 9 | `740b416ef` | evidência | defeito de concorrência, as regressões que introduzi e a atribuição da bateria |
| 10 | `382e0a2a4` | duplicação de efeito | fix loop sob posse do finding — impede o coder rodar duas vezes (BUG-03d) |
| 11 | `85a0cc9de` | orçamento de teste | `TIMEOUT_INTEGRATION_IO_MS` para suíte com I/O real (git + Postgres) |
| 12 | `69f044787` | custo O(estado global) | escopo `findingIds` na varredura + dublês de lease nas suítes de unidade |

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

### 9.3-decies Quarta revisão adversarial — starvation da drenagem (P1 com prova empírica) e fencing sem prova

Revisor independente sobre o delta dos três reparos anteriores. Veredito **PASS_PARCIAL**, 3 achados —
todos fechados, cada um com a mutação que o revisor disse que a suíte NÃO pegava:

| # | Sev | Achado | Evidência do revisor | Tratamento |
|---|---|---|---|---|
| 1 | **P1** | a drenagem "sem starvation" **não se sustentava**: excluir os já visitados EM MEMÓRIA não basta, porque o desfecho `PROCEED` **não muda** `integration_status`. Com o head da fila ocupado por esses intents, o lote seguinte devolve as mesmas linhas, `novos` fica vazio e a drenagem para — o intent recuperável (mais recente) **nunca** é alcançado | probe: 200 estacionários + 1 recuperável ⇒ `{"missions":200,...,"visitedNewMission":false}` | exclusão **no SQL** (`Op.notIn`), como `findMissionsWithExpiredLease` já fazia. Probe equivalente depois: `{"missions":201,"visitedNova":true,"pending":0}`. Regressão `MISSION_SRC_16` — **mutação: voltar à exclusão em memória ⇒ FAIL** (`Received: [0001, 0002]`, o recuperável de fora) |
| 2 | P2 | depois do reparo, o único sinal automático de dívida deixou de cobrir o estado que **mais** exige ação: `RECOVERY_REQUIRED` não era contado por ninguém (`SELECT` no banco local: **306 linhas invisíveis**) | `pending` contava só os 3 estados auto-reconciliáveis | `reconcilePendingIntents` devolve **`pending`** (alcançável e não visitado no teto) e **`needsRepair`** (irresolvível automaticamente), ambos no log de boot |
| 3 | P2 | o fencing propagado ao fix loop e à trilha de tentativas **não tinha prova**: remover `lease:` de `markFixed` ou o predicado de `persistAttempt` deixava a suíte verde — e a fila oficial declarava o contrário | `grep toHaveBeenCalledWith ... lease` → vazio; mutação não falhava | duas provas novas, **ambas verificadas por mutação**: (a) `markFixed` com fence velho ⇒ `FINDING_LEASE_LOST` e estado **continua FIXING** (mutação ⇒ FAIL); (b) `reproduce` sob posse perdida ⇒ tentativa **não persistida** (mutação ⇒ "promessa resolveu em vez de rejeitar") |

O revisor também confirmou por leitura + probe: o SQL cru com `IN (:status)` expande corretamente no
dialect postgres, `Integration.sequelize` existe, `lease: null` nos caminhos fora de posse não quebra, e
os 409 de posse estão corretos e cobertos. E confirmou o que eu já sabia: existe um `api/server.js` vivo
usando o **mesmo** Postgres, com worker de laço de bug disputando lease — daí rodadas isoladas darem
34/34 e lotes darem flake (motivo pelo qual a evidência válida é o L0b canônico).

### 7.1-bis `BUG_AUTONOMOUS_LOOP` — medido, e é o MESMO bloqueio externo (não trabalho pendente meu)

`npm run validate:bug-autonomous-loop` foi executado nesta rodada. Resultado: **`status=NO_GO itens=31
falhas=31 runtime=NOT_PROVEN`** — e a causa é única e verificável:

- o gate **não roda testes**: ele COMPÕE provas do relatório de execução autoritativa
  (`reports/release-suite-execution.json`), que **não existe** porque `test:release-authoritative`
  recusa iniciar (§7.1);
- por isso as 20 suítes aparecem como `NAO_EXECUTADA (PENDING)` e as provas de RUNTIME como
  `state=null` — **PENDING, nunca FAIL de conteúdo**, exatamente como o gate declara;
- `EVIDENCE_BINDING = PENDING_NO_GOVERNED_RUN` (sem run governado ativo).

Conclusão honesta: este item **não é fechável por código neste ambiente**. Ele é o mesmo bloqueio
externo dos 68 testes obrigatórios (§7.1) visto de outro ângulo — a cadeia é
`RAP_CLOSURE_INVENTORY_SHA256` + P0/P1 históricos ⇒ `test:release-authoritative` ⇒
`release-suite-execution.json` ⇒ matriz V2 e `BUG_AUTONOMOUS_LOOP`. Declarar `DEFINITIVO = GO` aqui
seria greenwashing: o gate diria exatamente o contrário.

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

Mesmo comando, `--runInBand`, 40 suítes, banco real, QUATRO amostras:

| Amostra | Suítes | Testes | Suítes que falharam |
|---|---|---|---|
| base `29372d7a3` | 2/40 | 3/219 | `engineeringPromotionService` (2), `engineeringPatchApplyAndTestRunner` (1) — 1131,6 s |
| branch amostra 1 (antes das correções de lease) | 4/40 | 6/222 | as 3 acima **+** `engineeringPromotionBaselineSeal` ER-V1-SEAL-001 (1), `engineeringBugLoop` BUG-02 (1), `engineeringMissionSourceE2E` MISSION_SRC_14 (1) — 1294,0 s |
| branch amostra 2 (depois das correções de lease) | 2/40 | 3/222 | **exatamente o conjunto da base** — 1123,2 s |
| branch amostra 3 (`69f044787`, depois do escopo da varredura) | 2/40 | 3/222 | **exatamente o conjunto da base** — 1147,8 s |
| branch amostra 4 (`114e0cd7b`, depois dos 4 achados da revisão do lease) | 2/40 | 3/226 | **exatamente o conjunto da base** — 1122,7 s (`engineeringBugLoop` PASS 26,0 s; `missionSourceE2E` PASS 9,6 s; `naturalPath` PASS 45,1 s; `autonomousLoop` PASS 40,5 s) |
| branch amostra 5 (`e7601632d`) | 1/40 | 1/226 | `engineeringMissionReviewEnforcement` ADVERSARIAL_TO_BUG_LOOP (`strategy` undefined) — **defeito real de proveniência**, §9.3-sexies — 1573,0 s |
| branch amostra 6 (`6e3f56f84`, com §9.3-quinquies e §9.3-sexies) | 1/40 | 1/228 | `engineeringBugLoop` PROTECTED_GOVERNANCE_BASELINE (`fixed:false` em 559 ms) — **flake sob carga**, 14 execuções isoladas do arquivo 32/32 PASS depois; as duas falhas permanentes da base **não existem mais** — 1481,3 s |
| branch amostra 7 (`76a31030c`, fencing do lease) | 1/40 | 1/230 | `engineeringMissionSourceE2E` MISSION_SRC_14 (`reconciled=0`) — **não era flake**: starvation da reconciliação de boot (§9.3-nonies) — 1265,1 s |
| branch amostra 8 (`0e0f33e53`, com os 3 achados da 3ª revisão) | **0/40** | **0/230** | **L0b 100% VERDE** — 1252,4 s |
| branch amostra 9 (`2ce574859`, com os 3 achados da 4ª revisão: drenagem no SQL, `needsRepair`, fencing provado) | **0/40** | **0/234** | **L0b 100% VERDE** — 2144,6 s (2 execuções canônicas consecutivas verdes) |
| branch amostra 10 (`1c83ff229`) | 1/40 | 2/234 | `engineeringMissionDurableResume` §17 + TEST 44 — **flake pré-existente**: a MESMA suíte falha igual na worktree da base `29372d7a3` (1/3). Arquivos do caminho de resume intocados pelo delta (`git diff 29372d7a3..HEAD` ⇒ vazio) |
| branch amostra 11 (`ba23386c3`, HEAD do código) | 1/40 | 1/234 | `engineeringMissionDurableResume` §17 — mesmo flake, agora 1 teste. Todo o resto verde, incluindo os dois suites novos (`MISSION_SRC_15/16`) — 1606,8 s |

`engineeringBugLoop` foi **PASS 58,065 s** (amostra 2), **PASS 28,905 s** (amostra 3, com escopo) e **PASS 26,044 s** (amostra 4, com as correções da revisão);
`engineeringMissionSourceE2E` **PASS 11,992 s** e **PASS 12,160 s**; `engineeringBugLoopNaturalPathE2E`
**PASS 53,332 s**. As TRÊS últimas amostras da branch são **idênticas à base** ⇒ nenhuma falha do L0b
canônico é atribuível a este delta, e as três falhas rotativas da amostra 1 não voltaram depois das
correções.

Nota de escopo do gate: `L0b` é `npx jest tests/integration/engineering --runInBand`
(`scripts/ci/dev-branch-gate.js:181`) — suítes do grupo exclusivo que vivem FORA desse glob (por exemplo
`tests/integration/governanceApprovalFullWorkerE2E.test.js`) não são cobertas por ele; a prova daquele
caminho é a execução isolada (§9.3-bis) somada a `BUG-03d`.

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

### 9.3-quinquies Os dois vermelhos permanentes do L0b: o teste media OUTRO repositório

`engineeringPromotionService` (2 testes) e `engineeringPatchApplyAndTestRunner` (1) falhavam em **toda**
execução dentro de worktree. Investigado até a causa, com reprodução:

```
Expected: "484eee4788e553907e31f7b0528cac9ee41d9298"   ← result.evidence.targetHead (serviço)
Received: "8dbaec15ad154bdbd46efdf19c4bb1eb91012e94"   ← realHead() do teste (worktree)
```

**Causa raiz.** Os serviços operam sobre `ROOT` de `contextBuilderService`, que honra
`ENGINEERING_ROUTER_HOST_REPO_ROOT` (o container do Runner precisa do caminho do HOST) — e o `.env`
aponta para `/opt/results/ria/r-agent2`. Os testes, porém, resolviam "o repositório" por
`path.resolve(__dirname, '..', '..')`, isto é, a worktree. Em checkout único os dois coincidem; em worktree
ligada divergem — e então duas asserções de HEAD se invertiam e o `stdoutRef` era procurado no lugar
errado (o arquivo é escrito sob a raiz do serviço).

**Correção:** os testes passam a medir a MESMA raiz que o serviço usa (`ROOT` importado do módulo que o
serviço consome). Nenhuma asserção foi afrouxada — muda de ONDE se mede, não O QUE se exige. Resultado:
os 3 testes verdes no L0b canônico (amostra 6), 10/10 e 4/4 nas suítes.

### 9.3-sexies Defeito de auditabilidade achado no L0b: o plano apagava a proveniência declarada

A amostra 6 do L0b derrubou `engineeringMissionReviewEnforcement` (ADVERSARIAL_TO_BUG_LOOP) por um
motivo que não era o teste:

```
Expected: "DECLARED_TEST_COMMAND"   Received: undefined
```

**Causa raiz.** A primeira tentativa de reprodução gravava o **plano derivado** no campo `reproduction`
do finding, substituindo o que o finding havia **declarado** (`strategy`, `source`, comando declarado).
Quem chegava como `DECLARED_TEST_COMMAND` deixava de ser auditável como tal — e o gatilho não é o teste:
qualquer tentativa de reprodução, **inclusive de outro processo**, bastava. É perda de proveniência em
produção, não flutuação de teste.

**Correção.** O plano entra POR CIMA do declarado (`{...declarado, ...plano}`), nos três caminhos
(`REPRODUCING`, `NOT_REPRODUCED` do plano `COMMAND` e do plano `INVARIANT`). Regressões permanentes:
`engineeringBugLoop` prova que `strategy`/`source` sobrevivem tanto em `REPRODUCED` quanto em
`NOT_REPRODUCED`.

### 9.3-septies Duas bordas de harness fechadas na Trilha 4

| Borda | Medição | Correção |
|---|---|---|
| ciclo do worker atravessando a fronteira da suíte | `bugWorkerBootFindsRealWorkE2E` parava com `stopWorkers()`, que só limpa o timer — o sweep em voo continuava varrendo a tabela GLOBAL e tomava lease de findings de suítes SEGUINTES (refusões de ~300–500 ms) | passou a usar `stopWorkerAndDrain` (o helper que naturalPath/governanceApproval já usavam): para de agendar **e espera** o ciclo terminar. Suíte PASS 7,5 s |
| orçamento de I/O da suíte de ataques de filesystem | `regularizadorFilesystemAttacks` sobe processos FILHOS e troca symlinks em janelas de tempo; B2 levou **10,404 s** no lote contra timeout global de 10 s, e **316 ms isolado** ⇒ reprovava o L0 sem defeito de lógica | `jest.setTimeout(TIMEOUT_INTEGRATION_IO_MS)` (60 s). Nenhuma asserção alterada; 18/18 PASS |

Nenhuma das duas "esconde" defeito: o orçamento é teto de espera (60 s ainda reprova trave real) e a
drenagem é fail-closed (se o ciclo não drenar, o erro é explícito).

### 9.3-octies Trilha 5 — fencing do lease e autoridade única do ciclo de posse

Os dois itens que a revisão adversarial havia deixado **explicitamente em aberto** (§10.1, "residual"):

| Item | Antes | Depois |
|---|---|---|
| `lease_fence` nas escritas | incrementado na aquisição e **validado por nenhuma escrita**: worker cujo lease expirou e foi tomado por outro **continuava gravando** | o fence corrente entra no **mesmo `UPDATE`** da transição (predicado atômico, sem TOCTOU entre checar e gravar): fence velho ⇒ 0 linhas ⇒ `FINDING_LEASE_LOST` nomeado, estado intocado |
| Duas implementações do ciclo (adquirir → heartbeat → liberar → fence) | `withFindingLeaseOwned` (serviços) e `withFindingLease` (varredura) com semântica divergente; a segunda não tinha nem o vínculo `lease.findingId` | a varredura **delega** a `withFindingLeaseOwned`, preservando o contrato (sem identidade ⇒ sem posse, explícito). Uma definição só |

Threading do lease: `confirmFinding` (transições `REPRODUCING` e `CONFIRMED`), `markReproducing` e
`markNotReproduced` passam a declarar posse na escrita. **Provas novas:** escrita com fence velho
recusada **e** controle positivo com o fence corrente; varredura com identidade declarando posse de
fato (recusa de um segundo worker) e lease liberado ao fim do ciclo. Medido: `engineeringBugLoop`
**34/34**, review enforcement 7/7, autonomousLoop 3/3, **naturalPath E2E PASS 77,9 s**, unit
`engineeringMission`+`bugFindingEngine` **499/499**.

### 9.3-nonies Terceira revisão adversarial — 3 achados fechados e o L0b 100% verde

Revisor independente sobre `114e0cd7b..HEAD`. Veredito **PASS com 3 lacunas P2** — todas fechadas:

| # | Sev real | Achado | Reprodução | Tratamento |
|---|---|---|---|---|
| 1 | **P1** (descoberto investigando) | **reconciliação de boot com starvation**: `BLOCKED_REQUIRES_REPAIR` nunca era persistido, então o intent voltava ao scan em TODO boot sem sair de `PREPARED/GIT_APPLIED/DB_APPLIED` | medido no L0b: `missions=138, reconciled=0, pending=209` e o intent recém-crashado (o do teste) **nem alcançado** | persistir `RECOVERY_REQUIRED` (o desfecho se chama "requer reparo"), scan automático separado do estado de reparo, ordem FIFO e drenagem em lotes com `pending` devolvido. Depois: `missions=209, reconciled=1, pending=0` |
| 2 | P2 | fencing era **opt-in**: `FIXED`/`REGRESSION_VALIDATED`/`CLOSED`/`BLOCKED`/`DUPLICATE` e `persistAttempt` escreviam sob posse sem declarar fence; `executarFixLoop` recebia `findingLease` e nunca o usava | probe do revisor: transição sob lease alheio **aceita** (`write: ACCEPTED`) | lease propagado por todo o fix loop e pelos retornos a `SUSPECTED`; `persistAttempt` com predicado de fence |
| 3 | P2 | erro de posse virava **500**: `FINDING_LEASE_LOST`/`MISMATCH`/`STATE_CONFLICT` fora do mapa de `handleError` | `grep` no mapa + contrato incoerente (skip=409, perda=500) | 409 para os três, com 4 casos de teste no boundary |

**O revisor também provou por mutação que DOIS dos meus testes eram vacuosos** — e isso vale mais que
o achado em si: (a) o caso `REPRODUZIDO` já reespalhava o `reproduction` declarado em `confirmFinding`,
então passaria sem a correção; (b) as asserções de efeito da delegação do lease passavam com a
implementação antiga. Ambos substituídos por provas **verificadas por mutação**:

| Prova nova | Mutação que a derruba (executada) |
|---|---|
| `INCONCLUSIVO preserva strategy/source` (caminho que PERDIA a proveniência) | `markReproducing` sem merge ⇒ **FAIL** (`Expected: DECLARED_TEST_COMMAND, Received: undefined`) |
| `delegação única` com espião em `withFindingLeaseOwned` | cópia local do ciclo restaurada ⇒ **FAIL** |

**L0b canônico no HEAD `0e0f33e53`: 40/40 suítes, 230/230 testes, exit 0, 1252 s** — primeira execução
100% verde da série, e verde porque as duas causas restantes foram corrigidas na raiz (proveniência e
starvation), não reclassificadas.

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
| `engineeringBugLoop.test.js` (suíte inteira) | 62,4 s · 63,4 s (58,1 s no L0b) | **26,0 s** (28,9 s no L0b) |
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

### 10.1 Segunda revisão adversarial — delta de posse por lease e escopo da varredura

Revisor distinto (`code-review`, contexto próprio) sobre `api/services/engineeringMission/*` e os testes
do laço de bug. **Veredito do revisor: FAIL**, com 4 achados — todos tratados nesta mesma missão:

| # | Sev | Achado | Evidência do revisor | Tratamento |
|---|---|---|---|---|
| 1 | **P1** | finding INEXISTENTE passou a responder "posse de outro worker" (409 no `/confirm`, 200 `SKIPPED_LEASE_HELD` no `/reproduce` e no `/fix`, com `lease.worker: null`) — o `not_found`/404 sumiu dos três caminhos | probe real contra o Postgres: `confirm`, `reproduce` e `runFixLoop` com id aleatório devolveram recusa de posse | `acquireFindingLease` distingue ausência de disputa (`current === null` ⇒ `not_found`), no único ponto onde o UPDATE casa 0 linhas; regressão nova "finding inexistente é NOT_FOUND nos três caminhos" |
| 2 | P2 | `handleAnomaly` desreferenciava `reproduction.finding`, que o delta passou a poder devolver `null` ⇒ `TypeError`; e lease aceito sem vínculo com o finding (lease de OUTRO finding rodava a operação sem posse) | recusa injetada ⇒ `CRASH: TypeError: Cannot read properties of null (reading 'status')` | guarda explícita de recusa (`skipped`/`outcome`, sem tocar em `finding`); `withFindingLeaseOwned` valida `lease.findingId` (`FINDING_LEASE_MISMATCH`); o param `findingLease` de `handleAnomaly` foi REMOVIDO (era inútil por construção: o finding é novo); 2 testes novos |
| 3 | P2 | `findingIds: []` (ou tipo inválido) caía na varredura GLOBAL — fail-open | `listFindings({ ids: [] })` ⇒ 3 linhas (sem filtro) numa tabela de 21 | `null`/`undefined` = global explícito; `[]` ⇒ `summary` vazio, nada escaneado; tipo inválido ⇒ `INVALID_SWEEP_SCOPE`; teste cobre as três |
| 4 | P2 | escopo explícito truncado por `limit` (default 10/50, teto 200) — "escopo parcial silencioso" | `listFindings({ ids: [3], limit: 1 })` ⇒ 1 linha | com `ids`, o limite é o tamanho do escopo (sem truncamento); teste com `limit: 1` e 3 ids |

O revisor também **confirmou**: nenhuma posse vazada (`finally` + `unref`), nenhuma dupla aquisição,
`REPRODUCING` órfão tem saída (lease expira e `MAX_INCONCLUSIVE_REPRODUCTIONS` vira `BLOCKED`), testes
BUG-03b/c/d **não são vacuosos** e os consumidores (`startWorkers`, `bugLoopWorker`, rotas) seguem
compatíveis. Confirmação parcial de premissa que fica registrada: existem DUAS implementações do ciclo de
lease (`withFindingLeaseOwned` nos serviços e `withFindingLease` na varredura), e a varredura disparada por
HTTP não detém posse quando não recebe `workerInstanceId` — comportamento pré-existente, agora explicitado
em §11 (risco residual), não corrigido aqui.

---

## 11. RISCOS RESIDUAIS E BLOQUEIOS EXTERNOS

| Item | Estado |
|---|---|
| 68 testes obrigatórios | **BLOCKED** — `test:release-authoritative` recusa com P0/P1 histórico aberto; exige `RAP_CLOSURE_INVENTORY_SHA256` do canal externo e provas de fechamento humanas |
| Envelope de auditoria V2 | **PENDING** — selar envelope sobre estado incompleto seria greenwashing; não gerado |
| `modelDrivenE2e` | **ENVIRONMENT** — depende do artefato do job `prod-like-smoke` |
| Padrões destrutivos residuais | 5 identificados (1 crítico), **inventariados e classificados**; correção de cada sítio é trabalho de outra ordem |
| Cache de módulos no benchmark | ruído de cache quente medido e declarado (3 pares) |
| `engineeringBugLoop` sob carga | **BUG-03 = defeito real corrigido** (§9.3-bis: 4 correções + provas BUG-03b/c/d) e **BUG-02 = custo O(estado global) corrigido na raiz** (§9.3-quater: escopo `findingIds`, 53,8 s → 15,6 s no teste; suíte 62,4 s → 26,0 s; L0b 58,1 s → 28,9 s) |
| `engineeringMissionDurableResume` (§17/TEST 44) | **`blocked` registrado na fila** (`TESTE-DURABLE-RESUME-FLAKE-POR-BANCO-COMPARTILHADO`), com `blocked_reason` escrito: corrigir exige **banco isolado por suíte**, decisão de infraestrutura. Não afrouxei a asserção (`SKIPPED_LOCKED`) porque isso reduziria a sensibilidade sem provar nada melhor. **flake PRÉ-EXISTENTE, medido nas duas árvores.** Atribuição feita por comparação real, não por argumento: rodando a MESMA suíte na worktree da **base `29372d7a3`** (sem nenhuma mudança minha) ela falha do mesmo jeito — **1 de 3 execuções, exatamente §17 e TEST 44**. No meu HEAD: 5 de 7 isoladas PASS, 2 de 2 lotes falharam. Causa operacional identificada: o `api/server.js` VIVO (8 dias) roda `startRecoveryLoop` a cada 5 min + `runBootRecovery` no boot contra o **MESMO Postgres** e retoma missões que o teste está montando. Não corrigido: exige banco isolado por execução, não é código deste PR |
| `engineeringMissionSourceE2E` MISSION_SRC_14 | **CORRIGIDO na raiz** (§9.3-nonies): não era corrida — o desfecho `BLOCKED_REQUIRES_REPAIR` não persistia estado e o intent do teste nunca era alcançado. Amostra 8 = verde. Registro histórico: **NÃO corrigido** e **não** declarado corrigido: corrida pela reconciliação dos pending intents do mesmo banco. Não recorreu nas amostras 2–6 do L0b; permanece `INCONCLUSIVO/SOB CARGA` |
| `engineeringBugLoop` PROTECTED_GOVERNANCE_BASELINE | **flake sob carga LOCAL, não observado em CI**: o `L0` do PR passou **5 de 5 vezes** com o L0b dentro (o flake aparece nesta máquina, com banco e sessões concorrentes). Diagnóstico em aberto com rastro (`logger.warn` nomeia o worker dono do lease) : falhou 1× na amostra 6 (`fixed:false` em 559 ms) e passou em **14 execuções isoladas consecutivas** do arquivo (32/32). Taxa medida: 2 falhas em ~6 execuções do L0b, 0 em 14 isoladas. A recusa agora **deixa rastro** (`logger.warn` com finding/worker/expiração) — antes era indistinguível de "fix rodou e não convergiu" |
| L0b canônico branch vs base | as duas falhas da base foram **corrigidas na raiz** (§9.3-quinquies): os testes mediam outro repositório. Amostra 6: só resta 1 flake sob carga |
| Ciclo de lease | **FECHADO na Trilha 5** (§9.3-octies): autoridade única (`withFindingLeaseOwned`) e a varredura delega. Nota de contrato mantida: varredura disparada por `POST` sem `workerInstanceId` roda **sem posse**, por decisão explícita |
| `lease_fence` | **FECHADO na Trilha 5** (§9.3-octies): o fence entra no CAS de toda transição que declara posse; escrita de posse perdida ⇒ `FINDING_LEASE_LOST` |

---

## 11.1 CI em runner LIMPO (PR #20) — execução real, não máquina de desenvolvimento

O que a máquina local não prova, o runner efêmero prova: **merge commit `8652f1554`**, run `40305840368`.

| Job | Resultado | Tempo |
|---|---|---|
| L0 (Jest oficial) + L1 (gates de governança) | **SUCCESS** | 18m02s |
| Integração real do Engenheiro (Postgres + sandbox) | **SUCCESS** | 12m19s |
| Smoke prod-like real (artefato GO consumido pelo L0) | **SUCCESS** | 17m28s |

Evidência do gate (`reports/dev-branch-ci-evidence.json`, artefato baixado): `veredito=PASS_PARCIAL`,
`equivalenteAValidacaoCompleta=false`, `fasesFaltantes=[R,E,F]`, `fasesNaoAprovadas=[]`, 10 passos,
**0 falhas** — `L0-suite-oficial` exit 0, **`L0b-integracao-engenheiro` exit 0**, `L1-release-dag`/
`fila-oficial`/`ai-memory`/`aderencia-agente` exit 0. `PASS_PARCIAL` não é convertido em PASS completo.

**Dois quebradores de AMBIENTE encontrados e fechados no caminho** (nenhum era deste delta; os runs de
2026-10-25 no mesmo branch eram verdes): o rótulo `ubuntu-latest` passou a resolver para
**ubuntu-26.04** e (a) `npx playwright install --with-deps chromium` morre com *"Playwright does not
support chromium on ubuntu26.04-x64"*; (b) o systemd do 26.04 mudou a REDAÇÃO do diagnóstico
(*"Unknown key 'X' in section [Unit]"*) e `devServicesSupervision` — que exige a mensagem antiga para
provar que a verificação não é vacuosa — falha. Correção: imagem de runner FIXA em `ubuntu-24.04` nos
três jobs, com a medição escrita no workflow; nenhuma asserção foi afrouxada para passar.

### 11.2 Política de imagem de runner — 7 workflows, 13 jobs (rollover do `ubuntu-latest`)

O rollover `ubuntu-latest` → **ubuntu-26.04** não é um problema do `dev-branch-ci`: era do repositório
inteiro. Levantamento e correção na mesma rodada:

| Workflow | Jobs pinados | Por quê |
|---|---|---|
| `dev-branch-ci.yml` | 3 | medido: Playwright sem suporte a 26.04 + redação do systemd |
| `e2e.yml` | 1 | instala Playwright 2× |
| `wave-reports.yml` | 1 | instala Playwright e roda por **cron (domingo 03:17 UTC)** — falharia sem ninguém olhar, degradando as waves para STALE no coverage gate |
| `jest.yml` | 2 | ambiente do runner (systemd/glibc) |
| `frontend.yml` · `rag.yml` | 1 + 1 | idem |
| `release-governance.yml` | 4 | idem — e é o workflow que protege publicação |

**Enforcement durável:** `tests/unit/ci/workflowRunnerImage.test.js` reprova qualquer `runs-on: *-latest`
ou imagem fora da lista suportada. Provado **não vacuoso**: revertendo um único pin
(`wave-reports.yml`) três testes falham listando `wave-reports.yml: runs-on: ubuntu-latest`; restaurado
em seguida. E o guarda roda **dentro do L0**: no run `40352055519`, o log do `L0-suite-oficial` contém
`PASS tests/unit/ci/workflowRunnerImage.test.js`. Vive em `tests/unit/` de propósito — `tests/ci/` só é
executado por `npm run test:system`, que o gate de branch não roda.

Nota de escopo: `e2e`, `frontend`, `jest`, `rag` e `release-governance` só disparam em `main`/`develop`,
portanto **não** são exercitados por PR para `dev/engineering-hardening`; a garantia deles é o guarda
executado no L0, não uma execução real neste PR.

---

### 11.2-bis Quinta revisão adversarial — o flip de estado da missão tinha raio de dano medido

| # | Sev | Achado | Evidência do revisor | Tratamento |
|---|---|---|---|---|
| 1 | P2 | o flip `mission_source_state='RECOVERY_REQUIRED'` que eu havia adicionado tem **raio de dano**: a classificação usa o repositório DESTE processo, então num boot cujo repo não enxerga as refs de missão (clone novo, deploy sem as branches, repo sintético) **toda** missão com intent não-terminal seria marcada como "requer reparo" — sem caminho de volta | probe: missão alheia `READY → RECOVERY_REQUIRED` numa base compartilhada; e o `afterAll` não reverte | flip **REVERTIDO**. A dívida continua visível pelo agregado `needsRepair` — global, sem tocar estado individual. Motivo registrado no próprio código |
| 2 | P2 | `ENG-DIVIDA-REPARO-SEM-SINAL` citava como `regressionTest` um arquivo que **nunca** chama `reconcilePendingIntents`, e nenhum teste mencionava `needsRepair`: o "sinal" estava sem cobertura | `grep -rn needsRepair tests/` ⇒ 0 | cobertura em `MISSION_SRC_16`: `needsRepair >= 1`, `pending` numérico e caso de **teto** (`pending >= 1` com `maxLotes` menor que a fila) |
| 3 | P2 | a evidência de `ENG-REPARO-NAO-VISIVEL-NA-MISSAO` citava mensagem de mutação de outra asserção, e o teste chamava a varredura **GLOBAL** contra um repo sintético (classifica o banco inteiro) | mutação do revisor: `Expected RECOVERY_REQUIRED / Received READY` (missão), não `PREPARED` | `MISSION_SRC_15` passou a usar reconciliação **por missão**; a prova do scan global ficou em `MISSION_SRC_16` **com o serviço por missão dublado** (sem efeito colateral). Textos da fila corrigidos |

**Mutações executadas para provar as asserções novas** (todas derrubam o teste, e foram revertidas):

| Mutação | Resultado |
|---|---|
| A — `if` sem `BLOCKED_REQUIRES_REPAIR` | `MISSION_SRC_15` **FAIL** — `Expected "RECOVERY_REQUIRED" / Received "PREPARED"` |
| B — `RECOVERY_REQUIRED` de volta ao scan automático | `MISSION_SRC_16` **FAIL** — `visitadas` inclui a missão que exige reparo |
| C — `needsRepair` fixo em `0` | `MISSION_SRC_16` **FAIL** — `Expected >= 1 / Received 0` |

Um ponto de honestidade sobre o processo, porque a revisão o expôs: eu havia declarado o flip como
melhoria de observabilidade e ele era, na prática, **aumento de raio de dano**. A revisão adversarial
não serviu para "confirmar" o trabalho — serviu para reverter uma decisão minha.

---

## 11.3 Varredura de validadores executáveis no HEAD `5992186ec`

Executados um a um (exit code real), porque "o agregado passa" não é afirmação que se faça de memória:

| Validador | Exit | Resultado |
|---|---|---|
| `validate:route-mounts` | 0 | PASS — 63 declarados, 63 montados |
| `validate:release-dag` | 0 | PASS — 29 nós, 25 artefatos, 0 ciclos |
| `validate:layer-conventions` | 0 | 0 criticals, 0 errors (o `engine/` foi zerado em ciclos anteriores) |
| `validate:timeout-architecture` | 0 | GREEN |
| `validate:state-sync` | 0 | PASS — 22 arquivos, 24 ocorrências, 0 violações |
| `validate:stack-versions` | 0 | PASS — menu, rota e handler de versão presentes |
| `validate:ai-memory` | 0 | PASS |
| `validate:worktree-integrity` | 0 | PASS |
| `validate:hardening-queue` | 0 | PASS — 6 abertos, todos `blocked_external` |
| `validate:engineering-router-v1` | 0 | PASS — 183 checks, 0 falhas |
| `validate:anti-greenwashing` | 0 | **PASS — 91 suítes, 0 violações** (nenhum teste meu é `.skip`/`.only`) |
| `validate:model-field-contracts` | 0 | PASS |
| `validate:invariants` | 0 | PASS |
| `validate:runtime` | **1** | FAIL em `/channel-health` (6 requisições de rede falharam) — **NÃO atribuível a este delta**: o app medido em `127.0.0.1:5173` é servido por `vite` a partir do **outro checkout** (`/opt/results/ria/r-agent2/frontend`, commit `484eee478`), não desta worktree. Registrado como estado da instância viva, não como regressão do PR |
| `validate:required-tests` | **1** | `V2-01..` NÃO provados — mesma cascata do bloqueio externo (§7.1): sem `release-suite-execution.json` nada é "provado" |
| `validate:ai-memory-consistency` · `operational-rules` · `cleanup` · `coverage-completeness` · `experience-segregation` · `visibility-policy` · `experience-api-segregation` | 0 | PASS |
| `validate:final-status-projection` | **1** | `canonical_unreadable:missing:governance/rap-master-scorecard.json` — artefato de **run governado**, que não existe neste worktree por construção (é gerado pelo selo). Mesmo bloqueio externo |
| `validate:governance-summary` | **1** | Agrega `runtimeValidation=FAIL` (a validação do app do OUTRO checkout) e `coverageGate=NO_GO` (artefatos de wave/run) — nenhum medido sobre este delta |
| `validate:bug-closure-status` | **1** | `FECHAMENTO_NAO_PROVADO` — 142 defeitos **históricos** (P0-1..P1-17, H9..H20, DEF-…) declaram fechamento sem prova válida; `authoritative=false`. **Nenhum item deste delta está na lista** (verificado: zero ids `ENG-*`) e é exatamente a dívida P0/P1 histórica que faz o `test:release-authoritative` recusar iniciar |

Nenhum validador falhou por causa deste delta. Os três vermelhos são: um medindo OUTRO checkout, e dois
declarando a mesma dívida histórica que o §7.1 já registra como bloqueio externo.

---

## 11.4 O plano de selagem: medido, e ele NÃO pode começar hoje (4 bloqueios verificados)

`npm run release:seal:plan` foi executado. Ele é **read-only** por desenho (`--dry-run` pula só o guard
de elegibilidade; as fases não rodam). Resultado e o que cada bloqueio significa — tudo medido, nada
inferido:

| # | Bloqueio | Medição | Quem resolve |
|---|---|---|---|
| 1 | **branch errada** | `✗ branch atual é 'codex/engineering-router-hardening-20261025' (esperado main)` — `seal-release.sh:159` exige `main` | decisão humana: merge do PR #20 |
| 2 | **`main` está ATRÁS do hardening** | `origin/main = 04cad9c1b`; `origin/dev/engineering-hardening = e306b6a10`. `04cad9c1b` **é ancestral** de dev, então selar em `main` hoje selaria **código anterior a este hardening** | decisão humana: promover dev→main (ou autorizar a selagem sobre o ref que se quer certificar) |
| 3 | **`dist/` sem payload** | `dist/release/*.payload.zip` ausente ⇒ a fase `prepare` (converge) é obrigatória, e o scorecard passa a contar RAP-052/RAP-054 como falha real (é o efeito de amplificação que já custou um ciclo) | pipeline (fase `prepare`), depois da autorização |
| 4 | **guard de fechamento RECUSA** | `exigir_elegibilidade SELO_FINAL` ⇒ `RECUSADO (exit 1): existem defeitos abertos que bloqueiam esta operação`. Ações exigidas pelo próprio guard: **`RAP_CLOSURE_INVENTORY_SHA256` do canal externo** + prova de fechamento válida por defeito (ou reabrir) | **operador/CI externo** — não é código |

Conclusão factual: **`RELEASE_CERTIFICATION = NO_GO` não é uma escolha minha nem um defeito do PR** — é o
resultado de uma guarda que recusa começar, com razão escrita, e de uma pré-condição que vem de fora da
árvore. Nenhum desses quatro itens se resolve dentro do código deste PR.

---

## 11.5 O merge aconteceu, e o branch atualizado foi revalidado (não presumido)

PR #20 mergeado com autorização explícita do usuário: **`dev/engineering-hardening = 53f7056d0`**
(*Merge pull request #20*). O merge foi limpo — `git diff origin/dev/engineering-hardening
codex/...` ⇒ **vazio** (nenhum conteúdo do branch se perdeu ou foi reescrito).

**CI do push no branch de destino: `success`** (run do commit `53f7056d0`, não do PR — é o gate do ref
final).

Revalidação feita em worktree **novo, destacado no merge commit** (não no worktree de
desenvolvimento, para não herdar artefato local):

| Verificação | Comando | Resultado |
|---|---|---|
| Artefatos canônicos | `npm run ci:artifacts` | exit 0 — `artefatos-obrigatorios veredito=PASS` |
| **L0b canônico** | `npx jest tests/integration/engineering --runInBand` | **40/40 suítes · 234/234 testes · exit 0** · 2030 s |
| Fila oficial | `validate:hardening-queue` | PASS |
| Rotas montadas | `validate:route-mounts` | PASS — 63/63 |
| DAG do release | `validate:release-dag` | PASS |
| Convenções de camada | `validate:layer-conventions` | exit 0 |
| Anti-greenwashing | `validate:anti-greenwashing` | **PASS — 91 suítes, 0 violações** |
| Engineering Router V1 | `validate:engineering-router-v1` | PASS — 183 checks |
| `ai-memory` · `state-sync` | idem | PASS |
| **Arquitetura de timeout** | `verify:timeout-architecture-e2e` + `validate:timeout-architecture` | **GREEN** (o gate pai só vira verde com a evidência de runtime gerada: sem ela fica `PENDING` — comportamento correto, não afrouxado) |
| Recuperação de task real | `validate:recovery` | PASS |
| `BUG_AUTONOMOUS_LOOP` | `validate:bug-autonomous-loop` | NO_GO — mesma cascata do bloqueio externo (§7.1-bis) |
| `required-tests` | `validate:required-tests` | NO_GO — `V2-01..` não provados, mesma cascata |

Nada foi "declarado verde": o que ficou vermelho ficou vermelho, e os dois vermelhos são o bloqueio
externo já documentado. O que mudou de fato: **o código deste hardening está em
`dev/engineering-hardening` e o gate do branch de desenvolvimento passou nele.**

---

## 11.6 Correção de uma medição minha: o commit `9a70ee2b2` NÃO estava "não publicado"

Na primeira versão do §11.4 eu escrevi que `main` local divergia do remoto por *"1 commit não publicado"*
(`9a70ee2b2`, converge do ciclo de selagem SEAL_PENDING) e que isso seria um bloqueio de proveniência.
**Estava errado, e a medição de ancestry mostra o contrário:**

```
git merge-base --is-ancestor 9a70ee2b2 origin/main                        ⇒ NÃO é ancestral
git merge-base --is-ancestor 9a70ee2b2 origin/dev/engineering-hardening   ⇒ É ancestral
git merge-base --is-ancestor 04cad9c1b origin/dev/engineering-hardening   ⇒ É ancestral
```

Ou seja: o commit **existe no remoto** (é ancestral de `origin/dev/engineering-hardening` e de mais 9
branches). Não há nada a "publicar ou descartar" — `validate:remote-provenance` já estaria satisfeito
quanto a ele. O bloqueio real é outro e mais simples: **`origin/main` está atrás do hardening**, então
selar em `main` certificaria código ANTERIOR a este trabalho.

Corrigi a linha do §11.4 em vez de deixar a versão errada no relatório: uma medição que eu não refiz
teria virado recomendação de operador ("publique ou descarte um commit") sobre um fato que não existe.
O `9a70ee2b2` fica onde está: é conteúdo já integrado ao dev, sem ação pendente.

---

## 11.7 O CI do `main` (`jest.yml`): cinco lacunas de AMBIENTE medidas e fechadas, uma residual declarada

O §11.1 mediu o CI em runner limpo pelo `dev-branch-ci`. Este bloco fecha o outro lado: o `jest.yml`,
que é o único workflow que roda em `main`/`develop` e que estava vermelho desde 2026-10-20. A diferença
importante: **nenhuma das falhas era de código**. Cada rodada revelou uma peça de ambiente ausente, e
cada peça foi fechada com o produtor canônico que o `dev-branch-ci` já usa — sem tocar em asserção.

### 11.7.1 A progressão medida (rodada a rodada, mesma suíte `npm test`)

| rodada | commit | o que foi adicionado | suítes | testes | falha restante |
|---|---|---|---|---|---|
| 40726692268 | `3d283cf0d` | `fetch-depth: 0` | 47 | 1460 (9 ✕) | `benchmarkChangeProposal`: `Não foi possível conectar ao PostgreSQL` |
| 40728206519 | `79ee59add` | serviços `postgres`+`redis` | 3 | 86 (17 ✕) | `mcpDiscoveryReal`: `relation "mcp_connections" does not exist` |
| 40729073198 | `e698bdf7d` | `db:migrate` | 106 | 2598 (1 ✕) | `ENOENT reports/benchmark-sufficiency-report.json` (2 suítes) |
| 40730595851 | `e7592acda` | `ci:artifacts` | 208 | 3940 (8 ✕) | `engineeringRouterExecutionSandboxSecurity`: `docker run` exit **125** |
| 40734125941 | `2d5803e0d` | build da imagem do sandbox | 328 | 5385 (1 ✕) | `modelDrivenE2e` |
| 40735242329 | `d74d5826b` | **sonda `--bail=0`** (medição, branch descartável) | **1121** | **9785 (10 ✕)** | 4 suítes, ver 11.7.2 |
| 40737265748 | `251a11a20` | `ci:bootstrap` + identidade git | 328 | 5385 (1 ✕) | **só** `modelDrivenE2e` |

A sonda `--bail=0` existiu porque `jest.config.cjs` tem `bail: 1`: sem ela, cada rodada parava na
primeira suíte vermelha e o número publicado seria sempre "1 suíte" — um número que esconde o tamanho
do problema. Com ela, o estado real de uma suíte de 1121 arquivos ficou visível de uma vez.

### 11.7.2 As quatro suítes vermelhas na sonda, e o que cada uma era

| suíte | testes | causa medida | fechada por |
|---|---|---|---|
| `governance/modelDrivenE2e` | 1 | exige `qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json` | **não** — artefato de outro job (11.7.3) |
| `engineeringRouter/workspaceStateSeeding` | 3 | `.env` e `api/data/config.json` não existem num checkout limpo | `npm run ci:bootstrap` |
| `engineeringRouterSafeEnvironment` | 3 | sandbox devolvia `exitCode: null` (mesma ausência de estado) | `npm run ci:bootstrap` |
| `governance/releaseTagPolicyBlock` | 3 | `git commit` nos cenários saía **128** (sem `user.name`/`user.email`) | identidade git |

Nenhuma delas foi "consertada" no teste. O que mudou foi o ambiente onde o teste roda — e a prova é que
depois do `ci:bootstrap` + identidade git, a mesma suíte fecha **327/328 com uma única falha**, a de
artefato.

### 11.7.3 A residual: `modelDrivenE2e` depende de um artefato que só outro job produz

O teste roda `validate-model-driven-e2e` e exige um smoke prod-like real (`status=GO`). Esse artefato é
produzido pelo job `prod-like-smoke` do `dev-branch-ci` e baixado pelo `dev-branch-gate`
(`dev-branch-ci.yml:139-146`) exatamente para não reprovar por ausência. O `jest.yml` não tem esse job,
então **em `main` esse teste não pode passar por construção** — e continuará assim até que uma de duas
decisões seja tomada:

1. **Extrair `prod-like-smoke` para um workflow reutilizável** (`workflow_call`) e chamá-lo nos dois
   workflows — uma definição só, dois consumidores. É a opção que mantém o gate medindo o mesmo em todo
   lugar; custo real: todo push em `main` passa a subir a stack prod-like (~90 min).
2. **Aposentar o `jest.yml`** como gate de `main` e deixar a validação canônica no `dev-branch-ci`, já
   que a promoção `dev → main` é fast-forward de commits que aquele gate já aprovou.

Isso é decisão de dono do repositório, não de agente: as duas opções mudam QUAIS gates rodam em `main`.
Não escolhi por conta própria e não mascarei o vermelho.

### 11.7.4 O `jest-integration` nunca chegou a medir nada

Em três rodadas consecutivas (`40729073198`, `40730595851`, `40734125941`) o job terminou `cancelled` em
**15m17s / 15m18s / 15m16s** — exatamente o `timeout-minutes: 15` — **sem publicar um único `Tests:`**.
Um gate que morre antes do veredito não é um gate vermelho: é um gate que não existe. O timeout foi para
**90 min** (o `dev-branch-ci` usa 45 min só para o subconjunto `engineering`, que mede 2030 s aqui) e o
job recebeu os mesmos pré-requisitos de ambiente. Se ainda não couber, o próximo passo é `jest --shard`,
não voltar a um timeout que estrangula.

### 11.7.5 O que já estava verde, e continua verde: o gate canônico

Enquanto o `jest.yml` era destrinchado, o gate canônico rodava nos mesmos commits e passava:

```
40729083196  e698bdf7d  dev-branch-ci  success   (prod-like-smoke, L0+L1, integração real)
40730607495  e7592acda  dev-branch-ci  success
40734136725  2d5803e0d  dev-branch-ci  success
```

Ou seja: o vermelho que estava sendo investigado era do **workflow-sombra** de `main`, não do trabalho de
hardening. Corrigir o sombra importa porque é ele que decide o CI de `main` — mas a conclusão sobre o
código não mudou por causa dele.

---

### 11.7.6 Segunda metade: o `jest-integration` também não media nada, e agora quase mede

O mesmo tratamento foi aplicado ao job de integração. Ele morria em 15m16s–15m18s (`timeout-minutes: 15`)
**sem publicar um único `Tests:`**. Com timeout de 90 min, o job passou a produzir veredito — e o
veredito mostrou o que o timeout escondia.

| rodada | commit | o que foi adicionado | resultado |
|---|---|---|---|
| 40737265748 | `251a11a20` | timeout 90 min + ambiente do job `jest` | 18m16s · 82 suítes · 5 suítes ✕ / 26 testes ✕ |
| 40741496599 | `6b1e9e4de` | lotes canônicos (manifesto) + `crm_p0_test` | 26m · **2 suítes ✕ / 2 testes ✕** |
| 40746356670 | `c0fddb6fe` | exclusiva sozinha no lote + ref `main` local | 27m · 2 suítes ✕ / 2 testes ✕ |
| 40752124806 | `5e1ff762d` | serviço RAG real em `127.0.0.1:8001` | 24m · 2 suítes ✕ / 2 testes ✕ |

O lote canônico sozinho fechou três das cinco famílias: `bugWorkerBootFindsRealWorkE2E` (worker global
não drenava com outra suíte no mesmo lote), a matriz de isolamento de tenant (**22 testes**, exigia
`CRM_PG_TEST_URL`) e `ticketLifecycleHandoverWhatsapp` (timeout de 10 s sob contenção).

### 11.7.7 As duas suítes que restam: medição completa do que NÃO é a causa

Sobram `missionSourceStaleReplanFullRouterE2E` e `governanceApprovalFullWorkerE2E`. Cada hipótese foi
testada por medição, não por argumento:

| hipótese | teste | veredito |
|---|---|---|
| contenção entre suítes | rodar cada uma SOZINHA no lote (29 lotes) | **não é a causa** — falham igual |
| ref `main` ausente | `git branch -f main origin/main` no job | **não é a causa** — o erro mudou de `ambiguous argument 'main'` para `status=BLOCKED` |
| serviço RAG ausente | subir a imagem oficial em `:8001` (log: `RAG pronto … try 2`) | **não é a causa** — falham igual |
| ambiente do runner | reprodução local com `npm run ci:bootstrap` (mesmo `.env`, 43 chaves) e `main = origin/main` | **passam localmente** (98 s e 94 s) |
| versão de Node | container `node:20.20.2` (mesmo `.env`, identidade git, socket do Docker) | **inconclusivo por artefato do experimento**: o container falhou antes, com `BLOCKED_INFRA / SANDBOX_INVALID_WORKSPACE` (o `docker run -v` do sandbox resolve caminhos do HOST, e o workspace em `/tmp` do container não existe no host) — falha DIFERENTE da do CI, que não tem `SANDBOX_INVALID_WORKSPACE` |

Fato medido que continua sem explicação: no runner as duas terminam em **~3 s** com `BLOCKED` e **nenhuma
chamada de provider** no log; localmente levam **78–98 s** e executam o pipeline inteiro. O experimento com
Node 20 NÃO reproduziu isso (reproduziu outro defeito, do próprio experimento), então a hipótese de versão de
runtime fica **não confirmada** — o registro correto é "causa desconhecida", não "é o Node". Nenhuma das duas
pertence ao gate canônico (`tests/integration/engineering` não as alcança) — elas são do manifesto de
release (`config/canonical-release-suites.json`), executado pelo runner de suítes, não pelo CI.

### 11.7.8 O que o `main` mede hoje, em número

```
job `jest`            → 327/328 suítes PASS; 5385 testes; ÚNICA falha: modelDrivenE2e (artefato prod-like)
job `jest-integration`→ 80/82 suítes PASS; 2 suítes ✕ (investigação aberta, hipótese Node 20)
gate canônico (dev)   → PASS 3/3 jobs nos últimos commits do branch
```

Antes desta campanha: **0 suítes medidas** em `main` e um gate de integração que jamais chegava ao
veredito. Isso é o que mudou — e o que ainda não mudou está nomeado acima, não escondido.

---

### 11.7.9 Pista medida para as duas suítes: o coder não é selecionado

O `governanceApprovalFullWorkerE2E` imprime um diagnóstico próprio quando `closed` é nulo, e no runner ele
saiu com a causa explícita:

```
"fixTask": { "status": "BLOCKED",
  "routing_decision": { "coder": { "selected": null, "reasonCodes": ["NO_QUALIFIED_CANDIDATE"],
                                   "qualifiedCandidates": [] } } }
```

`NO_QUALIFIED_CANDIDATE` vem de `engine/engineeringRouter/modelSelector.js:144` — a lista de candidatos
QUALIFICADOS ficou vazia. O produtor dessa lista é
`engineeringModelAvailabilityService.buildAvailableModels`, que combina a allowlist estática
(`modelCapabilities.js`) com `getRuntimeProviders()`, `getCredentialDetailsMap(tenantId)` e
`providerModelDiscoveryCache`. As suítes salvam credenciais FAKE para os providers candidatos; se
`getCredentialDetailsMap` não devolver essas credenciais no ambiente do runner, **nenhum** modelo fica
disponível e a task é BLOCKED antes de qualquer chamada de provider — exatamente os ~3 s observados.

Isso é uma **pista com endereço**, não uma conclusão: falta medir `getCredentialDetailsMap` no runner. Não
declarei causa porque não medi — e a hipótese anterior (Node 20) foi descartada por experimento, não por
opinião.

---

## 11.8 Defeito P1 PROVADO e corrigido: credencial do ESCOPO do Router × credencial do tenant do teste

### 11.8.1 A causa que sobreviveu a todas as hipóteses anteriores

As duas suítes residuais passavam na máquina de desenvolvimento e falhavam no runner em ~3 s com
`BLOCKED`. As hipóteses de contenção, ref `main`, RAG e Node 20 foram testadas e descartadas (§11.7.7).

O experimento decisivo foi criar uma base **limpa** (`rap_ci_sim`, só migrations) e rodar a suíte contra ela:

```
base limpa, SEM credencial no escopo      → BLOCKED em ~5 s   (NO_QUALIFIED_CANDIDATE)
base limpa, COM chaves fake no escopo     → PASS  103 s
```

Causa raiz: `engineeringRouterService` resolve credencial por `credentialScope`, **fixo** em
`SYSTEM_ENGINEERING`/`DEFAULT_TENANT_ID` — por decisão de segurança ele NUNCA usa a credencial do tenant
de quem abre a tela (`engineeringRouterService.js:18-25`, correção ERV1). As duas suítes salvavam as
chaves fake **só no tenant de fixture**; `getCredentialDetailsMap(escopo)` voltava vazio,
`buildAvailableModels` não qualificava nenhum modelo e a task virava `BLOCKED_INFRA`.

Passavam na máquina de desenvolvimento **apenas porque o banco local já tinha credenciais reais no
escopo** — dependência de estado ambiente, precisamente o que o CI recusa.

### 11.8.2 Correção (fixture hermética; nenhuma asserção alterada)

- provider que já tem chave no escopo é **preservado** — nunca sobrescrito nem re-cifrado;
- provider sem chave recebe a fake e é **removido** no `afterAll`.

Prova de não-destrutividade medida no banco de desenvolvimento: `sha256` do **texto claro** das 4 chaves
reais (`deepseek`, `kimi`, `openai`, `qwen`) idêntico antes e depois da execução; a suíte passa tanto na
base limpa (103 s) quanto na de desenvolvimento (113 s).

### 11.8.3 Efeito medido no runner

```
run 40752124806  → 2 suítes ✕ (missionSource…, governanceApproval…)
run 40781349215  → 1 suíte  ✕ (só governanceApproval…; missionSourceStaleReplanFullRouterE2E = PASS)
```

`missionSourceStaleReplanFullRouterE2E` está **verde no runner** com a correção. A segunda suíte muda de
causa a cada camada removida — o que ela mostra agora está no §11.8.4.

### 11.8.4 O que resta: fechamento do finding esperado × findings da missão

No runner, o ciclo fechou **dois** findings da missão (`→ FIXED / REGRESSION_VALIDATED / CLOSED` em
`b6b331aa…` e `d01963c8…`), mas `getFinding(finding.id)` continuou devolvendo `CONFIRMED` até o deadline.
O suite escolhe o finding por `listFindings({ missionId })[0]` e depois acompanha **aquele id**.

Com apenas o status do finding esperado, "não fechou" e "fechou outro" são indistinguíveis. O dump de
diagnóstico passou a trazer `findingIdEsperado` e `findingsDaMissao` (id, status, fix_task_id,
created_at, recurrence_count, dedupe_key) — sem tocar em asserção nenhuma.

**Segundo ciclo de medição (run 40786037745), com o diagnóstico ampliado:** a missão tem **um único**
finding (`c3b7cf52…`) — não é escolha de finding errado. E a linha do tempo mostra o mecanismo:

```
23:29:36.509  → FIXED
23:29:36.522  → REGRESSION_VALIDATED
23:29:36.551  → CLOSED            (resolved_at gravado)
23:29:36.551+ "recurrenceCount": 1   ← 183 ms depois
23:29:36.74   resumeOriginalMission  decision=REPLACE_TASK_RESUME_PHASE  resumedStatus=RED
23:44:21      DIAG: status=CONFIRMED, recurrence_count=1, fixTask=GREEN
```

Ou seja: o worker **fecha** o finding e a **mesma anomalia é redetectada 183 ms depois**, reabrindo-o
como `RECURRENCE` (`resolved_at` volta a `null`, `bugFindingService.js:207`). O teste faz poll de 1 s no
status corrente e perde a janela.

**Isso NÃO é "ambiental" e NÃO está concluído.** É uma corrida de ciclo de vida — fechamento ×
redetecção da mesma anomalia dentro do mesmo sweep, logo após `resumeOriginalMission` — que aparece na
base limpa e não aparece na base de desenvolvimento (lá a suíte fecha e permanece fechada). O caminho de
código está localizado (`bugLoopCoordinatorService.js:574`, `resumeOriginalMission`); o que falta é a
decisão de contrato (a recorrência nesse instante é legítima ou espúria?) e a regressão determinística
correspondente. Enfraquecer a asserção para "basta ter fechado uma vez" mascararia justamente essa
pergunta, e por isso NÃO foi feito.

---

### 11.8.5 Ordem exata do artefato de recorrência (medida no runner)

```
23:29:35.866  missionSource: IntegrationIntent PREPARED (task e4dbdd70 = fix task)
23:29:35.880  missionSource: candidate integrado  BUG_FIX_CANDIDATE  04cad9c1b → db83173a84fa
23:29:36.509  finding c3b7cf52 → FIXED
23:29:36.522  finding c3b7cf52 → REGRESSION_VALIDATED
23:29:36.550  finding c3b7cf52 → CLOSED            (resolved_at gravado)
23:29:36.609  engineeringRouterService: execução com posse de lease (task 88942609 = SUBSTITUTA)
23:29:36.692  engineeringRouterService: RED->FIX "nova tentativa"  iterationsUsed=1
              failureKind=PATCH_CONTRACT_VIOLATION  reason=PATCH_VALIDATION
23:29:36.731  bugFindingService: reincidência de finding  previousStatus=CLOSED  recurrenceCount=1
23:29:36.741  bugLoopCoordinator: missão original retomada (REPLACE_TASK_RESUME_PHASE, resumedStatus=RED)
```

O fix **estava** na fonte da missão quando a substituta nasceu (integração 730 ms antes do fechamento). A
substituta então reexecuta o cenário original da missão — que já está satisfeito — e o coder devolve um
patch que viola o contrato (`PATCH_CONTRACT_VIOLATION`), porque o artefato já existe. A falha dessa
primeira tentativa é registrada como **reincidência** do finding que acabou de ser fechado.

Caminho do código localizado: `runMissionTask` → `runTask` → `if (result.status !== 'GREEN')`
`bugLoopCoordinator.hookMissionFailure(...)` (`api/services/engineeringMission/missionOrchestratorService.js:264`),
que registra ocorrência/reincidência em `bugFindingService.applyToExisting`.

**O que falta decidir é contrato de produto, não ambiental:** a retomada deve reexecutar o cenário original
pelo coder (e então a primeira tentativa falhar é esperada e NÃO pode contar como recorrência), ou deve
reconhecer que o spec já está satisfeito e concluir a missão sem recodificar? As duas mudanças são
cirúrgicas, mas produzem comportamentos opostos — e a asserção do teste (`closed` no fim) só é justa na
segunda. Registrado como **impedimento de decisão**, com a medição acima como prova.

---

## 11.9 Varredura dos gates da missão no HEAD da branch (`53c37167e`)

Comando por comando, com o veredito medido — nada presumido:

| gate | exit | veredito medido |
|---|---|---|
| `validate:engineering-router-v1` | 0 | PASS (STRUCTURAL_PASS/RUNTIME_NOT_REQUESTED, 183 checks, 0 falhas) |
| `validate:engineering-router-v2` | 1 | **NO_GO** — 12 itens, 4 falhas, 5 pendências (inclui `BUG_AUTONOMOUS_LOOP` e `ENVELOPE_VERIFICATION` sem medição) |
| `validate:timeout-architecture` | 1 | **NO_GO** — veredito de gate pai não afirmado por artefato filho |
| `validate:bug-autonomous-loop` | 1 | **NO_GO** — 31 itens, 31 falhas, `runtime=NOT_PROVEN` |
| `validate:required-tests` | 1 | **FAIL** — 68 `NOT_EXECUTED` |
| `validate:bug-closure-status` | 1 | **FAIL** — 142 defeitos declaram fechamento sem prova válida (P0=31, P1=71) |
| `validate:route-mounts` | 0 | PASS — 63 declarados / 63 montados |
| `validate:release-dag` | 0 | PASS — 29 nós, 25 artefatos, 0 ciclos |
| `validate:experience-segregation` | 0 | PASS |
| `validate:experience-api-segregation` | 0 | PASS |
| `validate:visibility-policy` | 0 | PASS — 0 violações |
| `validate:anti-greenwashing` | 0 | PASS — 91 suítes, 0 violações |
| `validate:hardening-queue` | 0 | PASS |

### 11.9.1 O caminho para executar os 68 testes obrigatórios está FECHADO por âncora externa

`npm run test:release-authoritative` (o runner autoritativo do manifesto) **recusa iniciar**:

```
[bug-closure] L2_L3_EXTENSIVO @ 53c37167e561: RECUSADO —
  INVENTARIO_NAO_ANCORADO, BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO, FECHAMENTO_SEM_PROVA_VALIDA
  ação exigida: fornecer RAP_CLOSURE_INVENTORY_SHA256 do canal externo (operador/CI),
               fora da árvore do repositório
  ação exigida: anexar prova de fechamento válida (testes reais com exit 0, SHA atual,
               fingerprint, livro de transições e assinatura de autoridade com mayCloseDefects)
```

Ou seja: `REQUIRED_TESTS` não é "68 testes que ninguém rodou por preguiça" — é um caminho **fail-closed**
que exige uma âncora que não existe dentro do repositório. Registrado como `BLOCKED_EXTERNAL` com a ação
exata, sem inventar âncora e sem afrouxar o guard.

**Classificação corrigida por medição (2026-10-29): P0 → P1 → P2.** Cada tentativa de severidade foi medida:

- **P0** acionou `P0_ABERTO` (`governance/bug-closure/eligibility.js`) e o `dev-branch-ci` passou a NEGAR
  `L0_COMPLETO` (runs 40792639206, 40793008399);
- **P1** acionou `TESTE_DIRECIONADO_PENDENTE` — a regra exige teste direcionado de **todo** P0/P1 aberto
  (linhas 259-270), o que é impossível para um bloqueio externo (run 40795178033, mesmo DENIED);
- **P2** é a classe dos 7 itens `blocked_external` já existentes (H15, H19, H20, `P1-PROJECAO…`,
  `P1-AGREGADO…`, `TESTE-DURABLE-…`, `CI-MAIN-…`, `CI-INTEG-…`) e foi a condição em que o gate canônico
  rodou completo antes (run `eb3b525ab`).

Nada foi relaxado: o item continua **aberto e bloqueado** (`state: BLOCKED_EXTERNAL`), a certificação
continua bloqueada por ele e `DEVELOPMENT_VERIFIED` continua **NO_GO** — severidade não decide
certificação; `state` decide.

### 11.9.2 O que isso significa para a decisão

`DEVELOPMENT_VERIFIED = NO_GO`, e o motivo é verificável: 5 gates obrigatórios estão vermelhos ou
bloqueados, e 2 deles (`required-tests`, `bug-closure-status`) dependem de âncora/provas externas. O que
**não** está pendente por trabalho executável neste ambiente: as suítes oficiais do CI (327/328 unit e
81/82 integração, com as duas causas restantes nomeadas), o gate canônico (3/3 SUCCESS) e os 8 validadores
acima que passam.

---

## 11.10 Rodada de evidência real no HEAD: 3 gates saíram do vermelho

Executando os **produtores canônicos** (nenhum artefato inventado), o estado do `engineering-router-v2`
mudou de `4 falhas / 5 pendências` para `1 falha / 3 pendências`:

| produtor executado | resultado medido | efeito no gate |
|---|---|---|
| `verify:timeout-architecture-e2e` | `TODOS OS CENÁRIOS PASS` (61 s) | `validate:timeout-architecture` → **GREEN** |
| `engineering-router:v2-envelope:generate` + `:v2-envelope` | `status=VERIFIED checks=22 falhas=0` (sourceCommit do HEAD) | `ENVELOPE_VERIFICATION` → **[PASS]** |
| `validate:rag-index-health` | `HEALTHY indexed=3539 duplicados=0 violações=0` | `ENGINEERING_RAG_ENRICHMENT` → PASS |
| `validate:recovery` | `status=GO checks=17 falhas=0` (takeover real, fence 1→2) | `REAL_TASK_RECOVERY` → **[PASS]** |
| `verify:mission-crash-recovery` | `status=GO checks=13 falhas=0` (SIGKILL real, escrita do worker morto recusada) | `V2_CRASH_SIGKILL_VERDE` → **[PASS]** |

O envelope registra honestamente os insumos que **não existem** nesta árvore (`release-suite-execution.json`,
`engineering-router-v2-status-report.json`, `release-attestation.json`) — declarados, nunca omitidos.

### 11.10.1 O que sobrou tem uma causa única

```
[FAIL]    V2_BUG_AUTONOMOUS_LOOP_GREEN   BUG_AUTONOMOUS_LOOP=NO_GO (31 itens sem prova)
[PENDING] V2_REQUIRED_TESTS              68 testes obrigatórios NOT_EXECUTED
[PENDING] V2_REQUIREMENTS_MATRIX_STATUS  17 eixos sem prova
[PENDING] BUG_AUTONOMOUS_LOOP            31 itens sem prova
```

Os quatro são a **mesma** causa: a execução autoritativa das suítes está recusada por
`INVENTARIO_NAO_ANCORADO` (§11.9.1). Não existe trabalho local que os prove sem a âncora externa — e
fabricar prova seria violar o próprio guard.

---

## 11.11 Decisão arquitetural implementada: pós-fix não recodifica e não gera recorrência falsa

Autorização de 2026-10-29: **quando uma missão é retomada após a integração de uma correção, o Roteador
Engenheiro verifica se a especificação já está satisfeita antes de invocar novamente o coder.**

### 11.11.1 O que foi implementado (com a causa medida no §11.8.5)

| mecanismo | onde | efeito |
|---|---|---|
| Pré-verificação da spec | `engineeringRouterService.preVerifySpecSatisfied` | quando a fonte da missão já avançou, roda os `test_commands` do contrato NO COMMIT DA TASK, no sandbox real; se todos passam ⇒ `GREEN` + `SPEC_ALREADY_SATISFIED` **sem chamar o coder e sem patch** |
| Transições legais | `engine/engineeringRouter/stateMachine.js` | `ROUTED→GREEN` e `CLASSIFIED→GREEN` — os únicos caminhos a GREEN **sem candidato**, com o motivo documentado |
| Evidência | `engineering_telemetry_events` (`SPEC_PRE_VERIFIED`) | SHA da fonte + comandos + exit code de cada execução; nenhuma conclusão por inferência |
| Classificação pós-fix | `engine/engineeringMission/bugFinding/postFixFailure.js` (puro) | falha de **contrato/infra** (PATCH_*, `NO_PATCH_SCOPE`, `NO_QUALIFIED_CODER`, `PROVIDER_UNAVAILABLE/EXHAUSTED`) com finding pós-correção ⇒ fingerprint próprio (`coder-contract:<missionId>:coder_contract`), nunca recorrência |
| Recorrência real preservada | mesma função | falha de **mérito** (teste/regressão/governança) segue o caminho normal e reabre o finding |

### 11.11.2 Regressões (mutação-provadas)

```
tests/integration/engineeringRouterSpecPreVerification.test.js  3 casos — fonte REAL avançada por
    candidato (git commit-tree + integrateCandidate) + sandbox real
    mutante: preVerifySpecSatisfied → NOT_APPLICABLE reprova o caso 1 (862 ms, foi a RED)
tests/integration/postFixFailureVsRecurrence.test.js            2 casos — contrato NÃO reabre;
    mérito REABRE (status CONFIRMED, recurrence_count ≥ 1, resolved_at null)
tests/unit/engineeringMission/postFixFailureClassification.test.js  9 casos
tests/unit/engineeringRouter                                    40 suítes / 409 testes PASS
```

### 11.11.2-bis REGRESSÃO que eu introduzi, encontrada pelo CI, e a condição que faltava

O CI (run 40816307878) reprovou `missionSourceStaleReplanFullRouterE2E`: esperado
`READY_FOR_PROMOTION`/`STALE_CANDIDATE`, obtido **`GREEN`**. Não era flake — era a minha
pré-verificação larga demais, e a lição é estrutural: **“os `test_commands` passam” NÃO prova que a
spec está satisfeita.** Um smoke verde passa em qualquer base, inclusive numa task de implementação
que ainda precisa CRIAR o artefato exigido pela spec.

Duas condições semânticas foram acrescentadas, cada uma travando um modo de falso GREEN:

| condição | o que impede |
|---|---|
| `task.source_commit === mission.currentCommit` | task ancorada em fonte ANTERIOR (trabalho pendente) ser dada como pronta — a retomada pós-fix **reancora** a substituta; a task do stale-replan não é reancorada |
| última integração da missão é `BUG_FIX_CANDIDATE` `COMMITTED` cujo `candidate_commit` é o corrente | fase NORMAL da missão (integração de task de implementação) usar o atalho — a pré-verificação existe para retomada **pós-fix**, e só ela tem essa assinatura |

Com as duas, `SPEC_ALREADY_SATISFIED` fica restrito ao caso para o qual foi decidido. Medições depois:

```
missionSourceStaleReplanFullRouterE2E   PASS 82,1 s   (era RED no CI)
governanceApprovalFullWorkerE2E         PASS 55,4 s   0 recorrências
engineeringRouterSpecPreVerification    4/4           inclui “task ancorada em fonte ANTIGA
                                                      não é dada como satisfeita”
postFixFailureVsRecurrence              2/2
tests/unit/{engineeringMission,engineeringRouter,ci}  82 suítes / 893 testes PASS
    (3 suítes / 14 testes de SANDBOX falham IDENTICAMENTE no commit-base f8bf7cc6e —
     provado em worktree separado: não são regressão deste commit)
```

### 11.11.2-ter Regressão minha nº 2: `git add -A` levou relatórios governados

O gate canônico reprovou `governedEvidenceBinding` (L0) com divergência byte-a-byte em
`reports/tenant-isolation-report.json` e `reports/rag-domain-segregation-report.json`. Causa: `jest
tests/unit` **regenera** esses dois arquivos, e o meu `git add -A` os levou junto no commit da correção.

Restaurados byte-a-byte do commit anterior (`d9b491903`); `governedEvidenceBinding` volta a 3/3 PASS e o
gate canônico volta a 3/3 SUCCESS. A armadilha já estava escrita na minha própria evidência — foi
repetida por pressa com `-A`. Registro para não repetir: **commit seletivo, sempre.**

### 11.11.3 Efeito medido na suíte de aceitação

```
governanceApprovalFullWorkerE2E (base limpa, Rap_ci_sim)   PASS 75,7 s
  · reincidências do finding corrigido ............ 0   (antes: 1 por execução)
  · falhas de contrato separadas como finding próprio  2  (NO_PATCH_SCOPE / PATCH_INVALID_FORMAT)
```

A causa da task substituta não conseguir patch (escopo **deferred** não resolvido ⇒ `NO_PATCH_SCOPE`) é
agora um **finding próprio e visível**, não uma recorrência do bug que já foi corrigido. O defeito de
escopo em si continua aberto como item separado — não foi mascarado.

---

## 11.12 Defeito P1 que a decisão arquitetural REVELOU: substituta pós-fix nascia sem escopo de patch

A classificação pós-fix (§11.11) não escondeu o problema — ela o **expôs**. Ao separar a falha de
contrato da recorrência, ficou visível que a task substituta da retomada **nunca conseguia entregar
patch**: `NO_PATCH_SCOPE`, 3 ocorrências medidas no run 40824588991
(`engineeringBugLoopNaturalPathE2E`).

### 11.12.1 Causa raiz

`resumeOriginalMission` criava a substituta com `scopeDeferred: true`, na suposição de que "o
planejamento preenche o escopo depois". **Esse preenchimento não existe**: `allowed_paths` só é escrito
na criação da task (`engineeringTaskService.createTask`) e `updateTaskFields` é allowlist de metadados
por desenho. Logo, a substituta nascia com `allowed_paths: []`, o validador recusava TODO patch
(`NO_PATCH_SCOPE` — ausência total de escopo é reject explícito) e a retomada esgotava as tentativas sem
corrigir nada. A falha então voltava como recorrência do finding recém-fechado — o sintoma que motivou
toda esta investigação.

### 11.12.2 Correção (herança, nunca invenção)

| ordem | fonte do escopo |
|---|---|
| 1 | `spec.allowedPaths` (contrato aprovado da missão) |
| 2 | `originalTask.allowed_paths` (o escopo com que a correção foi de fato validada) |
| 3 | nenhum dos dois ⇒ `scopeDeferred` (comportamento anterior, fail-closed preservado) |

`lineage.scopeOrigin` (`MISSION_SPEC` / `ORIGINAL_TASK` / `DEFERRED_NO_SCOPE_DECLARED`) torna a origem
auditável em vez de implícita.

### 11.12.3 Regressão mutação-provada

Nova asserção (d) em `engineeringBugLoopNaturalPathE2E`: escopo da substituta **não vazio**, **contido**
no escopo da task original, e `scopeOrigin` declarado. Com o mutante `escopoHerdado = []` a suíte
reprova exatamente na linha 386 — a asserção mede o defeito, não a implementação.

```
engineeringBugLoopNaturalPathE2E       PASS 50,1 s   0 NO_PATCH_SCOPE (antes: 3)
governanceApprovalFullWorkerE2E        PASS 60,0 s   0 recorrências
missionSourceStaleReplanFullRouterE2E  PASS 64,7 s
```

---

## 11.13 Flake de corrida no L0 do gate: o teste lia estado em movimento

O gate canônico no HEAD `8c14087d7` reprovou `regularizadorFilesystemAttacks › B2` e **o mesmo SHA
passou no re-run do mesmo job** — assinatura de corrida, não de defeito de produto.

### 11.13.1 Causa medida

`B2` sobe um processo atacante que troca `itens/` por symlink por 4 s enquanto 6 gravações acontecem, e
depois chama `atacante.kill('SIGKILL')` — que é **assíncrono** — e asserta imediatamente. Sem esperar o
`exit`, o atacante pode executar **mais uma** troca entre o kill e as asserções, movendo `itens/` (já com
os arquivos gravados) para `itens-guardado/`. A invariante 2 então lia `existsSync(retorno.abs) === false`.

O que isso NÃO era: fuga. A invariante 1 (sentinela intocada, hash conferido) continuava válida e nada
saiu da raiz — o arquivo estava no diretório movido. Era a leitura de estado em movimento.

### 11.13.2 Correção (nenhuma asserção afrouxada)

O teste passa a aguardar o encerramento do processo atacante (evento `exit`, teto de 5 s) **antes** de
verificar. As três invariantes seguem idênticas; o que muda é que o processo concorrente termina antes da
leitura.

```
estabilidade: 3 execuções consecutivas do B2 verdes · suíte inteira 18/18
gate canônico no HEAD 8c14087d7: 1ª execução FAIL(B2) → re-run 3/3 SUCCESS (mesmo SHA)
```

Registrado porque a diferença entre "teste frágil" e "produto inseguro" é exatamente essa: o produto
recusou a escrita fora da raiz nos dois casos; o teste é que media depois de o mundo já ter mudado.

---

## 11.14 L0b local: 39/40 — e a 40ª era o MEU harness lendo outro checkout (hipótese refutada)

Rodada canônica de L0b no HEAD `ea1435ab7` (`jest tests/integration/engineering --bail=0 --runInBand`):

```
Test Suites: 1 failed, 39 passed, 40 total
Tests:       1 failed, 218 passed, 219 total
FAIL tests/integration/engineeringMissionCrashRecoveryE2E.test.js
  CRASH_SIGKILL_RUNTIME_EVIDENCE … Expected: < 168   Received: 217.41 (horas)
```

### 11.14.1 Primeira hipótese (registrada e depois REFUTADA)

Interferência entre suítes: `engineeringRunnerComposeDeploymentE2E` vazaria
`ENGINEERING_ROUTER_HOST_REPO_ROOT=/opt/results/ria/r-agent2` para as suítes seguintes no mesmo
processo, e a suíte de crash passaria a ler o relatório do worktree principal (217–218 h). O par
compose→crash em `--runInBand` de fato falhava de forma reprodutível, o que sustentou a hipótese.

### 11.14.2 Medição que refutou a hipótese

Instrumentando o topo do arquivo (`__dirname`, `ROOT`, a env suspeita) e rodando **o mesmo par**:

```
[MARK-ROOT] /opt/results/ria/er-fixci/tests/integration  /opt/results/ria/er-fixci  /opt/results/ria/r-agent2
PASS tests/integration/engineeringRunnerComposeDeploymentE2E.test.js
PASS tests/integration/engineeringMissionCrashRecoveryE2E.test.js
Tests:       6 passed, 6 total
```

Duas conclusões medidas:

1. A env **de fato** vaza (é por processo), mas é **inócua** para esta suíte: `ROOT` vem de
   `path.resolve(__dirname,'..','..')`, não da env. O par compose→crash **passa 6/6**.
2. Nos runs que falharam, o Jest executou o arquivo de **outro checkout**: a code frame apontava
   `expect(ageHours)` na **linha 230** (versão pré-diagnóstico do worktree principal), enquanto no
   arquivo deste worktree a asserção está na **linha 249** e a 230 é o `if` do diagnóstico. Só há uma
   explicação compatível com as duas coisas: o processo rodou a partir de `/opt/results/ria/r-agent2` e
   leu o relatório **daquele** checkout (`finishedAt` 2026-10-20 ⇒ 218 h).

**Causa raiz real:** o comando de reprodução que eu usei era
`cd <worktree> && node … &` seguido de `npx jest … &&` na mesma linha. Em Bash, `cd X && A &` coloca o
`cd` **dentro do subshell em background**, então o `npx jest` seguinte herdou o cwd da sessão
(`/opt/results/ria/r-agent2`) e mediu o repositório errado. Não é defeito do repositório, não é
interferência entre suítes e não é flake.

**Lição de método:** um `cd` que não vale para o comando seguinte produz exatamente o sintoma de
"teste mediu outro repositório" — o mesmo sintoma já documentado em §9.3-quinquies com causa diferente
(serviço honrando a env do HOST). Antes de atribuir causa a um teste, provar **de qual arquivo** veio a
code frame.

### 11.14.3 O que ficou no código (não é afrouxamento)

A asserção `ageHours < 168` permanece **idêntica**. Ficou apenas observabilidade no caminho de falha: o
`console.warn` publica `arquivo` (absoluto), `finishedAt`, idade, `mtime` e `cwd`. É exatamente o dado
que teria encurtado esta arqueologia de 40 minutos — com ele, "leu o checkout errado" é visível em uma
linha de log. Commit `99d1ee878`.

## 11.15 L0b local: três armadilhas do AMBIENTE de execução (nenhuma do produto)

Ao reexecutar o L0b local no HEAD `99d1ee878` apareceram **três** lotes inválidos consecutivos. Nenhum
era defeito do repositório; os três eram o mesmo skip do `globalSetup` em worktree ligado
(`tests/setup/engineeringRunnerGlobalSetup.js`) deixando o cliente apontado para algo que não existe.

| # | sintoma medido | causa medida | custo |
|---|---|---|---|
| 1 | 16 suítes `ECONNREFUSED 127.0.0.1:8090` → `BLOCKED_INFRA`, uma com 900 s de timeout | o skip não define `ENGINEERING_RUNNER_URL`; o cliente cai no valor do `.env` (**8090**), enquanto o runner de teste usa **8097** | ~35 min |
| 2 | 16 suítes `engineering_runner_unauthorized` (runner vivo em 8090, `/health` OK) | runner subido com token diferente do que o cliente usa; `/health` é **não autenticado por design**, então "vivo" não implica "autenticando" | ~30 min |
| 3 | `engineeringPatchApplyAndTestRunner` 3/4 (`git status` com exitCode 128 no workspace) | runner subido sem `--env-file-if-exists=.env`: quando o setup o sobe, ele herda `process.env` **já carregado** com o `.env`; subindo à mão sem a flag, faltam as variáveis | ~12 min |

### 11.15.1 O que foi entregue (diagnóstico, zero afrouxamento)

No ramo de skip do `globalSetup` passam a existir dois probes, ambos escrevendo em **stderr** (o stdout do
globalSetup é parseado pelo coletor):

1. **Probe de vida** — se o `ENGINEERING_RUNNER_URL` em vigor não responde, imprime o comando exato de
   subida do runner, com a porta/token que o próprio skip deixa em vigor e a flag `--env-file-if-exists=.env`.
2. **Probe autenticado sem efeito** — `POST /execute` com corpo vazio: a auth é validada **antes** do
   contrato, então `401` = token errado e `400` = token ok, sem executar nada. Detecta a armadilha 2,
   que é invisível no `/health`.

Nenhuma asserção, porta, token ou comportamento de teste foi alterado. Commits `4c4284a49` e `ec4d9b5b3`.

### 11.15.2 Receita local correta (a que produz amostra VÁLIDA)

```bash
cd <worktree> && node --env-file-if-exists=.env services/engineering-runner/src/index.js   # porta/token do .env
npx jest tests/integration/engineering --runInBand --bail=0
```

Subir o runner em 8097 com `ENGINEERING_RUNNER_TOKEN=jest-test-engineering-runner-token` **sem** carregar o
`.env` produz lote inválido — foi exatamente o erro das armadilhas 1 e 3.

### 11.15.3 Amostra canônica final (VÁLIDA) — L0b 100% verde

Receita de §11.15.2, HEAD `ec4d9b5b3` (árvore idêntica à medida), log `/tmp/rap-ev/l0b_valid4.log`:

```
Test Suites: 41 passed, 41 total
Tests:       238 passed, 238 total
Time:        1699.487 s
EXIT=0
```

Inclui, verdes, as suítes que sustentam o aceite desta rodada:

| suíte | resultado |
|---|---|
| `engineeringBugLoopNaturalPathE2E` | **PASS** 90,1 s |
| `engineeringRouterSpecPreVerification` | **PASS** 32,5 s (4/4) |
| `engineeringMissionCrashRecoveryE2E` | **PASS** 5,2 s (inclui `CRASH_SIGKILL_RUNTIME_EVIDENCE`) |

E, rodadas explicitamente (fora do diretório `engineering/`), 12/12 PASS: `governanceApprovalFullWorkerE2E`
(106,1 s), `postFixFailureVsRecurrence` e `postFixFailureClassification` (unit, 9 casos).

Comparação com o estado anterior: a amostra de `ea1435ab7` era **39/40 com 1 vermelho** e **41 arquivos**
hoje (a suíte nova `engineeringRouterSpecPreVerification` é desta rodada). O vermelho remanescente era o
harness (§11.14), não o produto.

## 11.16 Última vermelha do `jest.yml`: o unit media a ausência do artefato de OUTRO workflow

Estado medido antes: `jest.yml` em `ea1435ab7` = **327/328** suítes, única vermelha
`tests/unit/governance/modelDrivenE2e.test.js` — "artefato prod-like ausente ou ilegível:
`qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json`".

**Causa (não é flake, não é código de produto):** o artefato é **gitignored** por política (`.gitignore:90`,
`qa/smoke/`) e só é produzido pelo job `prod-like-smoke` do `dev-branch-ci`, baixado pelo
`dev-branch-gate`. Em qualquer checkout limpo — inclusive o do `jest.yml` — ele **não existe por
construção**. Logo o job de unit não media a saúde do código: media a ausência de um artefato que outro
workflow produz.

**Correção (a porta canônica do repositório, `tests/helpers/infraGate.js`):** a dependência passa a ser
declarada. Medido nesta worktree, com a alteração e sem ela:

| estado | antes | depois |
|---|---|---|
| artefato **ausente**, modo dev (`jest.yml`, `npm run test:unit`) | **FAIL** (`artefato prod-like ausente ou ilegivel … decision=MODEL_DRIVEN_E2E_FAIL`) | **PASS** com `NOT_EXECUTED` registrado (suíte, requisito, motivo) |
| artefato **ausente**, `RELEASE_AUTHORITATIVE=1` | FAIL | **FAIL fail-closed** (`code=INFRA_ERROR`) |
| artefato **presente** | PASS | PASS (asserções do relatório intactas) |

Nada foi afrouxado: artefato presente e **ilegível** continua falhando pelo erro auto-descritivo de antes,
e a execução autoritativa de release não muda (a suíte **não** está em
`config/canonical-release-suites.json`). `validate:anti-greenwashing` PASS (91 suítes, 0 violações).
Commit `195b31d58`.

**O que NÃO é decisão de agente e segue aberto:** se `prod-like-smoke` deve virar `workflow_call`
reutilizável consumido pelo `jest.yml` (custo: subir a stack prod-like a cada push em main) ou se o
`jest.yml` deve ser aposentado como gate de main. É decisão de dono do repositório sobre **quais gates
rodam em main** — não muda com esta correção.

## 11.17 Suíte COMPLETA de unit (1122 suítes) e o flake real que ela revelou

Execução completa em paralelo, `npx jest tests/unit --bail=0`, com o pré-requisito de CI
(`npm run ci:artifacts`) e após a correção de §11.17.2:

```
Test Suites: 1 skipped, 1122 passed, 1122 of 1123 total
Tests:       2 skipped, 9799 passed, 9801 total
EXIT=0
```

Primeira execução, ANTES do pré-requisito e da correção (§11.17.1–§11.17.2), para registro:

```
Test Suites: 2 failed, 1 skipped, 1120 passed, 1122 of 1123 total
Tests:       3 failed, 2 skipped, 9796 passed, 9801 total
FAIL tests/unit/coverage/impactRunner.test.js
FAIL tests/unit/dev/devServicesSupervision.test.js
```

### 11.17.1 Um dos dois é procedimento meu, não defeito (e é pré-requisito de CI)

`impactRunner` (2 testes) falhava com `base: GRAPH_STALE`: o grafo de impacto
(`reports/impact-graph.json`) é **gitignored** e o artefato local era de 28/10, anterior ao source atual —
o runner corretamente faz fail-closed ("o grafo precisa descrever o source ATUAL — rode `npm run
impact:build`"). Depois de `npm run ci:artifacts` (o passo que o `jest.yml` já executa antes das suítes),
a mesma suíte fecha **11/11 PASS**. Conclusão honesta: faltava o pré-requisito na MINHA execução local,
não há defeito a corrigir. Registrado porque a diferença entre "suíte vermelha" e "suíte sem artefato"
é exatamente o que este relatório não pode confundir.

### 11.17.2 O outro é defeito REAL: porta fixa dentro do range efêmero

`devServicesSupervision` caiu para 25/26 com `listen EADDRINUSE: address already in use 127.0.0.1:39118`
e passava isolada. As três portas fixas da suíte (**39117/39118/39119**) estão DENTRO do range efêmero do
Linux (32768–60999): qualquer conexão de saída da máquina pode ocupá-las — sob 1122 suítes em paralelo a
probabilidade deixa de ser teórica.

**Correção:** bind em `0` e uso da porta REAL atribuída pelo SO (`servidor.address().port`, helper
`escutarEmPortaEfemera`). O teste não depende do número — ele injeta a porta detectada nos dublês —, então
as asserções são as mesmas: identidade comprovada quando o cgroup do PID é o da unidade, e `start` FALHA
quando quem atende é outro processo.

**Prova por contenção real** (um listener ocupando 39118 durante a execução):

| versão | resultado |
|---|---|
| anterior | **FAIL** `EADDRINUSE … 127.0.0.1:39118` (25/26) |
| corrigida | **PASS** 26/26 |

Commit `411ceebc5`.

## 11.18 `npm test` COMPLETO local = verde (o conteúdo exato do `jest.yml`)

Depois das correções §11.16 (artefato prod-like) e §11.17.2 (portas efêmeras), os TRÊS componentes do
`npm test` — que é o que o job `jest` do `jest.yml` executa — fecharam verdes nesta worktree:

| componente | comando | resultado |
|---|---|---|
| unit | `npx jest tests/unit --bail=0` | **1122/1122 suítes**, 9799/9801 testes, EXIT=0 |
| flow | `npx jest tests/flow engine/__tests__ --bail=0` | **30/30 suítes**, 264/264 testes, EXIT=0 |
| rpa | `npm run test:rpa:jest` | **3/3 suítes**, 7 PASS + 4 SKIP declarados, EXIT=0 |

Consequência medida, não narrativa: a única vermelha que restava no `jest.yml` (run 40737265748, 327/328)
era o artefato prod-like de §11.16, e ela deixou de ser vermelha por construção. O que **não** está provado
aqui é o CI: nenhum destes números foi obtido em runner do GitHub — são a mesma suíte, mesmo comando,
máquina diferente.

## 11.19 Durable-resume: a opção "isolar por tenant" está REFUTADA (medido no código)

O item `TESTE-DURABLE-RESUME-FLAKE-POR-BANCO-COMPARTILHADO` está bloqueado com a justificativa "exige banco
isolado por suíte". Fui verificar se havia uma saída mais barata — isolar as missões do teste em um TENANT
próprio, de modo que o servidor vivo (mesmo Postgres, loop de recovery a cada 5 min) não as visse:

```
sweep({ tenantId = 'system', ... })            missionRecoveryCoordinator.js:87
  → missionStore.findMissionsWithExpiredLease({ limit, excludeIds })
  → missionStore.findMissionsWithoutLease({ limit, excludeIds })     missionStoreService.js:581
      where = { status: IN RESUME_STATES, lease_token: null }   ← SEM filtro de tenant
```

`sweep` recebe `tenantId` e **não o usa nas duas fontes de candidatos**: a varredura é global no banco.
Portanto "tenant dedicado no teste" **não resolve** — o servidor vivo alcança a missão de qualquer tenant.
As únicas saídas reais continuam sendo: (a) banco/schema dedicado por suíte, (b) servidor de teste sem
loop, ou (c) o servidor vivo rodar com `ENGINEERING_MISSION_RECOVERY_ENABLED=0`
(`recoveryEnabled()` desliga com `NODE_ENV=test`, e o intervalo é
`ENGINEERING_MISSION_RECOVERY_INTERVAL_MS`, default **5 min**).

Janela de corrida quantificada: a missão do teste fica em estado retomável com `lease_token: null` durante
a execução; o tick de 5 min a alcança com probabilidade ≈ `duração_do_teste / 300 s` — coerente com o
histórico medido (1/3 execuções na base, 2/2 em lotes, 6/6 verde no CI sem servidor concorrente). **Não é
defeito de produto**: a varredura global é o comportamento pretendido de recovery.

Isto é decisão de ambiente/infra, não de código de aplicação — e agora está delimitada, com a opção barata
eliminada por medição em vez de suposição.

**O que ficou no código** (commit `2d92987e8`): `diagnosticarInterferencia` na suíte de durable-resume. Quando
a missão do teste não aparece na retomada que ELE chamou, o log publica `statusAtual`, `leaseWorker`,
`leaseHost`, `leaseExpiraEm`, `atualizadoEm` e quantos itens a retomada trouxe — em vez de deixar a falha
parecer defeito da retomada. Prova do caminho de warn por mutação (parâmetro `esperado` invertido): o warn
sai com os campos preenchidos e o teste segue passando; revertido, 6/6 PASS sem warn.

O próprio mutante já entregou um dado: a retomada do teste trouxe **19 itens** — o banco compartilhado
acumula missões resumíveis de execuções anteriores, e é essa população que o servidor vivo também varre.

## 11.20 Superfície de validação local COMPLETA — tudo verde, e o que isso NÃO prova

Fecha o mapa de execução desta rodada. Todos os grupos foram rodados nesta worktree, no HEAD
`2d92987e8` (ou imediatamente anterior para os que não tocam os arquivos alterados):

| grupo | comando | resultado |
|---|---|---|
| unit | `npx jest tests/unit --bail=0` | **1122/1122 suítes**, 9799/9801 testes |
| flow | `npx jest tests/flow engine/__tests__ --bail=0` | **30/30**, 264/264 |
| rpa | `npm run test:rpa:jest` | **3/3**, 7 PASS + 4 SKIP |
| system (contracts/governance/ci/runtime/organizational/stress/rate-limit) | `npm run test:system` | **18/18**, 162/162 |
| tenant (isolamento) | `npx jest tests/tenant --bail=0` | **5/5**, 44/44 |
| integração do Roteador (L0b) | `npx jest tests/integration/engineering --runInBand` | **41/41**, 238/238 — duas execuções consecutivas |
| aceite da decisão arquitetural | `governanceApprovalFullWorkerE2E`, `postFixFailureVsRecurrence`, `postFixFailureClassification` | **12/12** |
| frontend | `cd frontend && npx vitest run --config vitest.config.mjs` | **141/141 arquivos**, 1065/1065 testes |
| memória operacional | `validate:ai-memory` + `validate:ai-memory-consistency` | **PASS** (0 blockers; 2 warnings, 56 infos) |
| fila oficial | `validate:hardening-queue` | **PASS** (159 itens, 0 pending/in_progress) |

**O que isso NÃO prova** (e não será apresentado como se provasse):
- **CI**: nada aqui rodou em runner do GitHub. Os números de CI citados no relatório (§11.7–§11.10) vêm dos
  runs identificados por ID; os desta tabela são desta máquina.
- **Certificação**: `DEVELOPMENT_VERIFIED`, `RELEASE_CERTIFICATION` e `ENGINEERING_ROUTER_V2` continuam
  **NO_GO** — a âncora de fechamento externa (inventário assinado, chaves Ed25519, artefato prod-like)
  não existe.
- **Durable-resume**: o flake por banco compartilhado segue aberto por decisão de ambiente (§11.19); a
  suíte passou 6/6 nesta rodada, o que não o encerra.
- **Vermelhos pré-existentes de governança de camadas**: `validate:layer-conventions` continua com os 118
  erros conhecidos só em `engine/` (pureza) — nenhum deles tocado ou mascarado aqui.

Nenhum defeito novo apareceu nesta varredura: os grupos acima já estavam verdes depois das correções
§11.16–§11.19, e o valor desta rodada é a MEDIÇÃO, não um conserto.

## 11.21 O refresh agendado das evidências de wave estava morto por falta de identidade de run

Descoberto ao verificar uma afirmação da própria fila ("Actions bloqueado por budget"). A evidência
contradiz a fila e revela um defeito de código:

```
run 40158423635 · 2026-10-25 · main 04cad9c1b · "Wave Reports Refresh" (schedule)
  ✓ 12 passos verdes (containers, migrations, API :3001, frontend :5173, warmup)
  X Database Integrity Wave (Postgres real)
      [db-integrity-wave] models no inventário: 224 | relações: 9
      [db-integrity-wave] dbAvailable=true
      [db-integrity-wave] erro fatal: nenhum run governado encontrado — crie o run antes de produzir evidência
  - API Surface Wave / Page Surface Wave      (nem rodaram)
```

**Não é billing**: o run agendado EXECUTOU (1m35s, 19 passos). O que aconteceu é fail-closed correto do
produtor (`scripts/governance/lib/report-lineage.js` → `LINEAGE_RUN_UNDEFINED`): evidência de runtime sem
run é evidência sem origem. O job agendado **nunca abria o run** — portanto o refresh não atualizava nada e
as evidências de wave venciam (o coverage gate degrada `VALIDATED → STALE` acima de 7 dias). O padrão de
sucesso/falha alternado por semana (04/10 e 18/10 verdes; 27/09, 11/10 e 25/10 vermelhos) é compatível com
a janela de validade das provas de fechamento de bug que o guard consome antes do lineage.

**Correção** (commit `1ad166d97`): o workflow passa a **abrir** o run antes das waves
(`create-governed-run.js`) e a **fechar** depois com `if: always()` — para não deixar run órfão quando uma
wave falhar (a classe de defeito do H20). O run é de **manutenção**: fecha como `SUPERSEDED`, com motivo e
evidência obrigatórios, e **nunca certifica release**.

**Prova local do mecanismo** (banco descartável `rap_wave_proof`, criado e removido; migrations aplicadas):

| estado | resultado medido |
|---|---|
| SEM run governado | `comLineage` lança `LINEAGE_RUN_UNDEFINED` — a classe exata do erro de CI |
| COM run criado | `comLineage` devolve `runId`/`sourceFingerprint`/`sourceCommit`, e `verifyDb` confere a linha do run no banco |
| fechamento | `close-run-context` grava `status=SUPERSEDED`, `closedAt`, `closedBy` com motivo e evidência |

`governance/.current-run.json` é gitignored (`.gitignore:123`) e o passo de commit adiciona **apenas** os três
relatórios — o ponteiro do run nunca entra no commit. Testes de CI: `tests/ci` 6/6 e
`stepExitMasking` 8/8 (o lint de mascaramento de exit passa com `pipefail` já declarado no job).

**O que NÃO está provado:** que o próximo run agendado fique verde. Isso depende de o guard de bug-closure
em `main` aprovar (em 25/10 ele aprovou — a falha foi no lineage), o que é previsão, não medição. Também
não reproduzi o erro localmente: nesta branch o guard de bug-closure recusa **antes** do lineage
(`INVENTARIO_NAO_ANCORADO` — a âncora externa), então a ordem de falha local difere da de `main`.

## 11.22 Ciclo autorizado de promoção: até onde foi, o que travou, e por quê

Autorização recebida para promover `dev → main` e empurrar, executando o caminho até o selo. Registro do
que foi FEITO, do que o gate MEDIU e do ponto em que parar era a única conduta honesta.

### 11.22.1 Executado (com SHA)

| passo | resultado |
|---|---|
| merge `docs/main-ci-environment-gaps` → `fix/jest-ci-history` | `dd379d820` (sem conflito; base comum era `3386a4547`) |
| `dev/engineering-hardening` FF no remoto | `3386a4547 → dd379d820` |
| merge do fix da fila (§11.22.2) | `bfd2ce9a3` |
| `dev/engineering-hardening` FF novamente | `dd379d820 → bfd2ce9a3` |

**Não promovi `main`** — e a razão é medida, não opinião (§11.22.3).

Estado dos checks em `dev` `bfd2ce9a3` (medido, não estimado):

| check | resultado |
|---|---|
| **Jest (unit + integration)** | **SUCCESS** — os dois jobs. É o gate que estava 327/328 |
| RAG Service Tests | **SUCCESS** |
| Frontend Tests | FAILURE — 1 de 569 (flake, §11.22.4) |
| E2E Playwright | FAILURE — 2 specs, idênticos em `main` em 2026-10-20 (§11.22.4) |
| Release Governance — ENVELOPE + PAYLOAD | FAILURE — depende das âncoras/Ed25519 (§11.22.3) |
| Dev Hardening CI (L0 + L1) | DENIED `L0_COMPLETO` (§11.22.3) |

### 11.22.2 Regressão que EU introduzi, pega pelo gate real

O run 40946909215 (Jest unit em `dev` `dd379d820`) reprovou **1 suíte / 1 teste**:
`tests/unit/governance/bugClosureQueueModel.test.js` → *"a fila REAL tem estado canônico em TODOS os itens"*.

Causa: os 4 itens que criei nesta missão usavam `state: "DONE_MEASURED"`, que **não existe** no vocabulário
canônico (`OPEN, REPRODUCED, FIX_IN_PROGRESS, FIXED_PENDING_VERIFICATION, VERIFIED, RESOLVED,
BLOCKED_EXTERNAL, RISK_ACCEPTED`). O `validate:hardening-queue` passava — o teste do modelo de dados não.
Corrigido para `VERIFIED` (`2fa75a88a`), verificado localmente **12/12 PASS**, e a contagem da fila volta a
`133 VERIFIED / 8 BLOCKED_EXTERNAL / 19 RESOLVED` sem item fora do vocabulário.

Lição: "o validador que eu rodei passou" ≠ "o gate real passa". Só o CI mediu essa diferença.

### 11.22.3 O que impede `main` e o selo — medido, não estimado

O gate canônico `Dev Hardening CI (L0 + L1 governança)` reprovou no run do `dd379d820`:

```
[dev-branch-gate] C autorizacao L0_COMPLETO: DENIED
                  (BLOQUEIO_EXTERNO_NAO_RESOLVE_CERTIFICACAO, TESTE_DIRECIONADO_PENDENTE)
```

E, medido na própria árvore (`validate-bug-closure-status` em `bfd2ce9a3`):

```
[bug-closure-status] abertos=160 (P0=0 P1=0 externos=8) bloqueantesParaCertificacao=107
[bug-closure-status] FAIL: FECHAMENTO_NAO_PROVADO 152 defeito(s) DECLARAM fechamento
                     sem prova válida (P0=31, P1=76) — declarar não é fechar
```

O guard do próprio selo (`exigir_elegibilidade SELO_FINAL`, primeira linha executável de
`seal-release.sh` depois do argparse) recusa:

```
[bug-closure-guard] RECUSADO (exit 1): SELO_FINAL não pode começar.
  · fornecer RAP_CLOSURE_INVENTORY_SHA256 do canal externo (operador/CI), fora da árvore do repositório
  · anexar prova de fechamento válida (testes reais com exit 0, SHA atual, fingerprint, livro de
    transições e assinatura de autoridade com mayCloseDefects) ou reabrir o defeito
```

**É um impasse fechado, não um bug**: o selo exige `L0_COMPLETO`; `L0_COMPLETO` é negado porque existem
defeitos `BLOCKED_EXTERNAL` (8) e 152 fechamentos sem prova válida; a prova válida exige
`RAP_CLOSURE_INVENTORY_SHA256` + assinatura de autoridade, que só existem com as âncoras provisionadas. E
cinco desses itens bloqueados (**H15/H19/H20** e os dois `P1-*`) têm como `blocked_reason` exatamente *"exige
ciclo de selagem"*. Ou seja: **o selo não começa porque falta o selo.** Promover `main` com esse estado seria
declarar release verde sobre governança `NO_GO` — proibido pela Constituição do repositório e pela missão.

### 11.22.4 Dois vermelhos pré-existentes que o run de `dev` expôs (não são meus)

1. **E2E Playwright** (2 falhas): `qa-waves-replay.spec.ts:209` (timeout de 420 s no click) e
   `support-agent-flow.spec.ts:306/314` (`ticketList` `element(s) not found`). **Idênticos em `main` no run
   39447249603 (2026-10-20)**, mesma linha 314 — logo anteriores a esta rodada. O segundo cheira à superfície
   `/support` legada (deprecated e gated por `caseManagement`), o que faria o spec estar medindo uma tela
   que já não é a canônica.
2. **Frontend Tests** (1 de 569): `SecurityIntelligencePage.test.jsx` → filtro "apenas pendências". Passou
   em `dd379d820` e falhou em `bfd2ce9a3`, cuja única diferença é **4 valores de `state` num JSON**:
   é flake, não regressão. Não reproduzi em 3 execuções locais da suíte (4/4 PASS nas três).

Nenhum dos dois foi registrado como item `pending` na fila — não vou criar compromisso de fila que eu não
vou cumprir neste turno. Ficam aqui como próximos passos com medição.

## 11.23 Os dois vermelhos pré-existentes do E2E: causa medida nos artefatos, não suposta

Sem stack local eu não teria diagnóstico — então baixei o artefato do run 40946909310
(`gh run download`, `playwright-report/data/*.md` contém snapshot da página e o call log exato).

### 11.23.1 `support-agent-flow` cenário 1 — o guard era CÓDIGO MORTO

```
Locator: getByTestId('ticket-list')   Expected: visible   Error: element(s) not found
Page snapshot: … paragraph: "Nenhum chamado disponível"
```

`SupportTicketList.jsx:187` só renderiza o contêiner `ticket-list` quando há chamado visível; com fila
vazia renderiza o vazio. A asserção de visibilidade vinha **antes** do guard `count === 0 →
PRECONDITION_FAILED`, portanto numa execução de fila limpa o teste estourava em timeout e o guard nunca
era alcançado — o vermelho acusava "locator" quando o problema era pré-condição. Correção: garantir o
chamado antes, com o MESMO helper que o cenário 2 já usava. Asserção intacta.

### 11.23.2 `qa-waves-replay` — clique sem timeout sobre uma jornada que o ambiente não tem

```
Error: locator.click: Test timeout of 420000ms exceeded.
  waiting for locator('.qa-journey-tree-journey').filter({ hasText: 'Support Ticket Flow' }).first()
Page snapshot: árvore contém APENAS "Beauty New Customer" e "Beauty Booking"
```

A árvore do ambiente de E2E é populada por jornadas derivadas do vertical **beauty**; a jornada de
suporte que a spec presume (`config/journey-scenario-links.json` liga `support_ticket_flow` ao cenário
`support-inbox-nota-ui`) **não é semeada**. Correção: a árvore é lida, a pré-condição é verificada e o
clique passa a ter timeout de 15 s — ausência falha em segundos NOMEANDO o que existe.

### 11.23.3 Verificação local (stack viva: API :3001 + Vite :5173)

| execução | resultado |
|---|---|
| `support-agent-flow.spec.ts` **com** a correção | **5/6, cenário 1 PASSANDO** (6,4 min) |
| `support-agent-flow.spec.ts` **sem** a correção (stash) | **5/6** — cenário 1 passa por sorte de dado residual e o **cenário 3** cai no MESMO `open_ticket_exists` |
| `qa-waves-replay.spec.ts` com a correção | falha em **segundos**: `journey_with_support_scenario: []` |

Conclusão honesta: a correção do cenário 1 é real e verificada (`+1` determinístico), mas a família de
cenários tem **dependência de estado compartilhado** pré-existente: 3, 4 e 5 contam com "algum chamado
visível na lista" deixado pelos anteriores. Tentativa de corrigir o cenário 4 com o helper do cenário 1
foi **revertida** porque não provou efeito (o helper faz takeover, e o chamado sai do filtro padrão da
lista) — registrar em vez de empurrar remendo.

### 11.23.4 O "flake" de frontend era CORRIDA, reproduzida e corrigida

Run 40949091209 (`Frontend Tests` em `dev` `bfd2ce9a3`): 1 de 569 vermelho com

```
Unable to find an element by: [data-testid="finding-actions-A|npm:pacote-a@1.0.0"]
```

A asserção (`SecurityIntelligencePage.test.jsx`) era **síncrona** (`getByTestId`) logo depois de esperar
apenas o título estático "Achados de segurança" — o grid depende de `listSecurityFindings`, e sob carga a
promise resolve depois. Os testes irmãos do arquivo já usavam `findBy*`.

**Reprodução determinística:** atrasando o mock de `listSecurityFindings` em 80 ms, o teste falha com a
**mensagem idêntica** à do CI. Com a correção (`findByTestId`, mesma asserção) e o **mesmo atraso ativo**,
passa. O atraso era experimento e foi removido; 4/4 em quatro execuções depois disso. Commit `f884f94fb`.

Ficou registrado (sem alterar) que o mesmo atraso artificial derruba também o teste irmão do agrupamento —
mesma classe de corrida, mas ele nunca falhou em CI, e corrigir o que não foi medido seria adivinhação.

**Próximo passo do E2E (não feito aqui, de propósito):** ou o workflow semeia a jornada
`support_ticket_flow` com o cenário `support-inbox-nota-ui`, ou cada cenário garante o chamado **no
estado que ele exige** (helper de chamado em fila, sem takeover). As duas mudam dados de E2E e merecem
verificação própria.

---

## 12. DECISÃO FINAL

```
TIMEOUT_ARCHITECTURE  = GO               (re-medido no HEAD 53c37167e: verify:timeout-architecture-e2e PASS → gate GREEN — §11.10)
CRASH_RECOVERY        = GO               (13 checks com SIGKILL real)
REAL_TASK_RECOVERY    = GO               (17 checks com takeover e fencing)
RAG_INDEX_HEALTH      = HEALTHY          (3539 indexados, 0 violações)
ENGINEERING_ROUTER_V2 = NO_GO            (HEAD d9b491903: pós-fix resolvido (§11.11); o que resta é a
                                          âncora externa — §11.10)
LEASES/ESCOPO         = 3 defeitos reais + 4 achados de revisão fechados com prova (§9.3-bis/quater, §10.1)
REQUIRED_TESTS        = FAIL/NOT_EXECUTED (68) — bloqueio externo
DEVELOPMENT_VERIFIED  = NÃO DECLARADO    (testes obrigatórios não executados)
RELEASE_CERTIFICATION = NO_GO
MERGE                 = DONE (PR #20 → dev/engineering-hardening = 53f7056d0, CI success)
PUBLISH               = NOT_AUTHORIZED (selagem nao autorizada; 4 bloqueios medidos em §11.4)
DEPLOY                = NOT_AUTHORIZED
L0b_CANONICO          = 41/41 SUITES · 237/237 TESTES PASS (HEAD d9b491903, com a suíte nova de
                        pré-verificação de spec — §11.11)
CI_EM_RUNNER_LIMPO    = PASS_PARCIAL     (fases A/B/C/D PASS, 0 falhas; R/E/F fora do gate de branch)
CI_DO_MAIN (jest.yml) = 5 lacunas de AMBIENTE fechadas; 327/328 suítes PASS (1121 medidas na sonda);
                        residual de unit = modelDrivenE2e (artefato prod-like de outro job) — §11.7
CI_INTEGRACAO (jest.yml) = timeout que matava o job corrigido; 80/82 suítes PASS em 24-27 min;
                        residual = 2 suítes do manifesto de release, hipótese ABERTA (Node 20) — §11.7.7
GATE_CANONICO (dev)   = PASS nos 3 últimos commits do branch (prod-like-smoke + L0/L1 + integração real)
MAIN_MODIFIED         = FALSE            (main intocado: 04cad9c1b; merge só com autorização humana)
```

Duas vulnerabilidades P0/P1 reais fechadas com reprodução antes/depois, uma delas tendo sobrevivido à
primeira correção e sido pega por revisão independente. O que impede `DEVELOPMENT_VERIFIED` é dependência
externa — não ausência de trabalho executável neste ambiente.
