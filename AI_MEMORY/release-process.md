# Release Process

## Official commands

- `npm run system:bootstrap`
- `npm run system:validate`
- `npm run zip:release`
- `npm run system:release`
- `npm run system:deploy`

`npm run zip:release` is mandatory for release packaging. Prefer `npm run zip:release:clean` when workspace runtime residue may exist.

## Canonical sources

- `README.md`
- `docs/official-path.md`
- `docs/release-contract.md`
- `docs/release-checklist.md`
- `docs/runtime-governance.md`
- `docs/runtime-paths.md`
- `docs/governance/PRODUCTION_READINESS.md`
- `tools/system/release.js`
- `tools/system/release-gate.js`
- `tools/system/go-no-go.js`
- `scripts/release-package.sh`

## Acceptance chain

Release is acceptable only when validation, package validation, replay integrity, runtime governance, release gate, governance chain and self-proving reports are coherent and green.

Never deploy from a live workspace when the approved artifact contract is required.

## Release state machine + DAG (2026-09-13)

Canonical model: `governance/release-state-machine.js` (fases, transições,
`requiredPhase`, `PENDING_PHASE`) and `governance/release-dag.js` (grafo
gate→gate, gate→artefato, artefato→produtor, detecção de ciclo). Enforcement:
`npm run validate:release-dag` (ciclo ⇒ `RELEASE_DEPENDENCY_CYCLE` antes de
qualquer mutação de pacote) e `npm run validate:release-artifact-identity`
(bytes reais + lineage candidato→payload + isolamento de run). Ambos entram no
gate agregado.

Fases (ordem única de comparação — nunca comparar strings): `SOURCE_VALIDATED`
→ `PRE_PACKAGE` → `CANDIDATE_BUILT` → `CANDIDATE_VALIDATED` → `SEALED` →
`DELIVERED` → `FINAL_GOVERNANCE` → `PUBLISHED_VERIFIED`.

Regras estruturais:

- Um gate declara `requiredPhase`. Antes da fase, o status é `PENDING_PHASE`
  (nunca PASS, nunca FAIL). PENDING vencido (fase alcançada e output nunca
  produzido) vira FAIL.
- O score da fase corrente não mistura dimensões ainda não mensuráveis;
  `FINAL_RELEASE_SCORE` é `NOT_YET_MEASURABLE` até as fases finais.
- **Candidato** é artefato de primeira classe: `dist/candidate/<release>.candidate.zip`
  + `<release>.candidate.manifest.json` (`artifactType=CANDIDATE`,
  `releasePhase=CANDIDATE_BUILT|CANDIDATE_VALIDATED`). Nunca rotulado
  DELIVERED/PUBLISHED/FINAL, nunca reescrito depois de validado.
- **Payload entregue**: `dist/release/<release>.payload.zip` + identidade
  EXTERNA `dist/release/<release>.delivered.identity.json`
  (`artifactType=DELIVERED_PAYLOAD`, `parentCandidateHash`, `finalPayloadHash`,
  `governanceRunId`, lineage). O hash do payload vive fora dos bytes que cobre —
  paradoxo do auto-hash evitado.
- Retenção: o release publicado anterior é preservado em
  `dist/archive/<release>/` (5 mais recentes) — o run novo não destrói o último
  release bom.
- `npm run zip:release` é AUTO-SUFICIENTE: provisiona o governance run do source
  atual (`scripts/governance/ensure-governed-run.js`), grava package-validation
  honesta (DEFERRED quando o candidato ainda não existe) e converge a governança
  (`converge-governance.sh`) — a sequência que antes era manual e não
  documentada. `RAP_SKIP_PRE_PACKAGE_PROVISION=1` desliga (release NÃO
  reproduzível).

## dist/ cleanliness contract (2026-07-23)

`npm run zip:release` (`scripts/release-package.sh` → `generate-zip.sh`) writes the audited ZIP + sidecar manifest (`r-agent2-YYYYMMDD-HHMMSS.zip` / `.manifest.json`) at the **root of `dist/` by design**. AGENTS.md allows this: "dist/ deve permanecer limpo, exceto ZIPs/manifestos de release aprovados". `scripts/check-dist-clean.sh` step 5 whitelists exactly that naming pattern; the governed envelope flow (`scripts/two-pass-release.sh`) lives in `dist/release/` and is verified separately. Custom `--name` ZIPs are NOT whitelisted. Reconciled after `validate:dist` failed on a legitimately produced release ZIP (contradiction between packaging and the cleanliness gate).

