# Arquitetura de Timeouts, Deadlines, Lease e Detecção de Ausência de Progresso

**Princípio fundador: `SLOW != STUCK != DEAD`.**

Lento não é travado. Travado não é morto. Nenhuma dessas três condições pode ser
inferida da outra — e **tempo decorrido nunca é autoridade** para declarar morte de
missão, perda de trabalho ou invasão de ownership.

Documento canônico do hardening de timeouts (2026-09-26). Substitui, no caminho
crítico, todo uso de timeout como mecanismo de **liveness**, **lock**, **lease**,
**recovery** ou **detecção de travamento**.

- Registry versionado: `config/timeout-policy.json`
- Motor de deadlines: `engine/shared/executionDeadline.js`
- Detector de progresso: `engine/engineeringMission/progressPolicy.js`
- Lease de mesh: `qa-mesh/meshLease.js`
- Inventário: `scripts/governance/lib/timeoutInventory.js`
- Gate bloqueante: `npm run validate:timeout-architecture`
- Prova em runtime real: `npm run verify:timeout-architecture-e2e`
- Evidência: `reports/TIMEOUT_ARCHITECTURE_REPORT.json`, `reports/timeout-architecture-evidence.json`

---

## 1. O problema que esta arquitetura elimina

O padrão incorreto (e a razão desta arquitetura existir) é usar **um único timeout de
relógio** para responder perguntas diferentes:

| Pergunta real | Resposta ERRADA (relógio) | Resposta CORRETA (esta arquitetura) |
|---|---|---|
| O dono do trabalho ainda está vivo? | "passou do timeout, então morreu" | heartbeat + lease + fencing |
| O trabalho está avançando? | "passou do timeout, então travou" | progresso significativo (milestones) |
| Posso assumir o trabalho? | "passou do timeout, posso invadir" | lease expirado + fence incrementado |
| A operação falhou? | "passou do timeout, mate a missão" | expirar **a operação**, classificar, retry/fallback/replan |
| O sistema todo travou? | "mate tudo" | classificação por operação + circuit breaker + diagnóstico |

Consequências do padrão errado: **kill por wall-clock** de trabalho legítimo e lento,
**takeover destrutivo**, **concorrência dupla** sobre o mesmo recurso, **perda de
estado** e **falha de missão por lentidão** (não por defeito).

### 1.1 Padrões PROIBIDOS

Detectados e bloqueados pelo gate (`DESTRUCTIVE_PATTERNS` em `timeoutInventory.js`):

- `MISSION_KILL_BY_WALL_CLOCK` — encerrar missão/tarefa por tempo decorrido.
- `STALE_BY_AGE_ONLY` — considerar lock/lease/estado obsoleto **apenas** por idade (mtime/`locked_at`), sem consultar olease e o heartbeat.
- `PID_AS_LIVENESS_AUTHORITY` — usar `process.kill(pid, 0)`/PID como autoridade de liveness distribuída.

Adicionalmente: `TIMEOUT != PASS`. Um timeout **nunca** é convertido em sucesso, em
progresso ou em aprovação de gate.

---

## 2. Taxonomia (15 categorias)

Cada site de timeout no código é classificado em exatamente uma categoria. O
inventário é **automático e versionado** (`npm run validate:timeout-architecture`
regera o relatório com o array completo de sites).

| # | Categoria | Pergunta que responde | Ação na expiração |
|---|---|---|---|
| 1 | `OPERATION_DEADLINE` | Limite de **uma** operação/tentativa | cancelar / retry / fallback / replan |
| 2 | `REQUEST_TIMEOUT` | Chamada HTTP interna/externa | abortar a requisição (AbortSignal local) |
| 3 | `DATABASE_TIMEOUT` | Query / conexão / transação | rollback, retry seguro ou `BLOCKED_INFRA` |
| 4 | `PROVIDER_TIMEOUT` | Chamada a provider de IA | marcar **tentativa**, retry → fallback |
| 5 | `COMMAND_DEADLINE` | Comando externo/shell | cooperativo (SIGTERM) → grace → SIGKILL **do filho** |
| 6 | `LEASE_DURATION` | Por quanto o dono executa sem renovar | `RECOVER` — libera ownership, **não** falha a missão |
| 7 | `HEARTBEAT_INTERVAL` | Sinal de liveness | não "expira"; a **ausência** é o sinal |
| 8 | `NO_PROGRESS_TIMEOUT` | Worker vivo sem avanço | `DIAGNOSE` — inspecionar e decidir |
| 9 | `RETRY_BACKOFF` | Espera entre tentativas | exponencial + jitter + proteção de storm |
| 10 | `POLL_INTERVAL` | Cadência de polling | não é deadline; nunca autoridade |
| 11 | `TEST_TIMEOUT` | Execução de teste | estado `TIMEOUT` (nunca `PASS`) |
| 12 | `SHUTDOWN_GRACE_PERIOD` | Janela de encerramento gracioso | escalar para kill forçado |
| 13 | `DELAY_SLEEP` | Espera intencional | não é limite |
| 14 | `USER_DEFINED_DEADLINE` | Deadline explícito do usuário/política | único caso que **pode** encerrar a missão |
| 15 | `LEGACY_UNKNOWN_TIMEOUT` | Não classificado | **deve ser 0** (hoje: 0) |

