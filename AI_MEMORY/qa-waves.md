# QA Waves

QA Waves are governed journeys and scenario waves. They connect seeds, business journeys, replay evidence, mesh execution, gap classification and release gates.

## Canonical sources

- `docs/governance/QA_WAVES_STATUS.md`
- `docs/qa-waves-enterprise-governance.md`
- `docs/qa-waves-operational-proof-architecture.md`
- `docs/qa-waves-production-readiness.md`
- `docs/QA_WAVES_SEMANTIC_SCENARIOS.md`
- `qa-mesh/meshRegistry.json`
- `qa-mesh/go-no-go-report.json`
- `qa-mesh/release-gate-report.json`
- `qa-waves/journey-coverage/*.json` (artefatos gerados pelo platform-readiness; o coverage gate NÃO os lê — usa `config/journey-scenario-links.json`, sincronizado via `npm run coverage-gate:links`)

## Operational rules

- A scenario is not release evidence without machine-readable result, replay linkage when applicable, and governance decision.
- NO_GO conditions must block release promotion.
- Seeds are operational inputs and must be reproducible.
- Auto-correction must generate evidence, never hide a failing journey.
- Scenario inference is allowed only when linked to explicit journey/domain metadata and validated runtime behavior.

## QA Mesh scheduler — habilitação explícita (2026-08-25)

- **Opt-in explícito (default OFF).** O scheduler do mesh só liga quando:
  - o estado persistido (`qa-mesh/scheduler-state.json`; fonte canônica no DB via `dbStateStore`) tem `enabled:true` (toggle na UI), **ou**
  - `QA_MESH_SCHEDULER_ENABLED=true` (env, opt-in explícito).
- **Fail-closed:** `QA_MESH_SCHEDULER_DISABLED=true` é kill-switch que sempre vence (a UI não consegue religar contra ele).
- Bootstrap (`qaMeshService.js` → `startScheduler()`) NÃO inicia o mesh sem habilitação explícita; também limpa `activeLock` obsoleto de reinícios anteriores.
- Presets de frequência: `15min/30min/1h/2h/6h/12h/daily` (default `15min`), persistidos em `criticalFrequencyKey`.
- API: `POST /qa-mesh/scheduler` (`{ enabled, frequencyKey }`, DEVELOPMENT) → `setMeshSchedulerEnabled`; frontend na tela QA Mesh (`QaMeshPage.jsx`).
- **Cron do smoke prod-like alinhado:** `scripts/smoke/run-scheduled-production-health-smoke.sh` (crontab 04:23) aplica a MESMA política antes de rodar — sem `enabled:true`/`QA_MESH_SCHEDULER_ENABLED=true`, ou com `QA_MESH_SCHEDULER_DISABLED=true`, o smoke é pulado (SKIP).
- Regressão: `qa-mesh/__tests__/scheduler.test.js` (opt-in default-off + kill-switch).

## AI as journey owner (2026-08-12)

- The AI agent is the **primary actor** for journey QA. It must: infer business needs → configure the journey → execute it **via browser as a normal user** → identify failures and gaps → fix them → register the journey as an executable QA scenario.
- **API-only coverage does not prove the user can complete a journey in the UI.** A journey is only "covered" when exercised end-to-end through the frontend by a real user flow. QA/Wave is the persistence/regression layer, not the sole detector.
- When an API endpoint exists but no UI calls it (e.g., `POST /api/fitness/student` had no create form), treat it as a gap immediately — not as intentional design.
- After fixing a gap, register it as an executable scenario (browser adapter) so the detection persists in the mesh/waves and does not depend on an agent being present.
- Concrete case (2026-08-12): the Fitness first journey (create student → charge → confirm payment → check-in) surfaced two defects that API-only QA missed: (a) no "create student" UI; (b) billing provider placeholder (`REPLACE_WITH_ASAAS_API_KEY`) returning 500. Both fixed (see `FitnessStudentsPage` "+ Novo Aluno" and `paymentProvider` placeholder detection) and covered by unit tests (`tests/unit/paymentProviderPlaceholder.test.js`, `frontend/src/pages/FitnessStudentsPage.test.jsx`).

## Journey → RPA/replay → revisão, treinamento e mentoria/tutoria (2026-08-12)