## Aprovação de deploy do artefato selado (2026-09-26)

**Passo obrigatório depois de qualquer selagem** — sem ele o deploy documentado
(`npm run system:deploy`) fica bloqueado, mesmo com o release selado, publicado e
verificado.

```bash
npm run system:go-no-go           # emite a decisão (qa/go-no-go-report.json)
npm run system:release-manifest   # escreve <release>.approval.json em dist/release/
npm run system:deploy             # dry-run (SYSTEM_DEPLOY_EXECUTE=1 para valer)
```

**Por que existe um sidecar separado.** Metadados de aprovação (goNoGo,
releaseGate, approvedForDeploy) **não podem** ser gravados no manifest do payload:
o hash desse manifest é selado no self-proving-report e o verifier rígido exige
igualdade. A aprovação vive em `<release>.approval.json`
(`tools/system/lib/release-artifact.js` — `updateArtifactManifest`), e
`listArtifacts` faz o merge na leitura.

**Sintoma quando falta** (verificado 2026-09-26):

```
[system:deploy] FAIL: artifact_missing:no_zip_with_audit_passed_and_go_no_go_go
```

`system:deploy` procura um ZIP cujo manifest (ou sidecar de aprovação) tenha
`audit === 'passed'` **e** `goNoGo === 'GO'`. O release publicado
`r-agent2-20260926-114417` não tinha sidecar porque **o fluxo canônico de
selagem (`release:seal`/`two-pass-release.sh`) não executa
`system:release-manifest`** — um selo bem-sucedido não aprovava o artefato para
deploy. O `qa/release-manifest.json` vigente ainda apontava para
`r-agent2-20260908-105354.zip`.

**Gap de processo FECHADO (commit `da1873fe`, 2026-09-26):**
`scripts/governance/seal-release.sh` (`phase_consolidate`) agora roda
`system:go-no-go` + `system:release-manifest` depois dos reparos de
projeção/lineage e antes do `commit_and_push`, **verifica** o sidecar
(`goNoGo=GO` E `approvedForDeploy=true`) e **aborta o selo (fail-closed)** se ele
não existir ou estiver inválido — um selo que termine sem aprovação de deploy é
um release que não pode ser implantado, e isso não pode passar silenciosamente.

Efeito colateral esperado dos dois comandos: regeneram 18 artefatos derivados
(`governance/final-*`, `qa-waves/journey-coverage/*`, projeções de status,
`docs/governance/PLATFORM_STATUS.md`) — o `commit_and_push` da própria fase os
persiste. Eles **não** clobberam lineage (`final-consistency-gate` =
`FINAL_CONSISTENCY_GO failed=0`; `validate:journey-projections` EXIT 0). O
sidecar em si é gitignored (`dist/`).

Para releases selados **antes** de `da1873fe`, os dois comandos continuam sendo
passos manuais obrigatórios (foi assim que `r-agent2-20260926-114417` passou a
ser deployável).

## Pré-requisito de selagem: evidência de smoke contínuo das QA Waves (< 48 h)

A fase `consolidate` roda o gate agregado (bloqueante) e ele inclui
`validate:qa-governance`. Esse gate **reconstrói** o veredito via
`tools/system/lib/qa-waves-enterprise-governance-bridge.js` (não lê o JSON
commitado) e considera **vencida** a evidência de smoke contínuo com
`generatedAt` mais antigo que `maxAgeHours = 48`:

```
qa_waves_enterprise_governance_no_go: qa_waves_status_not_go,
qa_waves_active_blockers, qa_waves_continuous_smoke_degraded
  ⟵ activeBlockers[0].evidenceReasons = [scheduled_evidence_stale,
                                          scheduled_source_evidence_stale]
```

**Não é regressão de código — é decaimento por tempo.** Medido no release
`r-agent2-20260926-215718`: no selo a evidência tinha 35,0 h (agregado EXIT 0);
~13 h depois tinha 49,6 h e o gate passou a FAIL, sem nenhuma mudança de fonte.
`mtime` não conta (só `generatedAt`), então `touch` não renova.

**Remédio (produtor canônico):**

```bash
./scripts/smoke/run-scheduled-production-health-smoke.sh   # feito para cron diário
```

