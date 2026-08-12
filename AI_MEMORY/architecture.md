# RAP Architecture Memory

## Official framing

RAP/r-agent2 is the Results Autonomous Platform: a multi-tenant Autonomous Operations Platform where operational events become project/customer state, decisions, executions, learning, QA evidence and release governance.

Core loop: Observe -> Project State -> Decide -> Execute -> Learn.

Agent OS layer (2026-06-11): see `AI_MEMORY/agent-os.md` for Agent Registry, Factory, Knowledge Graph, Journey Registry, RAP Learn, AI Governance, Marketplace, Orchestrator and Vertical Templates.

## Canonical sources to read first

- `README.md`
- `docs/00_DOCUMENTACAO_INDEX.md`
- `docs/OBJETIVO_FINAL_PLATAFORMA.md`
- `docs/ARQUITETURA_TECNICA.md`
- `docs/RESULTS_PLATFORM_ARCHITECTURE.md`
- `docs/CANONICAL_PROCESS_ARCHITECTURE.md`
- `docs/DURABLE_PROCESS_RUNTIME_ARCHITECTURE.md`
- `docs/architecture/STATE_OF_ARCHITECTURE.md`
- `docs/governance/00_DOCUMENTATION_INDEX.md`
- `docs/governance/PLATFORM_STATUS.md`

## Runtime layers

- `frontend/`: React 18 UI, route composition in `frontend/src/main.jsx`, navigation in `frontend/src/navigation/menu.js` and `frontend/src/navigation/workspaceAreas.js`.
- `api/`: Express backend, route registration in `api/app/registerRoutes.js` and `api/app/routeRegistry.js`.
- `api/modules/*`: bounded route modules for auth, workspace, CRM, channel accounts, QA, QA Waves, QA Mesh, RAG, PBX, process runtime and verticals.
- `api/services/*`: orchestration and domain services.
- `api/core/process-runtime/*`: deterministic durable process runtime.
- `core/rpa/*`: deterministic RPA recording/replay/player and recovery utilities.
- `qa/`, `qa-mesh/`, `qa-waves/`: validation, scenario mesh, evidence and wave coverage.
- `governance/`: self-proving, replay integrity, package validation, tamper detection and final readiness reports.
- `rag/` and `rag-service/`: RAG adapters/service boundaries.
- `pbx/`: Asterisk/PBX config and voice/contact-center integration.

## Integration model

RAP Workspace is the operational single pane. It links CRM, tickets, timeline, messages, tasks, agenda, documents, payments, QA/RPA evidence, insights and actions.

QA Waves and QA Mesh are not optional test extras. They are governance inputs for release decisions. Replay evidence is part of provenance and must remain traceable by hash/signature/integrity reports.

## Current governance state observed

As of `docs/governance/PLATFORM_STATUS.md` (updated 2026-05-28), the canonical mesh decision is `GO` with 47/47 scenarios passed, 0 failures across all 11 domains. All blocker domains (pbx, omnichannel) are resolved. Release readiness is GO.


## Cognitive Core (2026-06-12)

RAP Cognitive Core e o nucleo obrigatorio de inteligencia da plataforma; agentes (Agent OS) sao camada opcional sobre ele.

- Codigo: `src/core/cognitive/` (context-engine, intent-engine, action-planner, tool-registry, execution-engine, validation-engine, learning-engine, cognitive-orchestrator).
- Pipeline obrigatorio: INPUT -> CONTEXT -> INTENT -> PLAN -> EXECUTE -> VALIDATE -> LEARN.
- Docs canonicas: `docs/cognitive-core/` (current-state, gap-analysis, architecture, tool-registry, visibility-policy, acceptance-report).
- Tool Registry delega para servicos existentes (marketingService, scheduleService, queueService, whatsappService, handoverService, ccClick2CallService, ccCampaignsService, WorkspaceInsightService). Nenhuma execucao direta.
- Visibility PRODUCTION/SUPPORT/DEVELOPMENT reutiliza a politica de `api/modules/agent-os/experience-segregation.js`; QA Waves/Replay/Seeds/Mesh/RPA permanecem ocultos da operacao.
- Aprendizado: event ledger (`cognitive.execution.*`) + RAP Learn em falhas. Nao altera regras criticas automaticamente.
- Agentes opcionais: `src/core/agents/README.md`.
- Intent Engine (2026-07-22): **AI-first**. A classificacao heuristica por keywords/regex foi removida; a intencao e classificada exclusivamente via LLM (`aiProviderService`) com prompt que prioriza atendimento ao cliente e cobertura das necessidades de negocio. Falha/indisponibilidade da IA -> handoff humano explicito (`source: 'ai_unavailable'`); confianca < 0.55 ou intent fora da taxonomia -> `transferir_humano`. Extracao de entidades (telefone, e-mail, data, hora) segue deterministica (parsing de dados, nao inferencia).
- Agent Runtime (2026-08-09): pipeline estendido INPUT -> CONTEXT -> INTENT -> **AGENT SUPERVISOR** -> SPECIALIST PROFILE -> PLAN -> **EXECUTION ROUTER** (ATOMIC: Tool Registry | DURABLE: Process Runtime) -> VALIDATE -> LEARN. Novos modulos: `agent-supervisor/`, `execution-router/`, `capability-registry/`, `principal.js` (fail closed, sem wildcard implicito) em `src/core/cognitive/`; MCP em `src/core/mcp/` (server-adapter, client-hub, external-tool-adapter, auth). Doc canonica: `docs/architecture/agent-runtime-mcp.md`.