- **Toda execução QA/Wave grava em RPA/replay.** `runScenarioExecution` (botão "▶ Executar cenário" e "▶ Executar seeds") grava `qa_wave_replay_*` via `writeReplayArtifact` — replay é obrigatório para Waves RPA (`Replay deve estar habilitado`). A revisão analítica de vertical não dispara uma execução implicitamente: `reviewVertical({ recordJourney: true })` exige opt-in explícito. Sem replay de uma execução aprovada, a jornada não é evidência revisável.
- **Pipeline de consumo do replay (já existente, manter ligado):** replay real → `journeyTrainerService` (`api/modules/learning-core/journeyTrainerService.js`: anonimização → roteiro markdown → RAG `training:<replayId>` → `LearningMission`) → `tutorService` (mentoria/tutoria: hints e respostas a partir dos docs `training:*`). Revisão humana: `/dev/rpa-replays` (filtro Origem `qa-waves`, modo "🎓 Treinar").
- **Gravação de jornada na revisão de vertical:** `verticalReviewService.reviewVertical({ recordJourney: true })` (endpoint `POST /api/qa-waves/vertical-review`) encontra cenários executáveis da vertical (status `approved`/`active`/`regression` + seeds de browser + `platformScenarioIds`) e enfileira a execução, retornando `recordedJourney` (executionId + replayIds). Rota: `api/services/verticalReviewService.js` → `findRecordableScenarios` / `recordVerticalJourney`.
- **Drafts NUNCA são executados/gravados automaticamente** — apenas cenários aprovados com seeds de browser. Drafts (`draft_ai`) continuam exigindo aprovação manual antes de virar replay.
- A gravação é o elo que torna a jornada auditável e didática: revisão (auditoria do que QA fez), treinamento (roteiro derivado do replay) e mentoria/tutoria (RAG `training:*` consultado pelo Tutor).

## Revisão de Jornada interativa (2026-08-12)

Botão "🔍 Revisar jornada" na aba Jornadas (`QaWavesPage`) implementa o loop dirigido por IA com aprovação humana:

1. **Inferir** — `POST /api/qa-waves/review-journey/infer` (`journeyReviewService.inferJourneyReview`): gera proposta via `generateScenarioWithAI`.
2. **Mostrar desalinhamento** — `computeMisalignment` compara o cenário atual/ajustado com a proposta (passos faltando/sobrando, seeds, validadores, `platformScenarioIds`).
3. **Ajustes do usuário** — edita o cenário no editor JSON.
4. **Nova inferência** — re-inferir com `baseScenario` (ajustes do usuário como contexto).
5. **Aprovar e atualizar jornada** — `POST /api/qa-waves/review-journey/apply` (`applyJourneyReview` → `saveScenario`, nova versão + histórico).
6. **Detectar falhas/gaps e sugerir correções** — `collectJourneySuggestions` (coverage gaps + business gaps da jornada).

Serviço: `api/services/journeyReviewService.js`. Endpoints: `/api/qa-waves/review-journey/{infer,apply}` (+ `/dev/...`). A gravação da jornada em replay continua ocorrendo quando o cenário aprovado for executado.

## Inferência de IA (mecanismo)

- **Núcleo:** `api/services/qaWavesIntelligenceService.js`. Entradas de inferência:
  - `generateScenarioDraft({ vertical, journey, stage, gap, context })` — gera rascunho de cenário a partir de um gap.
  - `generateSeedsForScenario({ scenarioId, quantity, scenarioContext })` — gera seeds diversificadas.
  - `journeyReviewService.inferJourneyReview` → `generateScenarioWithAI` (proposta na revisão de jornada).