**Estado medido:** 1 962 arquivos varridos, **640 sites** classificados,
`LEGACY_UNKNOWN_TIMEOUT = 0`, `destructiveFindings.forbiddenTotal = 0`,
kills de missão/tarefa por relógio = **0**.

---

## 3. Registry de políticas

`config/timeout-policy.json` (`_artifactType: TIMEOUT_POLICY_REGISTRY`) é a **fonte
única** de durações. Nada define timeout "no lugar", com número solto.

Cada política declara: `category`, `configClass`, `default`, `min`, `max`, `unit`,
`retryable`, `retry`, `fallback`, `onExpiry`, `onExpiryDetail`, `envOverride`.

`configClass`:

- `staticDefault` — versionado, sem auto-tuning.
- `runtimeConfigurable` — sobrescrevível por env/config **dentro de `[min,max]`**.
- `tenantSpecific` — variável por tenant, respeitando `[min,max]`.
- `engineeringSpecific` — específico do Engineering Router/Missions.

### 3.1 Semânticas que não podem ser confundidas

- **`LEASE_DURATION`** — por quanto o dono executa sem renovar. Expirar **não falha
  a missão**: apenas libera ownership (takeover com fence novo).
- **`HEARTBEAT_INTERVAL`** — liveness. Deve ser **muito menor** que a lease
  (padrão: 10 s vs 60 s). **Não conta como progresso.**
- **`NO_PROGRESS_TIMEOUT`** — tempo sem progresso significativo **com worker vivo**.
  Dispara **investigação**, nunca kill imediato.
- **`OPERATION_DEADLINE`** — limite da operação concreta. Expira → cancelar/retry/
  fallback/replan. **Não** é limite de missão.
- **`USER_DEFINED_DEADLINE`** — deadline explícito propagado como orçamento
  (`remainingBudget`) aos filhos.
- **`MISSION_WALL_CLOCK`** — **PROIBIDO** no caminho crítico
  (`missionPolicy.wallClockMissionTimeout: null`).

### 3.2 Valores de referência

| Política | Default | Min | Max | onExpiry |
|---|---|---|---|---|
| `LEASE` | 60 s | 15 s | 15 min | `RECOVER` |
| `HEARTBEAT` | 10 s | 1 s | 5 min | `NONE` |
| `NO_PROGRESS` | 15 min | 1 min | 6 h | `DIAGNOSE` |
| `PROVIDER_REQUEST` | 120 s | 5 s | 15 min | `RETRY` |
| `PROVIDER_FALLBACK` (budget) | 10 min | 30 s | 1 h | `BLOCKED` |
| `SHELL_COMMAND` | 10 min | 1 s | 2 h | `KILL_CHILD_PROCESS` |
| `DATABASE_QUERY` | 15 s | 1 s | 5 min | `CANCEL_OPERATION` |
| `DATABASE_CONNECT` | 30 s | 1 s | 5 min | `BLOCKED` |
| `HTTP_INTERNAL` | 30 s | 1 s | 5 min | `CANCEL_OPERATION` |
| `HTTP_EXTERNAL` | 45 s | 1 s | 10 min | `CANCEL_OPERATION` |
| `UNIT_TEST` | 10 s | 1 s | 60 s | `FAIL_TASK` |
| `INTEGRATION_TEST` | 120 s | 5 s | 15 min | `FAIL_TASK` |

`NO_PROGRESS` tem **threshold por fase** (`perPhase`): `ANALYZING` 10 min,
`IMPLEMENTING` 20 min, `TESTING` 30 min, `REVIEWING` 15 min, `REGRESSION` 45 min.
Um limite único para todas as fases seria incorreto: `REGRESSION` fica longo sem
transição de fase mas **continua emitindo progresso** (eventos de teste).

---

## 4. Hierarquia e propagação de orçamento

```
USER_DEFINED_DEADLINE (missão)
   └── orçamento restante (remainingBudget)
        └── TASK deadline
             └── OPERATION deadline
                  └── PROVIDER_REQUEST / COMMAND / DB / HTTP
```

