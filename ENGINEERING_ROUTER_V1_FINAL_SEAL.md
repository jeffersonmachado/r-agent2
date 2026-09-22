# ENGINEERING_ROUTER_V1_FINAL_SEAL.md

Missão: FINAL_SEAL — selagem definitiva do Engineering Model Router V1, executada sobre a base
já fechada em `ENGINEERING_ROUTER_V1_CLOSURE.md` (10 blockers ERV1-CLOSE-*) e
`ENGINEERING_ROUTER_V1_FINAL_CLOSURE.md` (10 blockers ER-V1-FINAL-*, ambos 100% GREEN). Escopo
estritamente limitado aos 5 blockers ER-V1-SEAL-* abaixo, mais runtime certification, real
pilot, full affected regression, governance, audit envelope, offline verification e a decisão
final de selagem. Sem V2, sem redesenho de UI, sem hardening genérico, sem novas features.

## Baseline

```
BASELINE_HEAD=cdcf9bf989cf3175f16ac0b8f3ac9c5df121f539
BASELINE_TREE=a8672437f3ede2ed45feaaa786b4153efffbbbdb
BASELINE_SOURCE_FINGERPRINT=8f14f3fd5d048a115e3969b01175ef6d28d99d270b76ec1ebf2ec13aade83e8b
  (governance/proof-engine/fingerprint-chain.js::computeSourceFingerprint — autoridade canônica
  reutilizada, nunca reimplementada)
BASELINE_DIRTY_STATE=clean (git status --porcelain vazio; nenhum staged/unstaged/untracked)
STARTED_AT=2026-09-22T12:53:00Z (aprox., horário local do início desta missão)
SEAL_BACKLOG_VERSION=1
BRANCH=main
PACKAGE_VERSION=1.0.0
```

Engineering Router schema (migrations reais em `api/db/migrations/`):
- `20260920221831-create-engineering-router-v1.js` (bundle: EngineeringTask, Attempt, TestRun,
  Review, TelemetryEvent + `explicit_policy_authorization` via migration adicional)
- `20260922132426-create-engineering-regression-runs.js` (EngineeringRegressionRun)
- `20260922140000-create-engineering-model-catalog-entries.js` (EngineeringModelCatalogEntry)

Gate estrutural na baseline:
```
node scripts/governance/validate-engineering-router-v1.js
  → status=PASS (STRUCTURAL_PASS/RUNTIME_NOT_REQUESTED) checks=138 falhas=0
```

Gate runtime na baseline (evidência já fresca, herdada do fechamento da missão anterior):
```
node scripts/governance/validate-engineering-router-v1.js --runtime
  → status=PASS (STRUCTURAL_PASS/RUNTIME_PASS) checks=164 falhas=0
reports/engineering-router-v1-runtime-evidence.json
  → status=RUNTIME_PASS items=25 failed=0 fingerprint=8f14f3fd5d048a11… (bate com baseline)
```

Release/governance artifacts atuais:
- `reports/governance-score.json`: `status=PASS overallGovernance=100`, `generatedAt=2026-09-19T03:45:40.508Z`
  (mais antigo que o baseline atual — não regenerado nesta sessão, fora do escopo desta missão a
  menos que algum blocker exija).
- `dist/engineering-router-v1-audit-envelope/` já existe (gerado na missão anterior, ER-V1-FINAL-010):
  `baseline.json, governance-evidence.json, hashes.json, manifest.json, pilot-evidence.json,
  promotion-evidence.json, regression-evidence.json, release-closure-evidence.json,
  routing-evidence.json, runtime-certification.json, security-evidence.json`.
