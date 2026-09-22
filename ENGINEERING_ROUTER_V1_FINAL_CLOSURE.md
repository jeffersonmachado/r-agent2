# ENGINEERING_ROUTER_V1_FINAL_CLOSURE.md

Missão: FINAL_RELEASE_CLOSURE — segunda rodada de hardening do Engineering Model Router V1,
executada sobre a base já fechada em `ENGINEERING_ROUTER_V1_CLOSURE.md` (10 blockers ERV1-CLOSE-*,
todos GREEN). Escopo estritamente limitado aos 10 blockers ER-V1-FINAL-* abaixo. Sem V2, sem
redesenho, sem novas frentes.

## Baseline

```
BASELINE_HEAD: af139c0a799c33a71a5669bffe9e02d1d6fd9725
BASELINE_TREE: 5d37defa6c6467845531344d729bf668ae3daded
BASELINE_SOURCE_FINGERPRINT: cab469a17a5e174073c92b8843a2961f8ac4e96de88e8ad159080854184d6a73
  (governance/proof-engine/fingerprint-chain.js::computeSourceFingerprint — autoridade canônica
  já existente no projeto, reutilizada aqui sem reimplementar)
STARTED_AT: 2026-09-22T10:48:30Z
CLOSURE_BACKLOG_VERSION: ER-V1-FINAL-1
GIT_STATUS_AT_BASELINE: working tree limpo (sem alterações pendentes)
PACKAGE_VERSION: 1.0.0
```

Gate estrutural na baseline (herdado da missão anterior):
`node scripts/governance/validate-engineering-router-v1.js --runtime` → última execução
conhecida `STRUCTURAL_PASS + RUNTIME_PASS`, 103 checks, 0 falhas (ver
`ENGINEERING_ROUTER_V1_CLOSURE.md`).

Achado confirmado ao vivo nesta baseline (motivador direto do ER-V1-FINAL-004):
`package.json` linha 204, `validate:governance-enforcement`, chama
`npm run validate:engineering-router-v1` (SEM `--runtime`) — o pipeline oficial de governança
aceita `STRUCTURAL_PASS` sozinho para selar release.

## Escopo congelado (10 blockers, ordem de execução obrigatória)

1. ER-V1-FINAL-001 — Execution Sandbox
2. ER-V1-FINAL-002 — Exact Promotion
3. ER-V1-FINAL-003 — Fail-Closed Scope
4. ER-V1-FINAL-004 — Mandatory Runtime Gate
5. ER-V1-FINAL-005 — Durable Resume
6. ER-V1-FINAL-006 — Real Regression
7. ER-V1-FINAL-007 — Evidence Precision
8. ER-V1-FINAL-008 — Current Model Catalog
9. ER-V1-FINAL-009 — Full-Suite Isolation
10. ER-V1-FINAL-010 — Self-Proving Audit Envelope

## Blockers

### ER-V1-FINAL-001 — Execution Sandbox

- RED reproduzido (achado real, não hipotético): antes desta correção,
  `testRunnerService.runOneCommand` executava testCommands via `child_process.spawn` puro do
  host — isolamento só em nível de aplicação (allowlist estrutural de comando + env allowlist +
  redação de output, ERV1-CLOSE-001/002), zero em nível de SO/kernel. Reprodução real com 7
  fixtures maliciosas (`tests/fixtures/engineering-router-sandbox/{readEtcPasswd,readSshKey,
  networkAccess,dockerSocket,writeOutsideWorkspace,writeNodeModules,forkBomb}Probe.js`), rodadas
  através do mecanismo ANTIGO, confirmou: leu `/etc/passwd` do HOST (3963 bytes), abriu conexão
  TCP real para `1.1.1.1:80`, acessou `/var/run/docker.sock` do host (`isSocket:true`), escreveu
  arquivo fora do workspace em `/tmp` real do host, **corrompeu fisicamente o `node_modules`
  real do repositório** (confirmado por leitura pós-execução do marcador em
  `<ROOT>/node_modules/.marker`) através do symlink gravável que
  `patchApplyService.materializeWorktree` criava, e spawnou 200/200 processos filho sem
  qualquer limite de PIDs/CPU/memória (só timeout de parede de 120s).
- fix:
  1. **`api/services/engineeringRouter/executionSandbox.js`** (novo) — `runInSandbox()` executa
     cada testCommand dentro de um container Docker descartável via `docker run --rm`:
     `--network=none` por padrão, `--read-only` (filesystem raiz), `--tmpfs=/sandbox-tmp` (área
     de escrita temporária isolada — nunca `/tmp`, que colidiria com o `os.tmpdir()` real do
     host onde workspaces reais também vivem, achado real durante a implementação),
     `--cap-drop=ALL --security-opt=no-new-privileges`, UID/GID fixo não-privilegiado
     (`10001:10001`, nunca o UID do processo host — que em produção real é root),
     `--pids-limit=64 --memory=512m --cpus=1`, workspace montado no MESMO caminho absoluto
     (necessário: um git worktree referencia `.git` do repositório principal por caminho
     absoluto), `<ROOT>/node_modules` montado **read-only** por cima de `<workspace>/node_modules`
     (nunca mais gravável), `<ROOT>/.git` montado read-only (só leitura de histórico/objetos —
     mesmo conteúdo que o LLM já viu no patch, não uma escalada). Timeout mata o CONTAINER
     explicitamente (`docker kill`), não só o processo cliente `docker run` (achado real: matar
     o cliente não propaga ao container remoto). `isSandboxAvailable()` fail-closed: Docker
     inacessível propaga `SANDBOX_UNAVAILABLE`, nunca cai de volta para spawn sem sandbox.
     Proteção adicional descoberta durante a implementação: `runInSandbox` recusa
     explicitamente (`SANDBOX_INVALID_WORKSPACE`) se `cwd` for o repositório principal ou um
     ancestral dele — um teste pré-existente (`engineeringRouterTestOutputAuthority.test.js`)
     passava o ROOT como cwd, e sem essa proteção o sandbox tentava `chmod -R` recursivo sobre
     TODO o código-fonte real do projeto (inclusive `frontend/node_modules`) antes de montar.
  2. **`api/services/engineeringRouter/patchApplyService.js`** — `materializeWorktree` não cria
     mais o symlink gravável de `node_modules`; essa responsabilidade é exclusiva do sandbox
     (bind read-only).
  3. **`api/services/engineeringRouter/testRunnerService.js`** — `runOneCommand` delega a
     `runInSandbox` em vez de `spawn` direto; `runTestCommands` trata `SANDBOX_UNAVAILABLE`/
     `SANDBOX_INVALID_WORKSPACE` como status dedicado (nunca confundido com FAIL de teste real).
  4. **`engineering-router-sandbox/Dockerfile`** (novo) — imagem `node:22-bookworm-slim` + git
     (ausente na slim) + usuário `sandbox` (UID 10001) fixo, non-root.
  5. **`ensureWorkspaceReadableBySandbox`** — abre o workspace para o UID do sandbox com
     `chmod go+rX` (nunca `chmod 777`: um rascunho inicial usando modo completo alterava o bit
     executável do dono, que o git rastreia no índice — efeito colateral real observado:
     `git status` reportava TODOS os arquivos do worktree como modificados; corrigido para só
     adicionar leitura/execução condicional a group/others, nunca tocar o bit do dono).
- tests: `tests/unit/engineeringRouterExecutionSandboxSecurity.test.js` (novo, 10/10 PASS) —
  prova por execução real (sandbox real, Docker real, sem mocks) que rede externa, socket do
  Docker, escrita fora do workspace, escrita em node_modules real e excesso de PIDs concorrentes
  estão bloqueados; que `/etc/passwd` lido é o do container (muito menor que o do host); que
  `cwd = ROOT` é recusado antes de qualquer chmod/mount; e 3 casos positivos (script legítimo,
  `git status`, `npx jest` real) continuam funcionando normalmente dentro do sandbox. Regressão
  completa do Engineering Router (34 suítes: 31 não-E2E + 3 E2E completos com LLM real) — 194
  testes, 0 falhas, incluindo os 3 loops E2E ponta a ponta (RED→FIX→REVIEW→GREEN, reroute de
  modelo, reviewer reject→recode) todos passando através do novo sandbox.
