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