- **Chamada LLM:** tudo passa por `aiProviderService.generateAiResponse(prompt, roleOrTenant, { source, caller })` (fonte `qa_waves_intelligence`). O provider/config vem do tenant de IA (ver `aiProviderService`; não há hardcode de provedor).
- **Prompt:** `SCENARIO_SYSTEM_PROMPT` (papel system: "retorne APENAS JSON válido") + `buildScenarioDraftPrompt`/`buildSeedGenerationPrompt` (formato JSON específico com tipos válidos de `semanticSteps`). Saída esperada é JSON cru ou fenced ```json.
- **Parsing:** `extractJsonFromAiResponse` — extrai JSON de bloco markdown ou plain text; retorna `null` se inválido.
- **Normalização:** `api/modules/qa-waves/aiScenarioAdapter.js` — `normalizeAiOutput`/`adaptAiScenario` sanificam a saída para o schema do RAP (steps, seeds, validators, `platformScenarioIds`).
- **Fallback estrutural:** se IA indisponível ou saída inválida, usa `buildFallbackScenarioDraft`/`buildFallbackSeeds` (templates determinísticos). Nunca lança erro para cima.
- **Invariante de status:** todo rascunho sai com `status: 'draft_ai'` (`aiModel: 'intelligence_engine_v1'`), persiste em `qa/qa-waves/ai-drafts.json` e **nunca** é executado/gravado automaticamente — exige aprovação manual (→ `approved` → `active`).
- Doc canônica detalhada: `docs/qa-waves-ai.md` (arquitetura, endpoints `/api/qa-waves/intelligence/*`, ciclo de vida `draft_ai → approved → active`).

## Current state

Observed on 2026-08-14, the executable state is **NO_GO**, regardless of the older generated snapshot in `docs/governance/PLATFORM_STATUS.md` (2026-08-09):

- `npm run validate:qa-governance` fails because the promoted canonical execution references a missing history artifact: `qa-mesh/meshHistory/mesh-2026-08-09T16-47-06-616Z.json`.
- `qa/qa-waves-enterprise-governance.json` reports `NO_GO`, operational confidence `79.2`, grade `D`, risk `CRITICAL`.
- The scheduled smoke is stale (generated 2026-07-20), has no bound/canonical evidence path or source hash and omits the required `booking_flow` journey.
- Existing prod-like replay records use legacy `gov-sha256` signatures. The gate now accepts only secret-key HMAC (`hmac-sha256`) and therefore rejects those records until they are regenerated by a real smoke.
- `hourly_lightweight` is diagnostic only and writes `qa-waves-scheduled-operational-smoke-hourly_lightweight.json`; it cannot overwrite the canonical release wrapper. Promotion to `qa-waves-scheduled-operational-smoke.json` requires a `realStack` mode and the bridge verifies `prod_like_real_stack`, no fixture server, real backend/database and an isolated tenant.

Do not infer release readiness from `PLATFORM_STATUS.md` alone. The executable governance reports and validators are authoritative; no GO may be declared until a fresh real smoke, signed replays and the exact canonical mesh history all pass.

## Legacy cleanup (2026-07-21)

- Removed 3 scenario-store backups: `scenario-store.backup-1780062163517.json`, `scenario-store.backup-1780062959548.json`, `scenario-store.backup-1780063087327.json`.
- Removed the unused TypeScript duplicate `aiScenarioAdapter.ts` (it lived in api/modules/qa-waves; canonical is `aiScenarioAdapter.js`).
- `dev/qa-waves-ui/` is a legacy prototype (not a git worktree); preserved for reference, not part of the build or release pipeline. Contains uncommitted changes — do NOT delete without explicit confirmation.

## Snapshot refresh cadence (Gap 4)

- `qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json`: observed generated 2026-08-10, but its replay signatures are legacy and do not satisfy the current HMAC contract. Regenerate with the real runtime and configured signing key before release.
- `qa/qa-waves/operational-gaps-report.json`: last generated 2026-05-12. Regenerate via `POST /api/qa-waves/operational/recompute` (requires API running). Recommended cadence: weekly or pre-release.
- `qa/smoke/qa-waves-scheduled-operational-smoke.json`: observed generated 2026-07-20 and invalid/stale on 2026-08-14. Regenerate daily via cron/CI from a real source artifact; the report must bind `evidencePath`, SHA-256, source timestamp and all required journeys. **Automação instalada (2026-08-18)**: `scripts/smoke/run-scheduled-production-health-smoke.sh` roda diariamente às 04:23 via crontab do usuário (modo `production_health`, **prod-like requer containers no Docker local** — `docker-compose.yml` — para simular o ambiente real: API `:3001` e frontend nginx `:8080`, nunca Vite/fixture; log em `logs/qa/scheduled-production-health-smoke.log`). Este cron **respeita a política de agendamento do QA Mesh** (opt-in explícito + fail-closed): sem `enabled:true` persistido (toggle da UI) ou `QA_MESH_SCHEDULER_ENABLED=true` — ou com `QA_MESH_SCHEDULER_DISABLED=true` — o smoke é pulado (SKIP). Se a stack estiver fora, registra SKIP e sai 0 — nunca gera evidência falsa.
- Lightweight scheduled diagnostics use a mode-specific file and are never release evidence; do not copy or rename them into the canonical path.

## qa:waves scripts (Gap 3)

- `npm run qa:waves:business-e2e` → `scripts/qa-waves/generate-business-e2e.js` — generates E2E scenario templates from journey contracts. Deterministic (same contracts → same output). Runs offline (no runtime needed).
- `npm run qa:waves:business-100pct` → `scripts/qa-waves/generate-business-100pct.js` — generates full coverage scenarios (E2E + capability-specific). Depends on `config/journey-contracts.json`, `config/journey-preconditions.json`, `config/capability-dependencies.json`. Deterministic.
- Both scripts are **generators**, not validators. They should be run as part of the release pipeline before `validate:governance-enforcement`. Not plugged into the enforcement gate directly because they require regeneration of scenario files and subsequent mesh execution for validation.
- For CI safety, the validation path is: `qa:waves:business-e2e` / `qa:waves:business-100pct` → `qa:mesh` → `validate:qa-governance` → `validate:qa-waves-registry`.

## Registry validator (Gap 7)

- `npm run validate:qa-waves-registry` → `scripts/governance/validate-qa-waves-registry.js` — validates schema integrity of `config/qa-waves-registry.json`. Checks: required fields, stepCatalog consistency, blueprint↔verticalJourneys cross-references, domain/journey inference rules, keyword mappings.
- Plugged into `validate:governance-enforcement`.

## JSON-store formalization (Gap 8)

QA Waves uses versioned JSON for declarative registries and scenario definitions. Runtime execution history, replay artifacts and governed evidence use the persistent artifact/database layer and must fail closed when persistence is unavailable:

- **Scenario store**: `qa/qa-waves/scenario-store.json` — read/written by `qaWavesService.js`, `gapDetectionEngine.js`, `meshRunner.js`.
- **Enterprise governance**: `qa/qa-waves-enterprise-governance.json` — generated by `tools/system/lib/qa-waves-enterprise-governance-bridge.js` from smoke evidence.
- **Operational gaps**: `qa/qa-waves/operational-gaps-report.json` — generated by `api/services/qaWavesOperationalService.js` via `POST /api/qa-waves/operational/recompute`.
- **Registry**: `config/qa-waves-registry.json` — hand-edited configuration, validated by `validate:qa-waves-registry`.
- **Journey coverage**: `qa-waves/journey-coverage/*.json` — per-vertical coverage artifacts.
- **Smoke evidence**: `qa/smoke/prod-like/` and `qa/smoke/qa-waves-scheduled-operational-smoke.json`.

JSON files that remain mutable are written atomically and scoped by tenant. A JSON or in-memory fallback must not be introduced for runtime artifacts that require durable persistence.

## New scripts (2026-07-21)

- `npm run qa:waves:diagrams` → `scripts/qa-waves/generate-mermaid-diagrams.js` — generates Mermaid diagrams for all scenarios, vertical summaries, and architecture diagrams. Output: `docs/diagrams/qa-waves/` (54 files). Runs offline.
- `npm run qa:waves:runbooks` → `scripts/qa-waves/generate-journey-runbooks.js` — generates per-journey operational runbooks with objectives, preconditions, scenarios, evidence, and troubleshooting. Output: `docs/roteiros/` (18 files for 17 journeys + index). Runs offline.
- `npm run qa:waves:batch` → `scripts/qa-waves/batch-generate-scenarios.js` — batch generation of skeleton scenarios via API. Phase 1: generates scenarios for skeletons without steps (needs AI/RAG). Phase 2: validates and approves draft_ai scenarios. **Requires API + RAG running.**

## Current scenario counts (2026-07-21, updated after batch remediation)

- Total in `scenario-store.json`: 61
  - 43 approved (6 originais + 37 draft_ai validados e aprovados via `save-scenario`)
  - 12 active (materializados de ai-drafts: 11 IA + 1 manual de onboarding)
  - 6 deprecated (esqueletos `fitness-matricula-*` sem steps, substituídos pelos `fitness_full_*`)
- Todos os cenários em status executável (approved/active) possuem steps validados pelo schema.
- Journey coverage: 17 journeys across 6 verticals, 64 scenarios (artefato derivado do store + mesh registry; entradas `business-*` do mesh não têm steps em formato wave por design).
- Historical mesh snapshot: 47/47 GO (June 2026). It is not current release evidence.
- Current executable governance: `NO_GO` as observed on 2026-08-14; see the Current state section.

## Batch remediation notes (2026-07-21)

- `ALLOWED_SCENARIO_SOURCES` em `waveScenario.constants.js` incluía apenas 4 fontes; ampliado com `catalog`, `auto-generated-e2e`, `auto-generated-cap`, `auto-generated-precond` (produzidas pelos geradores do subsistema). Causa das 37 rejeições em massa na Fase 2 do batch.
- `scripts/qa-waves/batch-generate-scenarios.js`: Fase 2 agora aprova cenários do store via `save-scenario` (o endpoint `intelligence/approve-scenario` atua só sobre `ai-drafts.json`); flag `--phase2-only` pula a geração; erros de validação impressos serializados.
- `save-scenario` normaliza `steps := semanticSteps` quando `semanticSteps` existe — ao editar steps de um cenário, atualizar ambos os arrays.
- Draft junk `fitness_full_missing_e2e_scenario` (fallback estrutural, id determinístico reutilizado entre jornadas quando a IA falha) foi rejeitado; onboarding coberto pelo draft manual `fitness_full_onboarding_whatsapp_primeiro_acesso_e2e`.
- `business-e2e-omnichannel_engagement` ganhou `step_omnichannel_engagement_006` (validate_backend, backendEntity=conversation) para fechar `gap-enterprise-missing-backend-assertions`.

## Runbooks

6 runbooks operacionais em `docs/runbooks/`:
1. Criar Cenário
2. Executar Wave
3. Ler Governança
4. Tratar NO_GO
5. Integridade de Replay
6. Bot de Geração


## Browser-driven validation session (2026-07-22)

Ciclo completo dirigido por browser real (Playwright headed, DISPLAY=:1) com driver `scripts/qa-waves/browser-run-cycle.js`: login → tenant `system` → `/dev/qa-waves` → jornada FITNESS/Leads → cenário `fitness-matricula-leads` → Executar cenário (HTTP 202) → replay em `/dev/rpa-replays?search=<replayId>` → operational-health → enterprise-governance. Evidências em `AI_MEMORY/evidence/qa-waves/browser-run-*/` (screenshots + run-report.json). Última execução verde: `meshq-1784714101201-hev4kh`, replay `qa_wave_replay_1784714101202_h2mjob` — execução `completed/success`, `stateSnapshotContract.valid=true` (8/8 probes), detalhe do replay na UI com ANTES/DEPOIS captured e 25 passos.

### Bugs encontrados e corrigidos na sessão

1. **`filterLocalRunnable` elimina IDs pipeline-only silenciosamente**: cenário com `platformScenarioIds` só de mesh scenarios `requiresOfficialPipeline` falha 500 em contexto local (`MISSING_PLATFORM_SCENARIO_IDS`). Comportamento correto, mas a mensagem não distingue "sem IDs" de "IDs filtrados". 28/47 mesh scenarios exigem pipeline; apenas `fitness-matricula-leads` é approved + local-runnable.
2. **QaWavesPage `selectedScenarioId` default = `items[0]` global**: sem selecionar o cenário na UI, "Executar cenário" roda o primeiro da lista (hoje `beauty-campanha-lead-pagamento`). No driver: clicar a jornada Leads **na aba Cenários** (o filtro `selectedJourneyId` é por aba) e então o botão `<id>@<version>`.
3. **Contrato de snapshot ausente para `leads`** → adicionado em `config/state-snapshot-contracts.json` (before: `crm.leads.count`, `crm.activities.count`, `events.audit.count`; after: mesmos + `replay.exists:exists`, `replay.stepCount:incremented`).
4. **Collector de snapshot ausente para `leads`** (`journey_snapshot_collector_not_configured`, buckets vazios) → `collectLeadsSnapshot` em `api/services/qa/stateSnapshotService.js` (MarketingLead, VerticalJourneyEvent, AuditEvent/AuditLog) + dispatch em `collectOperationalSnapshot` + `getRequiredSources('leads') = ['db','api','crm','audit']`.

### Follow-ups registrados (não bloqueantes)

- **GO estrutural do replay `leads`**: o NO_GO remanescente vem de provas de browser (screenshotAfter/network proof) que só existem para jornadas blocking (`support_ticket_flow`, `fitness_customer_checkin`) com step definitions + `browserOperationalRunner` + seed provisioning. Promover `leads` exige: criar `leadsFlowSteps.js` em `api/services/qa/journeyStepDefinitions/`, seed operacional (`leadsOperationalSeed.js` em `qa/seeds/`), registro em `isBlockingOperationalJourney`/`resolveJourneyStepSpecs`/`validateOperationalSeedOutcome`, e então `:incremented` em tabelas de negócio passa a ser exigível. Estimativa: 1-2 dias.
- **Não registrar `step_001..step_007` no `operationalStepRegistry`**: o registry é global por stepId e outros cenários reutilizam ids genéricos — registro causaria colisão (`step_action_type_not_canonical`). Os blockers `operational_step_contract_missing`/`replay_step_missing_network_proof` para jornadas simuladas são advisory (`blocking: false`) e by design.
- **3 testes falhando em `api/services/__tests__/operationalSemanticConsistency.test.js`**: pré-existentes (falham também sem as mudanças desta sessão).
- `save-scenario` normaliza `steps := semanticSteps` (já registrado acima); edits diretos no store exigem atualizar ambos.

## Replay como treinamento + base de conhecimento (2026-07-22, sessão 2)

- Nova execução do ciclo browser-driven (`scripts/qa-waves/browser-run-cycle.js`, headed DISPLAY=:1): execução `meshq-1784735269632-0rsztq`, replay `qa_wave_replay_1784735269633_nkhthn`, cenário `passed` (7 passos, 27,1s, 0 erros). Evidências: `AI_MEMORY/evidence/qa-waves/browser-run-2026-07-22T15-46-55-336Z/`.
- Roteiro de treinamento para novos usuários gerado a partir do replay real: `docs/roteiros/treinamento-jornada-fitness-leads.md` (como assistir ao replay, o que cada um dos 7 passos valida, interpretação GO/NO_GO, FAQ). Indexado em `docs/roteiros/README.md`.
- Roteiro ingerido no RAG: documento `doc-1784735874169-tkgp3fppt` (tenant `system`, source_id `roteiro:treinamento-jornada-fitness-leads`, 13 chunks). Query de verificação "como executar o cenário fitness-matricula-leads e onde vejo o replay?" retornou `success=true`, confidence 0.87, source = chunk do roteiro.
- Como ver o replay na UI: `http://localhost:5173/dev/rpa-replays?search=qa_wave_replay_1784735269633_nkhthn` → clicar no item → botão Play no modal (25 passos, timeline ANTES/DEPOIS).