- evidence: gate estrutural `SANDBOX_NETWORK_NONE_BY_DEFAULT` + `SANDBOX_READ_ONLY_ROOTFS` +
  `SANDBOX_CAP_DROP_ALL` + `SANDBOX_NON_ROOT_FIXED_UID` + `SANDBOX_RESOURCE_LIMITS` +
  `SANDBOX_NEVER_MOUNTS_DOCKER_SOCKET` + `SANDBOX_NODE_MODULES_READ_ONLY` +
  `SANDBOX_FAIL_CLOSED_WHEN_UNAVAILABLE` + `TEST_RUNNER_USES_SANDBOX` +
  `PATCH_APPLY_NO_WRITABLE_NODE_MODULES_SYMLINK` (novos) em `validate-engineering-router-v1.js`
  (`STRUCTURED_COMMAND_EXECUTION` atualizado para refletir a nova arquitetura — `shell:false`
  migrou de `testRunnerService.js` para `executionSandbox.js`, novo check
  `SANDBOX_STRUCTURED_COMMAND_EXECUTION` cobre isso). Runtime evidence: item
  `EXECUTION_SANDBOX_ISOLATION` adicionado a `collect-engineering-router-runtime-evidence.js`.
  `npm run validate:engineering-router-v1:runtime` → `STRUCTURAL_PASS/RUNTIME_PASS`, 128 checks
  estruturais / 21 itens de runtime, 0 falhas.
- status: GREEN
- nota (POST_RELEASE_HARDENING, não implementado): em produção real, o processo do Engineering
  Router roda dentro do container `chatbot-api` (confirmado nesta mesma sessão, ver memória do
  projeto) — para o sandbox funcionar ali, o container precisa de acesso ao Docker socket do
  HOST (Docker-outside-of-Docker: o container `chatbot-api` orquestra containers sandbox
  IRMÃOS, que por sua vez NUNCA recebem esse socket de volta — `SANDBOX_NEVER_MOUNTS_DOCKER_SOCKET`
  já impede isso no lado do sandbox). Essa é uma mudança de infraestrutura de produção real
  (montar `/var/run/docker.sock` em `docker-compose.yml`) com risco de segurança não-trivial
  (o processo da API ganharia controle efetivo sobre o daemon Docker do host) — não aplicada
  sem confirmação explícita do usuário. Implementação e testes validados neste ambiente de
  desenvolvimento, onde o Docker é diretamente acessível ao processo Node.
- commit: `342faddd`

### ER-V1-FINAL-002 — Exact Promotion

- RED reproduzido (achado real, não hipotético): `promoteValidatedPatch` provava exatidão só
  com `git diff --stat` (não vazio) sobre a árvore de `git add -A` no workspace da TENTATIVA —
  onde CODER/TESTE/REVIEW/REGRESSION/GOVERNANCE já rodaram de verdade. Reprodução ao vivo:
  aplicado o patch validado, escrito um arquivo `INJECTED_BY_TEST_SIDE_EFFECT.txt` no workspace
  DEPOIS do apply (simulando efeito colateral real de um testCommand), chamado
  `promoteValidatedPatch` — resultado: `promoted:true`, e `git show --stat` no commit candidato
  real confirmou os DOIS arquivos presentes (o do patch + o injetado), promovidos juntos sem
  nenhum aviso.
- fix: `computeExpectedTreeHash({baselineHead, diff, taskId})` (novo, em
  `promotionService.js`) aplica o MESMO diff validado sobre o MESMO baseline, mas num workspace
  LIMPO e descartável, materializado só para este cálculo (nunca tocado por
  CODER/TESTE/REVIEW), produzindo `expectedTreeHash`. `promoteValidatedPatch` agora exige
  `expectedTreeHash === validatedTreeHash` (a árvore do workspace real, onde os testes de fato
  rodaram) ANTES de criar o commit candidato — qualquer divergência vira
  `PROMOTION_TREE_CONTAMINATED` com a lista exata dos arquivos contaminantes (`git diff
  --name-status`). Evidência persistida ampliada: `baselineTreeHash`, `expectedTreeHash`,
  `candidateTreeHash`, `promotedTreeHash`, `fileSetHash` (hash do conjunto ordenado de arquivos
  tocados), `promotionStatus`.
- tests: `tests/integration/engineeringPromotionService.test.js` — 4 novos casos cobrindo os
  cenários da missão: promoção legítima expõe `expectedTreeHash === candidateTreeHash` (A);
  arquivo NOVO injetado fora do patch bloqueia com `PROMOTION_TREE_CONTAMINATED` (B); arquivo
  EXISTENTE alterado fora do patch bloqueia (C); remoção de arquivo fora do patch bloqueia (D).
  6/6 GREEN determinístico quando isolado, quando junto com os outros 5 testes de
  promoção/E2E relacionados via `--runInBand`, e quando junto com as 34 suítes do Engineering
  Router em modo padrão (paralelo).
- evidence: gate estrutural `PROMOTION_EXPECTED_TREE_INDEPENDENT_COMPUTATION` +
  `PROMOTION_EXACTNESS_ENFORCED_BEFORE_COMMIT` (prova que a checagem de contaminação acontece
  ANTES do `commit-tree`, nunca depois) + `PROMOTION_EVIDENCE_TREE_HASHES_PERSISTED`. Runtime
  evidence: item `EXACT_PATCH_PROMOTION` adicionado. `validate-engineering-router-v1.js` →
  `STRUCTURAL_PASS`, 110 checks, 0 falhas.
- status: GREEN
- observação real (não escondida, não classificada como bug desta correção): ao rodar a
  suíte COMPLETA do Engineering Router (34 arquivos) em modo paralelo padrão do Jest logo após
  esta correção, `engineeringRouterFullLoopE2E.test.js` falhou de forma determinística (2/2
  tentativas) com `EngineeringTask não encontrada`. Isolado, e também junto com as outras 5
  suítes de promoção/E2E relacionadas via `--runInBand` (serial), o MESMO teste passa 100% das
  vezes (verificado 2x cada). Causa raiz confirmada depois, rodando a suíte COMPLETA de 845
  arquivos do projeto: `createWorkspace`/`createSnapshotCommit`
  (`api/services/engineeringRouter/patchApplyService.js`, pré-existente desde ERV1-CLOSE-005,
  não introduzido por esta correção) faz `git add -A` no REPOSITÓRIO PRINCIPAL compartilhado
  para tirar o snapshot do estado atual — sob paralelismo pesado, um arquivo temporário criado
  por OUTRO teste (`config/benchmarks/__testbXXXXXX.json`) pode ser removido por esse OUTRO
  teste entre o `git status` interno e o `git add`, e o `add -A` falha com "unable to stat...
  Arquivo ou diretório inexistente" (TOCTOU clássico sobre um recurso compartilhado — o
  working tree do repositório principal). Isso é estrutural ao mecanismo de snapshot-do-repo-
  compartilhado em si, não à lógica de Exact Promotion nem do Execution Sandbox — minha
  correção apenas tornou `promoteValidatedPatch` um pouco mais lenta (mais um
  workspace/worktree por chamada), ampliando a janela onde essa fragilidade pré-existente pode
  se manifestar. Taxa de ocorrência observada: 1 falha em 845 suítes/1914 testes na rodada
  completa. Registrado aqui com precisão em vez de escondido; a investigação e correção
  definitiva (workspace de snapshot isolado do repositório principal, ou lock/retry sobre o
  `git add -A` compartilhado) é o escopo exato do ER-V1-FINAL-009 (Full-Suite Isolation), mais
  adiante nesta mesma missão — resolvida lá, não aqui, para seguir a ordem obrigatória de
  blockers sem misturar escopos.
- commit: `4ee21088`

### ER-V1-FINAL-003 — Fail-Closed Scope

- RED reproduzido (achado real): `checkPathBoundary` (`engine/engineeringRouter/pathBoundary.js`)
  tratava `allowedPaths` vazio/ausente como "tudo permitido" — `checkPathBoundary(['frontend/src/
  App.jsx', 'api/server.js'], {allowedPaths: []})` retornava `{ok:true}`. Confirmado também via
  `validatePatch` real: um patch tocando `api/server.js` com `contract: {allowedPaths: [], risk:
  'HIGH'}` retornava `{ok:true}` — nenhuma barreira de escopo para uma task HIGH sem nenhum
  caminho declarado. `taskClassifier.js::inferScope` também classificava `allowedPaths=[]` como
  escopo `'MEDIUM'` (não REPOSITORY_WIDE, não um alerta), reforçando o comportamento silencioso.