Regenera `qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json` e
`qa/smoke/qa-waves-scheduled-operational-smoke.json`. Condições: exige opt-in do
scheduler (`enabled:true` persistido ou `QA_MESH_SCHEDULER_ENABLED=true`), exige a
stack prod-like em Docker (frontend 8080, API 3001, Postgres/Redis) e **derruba os
serviços de dev** (API node, Vite, RAG) para liberar as portas. Sem a stack no ar
ele registra SKIP e sai 0 — por política **nunca** gera evidência falsa. Antes de
um ciclo de selagem, confira a idade da evidência; se estiver > 48 h, agende a
renovação (cron `23 4 * * *`) em vez de descobrir na fase `consolidate`.

### Detecção antecipada (fail-fast) no preflight do selo

Desde 2026-09-27 o `preflight()` de `scripts/governance/seal-release.sh` roda a
**mesma** avaliação do gate (reusa `assessScheduledEvidence` do bridge — o
threshold de 48 h não é duplicado) **antes de qualquer trabalho**:

- evidência vencida => aborta em ~8 s com o remédio explícito acima (em vez de
  abortar no fim de um ciclo de 1,5–2 h);
- `--dry-run` apenas avisa e segue imprimindo o plano.

Armadilha medida ao implementar: a checagem **precisa** de
`node --env-file-if-exists=.env`. Sem a chave de assinatura, o
`validateReplayIntegrity` reprova todos os fluxos e o bridge emite
`scheduled_flow_source_mismatch:<jornada>:integrityValid` para cada um (8 falsos
mismatches em 2026-09-27); com `.env`, os motivos se reduzem a
`scheduled_evidence_stale` + `scheduled_source_evidence_stale`. Qualquer
avaliação do bridge fora do runtime do gate deve carregar o `.env`, sob risco de
bloquear selo válido.

O produtor de smoke **não** é chamado de dentro do selo, de propósito: ele derruba
API/Vite/RAG, exatamente os três serviços que o preflight do converge exige. Por
isso a evidência não pode ser renovada same-run dentro do selo neste host — o TTL
continua sendo o instrumento (o objeto validado é uma **stack viva**, não só o
código).

### Renovação verificada (2026-09-27)

```bash
# 1) stack prod-like. A API do STACK precisa estar no ar: o SPA em :8080 só
#    autentica se o proxy interno (nginx → api:3000) alcançar a API.
export ENGINEERING_ROUTER_HOST_REPO_ROOT=/opt/results/ria
export ENGINEERING_ROUTER_WORKSPACE_ROOT=/tmp/engineering-router-workspaces
export ENGINEERING_RUNNER_TOKEN="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
docker compose -f docker-compose.yml up -d --no-deps --no-build api rag-service

# 2) produtor canônico (derruba API/Vite/RAG de dev para liberar as portas)
QA_MESH_SCHEDULER_ENABLED=true ./scripts/smoke/run-scheduled-production-health-smoke.sh

# 3) voltar ao dev
docker stop chatbot-api chatbot-rag-service   # e subir API node + Vite 5173 + RAG 8001
```

`--no-deps` evita o `engineering-runner` (DEVELOPMENT ONLY; a imagem `:latest`
pode não existir localmente). `ENGINEERING_ROUTER_*` e `ENGINEERING_RUNNER_TOKEN`
são obrigatórias no compose e **não** são geradas pelo `system:bootstrap` (drift
bootstrap↔compose). Resultado esperado: `status=GO`, as duas evidências com
`generatedAt` novo e `validate:qa-governance` EXIT 0.

### Causa raiz das falhas do cron (2026-09-25/26/27)

`page.waitForFunction: Timeout 30000ms` em `ensureAuthenticated`: o container
`chatbot-api` estava **parado desde 2026-09-22 22:42** (stop manual —
`restart: unless-stopped` não ressuscita container parado à mão), enquanto `:3001`
era atendida por outro processo, e o `pkill -f "node api/server\.js"` do wrapper
não casa cmdlines com flags (`node --env-file-if-exists=.env api/server.js`). A
checagem `reachable "$API_URL/"` passava, o smoke começava e o SPA ficava sem
backend. Guard novo no wrapper: sonda `${FRONTEND_URL}/r-agent2/api/health`
exigindo 200, senão `SKIP prod_like_api_unreachable_through_frontend code=502` —
detecta em ~6 s em vez de morrer em 30 s. O log de cada execução fica em
`logs/qa/scheduled-production-health-smoke.log`.