## Learning Core (2026-07-23)

Dominio de aprendizado de USUARIO (distinto do RAP Learn, que e aprendizado de maquina): observar interacoes na UI, descobrir competencias e, em fases futuras, ensinar/simular/avaliar/certificar sem interromper o trabalho.

- Memoria operacional canonica: `AI_MEMORY/learning-core.md`.
- Fase 0 entregue: telemetria de interacao — tipos `learning.interaction.*` no event ledger, ingest `POST /api/learning/interactions` (`api/modules/learning-core/`), agregado `user_interaction_sessions`, tracker frontend `frontend/src/core/interactionTracker.js` (feature flag `learningCoreEnabled`, default OFF).
- Fase 1 entregue: Skill Graph (`npm run learning:skill-graph:build` -> `config/learning/skill-graph.json` + knowledge-graph) e Competency Engine (nucleo puro `src/core/learning/competency-engine/` + `competencyService.js`; scores por skill com evidenceRefs do ledger; classificacao de rotas desconhecidas AI-first, sem heuristica). Rotas `GET /api/learning/competencies/me|/:userId`, `POST .../recompute`, `GET /api/learning/skill-graph`.
- Fase 2 entregue: RAP Academy (`/academy`, read-only, item "Minha Evolucao" no menu) + Tutor niveis 0-1 (detector deterministico de dificuldade no ingest; dica via RAG emitida por WS `tutor.hint` so para o agente; TutorDock na shell; hints persistidos em `learning_tutor_hints` com cooldown 15min). `GET /api/learning/profile/me`. Rotas novas de pagina exigem registro em `allRoutes`/`protectedRoutes` no `main.jsx` (senao redirect para /workspace).
- Fase 3 entregue: Journey Trainer + Simulation Engine — anonymizer puro (`src/core/learning/anonymizer/`, fills de replay sempre mascarados), pipeline replay → anonimizacao → markdown → RAG `training:<replayId>` → missao (`journeyTrainerService.js`), simulacoes com personas sinteticas (`src/core/learning/simulation-engine/`, enriquecimento IA opcional), missoes coletivas/por usuario (`missionService.js`), Academy com 3 tabs. `nodemon.json` vigia `src/`.
- Fase 4 entregue: Assessment Engine puro (`src/core/learning/assessment-engine/`, recuperacao por janela de 24h), Certification Engine (emissao por thresholds de evidencia com snapshot auditavel; revogacao por drift), Mentor (agregados 7/30/90d + plano via IA; AI_UNAVAILABLE explicito), Adaptive (sinais drift/rotas nao classificadas/skills fracas + ciclo de reavaliacao), Analytics (overview do tenant + ROI proxy 30d vs 30d), Tutor niveis 2-4 (`POST /api/learning/tutor/help`: explica/guia/demonstra) e Academy com 6 tabs (Analytics admin).
- Automacao (2026-07-23): job kind `learning_adaptive_cycle` na execution queue (orquestrado por `adaptiveCycleService.js` — adaptive + recompute de ativos 24h), schedule seed 6h (`sch-learning-adaptive-cycle`) e scheduler generico (`schedulerService.startScheduler`) finalmente iniciado em `api/runtime/startWorkers.js` — gap de plataforma corrigido (a tabela `schedules` nunca era varrida).
