# ENGINEERING_ROUTER_V1_CLOSURE.md

Missão: RELEASE_CLOSURE HARDENING do Engineering Model Router V1. Fechar os 10 blockers
congelados abaixo com teste-primeiro, evidência de runtime real, e um piloto real promovido ao
source antes de declarar GO. Sem V2, sem redesenho, sem novas frentes.

## Baseline

```
BASELINE_HEAD: 6f5b5d690b772ccd066059659ad234d3ab5d1f1b
BASELINE_SOURCE_FINGERPRINT: d4c4d01597a07d7003b4d27129e2572e2f06e9e0f28def5dcfaba3097d68dc01
  (governance/proof-engine/fingerprint-chain.js::computeSourceFingerprint — autoridade canônica
  já existente no projeto, reutilizada aqui sem reimplementar)
STARTED_AT: 2026-09-21T05:30:00Z (aprox., início desta missão de fechamento)
CLOSURE_BACKLOG_VERSION: 1.0.0
GIT_STATUS_AT_BASELINE: working tree limpo (sem alterações pendentes)
```

Gate estrutural na baseline: `node scripts/governance/validate-engineering-router-v1.js` →
`status=PASS checks=44 falhas=0`.

## Escopo congelado (10 blockers, ordem de execução obrigatória)

1. ERV1-CLOSE-001 — Eliminar execução arbitrária de shell no Test Runner
2. ERV1-CLOSE-002 — Isolar environment dos testes + redaction de output
3. ERV1-CLOSE-003 — SecretRedaction multiline/whole-document
4. ERV1-CLOSE-006 — Separar credential scope de tenant/event scope
5. ERV1-CLOSE-008 — Model-level availability + reroute
6. ERV1-CLOSE-009 — Restart/resume + concorrência
7. ERV1-CLOSE-004 — Regression e Governance reais
8. ERV1-CLOSE-005 — Promotion do patch exato validado
9. ERV1-CLOSE-007 — Release Closure com autoridade real
10. ERV1-CLOSE-010 — Runtime certification

## Blockers

### ERV1-CLOSE-001 — Execução de comandos

- RED reproduced: `tests/unit/engineeringRouterCommandExecutionSecurity.test.js` — 5 de 7
  payloads de injeção (`;`, `&&`, `||`, `$()`, backtick) executaram efeito colateral real
  (criação de arquivo marcador via `touch`) contra o `testRunnerService.runTestCommands` real,
  antes da correção. Root cause: `spawn(command, {shell:true})` + allowlist por
  `startsWith()`/blocklist de padrões específicos (não fronteira real).
- fix: `engine/engineeringRouter/commandPolicy.js` reescrito — `FORBIDDEN_SHELL_CHARS_RE`
  rejeita a string inteira se contiver qualquer metacaractere de shell; `parseCommand` tokeniza
  o que sobra (sem shell, sem expansão) e valida `{executable,args}` contra
  `validateStructuredCommand` (allowlist fechada por executável: npm/npx/jest/node/git, cada um
  com sua própria validação de argumentos — nunca uma string livre). `testRunnerService.js`
  passou a chamar `spawn(executable, args, {shell:false, ...})`.
- tests: `tests/unit/engineeringRouterCommandExecutionSecurity.test.js` (8/8 PASS),
  `tests/unit/engineeringRouterCommandPolicy.test.js` (6/6 PASS, sem regressão),
  `tests/integration/engineeringPatchApplyAndTestRunner.test.js` (4/4 PASS, comando real ainda
  executa via git worktree real).
- evidence: gate `NO_SHELL_TRUE_TEST_RUNNER` + `STRUCTURED_COMMAND_EXECUTION` +
  `COMMAND_POLICY_SHELL_METACHAR_BLOCK` em `validate-engineering-router-v1.js`.
- status: GREEN

### ERV1-CLOSE-002 — Safe environment + output redaction

- RED reproduced: analisado por inspeção de código — `runOneCommand` passava
  `env: {...process.env}` para todo subprocess; qualquer patch podia rodar um teste que
  imprime `process.env` e vazar segredo real do processo pai para stdout/stderr, evidência em
  disco e excerpt no banco.
- fix: novo `api/services/engineeringRouter/safeEngineeringEnvironment.js` —
  `buildSafeTestEnv({cwd})` passa só um allowlist fixo de chaves não-secretas
  (PATH/NODE_ENV/CI/LANG/LC_ALL/TMPDIR/...) e força `HOME=cwd` (workspace isolado, nunca o HOME
  real do host). `testRunnerService.js` usa isso no lugar de `{...process.env}`, e passou a
  aplicar `redactText` (secretRedaction) em stdout/stderr ANTES de persistir em
  disco/excerpt/DB — nunca a saída bruta do subprocess.
- tests: `tests/unit/engineeringRouterSafeEnvironment.test.js` (3/3 PASS) — injeta
  `OPENAI_API_KEY`/`JWT_SECRET`/`DATABASE_PASSWORD`/`AMI_SECRET` falsos reais no
  `process.env` do processo de teste, confirma por grep real em todo `EVIDENCE_ROOT` que
  nenhum valor aparece em disco, e confirma que `HOME` do subprocess é o workspace isolado, não
  `os.homedir()`.