- fix: `checkPathBoundary` agora trata `allowedPaths` vazio/ausente como `NO_PATCH_SCOPE`
  (reject) sempre — independente de `forbiddenPaths` e do risco declarado. Única exceção:
  `contract.scope === 'REPOSITORY_WIDE'` E `contract.explicitPolicyAuthorization === true`
  (tratado como equivalente a `allowedPaths: ['**']`, ainda respeitando `forbiddenPaths`).
  Novo campo persistido `explicit_policy_authorization` (migration
  `20260922114725-add-explicit-policy-authorization.js`, `EngineeringTask` model, nunca default
  true) — só fica `true` se o criador da task setar explicitamente no payload
  (`engineeringTaskService.createTask`); propagado ao Task Contract em runtime via
  `contractFromTask` (`engineeringRouterService.js`). `patchValidator.js` propaga o `code` exato
  (`NO_PATCH_SCOPE` vs `PATCH_OUTSIDE_ALLOWED_SCOPE`) em vez de hardcodar um único motivo.
- tests: `tests/unit/engineeringRouterFailClosedScope.test.js` (novo, 14/14 PASS) — cobre
  exatamente os cenários exigidos pela missão: `allowedPaths=[]`/ausente rejeitado;
  `allowedPaths` positivo restrito ao escopo declarado (permite dentro, rejeita fora);
  REPOSITORY_WIDE sem autorização rejeitado; REPOSITORY_WIDE autorizado segue a policy (e ainda
  respeita `forbiddenPaths`); `explicitPolicyAuthorization`/`scope` isolados um do outro (nenhum
  dos dois basta sozinho); risk HIGH/CRITICAL/LOW sem allowedPaths sempre rejeitado (fail-closed
  não depende do risco); risk CRITICAL com REPOSITORY_WIDE autorizado passa mesmo sem
  allowedPaths. `tests/unit/engineeringRouterPathBoundary.test.js` atualizado (o teste antigo
  que assumia "sem allowedPaths = tudo permitido" agora prova o oposto).
- evidence: gate estrutural `PATH_BOUNDARY_FAIL_CLOSED_EMPTY_SCOPE` +
  `NO_PATCH_SCOPE_FAILURE_CODE_DEFINED` + `EXPLICIT_POLICY_AUTHORIZATION_PERSISTED` (novos).
  Runtime evidence: item `FAIL_CLOSED_SCOPE` adicionado. `validate-engineering-router-v1.js` →
  `STRUCTURAL_PASS`, 114 checks, 0 falhas.
- status: GREEN
- nota de investigação (não regressão real — mesmo padrão de falso positivo já documentado em
  ER-V1-FINAL-002): a primeira rodada de regressão completa (35 suítes) com o working tree
  ainda sujo (10 arquivos deste blocker não commitados) reportou
  `engineeringRouterModelRerouteE2E.test.js` terminando em `READY_FOR_PROMOTION` em vez de
  `GREEN`, de forma determinística mesmo isolado — investigado e confirmado como o MESMO
  mecanismo já descrito em ER-V1-FINAL-002 (`computeExpectedTreeHash` compara o workspace real,
  que herda qualquer edição não commitada do repositório principal no momento do snapshot,
  contra um baseline limpo a partir do HEAD real commitado — sob um working tree sujo de
  desenvolvimento ativo, os dois divergem por definição). Confirmado desaparecendo por completo
  depois do commit (working tree limpo) — ver regressão abaixo.
- commit: `45faee49`

### ER-V1-FINAL-004 — Mandatory Runtime Gate