### Lições operacionais do RAG (não óbvias)

- A API espera o rag-service em **http://localhost:8001** (não 8000). Subir com `cd rag-service && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/r_agent2 ./venv/bin/uvicorn main:app --host 127.0.0.1 --port 8001`. Sem `DATABASE_URL`, `dbConfigured=false` e `/rag/query` falha com "Postgres DSN não configurado".
- Rotas RAG da API ficam **sem prefixo `/api`**: `POST /rag/documents`, `POST /rag/documents/:id/reindex`, `POST /rag/query` (exige `tenantId` no body ou header `x-tenant-id`).
- Se a indexação for para um rag-service que depois morre, reindex retorna `0 chunks (duplicado)` — o dedup estrutural (`ragDeduplicationService`) fica em memória no processo da API. Solução: recarregar a API (`touch api/server.js` com nodemon) e reindexar.

## Polling → WebSocket/eventos + passo a passo das telas (2026-07-22, sessão 3)

Pedido: "trocar tudo o que for pooling por websocket" no fluxo QA Waves/RPA e exibir o preenchimento das telas da UI no replay.

### Arquitetura de sincronização (sem polling)

- `qa-mesh/executionQueue.js`: `EventEmitter` em processo (`executionEvents`, evento `updated`); `waitForQueuedExecution(executionId, {timeoutMs, onUpdate})` resolve em status terminal por evento, com **um único deadline** (não é polling). `updateExecution` emite a cada patch.
- `api/services/qaWavesExecutionService.js` `monitorExecution`: loop `setTimeout(poll)` substituído por `waitForQueuedExecution` (orçamento padrão 720s, env `QA_WAVES_MONITOR_MAX_POLLS`). Timeout → `failAndFinalize` preservando os erros `execution_not_found`/`timeout`; sucesso → `finalizeExecutionArtifacts` + WS `qa-waves.execution.updated`.
- `api/services/rpaService.impl.js`: `rpaExecutionEvents` (EventEmitter) emitido em toda mutação de status/progresso da execução RPA (running/paused/completed/failed/cancelled), com payload redigido e sem caminhos internos; a ponte WS emite `rpa.execution.updated` somente para o tenant autenticado. Gravações manuais emitem `rpa.recording.updated` em start/stop com o mesmo isolamento.
- `qa-mesh/adapters/rpaAdapter.js` `waitForExecution`: loop `while/sleep(1000)` substituído por espera orientada a evento no `rpaExecutionEvents` + primeira leitura síncrona + deadline único (10min). Shape de retorno preservado (artifacts, rawStatus, normalizedErrors, onStepProgress).
- `api/services/websocketService.js`: o handshake exige autenticação e resolve tenant/agent no servidor. Eventos RPA sem `tenantId` são rejeitados; broadcast global não é permitido para execuções, gravações ou logs.
- `api/modules/qa-mesh/routes.js`: `POST /qa-mesh/run` agora passa `tenantId` (senão `emitQaWavesExecutionRealtime` não emite).
- Frontend: `QaMeshPage` (polling 1.5s → WS `qa-waves.execution.updated`, map success→completed/processing→running) e `RpaSeedsPage` (pollings de gravação 2s e execução 2s → WS `rpa.recording.updated`/`rpa.execution.updated`; deadline de segurança de 10min mantido). `RpaReplaysPage` tem um `setInterval` que é apenas o **timer de animação do playback** (botão Play) — não é sincronização de estado, mantido de propósito.
- O que NÃO virou evento (de propósito): backoff de retry do adapter (`sleep(1000)` entre tentativas), `nodeCronCompat` (scheduler cron) e waits internos do Playwright.

