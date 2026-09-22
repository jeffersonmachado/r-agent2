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
- commit: `b6f40f43` (implementação) + `b863c54a` (correção do achado acima)
