# Project Map

## Core directories

- `frontend/`: React UI, pages, navigation, API client, Playwright/Vitest tests.
- `api/`: Express API, middleware, modules, services, DB models/migrations.
- `api/modules/agent-os/`: Agent Operating System — registry, factory, knowledge graph, journey registry, rap-learn, ai-governance, marketplace, orchestrator.
- `api/modules/agent-registry/`: Corporate agent CRUD and classification.
- `api/modules/knowledge-graph/`: Knowledge graph nodes and edges.
- `api/modules/journey-registry/`: Business journey registry.
- `api/modules/rap-learn/`: Continuous learning pipeline.
- `api/modules/ai-governance/`: AI audit trail and compliance.
- `api/modules/agent-marketplace/`: Internal agent catalog.
- `api/modules/vertical-templates/`: Vertical business templates.
- `core/rpa/`: RPA CLI, recorder, player, deterministic replay and recovery.
- `qa/`: QA runner, reports, checkpoints and evidence.
- `qa-mesh/`: mesh registry, runner, scheduler, adapters, metrics, go/no-go and gap engine.
- `qa-waves/`: journey coverage and wave artifacts.
- `governance/`: proof, package, replay, tamper and readiness engines/reports.
- `docs/`: canonical product, architecture, operation, QA, RAG, release and governance docs.
- `scripts/`: bootstrap, release, deploy, smoke and utility automation.
- `tools/system/`: official system lifecycle commands.
- `rag/`, `rag-service/`: RAG context pipeline/service.
- `pbx/`: PBX/Asterisk integration assets.
- `migrations/`: DDL migration scripts. `agent-os-2026-06-11.sql` for new Agent OS tables.

## Important scripts

- `npm run system:bootstrap`
- `npm run system:validate`
- `npm run system:release`
- `npm run system:deploy`
- `npm run zip:release`
- `npm run qa:mesh`
- `npm run test:governance`
- `npm run test:rpa:jest`
- `npm run frontend:build`
- `npm run stack:versions:sync` — regenera `AI_MEMORY/stack-versions.md` a partir das fontes declaradas
- `npm run validate:stack-versions` — valida o doc + fiação da página "Versões da Stack"

## Pipelines and gates

- `.github/workflows/release-governance.yml`
- `scripts/release-governance-ci.sh`
- `scripts/verify-enterprise-governance-v2.sh`
- `scripts/check-dist-clean.sh`
- `scripts/release-payload-blocklist.sh`
- `tools/system/release-gate.js`

## Existing documentation inventory

Primary indexes already exist in `docs/00_DOCUMENTACAO_INDEX.md` and `docs/governance/00_DOCUMENTATION_INDEX.md`. Treat duplicate/historical docs under `dev Documentos/` and root reports as historical unless a canonical index points to them.

## Known consolidation gaps

- Historical docs and root reports duplicate parts of canonical docs.
- Runtime route aliases are not all documented in one canonical place before this AI memory.
- Canonical QA Mesh is GO (mesh-2026-06-11, 47/47, 0 failures). Enterprise governance GO (regenerated 2026-07-21). Platform readiness: AUTONOMOUS_READY_GO (score 98.5, 0 blocking gaps). Overall governance score: 100 (all 7 pillars PASS).

