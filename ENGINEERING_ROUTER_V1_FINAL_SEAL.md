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