`resolveTimeoutPolicy()` resolve a política efetiva, aplica **clamp** em `[min,max]`
e **reporta o clamp** (nunca ajusta em silêncio).
`computeEffectiveDeadline()` calcula o deadline efetivo considerando o
`remainingBudget` do pai — um filho **nunca** recebe prazo maior que o orçamento que
o pai ainda tem.

O deadline é sempre **absoluto e propagado**, não recalculado localmente por cada
camada.

---

## 5. Classificação e registro de expiração

`classifyOperationError()` separa falha de **operação** de falha de **sistema**.

`buildExpiryRecord()` produz o registro completo de telemetria:

- categoria da política, política aplicada, duração efetiva;
- operação, tentativa, fase, worker, missão/task;
- classificação (`TIMEOUT` vs `INFRA_ERROR` vs `BLOCKED`);
- se houve retry/fallback/replan;
- `killsMission` — **`true` apenas** para `USER_DEADLINE_EXCEEDED` e
  `MISSION_BUDGET_EXCEEDED`;
- `killsWorker` — **sempre `false`**.

Ou seja: por construção, expiração de operação **não derruba worker nem missão**.

`computeBackoffMs()` implementa o backoff de `RETRY_BACKOFF` (exponencial + jitter +
proteção contra retry storm) e `buildChildTerminationPlan()` descreve o plano de
encerramento de processo filho (SIGTERM → grace → SIGKILL), sempre **do filho**,
preservando stdout/stderr e diagnóstico antes de matar.

---

## 6. Liveness: heartbeat + lease + fencing

Liveness **não** é PID. Liveness é **sinal renovado dentro da janela**.

### 6.1 Regra central (`qa-mesh/meshLease.js`)

- heartbeat **fresco** ⇒ lease **`ACTIVE`** — **mesmo que o PID esteja morto**;
- heartbeat **obsoleto** ⇒ lease **`EXPIRED`** — **mesmo que o PID esteja vivo**
  (caso `lease_expired_pid_recycled`: o PID foi reciclado por outro processo).

`isPidAlive()` é **apenas corroborativo** — nunca autoridade.

### 6.2 Fencing

Toda aquisição carrega `instanceId`. Takeover **incrementa o fence**. Um dono
anterior que "volte à vida" é rejeitado pelo fence: **não existe escrita de dois
donos**. Lease é renovável (`heartbeatLease`) e liberável (`releaseLease`).

### 6.3 Aplicação

- `api/services/qaMeshService.js`, `qa-mesh/meshScheduler.js`, `qa-mesh/meshRunner.js`
  usam lease+fence; `cleanStaleLocks` **não é mais baseado em mtime**.
- `api/services/engineeringMission/missionStoreService.js`: `lockMission` só toma o
  lock se `lockFreeOrMine` **E** `leaseFreeOrMine` — o takeover por idade foi extinto.

---

## 7. Progress detection: a única resposta para "travou?"

`engine/engineeringMission/progressPolicy.js`.

- `PROGRESS_SIGNALS` (10) — progresso **funcional** real (transições de fase,
  milestones, artefatos, veredito de teste, patch aplicado etc.).
- `NON_PROGRESS_SIGNALS` — `heartbeat`, `lease_renewal`, `poll_tick`, `keepalive`.
  São **liveness**, nunca progresso: `isMeaningfulSignal()` os **rejeita**.
- `recordProgress()` — milestone **nunca anda para trás**.
- `evaluateProgress()` — sem milestone registrado ⇒ **`UNKNOWN`**, nunca "travado".
  Ausência de dado **não** é veredito.
- `NO_PROGRESS_ACTIONS` (7) — inspecionar operação, capturar diagnóstico, classificar
  e **decidir**: `wait | cancel operation | retry | switch provider | restart child |
  replan | escalate`. **Nenhuma** delas é kill ou takeover.

Persistência real: colunas `last_progress_at`, `last_progress_signal`, `progress_count`
em `engineering_missions` e `engineering_tasks`
(migration `api/db/migrations/20260926130000-engineering-progress-tracking.js`),
com adaptador explícito DB ↔ núcleo puro
(`last_progress_at` ↔ `lastMeaningfulProgressAt`) em `progressRecordFromRow()`.

---

## 8. Retry, fallback, circuit breaker e checkpoint/resume

- **Retry** — por classe de erro. Retentáveis: `PROVIDER_TIMEOUT`, `PROVIDER_5XX`,
  `NETWORK_ERROR`, `RATE_LIMITED`, `DB_CONNECTION`, `DB_DEADLOCK`,
  `DB_SERIALIZATION_FAILURE`. **Não** retentáveis: `AUTH_FAILURE`, `INVALID_INPUT`,
  `POLICY_VIOLATION`, `CONTEXT_LENGTH_EXCEEDED`. Backoff exponencial com jitter e
  proteção contra storm.
