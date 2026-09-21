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

- RED reproduced: por inspeção de código — `executeRoutedLoop`, no outcome `ADVANCE`, apenas
  chamava `transitionTask(taskId, 'REGRESSION')` e `transitionTask(taskId, 'GOVERNANCE')` em
  sequência, sem executar nem verificar nada real entre elas. `status` dizendo REGRESSION/
  GOVERNANCE nunca era evidência de que algo determinístico tinha rodado.
- fix: novo `regressionGovernanceService.js` — `checkRegression(attemptId)` reler do banco
  (não confia na variável em memória do loop) que TODO `EngineeringTestRun` da tentativa é
  PASS/exitCode 0 (reprova explicitamente se não houver nenhum testRun persistido);
  `checkGovernance()` executa de verdade, como subprocess real, o gate canônico já existente
  (`scripts/governance/validate-engineering-router-v1.js`) — nunca reimplementa governança.
  `executeRoutedLoop` agora persiste a evidência real (`regression_evidence`/
  `governance_evidence`, nova migration em `engineering_attempts`) e vai para RED
  (`REGRESSION_FAILED`/`GOVERNANCE_FAILED`) se qualquer checagem reprovar — só chega em GREEN
  se as duas passarem de verdade.
- tests: `tests/integration/engineeringRegressionGovernanceService.test.js` (5/5 PASS) — DB
  real: todos os testRuns PASS aprova; um FAIL real reprova; ausência de testRun reprova;
  execução real do gate canônico aprova no estado atual do repo; reprovação real propagada
  corretamente (subprocess mockado só para simular reprovação sem quebrar o gate real).
  `tests/integration/engineeringRouterRegressionGovernanceGate.test.js` (1/1 PASS) — prova de
  ORQUESTRAÇÃO ponta a ponta: CODER/TESTING/REVIEWER todos aprovam de verdade (infra real), mas
  GOVERNANCE mockado para reprovar faz a task terminar RED com `GOVERNANCE_FAILED`, nunca GREEN
  decorativo.
- evidence: gate `REAL_REGRESSION_CHECK` + `REAL_GOVERNANCE_CHECK` +
  `REGRESSION_GOVERNANCE_CAN_FAIL`.
- status: GREEN

### ERV1-CLOSE-005 — Promotion do patch exato validado

- RED reproduced: por inspeção de código — o `git worktree` de uma tentativa era SEMPRE
  destruído ao final (`finally { destroyWorkspace(workspace) }`), inclusive quando GREEN.
  "Validado" e "existe no repositório real" eram coisas diferentes, e nada distinguia isso —
  GREEN só significava "o patch funcionou dentro de um diretório temporário que não existe
  mais".
- fix: novo `promotionService.js`. `runOneAttempt` passou a NÃO destruir o workspace num
  `ADVANCE` (`keepWorkspace=true`), devolvendo-o para `executeRoutedLoop` cuidar depois de
  REGRESSION+GOVERNANCE+PROMOTION (destruído sempre num `finally`, em qualquer saída).
  `promoteValidatedPatch`: (1) resolve o baseline real a partir do próprio workspace (`HEAD^`
  na tentativa) e bloqueia (`PROMOTION_TARGET_DIVERGED`) se o HEAD real do repositório mudou
  desde então; (2) `git add -A` + `write-tree` no workspace para obter o hash da árvore
  REALMENTE patcheada — achado real: `git apply` só toca o working tree, nunca o índice,
  então `HEAD^{tree}` sozinho continuava apontando para a árvore pré-patch (bug descoberto e
  corrigido durante a implementação desta mesma correção); (3) `git commit-tree` cria um commit
  real (nunca referenciado até o passo seguinte, nunca toca HEAD/branch atual/working tree);
  (4) `git diff --stat` confirma que o commit candidato difere do baseline (diff promovido ==
  diff validado); (5) `git branch -f engineering-router/candidates/<taskId>` aponta uma branch
  LOCAL dedicada para o commit — nunca `git push`, nunca merge, nunca publish; (6) smoke
  pós-promoção real: um `git worktree` NOVO a partir do commit candidato roda os MESMOS
  testCommands já validados. Task só chega em GREEN se a promoção completar; caso contrário
  (target divergiu, smoke falhou) vai para o novo estado terminal `READY_FOR_PROMOTION` —
  nunca RED, porque CODER/TESTE/REVIEW/REGRESSION/GOVERNANCE já passaram de verdade.
- tests: `tests/integration/engineeringPromotionService.test.js` (2/2 PASS, git real) —
  promoção com sucesso produz commit+branch reais cujo conteúdo tem exatamente o patch
  aplicado, nunca move o HEAD real; target divergido (baseline diferente do HEAD real) bloqueia
  a promoção com o motivo exato. `engineeringRouterFullLoopE2E.test.js` e
  `engineeringRouterModelRerouteE2E.test.js` continuam GREEN ponta a ponta, agora incluindo
  promoção real (branch candidata real criada e limpa no teardown do teste).