### Passo a passo das telas no replay (uiTrace)

- `buildUiTrace(result)` em `qaWavesExecutionService.js`: mapeia `rawStatus.results.steps` do RPA para `uiTrace` no replay JSON (ação, seletor, valor preenchido, screenshots ANTES/DEPOIS como data URI, limite 900KB/screenshot).
- **`qa-mesh/meshRunner.js` descartava `rawStatus`** ao montar o resultado do cenário (pick campo a campo) — por isso o `uiTrace` vinha vazio. Fix: `compactRawStatus()` (remove domSnapshot/consoleLogs/logs, mantém steps com screenshots e networkEvents) incluído no resultado.
- `RpaReplaysPage.jsx`: `getReplaySteps` inclui `uiTrace` como itens `trace-step` (🖥️), com linha "📝 Valor preenchido" para inputs primitivos.
- Seed `rpa/seeds/fitness-matricula-leads.json` v1.4.0: 11 passos de UI (qa-waves → aba Cenários → filtro Leads → cenário → /dev/rpa-replays → busca `qa_wave_replay`), `metadata.authOptions.loginStrategy="ui"`, interações `critical:false` (passo opcional que falha custa 15-50s cada).

### Armadilhas diagnosticadas (custo alto, não reabrir)

- **Corrida Login × navegação alvo**: em rota protegida o app renderiza Login **mantendo a URL** (`/dev/qa-waves`); após o login, o componente Login redireciona para `/workspace` de forma assíncrona. Se o auto-login checar `page.url() === targetUrl` antes desse redirect, ele pula a navegação e o app cai em `/workspace` (flaky sob carga; em probe isolado passa). Fix em `core/rpa/utils/autoLoginFlow.js`: após login SEMPRE recarregar a rota alvo, aguardar a SPA assentar (≥2.5s), verificar redirect e tentar 1 retry com `handleTenantSelectorModalIfPresent` (30s).
- `handleTenantSelectorModalIfPresent` **não era exportada** de `core/rpa/utils/authHelper.js` (erro `is not a function` → cenário flaky/infra_error). Exportada.
- Nodemon vigia só `api/` e `engine/`: mudanças em `qa-mesh/`, `core/rpa/` exigem `touch api/server.js` para recarregar.
- Execuções RPA com screenshots sob carga levam 6-8min (adapter pode fazer 2 tentativas de até 10min); orçamento do monitor precisa ser ≥12min.
- Tokens de sessão da API são em memória: qualquer restart invalida tokens/sessões de browser em andamento.