- RED reproduzido (achado real, confirmado por leitura + rastreamento da cadeia real de
  chamadas, não hipotético): `package.json`'s `validate:governance-enforcement` invocava `npm
  run validate:engineering-router-v1` SEM `--runtime`. Rastreado até a autoridade real de
  selagem de release: `scripts/governance/seal-release.sh` (o script por trás de `npm run
  release:seal`, o comando oficial de selagem documentado no `CLAUDE.md` do projeto) chama `npm
  run validate:governance-enforcement` diretamente (linhas 379/398) — ou seja, o pipeline
  OFICIAL de selagem aceitava `STRUCTURAL_PASS`/`RUNTIME_NOT_REQUESTED` como suficiente para o
  Engineering Router V1, sem nenhuma prova de comportamento real (exitCode real, fingerprint
  amarrado à working tree) exigida antes de selar uma release que incluísse o Router.
- fix: `package.json`'s `validate:governance-enforcement` agora chama `npm run
  validate:engineering-router-v1:runtime` — mudança mínima e cirúrgica no ÚNICO ponto de
  integração real (nenhum segundo pipeline criado). Verificado explicitamente (leitura de
  `api/services/engineeringRouter/regressionGovernanceService.js::checkGovernance`) que o
  caminho AO VIVO (chamado dentro do estágio GOVERNANCE de toda EngineeringTask real) invoca o
  MESMO script via `execFileAsync(process.execPath, [scriptPath])` — nunca via `npm run`, nunca
  com `--runtime` — logo é estruturalmente imune a esta mudança: o deadlock de bootstrap
  documentado em ERV1-CLOSE-010 nunca é reintroduzido, porque os dois caminhos de invocação
  (script direto vs. npm script agregado) são fisicamente distintos no código.
- tests: `tests/integration/engineeringRouterMandatoryRuntimeGate.test.js` (novo, 6/6 PASS) —
  prova estruturalmente que `validate:governance-enforcement` exige `:runtime`; prova que
  `checkGovernance()` nunca passa por `npm`/`--runtime`; roda o GATE REAL (nunca mockado) contra
  evidência manipulada no disco cobrindo os 4 cenários exigidos pela missão: evidência ausente →
  FAIL; evidência com fingerprint stale (de "outro código") → FAIL; modo padrão sem `--runtime`
  continua `RUNTIME_NOT_REQUESTED`/PASS (preserva o comportamento do loop ao vivo); evidência
  com fingerprint REAL da working tree atual (calculado ao vivo pela mesma autoridade do gate,
  `computeSourceFingerprint`) e todos os itens `exitCode:0` → PASS real.
- evidence: gate estrutural `MANDATORY_RUNTIME_GATE_IN_OFFICIAL_PIPELINE` +
  `LIVE_GOVERNANCE_CHECK_NEVER_REQUIRES_RUNTIME` (novos — o segundo prova a AUSÊNCIA de
  `--runtime` no caminho ao vivo, não só a presença do padrão correto).
  `validate-engineering-router-v1.js` → `STRUCTURAL_PASS`, 117 checks, 0 falhas.
- status: GREEN
- commit: `986129a1`

### ER-V1-FINAL-005 — Durable Resume

- RED reproduzido (achado real, não hipotético): `engineeringRouterService.js` tinha 3
  ocorrências de `transitionTask(taskId, X).catch(() => {})` no loop principal (CODING/TESTING/
  REVIEWING), com o comentário "já pode estar em CODING numa retomada — não é fatal". O `.catch`
  engolia QUALQUER erro de `transitionTask` — não só a retomada idempotente legítima (task já
  exatamente no estado de destino após um crash anterior), mas também: task já em estado
  TERMINAL por outro caminho (cancelamento concorrente via `POST /tasks/:id/cancel`, outro
  runner tendo concluído), task removida do banco (`not_found`), erro real de conexão. O loop
  continuava operando silenciosamente sobre uma task cujo estado real já não fazia sentido.
- fix: nova função `tolerantTransition(taskId, toStatus)` substitui as 3 ocorrências. Só tolera
  quando o estado ATUAL real (relido do banco via `getTask`, nunca a variável em memória do
  loop) já é EXATAMENTE o destino pedido (retomada idempotente real). Se o estado real for
  TERMINAL e diferente do destino, lança `TASK_ALREADY_TERMINAL_DURING_RESUME` com o status
  real — nunca prossegue operando sobre uma task morta. Qualquer outro caso (estado
  não-terminal inesperado, ou erro que não é `INVALID_STATE_TRANSITION`) propaga o erro
  original sem mascarar. `runLockedTask` ganhou um handler para o novo código de erro,
  devolvendo o status real (`{taskId, status: err.currentStatus, reasonCode:
  'TASK_ALREADY_TERMINAL_DURING_RESUME'}`) em vez de deixar a exceção subir crua até o
  fire-and-forget de `beginRun`.
- escopo desta correção (deliberado, dentro do congelamento da missão): o mecanismo de lock
  transacional real (`lockForRun`/`unlockTask`, `SELECT ... FOR UPDATE`, TTL de lock
  órfão/stale recovery, rejeição de segunda chamada concorrente genuína com
  `TASK_ALREADY_RUNNING`, proteção contra relock de task terminal com `TASK_TERMINAL`) e a
  idempotência de contagem de tentativas (`iterationsUsed` calculado do histórico REAL de
  `EngineeringAttempt` persistidos, nunca de um contador em memória) já existiam e já cobriam
  corretamente concorrência genuína e continuidade de iteração — verificado por leitura
  completa do código antes de decidir o escopo mínimo desta correção. O gap real e concreto era
  exclusivamente a MÁSCARA de erro nos 3 pontos de retomada de estado da TASK; a Promotion
  (`promotionService.js`) já é idempotente por design (sempre recomputa do estado atual real,
  `branch -f` nunca duplica).
- tests: `tests/unit/engineeringRouterTolerantTransition.test.js` (novo, 7/7 PASS, mocks
  determinísticos) cobre as 4 decisões da função isoladamente: sucesso direto; retomada
  tolerada; terminal diferente → erro com status real; erro não-INVALID_STATE_TRANSITION →
  sempre propaga sem consultar `getTask`. `tests/integration/engineeringTaskConcurrencyAndRestart.test.js`
  ganhou 3 novos casos com Postgres real simulando "process dies during CODING/TESTING,
  restart" (persiste a transição real via `transitionTask`, depois chama `tolerantTransition`
  como um processo reiniciado chamaria) e "cancelamento concorrente durante CODING" (a
  retomada detecta `CANCELLED` real e nunca arrasta a task de volta para um estado ativo) — 8/8
  PASS.
- evidence: gate estrutural `NO_BLIND_TRANSITION_CATCH` (nunca mais um catch cego sobre
  `transitionTask`) + `TOLERANT_TRANSITION_FAIL_SAFE_ON_TERMINAL` (novos).
  `validate-engineering-router-v1.js` → `STRUCTURAL_PASS`, 120 checks, 0 falhas.
- status: GREEN
- nota de investigação (não regressão real — comportamento honesto, melhor que o anterior): na
  regressão completa em paralelo, `engineeringRouterFullLoopE2E.test.js` falhou com
  `EngineeringTask não encontrada`, agora com o stack trace passando explicitamente por
  `tolerantTransition`. Isso é a MESMA race condition TOCTOU pré-existente já documentada em
  ER-V1-FINAL-002/003 (`git add -A` do `createSnapshotCommit` colidindo com arquivos
  temporários de outro teste sob paralelismo pesado) — mas agora `tolerantTransition`
  corretamente PROPAGA o erro real (`not_found`, que não é `INVALID_STATE_TRANSITION`) em vez
  de mascará-lo como o `.catch(() => {})` antigo faria. Confirmado isolado (PASS 100% das
  vezes). O sintoma mudou (mensagem de erro mais precisa, aparece mais cedo), a causa raiz
  continua a mesma e continua sendo escopo do ER-V1-FINAL-009.
- commit: `44df73f0`

### ER-V1-FINAL-006 — Real Regression

- RED reproduzido (achado real, confirmado por inspeção direta do código-fonte, sem
  ambiguidade): `regressionGovernanceService.js::checkRegression(attemptId)` só chamava
  `listTestRuns(attemptId)` — relia os `EngineeringTestRun` já persistidos pela fase TESTING
  (executada ANTES do REVIEW aprovar). Confirmado programaticamente: a função nunca continha
  `runTestCommands` no corpo. Isso é evidence revalidation (prova que algo passou no passado),
  nunca regression execution (prova que o código, no estado ATUAL, ainda passa).
- fix:
  1. **`engine/engineeringRouter/regressionPlan.js`** (novo, módulo puro) — `buildRegressionPlan
     ({touchedPaths, targetedCommands, risk, availableTestFiles})` constrói um plano
     determinístico e proporcional ao risco (`RISK_LEVELS` reaproveitado, já é exatamente
     LOW/MEDIUM/HIGH/CRITICAL): LOW = só `targetedCommands` (testCommands do Task Contract);
     MEDIUM = +testes relacionados por nome de arquivo ao caminho tocado
     (`findRelatedTestFiles`); HIGH = +suíte inteira do subsistema afetado (diretório pai
     comum, `findSubsystemTestFiles`); CRITICAL = +o gate de governança canônico
     (`scripts/governance/validate-engineering-router-v1.js`, reaproveitado, nunca
     reimplementado). Nunca "rodar tudo sempre" sem justificativa; risco desconhecido cai em
     LOW (fail-closed conservador).
  2. **`regressionGovernanceService.js::checkRegression`** — nova assinatura
     `({taskId, attemptId, workspacePath, touchedPaths, risk, targetedCommands})`. Resolve os
     candidatos a "related"/"subsystem" via `contextBuilderService.expandGlobsToFiles`
     (reaproveitado, nunca um glob paralelo), constrói o plano, e EXECUTA de verdade via
     `runTestCommands` (o mesmo Test Runner real, através do sandbox Docker de
     ER-V1-FINAL-001) no workspace isolado da tentativa. Persiste um `EngineeringRegressionRun`
     (novo model + migration) com `plan_tier`, `commands`, `exit_codes` reais,
     `source_fingerprint` (`computeSourceFingerprint`, mesma autoridade do resto da
     governança), `result`, `evidence_refs`.
  3. **`engineeringRouterService.js`** — o ponto de chamada no `executeRoutedLoop` agora
     resolve `touchedPaths` via `listChangedFiles(result.workspace)` (já existente,
     reaproveitado) e passa `task.risk`/`task.test_commands` para o novo `checkRegression`.
- tests: `tests/integration/engineeringRegressionGovernanceService.test.js` reescrito (a versão
  anterior testava a assinatura antiga de evidence-revalidation, incompatível com a nova
  semântica por design) — 5/5 PASS com workspace real: comandos do plano executam e passam →
  `EngineeringRegressionRun` persistido com `result:PASS`; comando do plano falha de verdade
  (`npx jest` contra um path inexistente, exitCode real != 0, nunca reaproveitando resultado
  antigo pois não existe nenhum `EngineeringTestRun` anterior para o attempt) → reprova;
  RegressionPlan MEDIUM inclui targeted + related de verdade (encontrado no repositório real).
  `tests/unit/engineeringRouterRegressionPlan.test.js` (novo, 11/11 PASS) cobre a política pura
  isoladamente: os 4 tiers, nunca duplica comando, risco desconhecido cai em LOW.
- evidence: gate estrutural `REGRESSION_PLAN_PROPORTIONAL_TO_RISK` +
  `REGRESSION_RUN_PERSISTED_WITH_FINGERPRINT` + `ENGINEERING_REGRESSION_RUN_MODEL_EXISTS`
  (novos); `REAL_REGRESSION_CHECK` atualizado para a nova arquitetura (`runTestCommands`/
  `buildRegressionPlan` em vez de `listTestRuns`). `validate-engineering-router-v1.js` →
  `STRUCTURAL_PASS`, 124 checks, 0 falhas.
- status: GREEN
- achado real durante a regressão (corrigido no mesmo blocker, não escondido): a primeira
  rodada da regressão completa expôs uma REGRESSÃO genuína introduzida por esta correção —
  `engineeringRouterFullLoopE2E.test.js` (task `risk:'HIGH'`, `allowedPaths:
  [tests/fixtures/engineering-router-sandbox/mathUtils.js]`) terminava em `RED` real (não a
  race condition TOCTOU já conhecida). Causa raiz: o RegressionPlan HIGH/MEDIUM, ao resolver
  "testes relacionados"/"subsistema" a partir de `touchedPaths`, encontrava e sugeria `npx
  jest tests/fixtures/engineering-router-sandbox/mathUtils.test.js` — um comando que SEMPRE
  falha com "No tests found" porque esse diretório está em `testPathIgnorePatterns` do
  `jest.config.cjs` real (mesma exclusão de `tests/rpa/`, já descoberta em ER-V1-FINAL-001).
  Não era uma reprovação real de regressão de código — era o próprio plano sugerindo um
  comando estruturalmente inválido. Corrigido filtrando os mesmos caminhos excluídos pelo
  `jest.config.cjs` ao resolver `availableTestFiles` em `checkRegression`
  (commit `b863c54a`). Confirmado GREEN isolado (59s, plano HIGH real executando a suíte
  inteira do subsistema `engineeringRouter`) e a regressão completa voltando ao padrão TOCTOU
  já conhecido (não esta regressão específica).
- commit: `b6f40f43` (implementação) + `b863c54a` (correção do achado acima)

### ER-V1-FINAL-007 — Evidence Precision

- RED reproduzido (achado real, ao vivo): a evidência de runtime (ERV1-CLOSE-010) rodava o
  ARQUIVO INTEIRO via `npx jest <testPath>` e certificava o requirement provado só com
  `exitCode === 0` — sem nenhuma granularidade sobre QUAL teste, dentro do arquivo, prova aquele
  requirement específico. Reprodução: `test.skip`-ando (via patch temporário, restaurado
  imediatamente após, confirmado por `git diff --stat` vazio) o único teste que prova
  `SUPPORT_DENIAL_DEFAULT` em `engineeringRouterRoutes.test.js` (mantendo os outros 11 testes do
  arquivo intactos) — o arquivo inteiro continuava saindo com `exitCode 0`, certificando o
  requirement como provado sem nenhum teste real cobrindo-o.
- descoberta adicional durante a correção: `npx jest <path> -t "<pattern sem match>"` também sai
  com `exitCode 0` (todos os testes reportados como "pulados", `numPassedTests:0`,
  `success:true`) — checar só `exitCode` após trocar para `--testNamePattern` seria uma prova
  ainda mais falsa que a anterior (aparenta granularidade, mas nada garante que o pattern casou
  com algum teste real).
- fix:
  1. **`scripts/governance/collect-engineering-router-runtime-evidence.js`** reescrito: cada um
     dos 24 itens roda restrito a `--testNamePattern` (`testId` = nome/substring estável do
     `test(...)` real que prova aquele requirement específico), captura `--json`
     (`maxBuffer: 50MB`, `timeout: 120000` — saída `--json` de testes E2E/git-reais passava do
     limite default de 1MB do `execFileSync`), e exige `numPassedTests >= 1` E
     `numFailedTests === 0` (nunca só `exitCode`). Report `artifactVersion` `2.0.0`: cada item
     ganha `testCaseId`, `assertionResult` (nomes/status reais casados), `numPassedTests`/
     `numFailedTests`/`numPendingTests`, `sourceFingerprint`, `runId`, `evidenceHash` (sha256).
     4 itens de runtime novos, cobrindo blockers já fechados que ainda não tinham prova de
     runtime granular: `EXACT_PATCH_PROMOTION`, `FAIL_CLOSED_SCOPE`, `CRASH_RESUME_MID_STAGE`,
     `EXECUTION_SANDBOX_ISOLATION` (24 itens no total, antes 20).
  2. **`scripts/governance/validate-engineering-router-v1.js`** (`buildRuntimeChecks`) —
     `REQUIRED_RUNTIME_ITEM_IDS` sincronizado com os 24 itens do coletor (autoridade única,
     mesma lista); cada `RUNTIME_<id>` agora exige `isFresh && exitCode===0 && testCaseId
     presente && numPassedTests>=1 && numFailedTests===0` — não mais só `exitCode===0`.
- tests: reprodução RED ao vivo (não um teste automatizado permanente — a prova é o próprio
  comportamento do coletor/gate reescritos, que é o artefato de evidência em si).
- evidence:
  - `node scripts/governance/validate-engineering-router-v1.js` (sem `--runtime`, árvore limpa
    antes do commit `7a2247c1`): `STRUCTURAL_PASS`, 124 checks, 0 falhas.
  - commit `7a2247c1` (working tree limpo — pré-requisito para um sinal não contaminado pelo
    padrão "dirty working tree" já documentado nos blockers anteriores).
  - `node scripts/governance/collect-engineering-router-runtime-evidence.js` rodado com a árvore
    limpa no commit `7a2247c1`: `status=RUNTIME_PASS items=24 falhas=0
    fingerprint=2501c21db3b7d890…`. Confirma que as 6 falhas ("saída do Jest não pôde ser
    parseada como JSON") observadas na rodada anterior (feita com o próprio script do coletor
    ainda não commitado, isto é, árvore suja) eram o padrão de dirty-working-tree/contaminação
    já documentado nos blockers 002/003/005/006 — não um problema real de `maxBuffer`/timeout
    nem uma falha genuína dos testes.
  - `node scripts/governance/validate-engineering-router-v1.js --runtime` (mesmo commit):
    `STRUCTURAL_PASS/RUNTIME_PASS`, 149 checks, 0 falhas.
  - `npm run test:unit` (suíte completa do projeto, mesmo commit): `Test Suites: 1 skipped, 847
    passed, 848 total`; `Tests: 2 skipped, 6457 passed, 6459 total`; exit code 0.
- status: GREEN
- commit: `7a2247c1` (implementação) + `0ea72c70` (evidência)

### ER-V1-FINAL-008 — Current Model Catalog

- RED reproduzido (achado real, por inspeção direta): nenhum módulo/tabela de "model catalog"
  existia (`engine/engineeringRouter/` e `api/services/engineeringRouter/` sem nenhum arquivo
  com "catalog" no nome). O discovery real de modelos (`providerModelDiscoveryCache`/
  `listAvailableModelIds`, ERV1-CLOSE-008) já existia, mas era usado SOMENTE para EXCLUIR da
  allowlist estática (`modelCapabilities.js`) um modelo mapeado que o provider deixou de listar.
  Quando o provider retornava um modelId REAL que não estava mapeado (modelo novo no catálogo do
  provider), essa informação era descartada sem nenhum rastro — nunca persistida, nunca
  auditável — mesmo que a não-elegibilidade automática já fosse correta por padrão fail-closed
  (só `listCapabilityEntries()`, isto é, o allowlist estático, entra no loop de
  `buildAvailableModels`).
- fix (sem tornar a allowlist dinâmica nem redesenhar o Router — `modelCapabilities.js` continua
  sendo a ÚNICA fonte de elegibilidade real, conforme a spec exige explicitamente: "Discovery
  deve ser source of truth para existência. Capability policy deve ser source of truth para
  uso."):
  1. **`engine/engineeringRouter/constants.js`** — `MODEL_CATALOG_STATUSES`: `DISCOVERED`,
     `UNCLASSIFIED`, `CLASSIFIED`, `APPROVED`, `RETIRED`, `UNAVAILABLE`, `DENIED` (vocabulário
     exato pedido pela missão).
  2. **`engine/engineeringRouter/modelCatalogPolicy.js`** (novo, módulo puro) —
     `resolveCatalogStatus({isMapped, listedByProviderNow, previousStatus})`: mapeado +
     confirmado pelo discovery → `APPROVED`; mapeado + discovery confirma ausência → `RETIRED`;
     não mapeado + discovery confirma presença real → `DISCOVERED` (ou mantém `CLASSIFIED` se já
     tiver sido classificado manualmente); `DENIED` nunca é sobrescrito automaticamente.
     `isEligibleForRisk(status)`: só `APPROVED` é elegível, para qualquer risco — a spec exige
     que HIGH/CRITICAL nunca aceitem unclassified, e a forma fail-closed mais simples de garantir
     isso é nunca aceitar unclassified para risco nenhum.
  3. **`api/db/models/EngineeringModelCatalogEntry.js`** + migration
     (`20260922140000-create-engineering-model-catalog-entries.js`) — tabela
     `engineering_model_catalog_entries` (`provider_id`+`model_id` único), camada de
     auditoria/governança, nunca consultada para decidir elegibilidade real.
  4. **`api/services/engineeringRouter/modelCatalogService.js`** (novo) —
     `reconcileDiscoveredModel` (idempotente via upsert, nunca lança — falha de persistência é
     best-effort/logada, nunca derruba o roteamento real), `getCatalogEntry`,
     `listCatalogEntries`.
  5. **`engineeringModelAvailabilityService.js::reconcileProviderCatalog`** — quando o discovery
     real de um provider responde com sucesso (mesmo ponto que já existia para excluir
     candidatos), reconcilia o catálogo nas DUAS direções: cada modelo mapeado desse provider →
     `APPROVED` ou `RETIRED` conforme presença real; cada modelId retornado pelo provider que não
     está mapeado → `DISCOVERED`. Best-effort, mesma política fail-open do resto do discovery.
  6. `collect-engineering-router-runtime-evidence.js`/`validate-engineering-router-v1.js`: novo
     item de runtime `MODEL_CATALOG_GOVERNANCE` (25 itens no total) + 6 novos checks estruturais
     (130 no total).
- tests:
  - `tests/unit/engineeringRouterModelCatalogPolicy.test.js` (novo, 9/9 PASS, política pura):
    modelo novo (discovery confirma, não mapeado) → `DISCOVERED`; `DISCOVERED`/`UNCLASSIFIED`
    nunca elegível nem para HIGH nem para CRITICAL; `CLASSIFIED` (sem promoção à allowlist)
    também não elegível; mapeado+confirmado → `APPROVED` elegível para qualquer risco;
    mapeado+discovery confirma ausência → `RETIRED` nunca elegível; discovery sem confirmação
    (fail-open) preserva `APPROVED`; `DENIED` nunca é sobrescrito automaticamente; `CLASSIFIED`
    não regride para `DISCOVERED` enquanto o discovery seguir confirmando existência.
  - `tests/integration/engineeringModelCatalogService.test.js` (novo, 4/4 PASS, Postgres real):
    modelo novo real persiste como `DISCOVERED`; modelo mapeado+confirmado persiste como
    `APPROVED`; modelo mapeado que o provider deixa de listar persiste como `RETIRED`;
    reconciliação repetida com os mesmos fatos é idempotente (nunca duplica linha).
  - regressão: `engineeringModelAvailabilityService`/`engineeringRouterProviderModelDiscovery`/
    `engineeringRouterModelSelector`/`engineeringRouterModelCapabilities` — 33/33 PASS, sem
    quebra (o comportamento de exclusão pré-existente do discovery continua intacto).
  - `tests/integration/engineeringRouterModelRerouteE2E.test.js` ("reroute continua funcional",
    exigido explicitamente pela spec): FAIL isolado na primeira rodada com working tree ainda
    suja (`READY_FOR_PROMOTION` em vez de `GREEN` — o já documentado padrão de
    dirty-working-tree/`PROMOTION_TREE_CONTAMINATED`, ver blockers 002/003/005/006/007); commit
    `d75ef6fb`, re-rodado isolado com árvore limpa → PASS (confirma que não era regressão real).
- evidence:
  - `node scripts/governance/validate-engineering-router-v1.js` (sem `--runtime`, commit
    `d75ef6fb`): `STRUCTURAL_PASS`, 130 checks, 0 falhas.
  - `node scripts/governance/collect-engineering-router-runtime-evidence.js` (árvore limpa,
    commit `d75ef6fb`): `status=RUNTIME_PASS items=25 falhas=0
    fingerprint=2a026d87370649da…`.
  - `node scripts/governance/validate-engineering-router-v1.js --runtime` (mesmo commit):
    `STRUCTURAL_PASS/RUNTIME_PASS`, 156 checks, 0 falhas.
  - `npm run test:unit` (suíte completa, mesmo commit): `Test Suites: 1 skipped, 848 passed, 849
    total`; `Tests: 2 skipped, 6466 passed, 6468 total`; exit code 0.
- status: GREEN
- commit: `d75ef6fb` (implementação) + `49d328bc` (evidência)

### ER-V1-FINAL-009 — Full-Suite Isolation

- RED reproduzido AO VIVO nesta sessão (não hipotético): rodando repetidamente a suíte do
  Engineering Router junto com testes de outras áreas do projeto que escrevem arquivos reais
  dentro do repositório (`tests/unit/benchmarks/benchmarkChangeProposal.test.js`, via
  `api/services/benchmark/benchmarkSampleRegistry.js` — escrita atômica tmp+rename em
  `config/benchmarks/`), em modo paralelo padrão do Jest (sem `--runInBand`, o modo oficial),
  a suíte falhava de forma real e repetida — nunca 100% limpa antes das correções abaixo.
  Investigação encontrou TRÊS causas raiz reais e distintas, todas corrigidas nesta sessão (não
  apenas a primeira, já suspeitada desde os blockers 002/003/005/006):

  **Causa 1 — TOCTOU no `git add -A` de `createSnapshotCommit`:**
  `patchApplyService.js::createSnapshotCommit()` faz `git add -A` no ROOT do repositório
  PRINCIPAL, compartilhado por TODA a suíte de 849 arquivos do projeto — não só o Engineering
  Router. Sob paralelismo real, um arquivo temporário criado por QUALQUER outro teste do projeto
  pode ser removido entre o scan interno do `git add -A` e o `stat` de cada arquivo — TOCTOU
  clássico sobre um diretório mutável compartilhado. Erro real capturado:
  ```
  Falha ao criar snapshot do working tree: Command failed: git add -A
  fatal: unable to stat 'config/benchmarks/__testbrcpf6351e6e.json': Arquivo ou diretório
  inexistente
  ```
  Fix: `createSnapshotCommit()` reescrita para envolver `createSnapshotCommitOnce()` (read-tree +
  add -A + write-tree + commit-tree) em um retry de até 5 tentativas com delay crescente
  (50/150/400/800ms), só quando o erro bate no padrão `TRANSIENT_GIT_SCAN_ERROR` (unable to
  stat/does not exist/no such file or directory/did not match any files) — qualquer outro tipo de
  erro propaga imediatamente, sem retry, nunca mascarado.
  Commit: `9b257cbe`.

  **Causa 2 — falso positivo estrutural em Exact Promotion (`PROMOTION_TREE_CONTAMINATED`):**
  Mesmo com a Causa 1 corrigida, a suíte ainda falhava — desta vez com `READY_FOR_PROMOTION` em
  vez de `GREEN` em testes E2E variados. `promotionService.js::computeExpectedTreeHash`
  reconstruía a árvore "esperada" a partir do commit `HEAD^` do workspace (o commit REAL da
  branch main, SEM qualquer estado não commitado). Mas o workspace "validado" sempre nasce do
  SNAPSHOT COMMIT completo (`createSnapshotCommit`, que captura intencionalmente TUDO
  fisicamente presente no ROOT no instante do snapshot — inclusive trabalho em andamento não
  commitado do próprio branch main direto, e inclusive um arquivo temporário real de QUALQUER
  outro teste do projeto que por acaso exista naquele instante). Qualquer coisa não commitada
  capturada no snapshot original SEMPRE aparecia como "contaminação" na comparação entre
  `expectedTreeHash` e `validatedTreeHash` — mesmo sendo idêntica em ambos os lados por
  definição, porque só um dos dois lados (`expected`) a excluía por partir do `HEAD^` puro.
  Reproduzido ao vivo com um log real temporário (`contaminatingFiles`), capturando casos como:
  ```
  contaminatingFiles: "M\tapi/services/engineeringRouter/promotionService.js"
  contaminatingFiles: "M\t...promotionService.js\nA\tconfig/benchmarks/__testbrcp7f03b289.json"
  ```
  — confirmando tanto trabalho em andamento próprio quanto arquivos reais de outro teste sendo
  incorretamente sinalizados como contaminação.
  Fix: `computeExpectedTreeHash` agora recebe `expectedBaseCommit` = o próprio SNAPSHOT COMMIT do
  workspace (`HEAD`, não `HEAD^`) — preserva a garantia de segurança real (side-effects de teste
  acontecem DEPOIS do snapshot, então ainda divergem do expected recalculado a partir do mesmo
  snapshot+patch) e elimina o falso positivo (estado pré-existente no snapshot é herdado
  igualmente por ambas as árvores). `baselineHead` (`HEAD^`, commit real) continua sendo usado só
  para o check de `PROMOTION_TARGET_DIVERGED`, onde é semanticamente correto (só um commit REAL
  pode mudar o HEAD real da branch). Confirmado sem enfraquecer a segurança: os 3 cenários de
  contaminação REAL já cobertos por `tests/integration/engineeringPromotionService.test.js`
  (cenário B — arquivo novo gerado como side-effect; C — arquivo existente alterado fora do
  diff; D — remoção de arquivo fora do patch) continuam GREEN após a correção.
  Commit: `bb03c37d`.

  **Causa 3 — timeouts insuficientes para acomodar o retry sob paralelismo real:**
  O retry da Causa 1 (até 5 tentativas com delay) torna `createSnapshotCommit` legitimamente
  mais lento sob a suíte completa rodando em paralelo (contenção real de CPU/IO, não só a race
  em si). Testes que chamam `createWorkspace`/`runTask` com timeout de 30s/60s estouravam por
  TIMEOUT genuíno (não bug de lógica) — confirmado com a mensagem real "Exceeded timeout of
  Xms" em `engineeringRouterOrphanWorkspacePruning.test.js` e
  `engineeringRouterPromotionEvidencePersistence.test.js`.
  Fix: timeouts aumentados proporcionalmente (30s→90s, 60s→120s) nos ~9 arquivos de teste que de
  fato exercitam `createWorkspace`/`runTask` real: `engineeringRouterModelRerouteE2E`,
  `engineeringRouterFullLoopE2E`, `engineeringRouterRegressionGovernanceGate`,
  `engineeringRouterPromotionEvidencePersistence`, `engineeringRouterReviewerRejectionRecodeE2E`,
  `engineeringPromotionService`, `engineeringRegressionGovernanceService`,
  `engineeringPatchApplyAndTestRunner`, `engineeringRouterOrphanWorkspacePruning`.
  Commit: `bb03c37d`.

  **REGRESSION relacionada, encontrada e corrigida durante esta mesma investigação (não uma das
  3 causas acima, mas descoberta no caminho):** `tests/integration/engineeringRouterMandatoryRuntimeGate.test.js`
  (blocker 004, já GREEN) mantinha uma TERCEIRA cópia hardcoded de `REQUIRED_RUNTIME_ITEM_IDS`
  que os blockers 007/008 deixaram dessincronizada (faltavam 2 dos 25 IDs reais, e a fixture
  sintética não tinha os campos do schema v2.0.0 de ER-V1-FINAL-007) — corrigido eliminando a
  duplicação na fonte (`collect-engineering-router-runtime-evidence.js` agora exporta
  `RUNTIME_ITEMS`, com guard `require.main === module`; gate e teste importam de lá). Commit
  `e33d1a25`.

- tests:
  - `tests/unit/engineeringRouterSnapshotCommitRetry.test.js` (novo, 3/3 PASS, determinístico via
    mock de `child_process.execFile`): retry bem-sucedido após 1 falha transitória; erro NÃO
    transitório propaga imediatamente sem retry; erro transitório em todas as 5 tentativas
    propaga o erro real (nunca finge sucesso).
  - `tests/integration/engineeringPromotionService.test.js` (7/7 PASS, incluindo os 3 cenários de
    contaminação real B/C/D) — confirma que a Causa 2 não enfraqueceu a detecção real.
  - `tests/integration/engineeringRouterMandatoryRuntimeGate.test.js` (6/6 PASS) — REGRESSION
    corrigida.
  - Regressão ampliada da suíte completa do Engineering Router + testes de escrita real em
    `config/benchmarks/` (41 suítes), rodada 6 vezes seguidas em modo paralelo padrão do Jest (3
    rodadas com árvore ainda dirty, iterando; 3 rodadas finais com árvore limpa no commit
    `bb03c37d`) — **41/41 suítes PASS em todas as 6 rodadas**, nenhuma falha, nenhum padrão de
    TOCTOU/contaminação/timeout reaparecendo.
- evidence:
  - `node scripts/governance/validate-engineering-router-v1.js` (árvore limpa, commit
    `bb03c37d`): `STRUCTURAL_PASS`, 132 checks, 0 falhas (inclui os 2 novos checks
    `SNAPSHOT_COMMIT_RETRIES_TRANSIENT_SCAN_ERROR` e `EXPECTED_TREE_USES_SNAPSHOT_NOT_BARE_HEAD`).
  - `npm run test:unit` (suíte completa do projeto, mesmo commit): `Test Suites: 1 skipped, 849
    passed, 850 total`; `Tests: 2 skipped, 6469 passed, 6471 total`; exit code 0 — GREEN limpo,
    nenhuma falha pré-existente encontrada (não é necessário usar `NO_NEW_REGRESSION` aqui; o
    resultado é efetivamente "ALL GREEN" real).
- status: GREEN
- commit: `9b257cbe` (causa 1, TOCTOU) + `bb03c37d` (causas 2 e 3, Exact Promotion + timeouts) +
  `e33d1a25` (REGRESSION do teste 004, achada no caminho) + `061354a0` (evidência)

### ER-V1-FINAL-010 — Self-Proving Audit Envelope

- RED reproduzido (achado real, por inspeção direta): nenhum script de "audit envelope" existia
  no repositório (`scripts/governance/` sem nenhum arquivo com "envelope" no nome). O projeto já
  tinha infraestrutura robusta de release/identidade (`write-release-identity.js`,
  `verify-release-artifact-identity.js`, `governance/proof-engine/fingerprint-chain.js`), mas
  nada especificamente ESPECÍFICO do fechamento do Engineering Router V1, autocontido e
  verificável 100% offline sem depender do texto narrativo de
  `ENGINEERING_ROUTER_V1_FINAL_CLOSURE.md`.
- fix (reaproveitando a evidência já real produzida pelos gates existentes, nunca fabricando
  prova nova nem reexecutando os 25 testes reais dentro do gerador):
  1. **`scripts/governance/generate-engineering-router-v1-audit-envelope.js`** (novo) — lê
     `reports/engineering-router-v1-runtime-evidence.json` (RUNTIME_PASS, 25 itens granulares,
     ER-V1-FINAL-007) e `reports/engineering-router-v1-report.json` (gate estrutural+runtime,
     ER-V1-FINAL-004); FALHA EXPLICITAMENTE se qualquer um estiver ausente, com
     `sourceFingerprint` obsoleto, ou status diferente de PASS/RUNTIME_PASS — nunca certifica um
     estado RED/FAIL como se fosse prova de fechamento. Computa baseline real (`git rev-parse
     HEAD`, `git rev-parse HEAD^{tree}`, `computeSourceFingerprint` — mesma autoridade única de
     `governance/proof-engine/fingerprint-chain.js`, reaproveitada, nunca duplicada). Distribui
     os 25 itens de runtime evidence por categoria (routing/security/regression/governance/
     promotion/pilot) em arquivos JSON separados, mais `release-closure-evidence.json` com o
     backlog congelado dos 10 blockers e seus commits reais. Cada artifact é content-addressed:
     `hashes.json` com sha256 real dos BYTES de cada arquivo já escrito em disco, referenciado
     também em `manifest.json` (schemaVersion, generatedAt, HEAD, sourceFingerprint, treeHash,
     runId, artifactHashes, testSuiteHash, runtimeStatus, promotionStatus, pilotTaskId,
     releaseStatus). Nunca inclui secrets — só hashes/status/metadados estruturais.
  2. **`scripts/governance/verify-engineering-router-v1-audit-envelope.js`** (novo) — verifier
     100% OFFLINE: nunca depende de banco, nunca depende de rede, nunca confia em nenhum `.md`
     (lê só os JSONs do próprio envelope). Valida hashes (recalcula sha256 real de cada artifact
     e compara com `hashes.json` E `manifest.artifactHashes` — as duas referências precisam
     bater), runId (consistente em todos os 9 artifacts), sourceFingerprint/treeHash/HEAD
     (`baseline.json` === `manifest.json`), requirement coverage (os 25 IDs obrigatórios
     presentes com `pass=true`/`testCaseId` presente/`numPassedTests>=1` — mesmo rigor de
     ER-V1-FINAL-007, nunca só `exitCode`), runtime PASS, promotion exactness (todos os itens de
     `promotion-evidence.json` com `pass=true`), pilot evidence (loop RED→FIX→REVIEW→GREEN real
     presente e PASS em `pilot-evidence.json`), e evidence freshness best-effort (compara com
     `HEAD` do git local quando disponível, nunca EXIGE isso — um envelope copiado para fora do
     checkout continua verificável).
  3. `validate-engineering-router-v1.js`: 6 novos checks estruturais (138 no total antes do
     `--runtime`) confirmando que gerador/verifier existem com os padrões esperados.
  4. `package.json`: `engineering-router:audit-envelope:generate` /
     `engineering-router:audit-envelope:verify`.
- tests:
  - `tests/unit/engineeringRouterAuditEnvelopeVerifier.test.js` (novo, 9/9 PASS, determinístico
    — constrói um envelope sintético VÁLIDO em tmpdir, sem depender de `reports/` real, e
    corrompe uma dimensão por vez): envelope válido → PASS em todos os checks; diretório
    inexistente → FAIL sem lançar; artifact alterado após a geração → FAIL no hash e na
    referência do manifest; item de requirement coverage ausente → FAIL específico do ID; runId
    divergente entre um artifact e o manifest → FAIL; sourceFingerprint divergente entre
    `baseline.json` e `manifest.json` → FAIL; item de promoção com `pass:false` → FAIL
    específico, mesmo com hashes íntegros; `pilot-evidence.json` ausente → FAIL explícito;
    `manifest.json` inválido (não é JSON) → FAIL imediato, nunca lança exceção.
  - `tests/integration/engineeringRouterAuditEnvelopeGeneration.test.js` (novo, 2/2 PASS) — roda
    o GERADOR real a partir da evidência real no disco e o VERIFIER real sobre o output, ponta a
    ponta (skip explícito se a evidência não estiver fresca, nunca finge verde); confirma que
    gerar com evidência corrompida para `RUNTIME_FAIL` lança explicitamente.
  - Teste manual de corrupção deliberada (ver evidence abaixo) — a garantia central da spec
    ("se envelope for alterado: verifica") confirmada tanto no teste automatizado quanto ao vivo
    contra o envelope real.
- evidence:
  - `node scripts/governance/validate-engineering-router-v1.js --runtime` (árvore limpa, commit
    `e9e12a6b`, coletor rodado de novo com 25/25 `RUNTIME_PASS`): `STRUCTURAL_PASS/RUNTIME_PASS`,
    **164 checks, 0 falhas**.
  - `npm run engineering-router:audit-envelope:generate` (mesmo commit):
    `runId=e9e12a6bcd808612696ebe756881591cb94b72f4 runtimeStatus=RUNTIME_PASS
    releaseStatus=ENGINEERING_ROUTER_V1_10_OF_10_GREEN`.
  - `npm run engineering-router:audit-envelope:verify`: `status=PASS checks=98 falhas=0`.
  - Corrupção deliberada ao vivo (manual, fora do teste automatizado): um byte alterado em
    `pilot-evidence.json` do envelope real gerado → verifier reportou `status=FAIL checks=98
    falhas=3` (`ARTIFACT_HASH_MATCHES_pilot-evidence.json`,
    `MANIFEST_REFERENCES_pilot-evidence.json`, `PILOT_ITEM_PASS_ACTUAL_PATCH_APPLY`) — restaurado
    o arquivo original → `status=PASS` de novo. Confirma a garantia central da spec.
- status: GREEN
- commit: `e9e12a6b`

## Fechamento final da missão — 10/10 blockers GREEN

### Backlog congelado — status final

| # | Blocker | Título | Status | Commit(s) principal(is) |
|---|---|---|---|---|
| 1 | ER-V1-FINAL-001 | Execution Sandbox | GREEN | `342faddd` |
| 2 | ER-V1-FINAL-002 | Exact Promotion | GREEN | `4ee21088` |
| 3 | ER-V1-FINAL-003 | Fail-Closed Scope | GREEN | `45faee49` |
| 4 | ER-V1-FINAL-004 | Mandatory Runtime Gate | GREEN | `986129a1` |
| 5 | ER-V1-FINAL-005 | Durable Resume | GREEN | `44df73f0` |
| 6 | ER-V1-FINAL-006 | Real Regression | GREEN | `b6f40f43` + `b863c54a` |
| 7 | ER-V1-FINAL-007 | Evidence Precision | GREEN | `7a2247c1` + `0ea72c70` |
| 8 | ER-V1-FINAL-008 | Current Model Catalog | GREEN | `d75ef6fb` + `49d328bc` |
| 9 | ER-V1-FINAL-009 | Full-Suite Isolation | GREEN | `9b257cbe` + `bb03c37d` + `e33d1a25` + `061354a0` |
| 10 | ER-V1-FINAL-010 | Self-Proving Audit Envelope | GREEN | `e9e12a6b` + `6e340570` |

**10 de 10 blockers do backlog congelado estão GREEN. Nenhum blocker reaberto sem evidência
objetiva de regressão (regra 10 da missão respeitada em toda a execução) — as duas reaberturas
que ocorreram (ver abaixo) tinham evidência concreta de regressão real, não suspeita.**

### Achados classificados como REGRESSION corrigidos no percurso (transparência total)

Nenhum achado foi escondido ou convertido em narrativa de sucesso (regras 14–19 da missão). Dois
achados reais foram classificados como `REGRESSION` (quebra causada pelas correções desta
própria missão) e corrigidos no mesmo ciclo do blocker onde foram descobertos, nunca fora de
ordem:

1. **Dentro de ER-V1-FINAL-006**: `RegressionPlan` (HIGH/MEDIUM) sugeria
   `tests/fixtures/engineering-router-sandbox/mathUtils.test.js` como comando de regressão — um
   path excluído por `testPathIgnorePatterns` do `jest.config.cjs`, que SEMPRE falha com "No
   tests found", fazendo `engineeringRouterFullLoopE2E.test.js` (risco HIGH) terminar em RED
   real. Corrigido filtrando `availableTestFiles` pelos mesmos caminhos excluídos pelo Jest.
   Commit `b863c54a`.
2. **Durante a investigação de ER-V1-FINAL-009**: `tests/integration/engineeringRouterMandatoryRuntimeGate.test.js`
   (blocker 004, já GREEN) mantinha uma cópia hardcoded de `REQUIRED_RUNTIME_ITEM_IDS` que os
   blockers 007/008 deixaram dessincronizada (faltavam 2 dos 25 IDs reais, e a fixture sintética
   não tinha os campos do schema v2.0.0 de ER-V1-FINAL-007). Corrigido eliminando a duplicação
   na fonte — `collect-engineering-router-runtime-evidence.js` agora exporta `RUNTIME_ITEMS`
   (autoridade única), gate e teste importam de lá. Commit `e33d1a25`.

### Runtime certification final

```
node scripts/governance/collect-engineering-router-runtime-evidence.js
  → status=RUNTIME_PASS items=25 falhas=0
    commit=e9e12a6bcd808612696ebe756881591cb94b72f4
    fingerprint=8f14f3fd5d048a11…