- evidence: gate `PROMOTION_SERVICE` + `PROMOTION_NEVER_PUSHES_OR_MERGES` +
  `PROMOTION_WIRED_BEFORE_GREEN`.
- status: GREEN
- nota: integração da branch candidata ao branch principal do time segue sendo, por decisão
  explícita da missão original, um passo humano fora do escopo do Router V1 — a branch fica
  real e inspecionável (`git log`/`git diff engineering-router/candidates/<taskId>`), pronta
  para esse fluxo oficial.

### ERV1-CLOSE-007 — Release Closure com autoridade real

- RED reproduzido (achado real, não fixture): `api/services/engineeringRouter/releaseClosureService.js`
  antes desta correção declarava `cleanReleaseState` a partir de um critério paralelo
  simplificado (`goNoGo.status==='GO' && finalReadiness.finalDecision.startsWith('PASS') &&
  releaseBlockers===0`), sem NUNCA checar se esses artefatos pertenciam ao run corrente.
  Confirmado ao vivo neste repositório: `governance/.current-run.json` (run corrente real)
  tinha `runId`/`sourceFingerprint` completamente diferentes de
  `qa-mesh/go-no-go-report.json` (evidência de um run do dia anterior) — o código antigo teria
  aceitado esse GO estrangeiro como válido para fechamento de release.
- fix: `releaseClosureService.js` reescrito para reutilizar autoridade JÁ EXISTENTE no
  projeto (nunca reimplementada em paralelo): `governance/shared/run-context.js::readRunContext`
  (mesma fonte de run corrente usada pelo resto da governança) e
  `governance/final-consistency-gate-report.json` (Final Consistency Gate já existente, que já
  agrega replay/readiness/package/governance/contamination/cross-engine numa única decisão
  GO/NO_GO). Nova função pura `isSameRun(artifact, currentRun)` exige `runId` E
  `sourceFingerprint` idênticos — qualquer artefato ausente, com decisão negativa, ou de outro
  run vira um motivo explícito em `lockReasons` (nunca um bloqueio genérico). Frontend
  (`EngineeringReleaseClosurePage.jsx`) passou a exibir "Mesmo run corrente?" por artefato, um
  card dedicado ao Final Consistency Gate, e uma caixa vermelha com o `lockReasons` exato.
- tests: `tests/integration/engineeringReleaseClosureAuthority.test.js` (novo) — 5 testes de
  unidade para `isSameRun` (runId+fingerprint iguais, runId diferente, fingerprint diferente,
  artefato nulo, run corrente nulo) + 2 testes de integração rodando `getReleaseClosure()` REAL
  contra o estado REAL do repositório/Postgres, provando que `cleanReleaseState` nunca é `true`
  com `lockReasons` não vazio, e que qualquer artefato fora do run corrente aparece com o motivo
  `*_FOREIGN_RUN`/`*_NOT_GO`/`*_MISSING` exato. 7/7 GREEN.
- evidence: gate `RELEASE_CLOSURE_USES_REAL_RUN_AUTHORITY` +
  `RELEASE_CLOSURE_NEVER_ACCEPTS_FOREIGN_RUN_EVIDENCE` + `RELEASE_CLOSURE_TEST_COVERAGE`
  (novos, incorporados a `scripts/governance/validate-engineering-router-v1.js`, gate completo
  GREEN com 78 checagens/0 falhas). Regressão relacionada ao Engineering Router (23 suítes/119
  testes) GREEN.
- status: GREEN

### ERV1-CLOSE-010 — Runtime certification

