# Project Map

## Core directories

- `frontend/`: React UI, pages, navigation, API client, Playwright/Vitest tests.
- `api/`: Express API, middleware, modules, services, DB models/migrations.
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
- Current governance docs report canonical mesh `NO_GO`, so release memory must preserve that blocker.