- **Fallback** — esgotado o retry, muda de provider sob `PROVIDER_FALLBACK`
  (orcamento com guardas: máx. 6 tentativas, US$ 25, 10 min). Esgotado o orçamento ⇒
  `PROVIDER_EXHAUSTED` / `BLOCKED_EXTERNAL_DEPENDENCY` — **não é crash**, é decisão
  do Router (replanejar).
- **Circuit breaker** — health por provider/serviço. `DATABASE_CONNECT` expirado ⇒
  `BLOCKED_INFRA` **com circuit breaker compartilhado**, evitando retry storm contra
  infraestrutura indisponível.
- **Checkpoint/resume** — o trabalho não é reiniciado do zero após recuperação; o
  estado é retomado do último checkpoint consistente.

---

## 9. Sinais auxiliares de liveness (não substituem progresso)

Para comandos longos: `stdoutActivity`, `stderrActivity`, `testEventStream`,
`processCpu`, `checkpointFiles`. Um comando que produz saída **está vivo**, mesmo em
silêncio longo aos olhos de um timer ingênuo. SIGKILL só depois de
`cancelRequested: true` + `gracePeriodMs` (`SHUTDOWN`).

---

## 10. Enforcement e prova

```bash
npm run validate:timeout-architecture        # inventário + 10 capacidades + proibições
npm run verify:timeout-architecture-e2e      # 4 cenários em runtime REAL (requer DB)
```

O gate é **bloqueante** e está no agregado `validate:governance-enforcement`.

### 10.1 Como ele evita auto-engano

- A evidência de runtime deve vir do **produto** (`api|engine|lib|src|qa-mesh|pipeline`)
  — o validador **não aceita a si mesmo** como prova (`RUNTIME_EVIDENCE_RE`).
- Capacidades são checadas com semântica explícita `any` (OR) / `all` (AND) — o
  "qualquer" não é lido como "todos".
- Comentários e strings são **removidos antes** do scan (`stripCommentsAndStrings`,
  preservando posições): prosa não é código.
- Nomes não-duração são rejeitados (`timeoutId`, `timeoutPolicy`, `bottleneck`).
- Padrões destrutivos exigem `/g`/loop real — sem isso o scan não avança
  (proteção contra falso positivo **e** contra travamento do próprio scanner).

### 10.2 Capacidades verdes (10/10)

`LEASE`, `FENCING`, `HEARTBEAT`, `NO_PROGRESS_DETECTION`,
`PROVIDER_TIMEOUT_ISOLATION`, `PROVIDER_FALLBACK`, `COMMAND_TIMEOUT_ISOLATION`,
`DATABASE_TIMEOUT_ISOLATION`, `CIRCUIT_BREAKER`, `CHECKPOINT_RESUME`.

### 10.3 Prova em runtime real (4/4 PASS)

| Cenário | O que prova |
|---|---|
| `LONG_RUNNING_TASK` | heartbeat renova lease; progresso registrado; tarefa longa **não** é listada como expirada |
| `REAL_DEAD_WORKER_RECOVERY` | worker morto é recuperado por lease/fence, não por relógio |
| `NO_PROGRESS_E2E` | ausência de progresso **com heartbeat vivo** dispara diagnóstico, não kill |
| `PROVIDER_FALLBACK_E2E` | timeout de provider isolado → retry → fallback → plano, sem matar missão |

### 10.4 Regressões

`tests/unit/timeoutArchitectureMatrix.test.js` (30 casos, matriz TIMEOUT-01..25),
`tests/unit/qaMeshLease.test.js` (10), `tests/unit/engineeringMissionProgressPolicy.test.js` (10).

---

## 11. Como adotar (para quem escreve código novo)

1. **Não invente número de timeout.** Resolva a política:
   `resolveTimeoutPolicy('<POLITICA>')` a partir de `config/timeout-policy.json`.
2. **Não use PID nem idade** para decidir liveness/ownership: use
   `heartbeat` + `decideMeshLease()`/`lockMission` e **fence** no takeover.
3. **Não mate missão por tempo.** Se precisa de limite de missão, use
   `USER_DEFINED_DEADLINE`/budget — e propague com `computeEffectiveDeadline()`.
4. **Ao expirar, registre** com `buildExpiryRecord()` e classifique a operação
   (`classifyOperationError()`); retry/fallback conforme a classe do erro.
5. **Para saber se travou**, registre **progresso significativo**
   (`recordProgress()`); `heartbeat`/`poll` **não** contam.
6. **Ao encerrar filho**, use `buildChildTerminationPlan()`:
   cooperativo → grace → forçado, preservando diagnóstico.
7. Rode `npm run validate:timeout-architecture` antes de concluir.

Uma operação pode morrer mil vezes sem que a missão morra uma só.