### Testes

- `qa-mesh/__tests__/executionQueue.wait.test.js` (6) e `qa-mesh/__tests__/rpaAdapter.wait.test.js` (6): waits por evento, timeout, progresso, isolamento por executionId. `resetMocks:true` no jest.config exige redefinir `mockImplementation` em `beforeEach` (implementações na factory do `jest.mock` são apagadas).
- Regressões: qa-mesh 7 suítes/56 testes, qaWavesExecutionService 16, rpaAutoLoginFlow 5 — todos verdes.

### Root causes finais da validação E2E (sessão 3, adendo)

- **`api/utils/urlNormalizer.js` sem guarda de template**: a versão usada pelo `rpaService` (diferente de `core/rpa/utils/urlNormalizer.js`) não devolvia URLs com `{{...}}` intactas — `{{urls.frontend}}/dev/qa-waves` virava `http://localhost:5173/{{urls.frontend}}/...`, rota desconhecida → redirect autenticado para `/workspace` (a "corrida Login×nav" acima era hipótese parcial; este era o root cause real do redirect). Fix: `if (/\{\{[^}]+\}\}/.test(url)) return url;` no início de `normalizeUrl`. Teste novo `api/utils/__tests__/urlNormalizer.test.js` (3/3).
- **`auth.maxSessionsPerAgent` default 3** (`api/services/authService.js`, `cleanupOldSessions`): cada login extra (driver do ciclo, curls de diagnóstico, o próprio RPA) purgava a sessão mais antiga do cache+DB — o app do RPA caía em `/login` no meio do run (foi o que sabotou o probe 14). Mitigação dev (não commitada, `api/data/config.json` é gitignored): `auth: {maxSessionsPerAgent: 20, inactivityTimeoutMinutes: 120}`. Regra operacional: não criar tokens curl desnecessários durante um run RPA.
- Seed `rpa/seeds/fitness-matricula-leads.json` **v1.5.1**: 15 passos espelhando o driver `scripts/qa-waves/browser-run-cycle.js` (o filtro "Leads" é por **aba**, não por lista — clicar Leads, depois Cenários, depois Leads de novo). `button:text-is("Leads")` NÃO funciona (badge "warning" dentro do texto); usar `button:has-text("Leads")`.