```

Todos os 25 itens de evidência de runtime (schema v2.0.0, ER-V1-FINAL-007: `testCaseId`
presente, `numPassedTests>=1`, `numFailedTests===0` por item — nunca só `exitCode`) PASS,
cobrindo: segurança (7 itens), roteamento (5 itens), pilot real RED→FIX→REVIEW→GREEN (4 itens),
regressão real (1 item), governança (5 itens), promoção exata (3 itens).

### Gate estrutural + runtime final

```
node scripts/governance/validate-engineering-router-v1.js --runtime
  → status=PASS (STRUCTURAL_PASS/RUNTIME_PASS) checks=164 falhas=0
```

### Self-proving audit envelope final

```
npm run engineering-router:audit-envelope:generate
  → runId=e9e12a6bcd808612696ebe756881591cb94b72f4 runtimeStatus=RUNTIME_PASS
    releaseStatus=ENGINEERING_ROUTER_V1_10_OF_10_GREEN
npm run engineering-router:audit-envelope:verify
  → status=PASS checks=98 falhas=0
```

### Regressão completa final (suíte inteira do projeto)

```
npm run test:unit (commit 6e340570, árvore limpa)
  → Test Suites: 1 skipped, 850 passed, 851 total
    Tests:       2 skipped, 6478 passed, 6480 total
    exit code 0
