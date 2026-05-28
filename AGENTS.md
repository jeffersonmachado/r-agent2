# AGENTS.md - RAP/r-agent2 Agent Operating Contract

This repository is AI-native. All agents must use `AI_MEMORY/` as the first operational memory layer and must preserve existing governance.

## Mandatory startup

1. Read `AI_MEMORY/architecture.md`, `AI_MEMORY/project-map.md`, `AI_MEMORY/project-runtime-map.md`, `AI_MEMORY/operational-rules.md` and the area-specific memory file.
2. Check `docs/governance/PLATFORM_STATUS.md` before release/governance claims.
3. Inspect existing docs before creating new docs.
4. Preserve user/worktree changes; do not revert unrelated files.
5. Run or preserve the relevant executable enforcement gates before claiming completion.

## Executable enforcement

Documentation is not sufficient. Agents must use the blocking validators in `scripts/governance/`:

- `npm run validate:ai-memory`
- `npm run validate:runtime`
- `npm run validate:browser-evidence`
- `npm run validate:qa-governance`
- `npm run validate:replay-governance`
- `npm run validate:release-governance`
- `npm run validate:dist`
- `npm run validate:agent-adherence`
- `npm run validate:self-proving`
- `npm run validate:governance-summary`

`npm run validate:governance-enforcement` is the aggregate gate. If any validator fails, the task is not release-green and the failure must be reported with the generated `reports/*.json` evidence.

## Runtime validation

- Before documenting web behavior, authenticate in the real frontend with `tests/helpers/playwrightAuth.js`.
- Use `systemadmin`/`Admin123!` and tenant `system` only for local QA validation unless the task specifies another credential source.
- Validate DOM, final URL, menu/sidebar origin, permissions, console errors and network failures.
- Record aliases and gaps in `AI_MEMORY/runtime-navigation.md` and `AI_MEMORY/project-runtime-map.md`.

## Governance

- QA Waves, QA Mesh, replay integrity, package validation, release gate and self-proving are release blockers.
- Never declare `GO_FINAL_HARDENED` while canonical mesh/release governance is `NO_GO`.
- Never claim `overallGovernance >= 95` unless `reports/governance-score.json` exists and reports `status=PASS`.
- Keep evidence outside `dist/` and out of release payloads unless explicitly approved by release tooling.
- Never commit `.env`, `.token.env`, tokens, dumps, backups, `node_modules` or transient browser auth caches.

## Implementation standards

- Follow existing architecture and conventions before adding abstractions.
- Backend is CommonJS; frontend is ES modules.
- Frontend route truth is `frontend/src/main.jsx`; menu truth is `frontend/src/navigation/menu.js`.
- Official release path is `npm run system:validate`, `npm run zip:release`, `npm run system:release`.
- Official AI-native enforcement path is `npm run validate:governance-enforcement` followed by `npm run zip:release` when release packaging is in scope.
- Browser tests must reuse `tests/helpers/playwrightAuth.js`.