### Resultado da validação E2E (rodada 14, 2026-07-22 ~20:29 UTC)

- Primeira rodada com TODOS os fixes (urlNormalizer + seed v1.5.1 + maxSessions 20): execução `meshq-1784752144172-whub9u` **success**, cenário `fitness-matricula-leads` **passed**, duração ~1m50s (muito mais rápido que as 6-8min anteriores — sem retries por sessão purgada), `goNoGo: GO` no summary da execução.
- Replay `qa_wave_replay_1784752144172_emuot9` (12.3 MB): **uiTrace com 15/15 entradas**, todas com `screenshotBefore`/`screenshotAfter` data-URI; os 15 passos do seed executaram sem falha (incluindo `text-is("Cenários")` e o click no cenário).
- Modal do replay na UI (`/dev/rpa-replays`): 59 passos no log, resultado "✓ Sucesso", passos 🖥️ (uiTrace) renderizados com seletor/ação/status/duração. Evidências em `AI_MEMORY/evidence/qa-waves/replay-{list,detail,uitrace-step}-rodada14.png`.
- "Governança operacional: NO GO" exibido no replay é **estrutural e esperado** (jornada leads não-blocking, sem provas de browser obrigatórias) — não é falha da execução.
- O driver do ciclo reporta `execution-finished: timeout_waiting` porque o wait dele é mais curto que o run do RPA; a execução finaliza corretamente depois, via eventos (verificar pelo JSON do replay, não pelo log do driver).