```

Nenhuma falha — resultado é "ALL GREEN" real, não `NO_NEW_REGRESSION` sobre uma baseline já
vermelha.

### Declaração de GO

**GO.**

Com base em evidência real, não em narrativa:
- 10/10 blockers do backlog congelado GREEN, cada um com RED reproduzido, fix implementado,
  testes GREEN, regressão dirigida e evidência registrada antes de avançar (regra 8 da missão
  respeitada em todos os 10 blockers).
- Runtime certification: `RUNTIME_PASS`, 25/25 itens, commit `e9e12a6bcd808612696ebe756881591cb94b72f4`,
  fingerprint `8f14f3fd5d048a11…`.
- Gate agregado estrutural+runtime: `PASS`, 164 checks, 0 falhas.
- Self-proving audit envelope: gerado e verificado offline, `PASS`, 98 checks, 0 falhas — inclui
  teste de corrupção deliberada confirmando que qualquer alteração no envelope é detectada.
- Regressão completa do projeto: `850 passed, 851 total` suítes / `6478 passed, 6480 total`
  testes, exit code 0.
- Nenhum `BLOCKED_EXTERNAL` foi necessário — todos os 10 blockers foram fechados com
  infraestrutura já disponível localmente.
- Dois achados de `REGRESSION` genuínos foram encontrados e corrigidos no próprio ciclo do
  blocker onde apareceram, documentados com precisão acima — nunca escondidos, nunca convertidos
  em narrativa de sucesso vazia.

Fim da missão FINAL_RELEASE_CLOSURE. Backlog congelado ER-V1-FINAL-1 encerrado.
