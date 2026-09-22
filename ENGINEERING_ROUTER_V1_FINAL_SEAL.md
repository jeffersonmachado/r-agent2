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