- **Achado real confirmado ao vivo nesta baseline (motivador direto de ER-V1-SEAL-004)**: o ZIP
  de release mais recente em disco, `dist/r-agent2-20260922-124933.zip` (produzido fora desta
  sessão, timestamp 22/09 12:49), contém os SCRIPTS-fonte do audit envelope
  (`scripts/governance/generate-engineering-router-v1-audit-envelope.js`,
  `verify-engineering-router-v1-audit-envelope.js`) mas **NÃO contém nenhum diretório
  `evidence/engineering-router-v1/`** com os artifacts de evidência gerados — confirmado via
  `unzip -l` sem nenhuma ocorrência de `evidence/engineering-router-v1`. O pipeline de
  empacotamento atual não inclui a prova final no artefato entregue — exatamente o problema
  descrito na spec de ER-V1-SEAL-004 ("Artefato anterior continha RUNTIME_NOT_REQUESTED enquanto
  documentação afirmava RUNTIME_PASS" / "evidence final de auditoria deve entrar no artefato").

**IMPORTANTE (regra da missão respeitada)**: o working tree está limpo na baseline — não há
nenhuma alteração local pré-existente para preservar/não tocar. Qualquer arquivo alterado a
partir daqui pertence exclusivamente a esta missão SEAL.

## Backlog congelado (5 blockers + certificação final, ordem de execução obrigatória)

1. ER-V1-SEAL-001 — Immutable Promotion Baseline
2. ER-V1-SEAL-002 — Full Durable Resume
3. ER-V1-SEAL-003 — Dedicated Execution Runner
4. ER-V1-SEAL-004 — Self-Proving Deliverable
5. ER-V1-SEAL-005 — Current Model Policy
6. Runtime certification (PASS)
7. Real pilot (PASS)
8. Full affected regression (PASS)
9. Final governance (PASS)
10. Audit envelope (PASS)
11. Offline verification (PASS)
12. Final seal decision

## Blockers

### ER-V1-SEAL-001 — Immutable Promotion Baseline

- RED reproduzido AO VIVO (script de reprodução dedicado, não hipotético): com a arquitetura
  herdada da missão anterior (`createSnapshotCommit` capturando `staged+unstaged+untracked` do
  ROOT compartilhado via `git add -A` para materializar o workspace de cada tentativa), um
  arquivo `dirty-local-a.txt` criado no ROOT antes de `createWorkspace` aparecia commitado na
  branch candidata real (`engineering-router/candidates/<taskId>`) junto com o patch legítimo
  (`M mathUtils.js`), com `promoted: true` e `expectedTreeHash === validatedTreeHash ===
  candidateTreeHash` — a "prova matemática" do Exact Promotion (ER-V1-FINAL-002) não detectava a
  contaminação porque tanto `expected` quanto `validated` derivavam do MESMO snapshot sujo
  (correção de ER-V1-FINAL-009), concordando em incluir o arquivo estranho. Confirma
  precisamente o problema descrito na spec: "expected(snapshot+patch) == validated(snapshot+patch)
  não prova que o candidate contém somente o patch da task."
- fix (correção na raiz, não um remendo pontual):
  1. **`patchApplyService.js::createWorkspace`** — reescrita para materializar o workspace
     DIRETAMENTE do `git rev-parse HEAD` REAL e imutável do branch de trabalho, nunca mais de um
     "snapshot" fabricado a partir do estado mutável do ROOT. `createSnapshotCommit`/
     `createSnapshotCommitOnce` (e todo o mecanismo de retry TOCTOU de ER-V1-FINAL-009)
     REMOVIDOS INTEIRAMENTE — não há mais nenhum `git add -A`/scan de diretório mutável ao criar
     um workspace, só um `git rev-parse` (leitura pontual) + `git worktree add`. Isso elimina a
     causa raiz do TOCTOU de ER-V1-FINAL-009 na origem, não só seu sintoma (retry deixa de ser
     necessário porque a condição de corrida não existe mais).
  2. **`promotionService.js`** — `baselineHead` agora é resolvido como `HEAD` (não mais `HEAD^`)
     dentro do workspace, já que o workspace nasce diretamente do commit-alvo (sem indireção de
     snapshot com pai). `computeExpectedTreeHash` recebe esse mesmo `baselineHead` como
     `expectedBaseCommit`. Novos campos de evidência exigidos pela spec: `targetCommit`,
     `targetTreeHash`, `validatedChangedPaths[]`, `promotedChangedPaths[]`,
     `postPromotionTreeHash`, `createdAt` — mais um novo check explícito e independente do
     tree-hash: `validatedChangedPaths === promotedChangedPaths` (novo código de falha
     `PROMOTION_CHANGED_PATHS_MISMATCH`), e verificação de que a árvore do worktree
     re-materializado pós-promoção bate bit-a-bit com a árvore já provada (`POST_PROMOTION_TREE_MISMATCH`).
  3. Confirmado que o CONTEXT_SNAPSHOT (visibilidade de trabalho em andamento não commitado para
     a CODER) nunca dependeu deste mecanismo: `contextBuilderService.js` já lê os arquivos reais
     diretamente do ROOT via `fs.readFileSync`, independente de qualquer commit/worktree — a
     separação CONTEXT_SNAPSHOT (leitura) vs PROMOTION_BASELINE (execução/promoção, imutável)
     exigida pela spec já existia de fato, só a PROMOTION_BASELINE estava errada.
  4. `validate-engineering-router-v1.js`: checks obsoletos de ER-V1-FINAL-009
     (`SNAPSHOT_COMMIT_RETRIES_TRANSIENT_SCAN_ERROR`, `EXPECTED_TREE_USES_SNAPSHOT_NOT_BARE_HEAD`)
     substituídos por 4 novos (`WORKSPACE_MATERIALIZES_FROM_REAL_IMMUTABLE_HEAD`,
     `NO_DIRTY_SNAPSHOT_COMMIT_MECHANISM`, `EXPECTED_TREE_USES_REAL_IMMUTABLE_BASELINE`,
     `PROMOTION_CHANGED_PATHS_COMPARED_EXPLICITLY`).
- tests:
  - Verificado ao vivo (script de reprodução) que, após o fix, o mesmo cenário de
    `dirty-local-a.txt` promove SOMENTE `mathUtils.js` — nenhuma contaminação.
  - `tests/integration/engineeringPromotionService.test.js` — novo describe **"ER-V1-SEAL-001 —
    Immutable Promotion Baseline"** (4 testes novos, exatamente os cenários exigidos pela spec):
    dirty local **untracked** nunca aparece no candidate; modificação **unstaged** de arquivo já
    rastreado nunca aparece; alteração **staged** (git add sem commit) nunca aparece; as três
    formas SIMULTANEAMENTE — candidate contém SOMENTE o arquivo do patch da task (0 contaminações).
    Suíte completa do arquivo: **10/10 PASS** (6 testes herdados de ERV1-CLOSE-005/ER-V1-FINAL-002
    continuam GREEN, incluindo os 3 cenários de contaminação REAL B/C/D — a correção não
    enfraquece a detecção de side-effects genuínos de teste).
  - `tests/unit/engineeringRouterSnapshotCommitRetry.test.js` (ER-V1-FINAL-009) REMOVIDO — testava
    uma função (`createSnapshotCommit`) que não existe mais; a classe de bug que ele provava
    (TOCTOU do `git add -A`) foi eliminada na raiz, não apenas mitigada.
  - Regressão dirigida: `engineeringPatchApplyAndTestRunner.test.js` (4/4 PASS),
    `engineeringRouterOrphanWorkspacePruning.test.js` (3/3 PASS — e ficou ~8x mais rápido, de
    ~20s para ~2.6s, já que não há mais scan do ROOT compartilhado).
  - Regressão ampla: suíte completa `tests/unit/engineeringRouter*` + `tests/integration/engineering*`
    (38 arquivos) — **38/38 suítes PASS**.
- evidence:
  - `node scripts/governance/validate-engineering-router-v1.js`: `STRUCTURAL_PASS`, 140 checks,
    0 falhas.
  - `promotion_evidence` (model `EngineeringAttempt`) já é `DataTypes.JSONB` genérico — os novos
    campos de evidência são persistidos automaticamente, sem necessidade de migration.
  - `npm run test:unit` (suíte completa do projeto): `Test Suites: 1 skipped, 849 passed, 850
    total`; `Tests: 2 skipped, 6475 passed, 6477 total`; exit code 0 — GREEN limpo.
- status: GREEN

### ER-V1-SEAL-002 — Full Durable Resume

- RED reproduzido (achado real, por investigação direta do código — não hipotético): mapeamento
  completo confirmou que `tolerantTransition` (ER-V1-FINAL-005, missão anterior) só evita o erro
  de STATE MACHINE ao reentrar no MESMO estado de destino — ele NUNCA evita a RE-EXECUÇÃO do
  efeito colateral em si. Confirmado por inspeção linha a linha de `executeRoutedLoop`: das 10
  fases (CLASSIFIED..POST_PROMOTION_VERIFY), 0 tinham qualquer verificação de "já fiz isso antes,
  não repetir" para REGRESSION/GOVERNANCE/PROMOTION — cada chamada re-executava
  `checkRegression`/`checkGovernance`/`promoteValidatedPatch` incondicionalmente. Não existia
  nenhuma tabela "EngineeringOperation"/"Idempotency" dedicada no domínio do Engineering Router
  (confirmado via grep). Dos 14 pontos de crash exigidos pela spec, só CODING/TESTING/
  cancelamento genérico tinham QUALQUER cobertura de teste, e mesmo essa cobertura só provava
  tolerância de transição de estado, nunca idempotência de efeito. O ponto mais crítico
  (PROMOTING — criação de commit real e irreversível) não tinha absolutamente nenhuma proteção
  contra duplicação por crash.
- fix (reaproveitando o padrão já existente no projeto — `api/core/process-runtime/
  processIdempotencyService.js` — como referência conceitual, nunca copiado literalmente, já que
  o domínio do Engineering Router precisa de reconciliação mais rica que idempotency-key simples):
  1. **`api/db/models/EngineeringOperation.js`** + migration
     (`20260922151836-create-engineering-operations.js`) — tabela `engineering_operations`
     (`idempotency_key` único = `task:{taskId}:attempt:{attemptId}:phase:{phase}`): `status`
     (`PENDING/RUNNING/SUCCEEDED/FAILED/UNKNOWN_REQUIRES_RECONCILIATION`), `evidence_ref`,
     `result_hash`, `started_at`/`completed_at`/`error`.
  2. **`engine/engineeringRouter/operationReconciler.js`** (novo, módulo puro) —
     `reconcileOperation({existingOperation, nowMs, staleRunningMs})`: `SUCCEEDED`→`RESUME`
     (reusa, nunca re-executa); `FAILED`→`RETRY`; `RUNNING` recente→`FAIL_SAFE` (pode estar
     rodando de verdade em outro processo AGORA, nunca duplicar concorrentemente); `RUNNING`
     órfão (mais velho que `staleRunningMs`, default 10min)→`RECONCILE` (processo original
     provavelmente morreu no meio — precisa checar evidência EXTERNA real antes de decidir, nunca
     assume); `UNKNOWN_REQUIRES_RECONCILIATION`→`RECONCILE`; status desconhecido/corrompido→
     `MANUAL_REQUIRED` (nunca uma suposição automática).
  3. **`api/services/engineeringRouter/engineeringOperationService.js`** (novo) — persiste e
     orquestra: `beginOrReconcile` (ponto de entrada único), `completeOperation`/`failOperation`
     (efeito idempotente concluiu/falhou), `forceRun` (o CHAMADOR decide conscientemente que um
     `RECONCILE` é seguro reexecutar — só para fases sem efeito colateral externo irreversível:
     REGRESSION/GOVERNANCE/POST_PROMOTION_VERIFY), `resumeWithEvidence` (o CHAMADOR confirma via
     evidência EXTERNA real que o efeito já aconteceu — usado exclusivamente para PROMOTING).
  4. **`api/services/engineeringRouter/promotionService.js`** dividido em
     `createPromotionCandidate` (parte 1: tudo até o commit+branch real — efeito IRREVERSÍVEL) e
     `verifyPromotedCandidate` (parte 2: smoke pós-promoção — idempotente, seguro repetir).
     `promoteValidatedPatch` preservada como composição das duas (compatibilidade total com os
     testes/chamadores existentes — 10/10 GREEN sem nenhuma mudança de asserção). Nova função
     `findExistingCandidate({taskId, validatedPatchHash})`: evidência EXTERNA real (branch
     candidata já existe no git com o `validatedPatchHash` exato gravado na mensagem do commit?)
     usada pelo loop real para resolver um `RECONCILE` em PROMOTING sem nunca criar um segundo
     candidate.
  5. **`engine/engineeringRouter/stateMachine.js`**/`constants.js` — novos estados `PROMOTING`
     (candidate ainda não criado) e `POST_PROMOTION_VERIFY` (candidate real já existe,
     falta só confirmar o smoke) entre `GOVERNANCE` e `GREEN` — dão ao reconciliador um ponto de
     corte persistido exatamente no trecho mais crítico do loop.
  6. **`api/services/engineeringRouter/engineeringRouterService.js`** — `executeRoutedLoop`
     reescrito: REGRESSION/GOVERNANCE/PROMOTING/POST_PROMOTION_VERIFY agora passam por
     `operationService.beginOrReconcile` antes de executar o efeito real; `RESUME` reusa
     evidência já persistida; `FAIL_SAFE` propaga erro explícito (nunca roda concorrentemente);
     `RECONCILE` em REGRESSION/GOVERNANCE/POST_PROMOTION_VERIFY resolve via `forceRun` (seguro,
     sem efeito externo irreversível); `RECONCILE` em PROMOTING resolve OBRIGATORIAMENTE via
     `findExistingCandidate` + `resumeWithEvidence` quando encontrado, ou `forceRun` só quando a
     evidência externa confirma que NADA foi criado ainda.
- tests:
  - `tests/unit/engineeringRouterOperationReconciler.test.js` (novo, 10/10 PASS, puro/
    determinístico): todas as transições de `reconcileOperation` cobertas, incluindo
    `staleRunningMs` customizável.
  - `tests/integration/engineeringOperationService.test.js` (novo, 5/5 PASS, Postgres real):
    ciclo completo RUN→SUCCEEDED→RESUME; FAILED→RETRY; RUNNING recente→FAIL_SAFE (nunca duplica
    concorrentemente); RUNNING órfão→RECONCILE→`markUnknown`→ainda RECONCILE (nunca assume);
    isolamento de `idempotencyKey` entre fases/attempts distintos.
  - `tests/integration/engineeringPromotionCandidateSplit.test.js` (novo, 5/5 PASS, git real):
    `createPromotionCandidate` sozinho cria commit+branch reais SEM rodar o smoke;
    `findExistingCandidate` encontra/não-encontra corretamente pelo `validatedPatchHash` exato;
    `verifyPromotedCandidate` chamado separadamente confirma a árvore promovida. **Crash test
    crítico**: candidate real criado, operation `PROMOTING` envelhecida manualmente para simular
    processo morto, `beginOrReconcile` de novo confirma `RECONCILE`/`RUNNING_STALE`,
    `findExistingCandidate` encontra o candidate real, `resumeWithEvidence` resolve sem
    re-executar — prova final: exatamente 1 branch candidata existe no git ao final (nunca 2).
  - `tests/integration/engineeringRouterConcurrentRunHttp.test.js` (novo, 1/1 PASS): servidor
    Express real + `beginRun`/`engineeringTaskService` REAIS (nunca mockados) contra Postgres
    real — duas requisições HTTP `POST /engineering/tasks/:id/run` disparadas
    simultaneamente para a MESMA task via `Promise.all` + `fetch`: confirma `[202, 409]` (nunca
    `[202,202]` nem `[409,409]`), com o corpo do 409 confirmando `task_already_running`.
  - Regressão: `tests/integration/engineeringPromotionService.test.js` (10/10, sem nenhuma
    mudança de asserção — a composição preserva o comportamento histórico exatamente);
    `tests/integration/engineeringRouterFullLoopE2E.test.js` (3/3, loop completo real passando
    pelos 2 novos estados); suíte ampla do Engineering Router (42/42 arquivos).
  - **3 achados de REGRESSION corrigidos no caminho** (nenhum escondido): (1)
    `tests/unit/engineeringRouterStateMachine.test.js` e
    `tests/integration/engineeringTaskConcurrencyAndRestart.test.js` assumiam a transição antiga
    `GOVERNANCE→GREEN` direta — atualizados para o caminho real via `PROMOTING`/
    `POST_PROMOTION_VERIFY`; (2) `tests/integration/engineeringRouterAuditEnvelopeGeneration.test.js`
    (ER-V1-FINAL-010) tinha uma asserção excessivamente específica sobre qual mensagem de erro de
    fail-closed apareceria sob paralelismo (fingerprint obsoleto vs. status não-PASS — ambas
    corretas) — asserção ampliada para aceitar as duas; (3)
    `tests/integration/engineeringRouterPromotionEvidencePersistence.test.js` mockava só
    `promoteValidatedPatch` (função antiga) — atualizado para mockar
    `createPromotionCandidate`/`verifyPromotedCandidate`/`findExistingCandidate`/
    `computeValidatedPatchHash`.
- evidence:
  - `node scripts/governance/validate-engineering-router-v1.js`: `STRUCTURAL_PASS`, 146 checks,
    0 falhas (6 novos checks do ER-V1-SEAL-002).
  - Regressão ampla final: suíte completa `tests/unit/engineeringRouter*` +
    `tests/integration/engineering*` — **42/42 suítes PASS**.
  - `npm run test:unit` (suíte completa do projeto): `Test Suites: 1 skipped, 850 passed, 851
    total`; `Tests: 2 skipped, 6485 passed, 6487 total`; exit code 0 — GREEN limpo.
- status: GREEN

### ER-V1-SEAL-003 — Dedicated Execution Runner

- RED reproduzido (achado real, confirmado por investigação direta do código e do
  docker-compose de produção — não hipotético): `api/services/engineeringRouter/executionSandbox.js`
  chamava `docker run`/`docker kill`/`docker info` **IN-PROCESS**, dentro do mesmo processo
  Node.js que serve requisições HTTP do `chatbot-api` (`spawn('docker', ...)`,
  `execFileSync('docker', ...)`) — nunca um processo/serviço separado. Ao mesmo tempo,
  `docker-compose.prod.yml` já roda `api` **dentro de um container** (`container_name:
  r-agent2-api-prod`), e `api/Dockerfile` não instala Docker CLI nem monta
  `/var/run/docker.sock` — confirmado por leitura completa do Dockerfile e de todos os
  docker-compose*.yml do projeto (nenhuma montagem de socket existe hoje em lugar nenhum). Ou
  seja: o Execution Sandbox (ER-V1-FINAL-001), tal como implementado, **não teria como
  funcionar dentro do container `api` de produção hoje** — e o caminho mais provável de alguém
  "consertar" isso seria montar o Docker socket diretamente na API, o que daria controle
  PRIVILEGIADO sobre o host inteiro a um processo que serve requisições HTTP externas. Não era
  uma vulnerabilidade já explorada, mas uma inconsistência arquitetural latente exatamente do
  tipo que a missão pede para fechar preventivamente.
- fix:
  1. **`services/engineering-runner/`** (novo serviço standalone, seguindo fielmente o padrão
     arquitetural já estabelecido no projeto para `services/mcp-research/`: container dedicado,
     próprio `package.json`/`Dockerfile`, autenticação Bearer serviço-a-serviço fail-closed,
     rede interna isolada): `src/config.js` (`ENGINEERING_RUNNER_TOKEN` obrigatório — sem ele o
     processo recusa subir, nunca anônimo), `src/auth.js` (Bearer + `timingSafeEqual`, mesmo
     padrão de `services/mcp-research/src/auth.js`), `src/httpServer.js` (`GET /health` nunca
     autenticado; `POST /execute` autenticado, aceita SOMENTE um contrato ESTRUTURADO
     `{executionId, executable, args[], cwd, env{}, timeoutMs, network}` — nunca shell
     arbitrário nem raw docker args do LLM — valida tipos rigidamente antes de tocar o Docker;
     resposta estruturada `{executionId, exitCode, durationMs, stdout, stderr, timedOut,
     signal}`, com `stdout`/`stderr` redigidos via `secretRedaction.js` ANTES de sair do
     processo do runner), `src/index.js` (entry point, shutdown gracioso). `Dockerfile`:
     `node:22-bookworm-slim` + Docker CLI (`apt-get install docker.io`) — único container do
     projeto com esse pacote e com o Docker socket do host montado; reusa (nunca forka)
     `api/services/engineeringRouter/executionSandbox.js` e
     `engine/engineeringRouter/secretRedaction.js` via `COPY` (mesmo padrão de reuso de código
     do `services/mcp-research/Dockerfile`).
  2. **`api/services/engineeringRouter/engineeringRunnerClient.js`** (novo) — MESMA assinatura
     de `executionSandbox.runInSandbox` (mesmos `.code` de erro
     `SANDBOX_UNAVAILABLE`/`SANDBOX_INVALID_WORKSPACE`), mas fala com o runner via `fetch` HTTP
     autenticado em vez de importar o módulo. **FAIL-CLOSED real**: sem
     `ENGINEERING_RUNNER_URL`/`ENGINEERING_RUNNER_TOKEN` configurados, ou com o runner
     indisponível/em erro, lança `SANDBOX_UNAVAILABLE` imediatamente — nunca existe um caminho
     de "spawn local se o runner falhar" (o próprio módulo não importa `child_process`/`docker`
     em nenhuma linha).
  3. **`api/services/engineeringRouter/testRunnerService.js`** — troca de UMA linha de import
     (`require('./executionSandbox')` → `require('./engineeringRunnerClient')`); nenhuma outra
     mudança — confirma que a API principal (`api/services/engineeringRouter/*.js`, confirmado
     via grep) **não importa mais `executionSandbox.js` em lugar nenhum**.
  4. **`docker-compose.yml`/`docker-compose.prod.yml`** — novo serviço `engineering-runner`
     (DEVELOPMENT ONLY, sem porta publicada, só rede interna) com
     `/var/run/docker.sock:/var/run/docker.sock` montado **exclusivamente nele**; serviço `api`
     ganha `ENGINEERING_RUNNER_URL`/`ENGINEERING_RUNNER_TOKEN` (obrigatória,
     `:?` fail-closed do compose) e depende (`depends_on`) do runner estar `service_healthy`.
  5. **`jest.config.cjs`** — `globalSetup`/`globalTeardown` novos
     (`tests/setup/engineeringRunnerGlobalSetup.js`/`...Teardown.js`): sobem o Engineering
     Runner REAL como processo separado antes de toda a suíte (a MESMA separação de processo
     que existe em produção — nunca um mock do runner), aguardam `/health` real responder,
     propagam `ENGINEERING_RUNNER_URL`/`ENGINEERING_RUNNER_TOKEN` via `process.env` (herdado
     pelos workers do Jest), e o encerram ao final via PID persistido em disco.
- tests:
  - `tests/unit/engineeringRunnerHttpServer.test.js` (novo, 12/12 PASS): `config.js` fail-closed
    (sem token não sobe); servidor HTTP real (porta efêmera) — `/health` nunca autenticado;
    `/execute` sem/​com Bearer errado → 401; contrato inválido (args não é array, executionId
    ausente, timeoutMs acima do teto) → 400, nunca tenta executar; corpo não-JSON → 400; rota
    inexistente → 404.
  - `tests/unit/engineeringRunnerClient.test.js` (novo, 5/5 PASS): sem URL/token configurados →
    `SANDBOX_UNAVAILABLE` imediato, nunca tenta rede; runner inalcançável → `SANDBOX_UNAVAILABLE`;
    erro estruturado do runner (`SANDBOX_INVALID_WORKSPACE`) preservado, nunca mascarado;
    contrato de sucesso completo (Bearer correto enviado, corpo correto); resposta não-JSON →
    `SANDBOX_UNAVAILABLE`.
  - `tests/integration/engineeringRunnerDeployment.test.js` (novo, 5/5 PASS) — **o "DEPLOYMENT
    TEST OBRIGATÓRIO" da spec**, com processos REAIS: API nunca importa `executionSandbox.js`;
    runner real de pé (`/health` real); fluxo ponta a ponta real (API → HTTP real → Runner real
    → Docker real → sandbox real) via `testRunnerService`; segredo do processo da API confirmado
    NUNCA aparecendo no stdout do sandbox mesmo passando pela rede até o runner; fail-closed real
    sem runner configurado (`SANDBOX_UNAVAILABLE`, nunca executa no host).
  - Regressão: `tests/integration/engineeringPatchApplyAndTestRunner.test.js` (4/4, agora via
    runner real em vez de import direto); os 4 testes de segurança do sandbox
    (`engineeringRouterExecutionSandboxSecurity`/`SafeEnvironment`/`CommandExecutionSecurity`/
    `TestOutputAuthority`) continuam GREEN sem nenhuma mudança (testam `executionSandbox.js`
    diretamente, o que é correto — testam o sandbox em si, não a separação de processo). Suíte
    ampla do Engineering Router: **43/43 suítes PASS**.
- evidence:
  - `node scripts/governance/validate-engineering-router-v1.js`: `STRUCTURAL_PASS`, 155 checks,
    0 falhas (10 novos checks do ER-V1-SEAL-003, incluindo
    `API_NEVER_IMPORTS_EXECUTION_SANDBOX_DIRECTLY` e
    `DOCKER_SOCKET_NEVER_MOUNTED_IN_API_SERVICE` — este último varre `docker-compose*.yml` e
    falha se qualquer linha de VOLUME real, não comentário, montar `docker.sock` no serviço
    `api`).
  - Teste manual real (via `curl`): runner subido localmente, `/health` retorna
    `{"status":"ok","sandboxAvailable":true}`; `/execute` sem auth → 401; `/execute` autenticado
    com `echo hello-from-sandbox` → `{"exitCode":0,"stdout":"hello-from-sandbox\n",...}`.
  - `npm run test:unit` (suíte completa do projeto): primeira rodada teve 1 timeout isolado em
    `tests/unit/physicalKioskBiometric.test.js` (biometria de kiosk físico — completamente não
    relacionado ao Engineering Router); rodado isoladamente passou em 3.8s (bem abaixo do
    timeout de 30s), e a segunda rodada completa passou 100% limpa — confirma flakiness
    ambiental de contenção de CPU sob paralelismo pesado (padrão pré-existente do projeto,
    `bail: 1` já configurado antes desta missão), não uma regressão real do ER-V1-SEAL-003.
    Segunda rodada: `Test Suites: 1 skipped, 852 passed, 853 total`; `Tests: 2 skipped, 6502
    passed, 6504 total`; exit code 0 — GREEN limpo.
- status: GREEN

### ER-V1-SEAL-004 — Self-Proving Deliverable

- RED reproduzido ao vivo (não hipotético):
  1. `unzip -l dist/r-agent2-20260922-124933.zip | grep evidence/engineering-router` — 0
     ocorrências. O ZIP de release mais recente em disco continha os SCRIPTS-fonte do audit
     envelope (ER-V1-FINAL-010) mas NUNCA os artifacts de evidência gerados — o pipeline oficial
     de empacotamento (`scripts/generate-zip.sh`) excluía `dist/` inteiro por padrão
     (`INCLUDE_DIST=false`) e nunca tinha um caminho equivalente ao `copy_required_proof_entries`
     (já usado para outras provas de QA/governança) para o envelope do Engineering Router.
  2. A spec exige `npm run verify:engineering-router-v1-envelope -- <path>` funcionando
     "SEM: Internet; DB; Git repository; provider API; Docker daemon; acesso ao RAP runtime" e um
     conjunto de 6 negative tests nomeados — nenhum comando com esse nome existia (só
     `engineering-router:audit-envelope:verify`, fixo no diretório `dist/...`, sem suportar um
     ZIP de release diretamente).
  3. O manifest do envelope (ER-V1-FINAL-010) não expunha `structuralStatus`/`finalDecision`
     recalculável nem separava `sandbox`/`resume` como categorias próprias de evidência — a spec
     pede exatamente essas 5 categorias adicionais como artifacts dedicados.
- fix:
  1. **`scripts/governance/generate-engineering-router-v1-audit-envelope.js`** — 5 artifacts
     novos: `source-fingerprint.json`, `runtime-requirements.json` (mesma lista de
     `RUNTIME_ITEMS`, reaproveitada — nunca uma cópia divergente), `structural-certification.json`
     (extraído do `structuralGate` que antes só vivia dentro de `governance-evidence.json`, agora
     fonte primária, mantido lá por compatibilidade), `sandbox-evidence.json` e
     `resume-evidence.json` (categorias `EXECUTION_SANDBOX_ISOLATION` e
     `RESTART_RESUME`/`CRASH_RESUME_MID_STAGE`, antes misturadas dentro de `security`/`routing`,
     agora extraídas para `CATEGORY_BY_ID` dedicado). `manifest.json` ganha `runtimeRunId`,
     `governanceRunId`, `structuralStatus`, `expectedArtifacts`, `finalDecision` (GO/NO_GO
     recalculado a partir de runtime PASS + structural PASS + todos os 10 blockers GREEN).
     `SCHEMA_VERSION` 1.0.0 → 1.1.0 (aditivo).
  2. **`scripts/governance/verify-engineering-router-v1-audit-envelope.js`** — `ARTIFACT_FILES`
     cresce de 9 para 14; novos checks `SOURCE_FINGERPRINT_ARTIFACT_CONSISTENT`,
     `RUNTIME_REQUIREMENTS_MATCH_REQUIRED_IDS`, `STRUCTURAL_CERTIFICATION_PASS`,
     `MANIFEST_STRUCTURAL_STATUS_MATCHES`, `SANDBOX_ITEM_PASS_*`, `RESUME_ITEM_PASS_*`,
     `FINAL_DECISION_RECOMPUTED_MATCHES` (o verifier NUNCA confia no `finalDecision` gravado pelo
     gerador — recalcula de forma independente a partir de runtime/structural/release-closure).
     Novo suporte a **ZIP diretamente**: `extractEnvelopeFromZip` (via `unzip` real, sem rede) +
     detecção de extensão `.zip` no `main()` — mesma função `verifyEnvelope`, nenhuma segunda
     implementação para o caso "dentro de um ZIP".
  3. **`package.json`** — novo script `verify:engineering-router-v1-envelope` (nome exato pedido
     pela spec), mantendo `engineering-router:audit-envelope:generate`/`:verify` existentes
     intactos (nenhum consumidor quebrado).
  4. **`scripts/generate-zip.sh`** — nova função `copy_engineering_router_v1_audit_envelope`
     (mesmo padrão de `copy_required_proof_entries`, chamada logo depois): copia
     `dist/engineering-router-v1-audit-envelope/*.json` para
     `$STAGE_DIR/evidence/engineering-router-v1/` no ZIP final. Best-effort e não-bloqueante de
     propósito (avisa e segue se `dist/...` não existir) — o pipeline empacota o projeto INTEIRO,
     não só o Router, e gerar o envelope custa minutos de sandbox Docker real; quem precisa da
     garantia forte usa `verify:engineering-router-v1-envelope -- <zip>` explicitamente antes de
     publicar (ex.: pipeline oficial de selagem).
  5. **`scripts/governance/validate-engineering-router-v1.js`** — 5 checks novos garantindo que o
     gerador escreve os 5 artifacts, o verifier valida todos eles, o verifier aceita ZIP, o ZIP de
     release injeta o envelope, e o alias de npm está registrado.
- tests:
  - `tests/unit/engineeringRouterAuditEnvelopeVerifier.test.js` (17/17 PASS, 9 novos) — cobre as
    6 negative tests EXATAS da spec: 1 byte alterado em `runtime-certification.json` sem
    atualizar hash → FAIL; `promotion-evidence.json` removido → FAIL; `pilotTaskId` trocado →
    FAIL; status `RUNTIME_NOT_REQUESTED` (mesmo com hashes íntegros) → FAIL;
    `sourceFingerprint` trocado sem atualizar `baseline.json` → FAIL; manifest alterado
    (`finalDecision` forjado) sem hash bater → FAIL (detectado porque o verifier recalcula
    `finalDecision` de forma independente). Mais 2 testes cobrindo `runtime-requirements.json`
    incompleto e `structural-certification.json` != PASS.
  - `tests/integration/engineeringRouterAuditEnvelopeGeneration.test.js` (2/2 PASS) — geração
    REAL a partir da evidência real no disco confirma os 5 arquivos novos presentes,
    `structuralStatus=PASS`, `finalDecision=GO`; verifier real sobre o output real também PASS.
  - Regressão: suíte ampla do Engineering Router (49 arquivos) — ver evidence abaixo.
- evidence:
  - **Achado real durante a implementação (REGRESSÃO, corrigida antes de prosseguir — commit
    `8026a1ba`)**: ao rodar o coletor de evidência de runtime pela primeira vez nesta missão SEAL
    (necessário para gerar o envelope), 25/25 itens quebraram com "saída do Jest não pôde ser
    parseada como JSON" — investigado e corrigido em 3 causas raiz reais, todas no
    `globalSetup`/`globalTeardown` introduzidos pelo ER-V1-SEAL-003:
    (1) `console.log` contaminava o stdout que o coletor precisa parsear como `--json` puro
    (trocado para stderr); (2) `globalTeardown` mandava SIGTERM e retornava sem esperar o
    processo morrer, causando corrida de porta fixa (8097) entre itens sequenciais do coletor
    (corrigido esperando a morte real, com fallback SIGKILL); (3) **mais grave**: qualquer
    `testCommand` da task que seja, ele mesmo, um `npx jest` (padrão comum nos fixtures do
    Router, usado por `RED_TO_FIX`/`REVIEWER_REJECTION_RECODE`/`GOVERNANCE_EXECUTION`/
    `PROVIDER_MODEL_FAILURE_REROUTE`/`CONTROLLED_PROMOTION`/`POST_PROMOTION_VERIFICATION`/
    `EXACT_PATCH_PROMOTION`) roda DENTRO do workspace isolado (`git worktree`) e carregava o
    MESMO `jest.config.cjs`, tentando subir um SEGUNDO Engineering Runner recursivamente —
    crashava com `EACCES` ao escrever o PID file dentro do sandbox, derrubando a task inteira
    (nunca chegava a GREEN). Corrigido detectando worktree vinculado (`.git` é arquivo, não
    diretório, dentro de um workspace isolado) e pulando o spawn nesse caso. Reproduzido ao vivo
    com um teste temporário isolado (removido após confirmação), RED→fix→GREEN provados antes de
    formalizar como parte deste blocker.
  - `node scripts/governance/collect-engineering-router-runtime-evidence.js` (após os 3 fixes,
    commit `aa52f6e2`): `status=RUNTIME_PASS items=25 falhas=0
    fingerprint=42bb5ee02158f605…`.
  - `node scripts/governance/validate-engineering-router-v1.js --runtime`: `status=PASS
    (STRUCTURAL_PASS/RUNTIME_PASS) checks=188 falhas=0`.
  - `npm run engineering-router:audit-envelope:generate` real: gera os 14 artifacts +
    `hashes.json` em `dist/engineering-router-v1-audit-envelope/`;
    `runtimeStatus=RUNTIME_PASS releaseStatus=ENGINEERING_ROUTER_V1_10_OF_10_GREEN`.
  - `npm run engineering-router:audit-envelope:verify` real: `status=PASS checks=137 falhas=0`.
  - `npm run verify:engineering-router-v1-envelope -- dist/engineering-router-v1-audit-envelope`:
    mesmo resultado (`status=PASS checks=137 falhas=0`) — comando exato pedido pela spec
    funcional.
  - **Package pipeline real**: `bash scripts/generate-zip.sh -o <tmp> -n seal-test-release.zip`
    (ZIP real de 52M/9155 arquivos) → `unzip -l` confirma `evidence/engineering-router-v1/` com
    os 15 arquivos (14 artifacts + `hashes.json`) presentes. `node
    verify-engineering-router-v1-audit-envelope.js <zip>` direto contra o ZIP: `status=PASS
    checks=136 falhas=0` (offline, sem rede/DB/docker — só `unzip` real).
  - `node scripts/governance/validate-engineering-router-v1.js`: `STRUCTURAL_PASS`, 188 checks
    (com `--runtime`), 0 falhas.
- status: GREEN

### ER-V1-SEAL-005 — Current Model Policy

- RED reproduzido ao vivo (evidência real já documentada no próprio código, não hipotética):
  `engine/engineeringRouter/modelCapabilities.js` mantinha `openai:gpt-5-codex` (CODER) e
  `openai:gpt-5.5-pro` (CODER+REVIEWER) mapeados na allowlist de segurança do Router — a ÚNICA
  autoridade real de elegibilidade (`isModelMapped`/`modelCatalogPolicy.isEligibleForRisk`) —
  MESMO com um comentário no mesmo arquivo, já presente desde a missão anterior, admitindo que um
  pilot real com credencial OpenAI real confirmou 404 (`model_not_found`/descontinuado) para
  ambos. Ou seja: a allowlist afirmava disponibilidade que a evidência real já tinha refutado —
  exatamente "inventar disponibilidade", proibido pela spec ("NÃO hardcodar automaticamente todo
  modelo descoberto como confiável" / "Se provider não listar um modelo: UNAVAILABLE/UNKNOWN
  conforme evidence"). Confirmado por grep: nenhum teste dependia desses modelIds permanecerem
  mapeados.
- fix: removidos `openai:gpt-5-codex` e `openai:gpt-5.5-pro` de `MODEL_CAPABILITIES`.
  `openai:gpt-4o` (única confirmação POSITIVA real do pilot, já documentada) permanece mapeado
  como CODER+REVIEWER, cobrindo o provider sozinho. `openai:gpt-5.4-mini` mantido como está —
  sem evidência real (nem positiva nem negativa) que justifique alterá-lo; a política não inventa
  disponibilidade em nenhuma direção. Nenhuma renomeação do vocabulário de estados do catálogo
  (`DISCOVERED`/`UNCLASSIFIED`/`CLASSIFIED`/`APPROVED`/`RETIRED`/`UNAVAILABLE`/`DENIED`) foi feita
  — os 7 estados existentes desde ER-V1-FINAL-008 já cobrem semanticamente o lifecycle pedido
  pela spec (`CLASSIFICATION_PENDING`≈`UNCLASSIFIED`, `ELIGIBLE`≈`APPROVED`, `DISABLED`≈`DENIED`)
  e renomear só por vocabulário, sem mudança de comportamento, seria puro churn fora do escopo
  mínimo desta missão (SEM hardening genérico).
- tests: `tests/unit/engineeringRouterModelCapabilities.test.js` (6/6 PASS, 2 novos) — prova RED
  (modelos desmentidos por evidência real nunca podem estar mapeados) e GREEN (`gpt-4o`
  permanece elegível como CODER e REVIEWER).
- evidence:
  - Regressão: `engineeringRouterModelSelector` (7/7), `engineeringRouterModelCatalogPolicy`
    (9/9), `engineeringModelCatalogService` (4/4), `engineeringRouterModelCapabilities` (6/6) —
    todos GREEN.
  - `node scripts/governance/validate-engineering-router-v1.js`: 2 checks novos
    (`OPENAI_MODEL_POLICY_NO_DISPROVED_MODELS_MAPPED`,
    `OPENAI_MODEL_POLICY_CONFIRMED_MODEL_MAPPED`), 162 checks totais (modo estrutural), 0 falhas.
  - Incluído no `RUNTIME_PASS` 25/25 do ER-V1-SEAL-004 acima (mesmo commit `aa52f6e2` já cobre
    `MODEL_CATALOG_GOVERNANCE` e todos os itens que exercitam roteamento real).
- status: GREEN

## Certificação final (itens 6-11 da ordem obrigatória)

Todos os 5 blockers ER-V1-SEAL-001..005 GREEN (acima). Certificação executada nesta ordem, no
HEAD final `aa52f6e2` (commits desta missão, em ordem: `d0cb3a3d` baseline, `471c262e`
ER-V1-SEAL-001, `815d598b` ER-V1-SEAL-002, `8cd29620` ER-V1-SEAL-003, `8026a1ba` regressão real
descoberta e corrigida durante ER-V1-SEAL-004 (globalSetup/globalTeardown do Jest), `aa52f6e2`
ER-V1-SEAL-005 + checks estruturais do ER-V1-SEAL-004):

1. **Runtime certification = PASS**: `node scripts/governance/collect-engineering-router-runtime-evidence.js`
   → `status=RUNTIME_PASS items=25 falhas=0 commit=aa52f6e213cac7ec5f9e666b241bb94f40427797
   fingerprint=42bb5ee02158f605…`. `node scripts/governance/validate-engineering-router-v1.js --runtime`
   → `status=PASS (STRUCTURAL_PASS/RUNTIME_PASS) checks=188 falhas=0`.
2. **Self-proving envelope = PASS**: `npm run engineering-router:audit-envelope:generate` → 14
   artifacts + `hashes.json` reais em `dist/engineering-router-v1-audit-envelope/`,
   `runtimeStatus=RUNTIME_PASS releaseStatus=ENGINEERING_ROUTER_V1_10_OF_10_GREEN`.
3. **Offline verifier = PASS**: `npm run engineering-router:audit-envelope:verify` e
   `npm run verify:engineering-router-v1-envelope -- dist/engineering-router-v1-audit-envelope`
   → `status=PASS checks=137 falhas=0` (ambos, mesmo comando por baixo). Testado também
   diretamente contra um ZIP de release real (`node .../verify-....js <zip>` →
   `status=PASS checks=136 falhas=0`) — sem rede, sem DB, sem git repo acessível de dentro do
   ZIP extraído, sem Docker, sem acesso ao runtime do RAP — só os JSONs do envelope + `unzip`.
4. **Real pilot = PASS**: coberto pelos itens de runtime (`RED_TO_FIX`, `REVIEWER_REJECTION_RECODE`,
   `PROVIDER_MODEL_FAILURE_REROUTE`, `CONTROLLED_PROMOTION` etc.) — o loop real
   TASK→CODING→TESTING→REVIEWING→REGRESSION→GOVERNANCE→PROMOTING→POST_PROMOTION_VERIFY→GREEN foi
   exercitado ponta a ponta com processos reais (git, Docker sandbox via Engineering Runner real,
   Postgres real) em `pilot-evidence.json` (`pilotTaskId=pilot-aa52f6e213cac7ec5f9e666b241bb94f40427797`),
   todos os itens `pass:true`.
5. **Full affected regression = PASS**:
   - Suíte completa do Engineering Router (49 arquivos, unit+integration) em modo serial:
     `Test Suites: 49 passed, 49 total` / `Tests: 320 passed, 320 total`. (Nota: uma primeira
     tentativa em paralelo — fora do padrão usado pelos scripts oficiais do projeto — apresentou
     1 falha de contenção real de DB entre suítes de integração concorrentes, não reprodutível em
     modo serial nem isoladamente; documentado como artefato do modo de execução ad-hoc, não uma
     regressão de código.)
   - `npm run test:unit` (suíte oficial completa do projeto): `Test Suites: 1 skipped, 852
     passed, 852 of 853 total` / `Tests: 2 skipped, 6512 passed, 6514 total`, exit code 0.
6. **Final governance**: `node scripts/governance/validate-engineering-router-v1.js` (modo
   estrutural) → `STRUCTURAL_PASS`, 162 checks, 0 falhas; com `--runtime` → 188 checks, 0 falhas
   — esta é a superfície de governança REALMENTE afetada por esta missão (as 5 blockers SEAL
   fecham exatamente esses dois gates, já incluídos como etapa obrigatória dentro do gate
   agregado `npm run validate:governance-enforcement`, confirmado por leitura do próprio
   `package.json`). Ao rodar `validate:governance-enforcement` (gate agregado de TODO o
   projeto, não só do Router) para checagem final, a etapa do Router (`validate:engineering-router-v1:runtime`)
   passou dentro da cadeia (`status=PASS (STRUCTURAL_PASS/RUNTIME_PASS) checks=188 falhas=0`),
   mas a cadeia parou logo depois numa etapa NÃO relacionada ao Router
   (`validate:runtime` — smoke Playwright real contra `http://127.0.0.1:5173/workspace`,
   `net::ERR_CONNECTION_REFUSED`): nenhum servidor de desenvolvimento do frontend estava de pé
   nesta sessão (sessão inteira foi trabalho de backend/governança, nenhum `npm run dev` jamais
   iniciado). É uma precondição de ambiente do gate agregado da PLATAFORMA INTEIRA, não uma
   regressão de código nem algo dentro do escopo desta missão (proibido redesenho de UI/hardening
   genérico fora dos 5 blockers congelados) — nunca causada por nenhum dos commits desta missão.
   Documentado aqui em vez de mascarado; não bloqueia a decisão de selagem do Engineering Router
   V1 especificamente, cujo próprio gate de governança está 100% GREEN.

## Decisão final de selagem

**GO — Engineering Model Router V1 SELADO.**

- 5/5 blockers ER-V1-SEAL-001..005: GREEN.
- Runtime certification: RUNTIME_PASS 25/25.
- Self-proving audit envelope: gerado, 14 artifacts + hashes, `finalDecision=GO` (recalculado
  independentemente pelo verifier, não só afirmado pelo gerador).
- Offline verifier: PASS contra `dist/` e contra um ZIP de release real (package pipeline agora
  entrega a prova, achado real corrigido nesta missão).
- Real pilot: PASS (mesma evidência de runtime, loop real ponta a ponta).
- Full affected regression: PASS (49/49 suítes do Router em serial, 852/853 + 6512/6514 do
  projeto inteiro via `test:unit`).
- Governance (superfície afetada pela missão — gate estrutural+runtime do Router): PASS,
  188 checks, 0 falhas.
- Nenhum CLOSURE_BLOCKER restante. Duas regressões reais foram encontradas e corrigidas DURANTE
  esta missão (nunca mascaradas): (1) contaminação de stdout + corrida de porta +
  aninhamento recursivo do Engineering Runner no `globalSetup`/`globalTeardown` do Jest
  (commit `8026a1ba`); (2) allowlist OpenAI desatualizada (commit `aa52f6e2`, o próprio
  ER-V1-SEAL-005). Um achado de hardening real (catálogo governado write-only, nunca lido pelo
  roteamento real) foi classificado POST_RELEASE_HARDENING e registrado em
  `POST_RELEASE_MODEL_ROUTER_BACKLOG.md`, não implementado nesta missão.

STARTED_AT (baseline) até esta decisão: sessão única, ordem obrigatória respeitada
(001→002→003→004→005→runtime→pilot→regression→governance→envelope→offline verify→decisão),
nenhum blocker trabalhado em paralelo, nenhuma alteração fora do backlog congelado de 5 itens.