- evidence: gate `NO_FULL_ENV_PASSTHROUGH_TEST_RUNNER` + `SAFE_TEST_ENVIRONMENT` +
  `TEST_OUTPUT_REDACTION`.
- status: GREEN
- nota (POST_RELEASE_HARDENING): V1 não implementa `credentialRef` para injeção explícita de
  segredo em teste — nenhum Task Contract real precisa disso hoje (testCommands são sempre
  npm/jest/git), e negar tudo por padrão é mais seguro que construir esse mecanismo sem caso de
  uso real.

### ERV1-CLOSE-003 — Secret redaction multiline

- RED reproduced: por inspeção de código — `redactContent` fazia `content.split('\n')` e
  aplicava os padrões (incluindo o de chave privada, que é multiline por natureza) linha a
  linha; nenhuma linha isolada de um PEM/RSA/OpenSSH contém `-----BEGIN` e `-----END` ao mesmo
  tempo, então o padrão nunca casava.
- fix: extraído `MULTILINE_BLOCK_PATTERNS` (chave privada) e nova função
  `redactBlockSecrets(content)` que roda sobre o CONTEÚDO INTEIRO antes do split em linhas.
  Pipeline: bloco multiline → linha a linha (env assignment + tokens de uma linha) →
  truncamento (já existente no Test Runner). Novo `redactText(text)` exportado para uso direto
  em stdout/stderr (ERV1-CLOSE-002).
- tests: `tests/unit/engineeringRouterSecretRedactionMultiline.test.js` (9/9 PASS) — PEM
  genérico, RSA, OpenSSH, múltiplos blocos no mesmo conteúdo, mistura com secret de uma linha
  só, idempotência, bearer token.
- evidence: gate `SECRET_REDACTION_MULTILINE`.
- status: GREEN

### ERV1-CLOSE-006 — Credential scope isolation

- RED reproduced: achado real, não teórico — introduzido pela própria sessão anterior desta
  missão (feature de feedback em tempo real via WebSocket). `api/modules/engineering-router/
  routes.js` resolvia `tenantId = req.tenantId || req.agent?.tenantId` e passava ESSE MESMO
  valor para `engineeringRouterService.runTask({tenantId})`, que usava o valor único tanto para
  `emitTaskStage` (audiência do evento) quanto para `buildAvailableModels({tenantId})` e
  `generatePatch/review({tenantId})` — e `aiProviderService.js` usa `context.tenantId`
  DIRETAMENTE em `getDecryptedAPIKey(tenantId, provider)` para resolver a API key real. Um
  usuário comum do tenant cliente que cria e roda uma Engineering Task fazia o Router gastar a
  credencial/budget de IA DAQUELE TENANT para enviar código-fonte real do RAP.
- fix: `engineeringRouterService.js` separa `credentialScope` (default fixo
  `ENGINEERING_CREDENTIAL_SCOPE` = `DEFAULT_TENANT_ID`/`SYSTEM_ENGINEERING`, nunca sobrescrito
  pela rota) de `eventAudienceTenantId` (tenant real de quem chama, só para o WebSocket).
  `routes.js` só constrói `eventAudienceTenantId` a partir do agente autenticado — nunca mais
  `tenantId`/`credentialScope`.
- tests: `tests/unit/engineeringRouterRoutes.test.js` (novo caso: agente com
  `tenantId: 'tenant-cliente-real'` — confirma que `runTask` recebe `eventAudienceTenantId`
  igual ao tenant do agente e NUNCA recebe `credentialScope`/`tenantId`);
  `tests/integration/engineeringRouterFullLoopE2E.test.js` (continua confirmando, ponta a
  ponta com infra real, que `credentialScope` explícito chega intacto ao `context.tenantId` da
  chamada real de IA).
- evidence: gate `CREDENTIAL_SCOPE_ISOLATION` +
  `ROUTE_NEVER_PASSES_CALLER_TENANT_AS_CREDENTIAL_SCOPE`.
- status: GREEN

### ERV1-CLOSE-008 — Model-level availability + reroute

- RED reproduced: por inspeção de código — `runOneAttempt` tratava QUALQUER erro
  `PROVIDER_UNAVAILABLE` do CODER/REVIEWER como `outcome:'FATAL'`, indo direto para RED sem
  tentar nenhum outro candidato qualificado. Achado real do próprio pilot desta missão
  (documentado em `ENGINEERING_MODEL_ROUTER_MANUAL.md`): `openai:gpt-5.5-pro`/`gpt-5-codex`
  retornaram 404 real ("modelo não existe") enquanto `openai` em si estava saudável — o
  circuit breaker nunca abre por isso (erro de modelo, não de provider).