## Remoção de fallbacks heurísticos — inferência via registry + IA (2026-07-22, sessão 4)

Princípio AI-native (commit `89b0180`) aplicado à varredura completa de inferências:

- **`qa/qa-waves/services/journeyInferenceService.js`**: `inferJourneyHeuristically` (scoring por tokens/keywords) removida. Nova `resolveJourneyFromRegistry(input)` — lookup estrito: sem `journeyId` ou `journeyId` fora do registry → `null`. `inferJourney`: `journeyId` explícito → lookup (desconhecido → erro `JOURNEY_NOT_FOUND`); sem `journeyId` → `inferJourneyWithAI` (falha propaga `AI_UNAVAILABLE`). Opção `useAi:false` deixou de existir.
- **`api/services/qaWavesScenarioService.js`**: `normalizeScenarioRecord` e `inferScenario` usam `resolveJourneyFromRegistry`. Jornada não resolvida fica com `journeySource: 'unresolved'` (o store exige `journeyId` não vazio; o valor original é preservado) e o caminho async (`generateScenarioWithAI` → `resolveJourneyMetadata`) resolve via IA — `journeyId` que não existe no registry é descartado e a IA escolhe entre as candidatas da vertical.
- **`api/services/qa/systemDiscoveryEngine.js`**: `DEPENDENCY_HEURISTICS` + inferência por substring de tags removidas. `inferDependencies` lê `config/capability-dependencies.json` como fonte de verdade; capability sem entrada → `dependsOn: []` (não inventa dependência).
- **`tools/system/platform-readiness.js`**: cobertura de jornadas por vertical passa a contar apenas `journeyId` **declarado** (store/mesh registry); cenário sem jornada declarada não conta (antes a heurística atribuía uma jornada arbitrária ou `${vertical}_default_journey`).
- **Intent Engine (`src/core/cognitive/intent-engine/`)**: regras keywords/regex removidas — classificação 100% via LLM, prompt prioriza atendimento/necessidades de negócio; falha da IA → handoff humano `ai_unavailable` (nunca heurística).
- **Labels**: `MarketPredictionEngine` default `statistical_market_regression_v1` (era `heuristic_...`); `googleAdsRecommendationService` default source `'ai'`. Toggle morto `fallbacks.ticketInsightHeuristic` removido de `ConfigFallbacksTab.jsx` (o backend já não lia a chave).
- **Mantidos de propósito** (não são fallback de inferência): `semanticContextService` e `googleAdsKeywordInsightService.heuristicRecommendations` (pré-processamento determinístico que alimenta o prompt da IA), extração de entidades por regex no intent engine, `inferDomainFromCapability`/`inferModuleFromEvidence` (indexação determinística do discovery, não substituto de IA).
- **Gap de contrato registrado**: `contracts/ia/` cobre envelopes de geração (chatbot_flow, rpa_test, tenant); não existe contrato JSON formal para classificação de intenção — o contrato vigente está documentado no header do intent-engine e em `docs/cognitive-core/architecture.md` (tabela "Decisões de comportamento").
- Testes: `tests/unit` 345 suítes/1700 testes verdes; qa-waves 3 suítes/16 testes verdes. Falhas em `api/services/__tests__` (authService, websocketService, operationalSemanticConsistency, evidenceProofValidator, causalHardeningGovernance, autonomousGapClosureEngine) são **pré-existentes** (PostgreSQL indisponível no ambiente Jest / assertions já quebradas na base `94f720a`) — confirmado via `git stash`.
