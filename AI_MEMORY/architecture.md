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