- fix: novo `modelAvailabilityStore.js` (estado em memória com TTL, mesmo padrão do circuit
  breaker) rastreia disponibilidade por `providerId:modelId` (`AVAILABLE|UNAVAILABLE|RETIRED|
  AUTH_DENIED|RATE_LIMITED|TEMPORARILY_UNAVAILABLE`), classificando a falha real
  (`classifyModelFailure`). `modelSelector.evaluateCandidate` passou a checar `model.available`;
  `selectForRole`/`selectCoderAndReviewer` aceitam `excludedModelKeys` para excluir
  explicitamente modelos que já falharam NESTA execução da task.
  `engineeringRouterService`: falha `PROVIDER_UNAVAILABLE` do CODER/REVIEWER agora retorna
  `outcome:'REROUTE'` (marca o modelo indisponível) em vez de FATAL; `executeRoutedLoop`
  reseleciona `{coder,reviewer}` excluindo os modelos já marcados e continua a MESMA task —
  só vai a RED (`NO_ALTERNATIVE_CANDIDATE`) se não sobrar nenhum candidato.
- tests: `tests/integration/engineeringRouterModelRerouteE2E.test.js` (1/1 PASS) — infra real
  (DB, git worktree, jest real): provider `anthropic` (3 modelos CODER-qualificados) sempre
  falha com 404 real; o Router reroteia pelos 3 modelos anthropic até `mistral` (único
  candidato saudável restante) e chega em GREEN na mesma task, com o histórico de tentativas
  provando o provider quebrado e o `routing_decision` final apontando para o que funciona.
- evidence: gate `MODEL_LEVEL_AVAILABILITY` + `MODEL_REROUTE_WITHIN_TASK` +
  `MODEL_SELECTOR_RESPECTS_AVAILABILITY`.
- status: GREEN

### ERV1-CLOSE-009 — Restart/resume + concorrência

- RED reproduced: `lockForRun` (SELECT...FOR UPDATE, stale-lock recovery) já existia e
  funcionava — mas NUNCA tinha teste algum comprovando isso, e a rota HTTP tinha um bug real:
  `POST /run` chamava `runTask(...)` SEM `await` (fire-and-forget) e só `runTask` fazia
  `lockForRun` — ou seja, o try/catch da rota nunca via o erro `TASK_ALREADY_RUNNING`, que só
  era logado via `.catch()`. Duas chamadas concorrentes de `/run` na mesma task sempre
  recebiam 202+202, mesmo quando a segunda nunca chegava a rodar de verdade — o chamador nunca
  sabia. Também não existia nenhuma limpeza de workspace órfão se o PROCESSO (não uma exceção
  JS) morresse no meio de uma tentativa — o `finally` que chamaria `destroyWorkspace` nunca
  roda nesse caso.
- fix: `engineeringRouterService.js` ganhou `acquireRunLock`/`runLockedTask`/`beginRun` —
  `beginRun` adquire o lock de forma SÍNCRONA (awaited) e só DEPOIS dispara a execução longa em
  background; `routes.js` agora usa `await deps.engineeringRouterService.beginRun(...)`, então
  uma segunda chamada concorrente recebe `TASK_ALREADY_RUNNING` → 409 de verdade, antes de
  qualquer resposta ser decidida. Novo `patchApplyService.pruneOrphanedWorkspaces()` varre
  workspaces reais (`git worktree list --porcelain`) sob `WORKSPACE_ROOT` mais velhos que um
  TTL e os remove — chamado no boot do servidor (`startServerRuntime.js`), nunca toca no
  worktree principal do repositório.
- tests: `tests/integration/engineeringTaskConcurrencyAndRestart.test.js` (4/4 PASS, Postgres
  real) — duas aquisições de lock concorrentes (uma ganha, outra `TASK_ALREADY_RUNNING` real),
  lock fresco rejeita intrusos, lock órfão (backdatado além do TTL) é recuperado por um runner
  diferente, task terminal nunca aceita lock novo.
  `tests/integration/engineeringRouterOrphanWorkspacePruning.test.js` (3/3 PASS) — workspace
  real backdatado é removido do disco E do `git worktree list`; workspace recente e o worktree
  principal do repositório nunca são tocados; pruning é idempotente.
  `tests/unit/engineeringRouterRoutes.test.js` (novo caso: `beginRun` lançando
  `TASK_ALREADY_RUNNING` → rota responde 409 real).
- evidence: gate `RESTART_SAFE_LOCK` + `CONCURRENCY_SAFE_ROUTE` + `ORPHAN_WORKSPACE_PRUNING`.
- status: GREEN
- nota (POST_RELEASE_HARDENING): promoção de patch (ERV1-CLOSE-005) ainda não existe na V1 —
  o cenário "restart não duplica promotion" da missão fica sem objeto até essa etapa existir;
  tratado no item 005 abaixo.

### ERV1-CLOSE-004 — Regression e Governance reais

- status: PENDENTE

### ERV1-CLOSE-005 — Promotion do patch exato validado

- status: PENDENTE

### ERV1-CLOSE-007 — Release Closure com autoridade real

- status: PENDENTE

### ERV1-CLOSE-010 — Runtime certification

- status: PENDENTE

## Relatório final (preenchido ao fim)

FINAL: PENDENTE