- RED reproduzido (achado real, não fixture): antes desta correção,
  `scripts/governance/validate-engineering-router-v1.js` provava apenas STRUCTURAL_PASS — que o
  código-fonte CONTÉM os padrões esperados (regex sobre arquivo). Nunca provava que o
  comportamento REALMENTE acontece: um teste quebrado silenciosamente, código morto, ou uma
  regressão introduzida depois do commit em que o check foi escrito passariam despercebidos.
  Levantando o inventário dos 20 itens de evidência de runtime exigidos pela missão, dois achados
  reais adicionais surgiram:
  1. **Bug real de estado terminal**: `acquireRunLock` (engineeringRouterService.js) checava
     estado terminal com uma lista hardcoded `['GREEN','RED','BLOCKED','CANCELLED']` em vez de
     `TERMINAL_STATES` — o MESMO bug já corrigido uma vez em `computeOverview()` quando
     `READY_FOR_PROMOTION` virou terminal (ERV1-CLOSE-005). Impacto real confirmado: `POST
     /engineering/tasks/:id/run` numa task `READY_FOR_PROMOTION` não caía no fast-path
     idempotente e ia direto para `lockForRun`, que rejeitava com `TASK_TERMINAL` — erro não
     tratado especificamente pela rota, virando **500** em vez do 200 idempotente correto.
     Corrigido importando `TERMINAL_STATES` da fonte única (commit `604ffd30`).
  2. **Lacuna real de evidência**: nenhum teste do repositório provava, ponta a ponta, o item
     "reviewer rejection→recode" — `engineeringCoderReviewerService.test.js` só provava o parsing
     isolado da decisão REJECT, nunca que a task inteira reage com uma nova tentativa real
     (persistida, com o failureBundle do reviewer) em vez de travar/RED direto. Corrigido com um
     novo teste E2E real (`engineeringRouterReviewerRejectionRecodeE2E.test.js`).
  3. **Deadlock de bootstrap descoberto ao ligar RUNTIME_PASS no modo padrão do gate**: este MESMO
     script é invocado como subprocess por `checkGovernance()`
     (`regressionGovernanceService.js`), chamado dentro do estágio GOVERNANCE de TODA
     EngineeringTask real — caminho quente do próprio loop de auto-melhoria. Exigir evidência de
     runtime sempre fresca (fingerprint exato) ali travaria toda task real em GOVERNANCE_FAILED
     (evidência nunca pode ficar fresca a tempo, pois gerá-la exige rodar testes que passam pelo
     próprio estágio GOVERNANCE). Confirmado ao vivo: `engineeringRouterFullLoopE2E.test.js`,
     `engineeringRouterModelRerouteE2E.test.js` e o novo teste de reject-recode passaram a falhar
     com `GOVERNANCE_FAILED` assim que RUNTIME_PASS foi ligado incondicionalmente.
- fix: gate reestruturado em duas categorias reais, nunca uma "best effort" que pode ser ignorada:
  - `STRUCTURAL_PASS` — todos os checks estruturais pré-existentes (82 checks), executados
    SEMPRE, inclusive pelo `checkGovernance()` do loop ao vivo — comportamento inalterado ali,
    exatamente para não reintroduzir o deadlock de bootstrap.
  - `RUNTIME_PASS` — novo, ativado só com a flag explícita `--runtime` (nunca no modo padrão).
    `scripts/governance/collect-engineering-router-runtime-evidence.js` (novo) executa de
    verdade, via Jest, o teste real que prova cada um dos 20 itens de evidência de runtime
    exigidos pela missão (injeção de shell rejeitada, ambiente seguro, redação multiline,
    boundary de path do patch, apply real de patch, RED determinístico, RED→FIX, review
    independente, reviewer reject→recode, execução real de regressão, execução real de
    governança, reroute de provider/modelo, restart/resume, promoção controlada, verificação
    pós-promoção, autorização DEVELOPMENT, negação PRODUCTION, negação SUPPORT por padrão,
    isolamento de credencial por tenant, integridade same-run do release closure), captura o
    exitCode REAL de cada execução e persiste em
    `reports/engineering-router-v1-runtime-evidence.json` amarrado ao
    `sourceFingerprint` REAL da working tree (reaproveitando
    `governance/proof-engine/fingerprint-chain.js::computeSourceFingerprint` — mesma autoridade
    já usada pelo resto da governança do RAP, nunca um hash paralelo). O gate em modo `--runtime`
    rejeita explicitamente evidência ausente, de outra versão do código (fingerprint divergente)
    ou com qualquer item de exitCode != 0 — nunca aceita "já rodou algum dia" como prova de
    comportamento atual.
- tests: os 20 itens de runtime são testes já existentes (ou os dois novos criados aqui:
  `engineeringRouterReviewerRejectionRecodeE2E.test.js` e o já testado em
  `tests/integration/engineeringTaskConcurrencyAndRestart.test.js` cobrindo o bug do
  `acquireRunLock`) — nenhum teste-fantasma criado só para "passar o gate". Regressão completa do
  Engineering Router (25 suítes) GREEN após a correção; `npm run
  validate:engineering-router-v1:runtime` roda a coleta + o gate em `--runtime` e confirma
  `RUNTIME_PASS` real (20/20 itens, exitCode 0, fingerprint fresco).
- evidence: gate `RUNTIME_CERTIFICATION_COLLECTOR_EXISTS` +
  `RUNTIME_MODE_SEPARATED_FROM_LIVE_GATE` (novos, modo padrão) + os 21 checks `RUNTIME_*` (modo
  `--runtime`). Modo padrão: `STRUCTURAL_PASS`, 82 checks, 0 falhas. Modo `--runtime`:
  `STRUCTURAL_PASS`/`RUNTIME_PASS`, 103 checks, 0 falhas.
- status: GREEN

## Relatório final (preenchido ao fim)

FINAL: PENDENTE
